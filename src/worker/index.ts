import type { Env } from './env';
import { can, currentUser, hasAccess, subState, type Role, type User } from './auth';
import { BY_ID } from './connectors';
import { refreshSnapshot, runTick } from './scheduler';
import { json, now, rawJson, hashId, dayOf } from './util';

const ROLES: Role[] = ['admin', 'analista', 'lector'];
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function sameOrigin(req: Request): boolean {
  const o = req.headers.get('Origin');
  return !o || o === new URL(req.url).origin;
}

async function audit(env: Env, actor: string, action: string, detail: unknown) {
  await env.DB.prepare('INSERT INTO audit (at, actor, action, detail) VALUES (?, ?, ?, ?)').bind(now(), actor, action, JSON.stringify(detail)).run();
}

function pagoInfo(env: Env, email: string | null) {
  const usuario = env.PAYPAL_USER ?? 'garavide';
  return {
    importe: parseFloat(env.PRICE_EUR ?? '10'),
    periodo: 'año',
    pruebaDias: parseInt(env.TRIAL_DAYS ?? '30', 10),
    paypal: '@' + usuario,
    enlace: env.PAYPAL_LINK || `https://www.paypal.com/paypalme/${usuario}`,
    tipo: 'Amigos y familiares',
    nota: env.PAYPAL_NOTE ?? 'regalo familiar',
    email,
  };
}

export async function verifyForecasts(env: Env): Promise<number> {
  const hoy = dayOf(now());
  const { results } = await env.DB.prepare('SELECT made_on, horizon, due_on FROM forecasts WHERE realized IS NULL AND due_on < ? LIMIT 200').bind(hoy).all<any>();
  if (!results.length) return 0;
  const row = await env.DB.prepare("SELECT data FROM series WHERE key = 'close'").first<{ data: string }>();
  if (!row) return 0;
  const close = new Map<string, number>(JSON.parse(row.data));
  const ups = results.filter((r) => close.has(r.due_on)).map((r) => env.DB.prepare('UPDATE forecasts SET realized = ? WHERE made_on = ? AND horizon = ?').bind(close.get(r.due_on), r.made_on, r.horizon));
  if (ups.length) await env.DB.batch(ups);
  return ups.length;
}

async function api(req: Request, env: Env, ctx: ExecutionContext, path: string, user: User | null, email: string | null): Promise<Response> {
  const m = req.method;
  const read = env.ACCESS_MODE === 'publico' || (env.ACCESS_MODE === 'privado' ? !!user : hasAccess(user));

  if (path === '/api/me') {
    return json({ email, usuario: user, modo: env.ACCESS_MODE, accesoConfigurado: !!(env.ACCESS_TEAM && env.ACCESS_AUD), anuncios: env.ADS_ENABLED === 'true', pago: pagoInfo(env, email) });
  }
  // Vista previa pública (página de bienvenida): solo el precio de referencia
  if (path === '/api/publico') {
    const s = await env.KV.get('snapshot', 'json') as any;
    return json({ precio: s?.precio?.price ?? null, cambio24h: s?.cambio24h ?? null, generado: s?.generado ?? null, fuentes: (s?.fuentes ?? []).length }, { maxAge: 60 });
  }

  // Diagnóstico de conectores (protegido con el token del calibrador): ejecuta las fuentes indicadas sin guardar nada
  if (path === '/api/diagnostico' && m === 'POST') {
    if (!env.PUBLISH_TOKEN || req.headers.get('Authorization') !== `Bearer ${env.PUBLISH_TOKEN}`) return json({ error: 'no autorizado' }, { status: 401 });
    const ids: string[] = ((await req.json()) as any).ids ?? [];
    const out = await Promise.all(ids.slice(0, 10).map(async (id) => {
      const c = BY_ID.get(id);
      if (!c) return { id, ok: false, error: 'desconocido' };
      const t0 = Date.now();
      try {
        const o = await c.run(env);
        return { id, ok: true, ms: Date.now() - t0, metricas: o.metrics?.length ?? 0, series: o.series?.map((x) => `${x.key}:${x.points.length}`), items: o.items?.length ?? 0, muestra: o.items?.[0]?.title ?? o.metrics?.[0] ?? null };
      } catch (e) {
        return { id, ok: false, ms: Date.now() - t0, error: (e as Error).message };
      }
    }));
    return json(out);
  }

  // Publicación del calibrador (script en Node / NAS / GitHub Actions)
  if (path === '/api/publish' && m === 'POST') {
    const auth = req.headers.get('Authorization');
    if (!env.PUBLISH_TOKEN || auth !== `Bearer ${env.PUBLISH_TOKEN}`) return json({ error: 'no autorizado' }, { status: 401 });
    const body: any = await req.json();
    const stmts: D1PreparedStatement[] = [];
    for (const key of ['calibracion', 'backtest', 'pesos_indices']) {
      if (body[key]) stmts.push(env.DB.prepare('INSERT INTO published (key, data, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(key, JSON.stringify(body[key]), now()));
    }
    for (const f of body.previsiones ?? []) {
      stmts.push(env.DB.prepare(`INSERT INTO forecasts (made_on, horizon, price, p05, p25, p50, p75, p95, prob_up, model, due_on) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(made_on, horizon) DO NOTHING`).bind(f.made_on, f.horizon, f.price, f.p05, f.p25, f.p50, f.p75, f.p95, f.prob_up, f.model, f.due_on));
    }
    if (stmts.length) await env.DB.batch(stmts);
    ctx.waitUntil(refreshSnapshot(env));
    return json({ ok: true, guardados: stmts.length });
  }

  if (path === '/api/pago') return json(pagoInfo(env, email));
  // El usuario avisa de que ha pagado (con el nombre o correo de su PayPal) para que el administrador lo localice
  if (path === '/api/suscripcion/aviso') {
    if (!email || !user) return json({ error: 'entra con tu correo primero' }, { status: 401 });
    if (m === 'GET') return json(await env.DB.prepare('SELECT pay_claim, pay_claim_at FROM users WHERE email = ?').bind(email).first());
    if (m === 'POST' && sameOrigin(req)) {
      const b: any = await req.json().catch(() => ({}));
      const pagador = String(b.pagador ?? '').trim().slice(0, 120);
      if (pagador.length < 3) return json({ error: 'indica el nombre o el correo de tu cuenta de PayPal' }, { status: 400 });
      await env.DB.prepare('UPDATE users SET pay_claim = ?, pay_claim_at = ? WHERE email = ?').bind(pagador, now(), email).run();
      await audit(env, email, 'aviso_pago', { pagador });
      return json({ ok: true });
    }
  }
  if (!read) {
    if (env.ACCESS_MODE === 'suscripcion' && user) return json({ error: 'suscripción caducada', estado: user.estado }, { status: 402 });
    return json({ error: env.ACCESS_MODE === 'suscripcion' ? 'necesitas una cuenta: la prueba es gratuita durante 30 días' : 'acceso restringido a usuarios asignados' }, { status: email ? 403 : 401 });
  }

  if (path === '/api/snapshot') {
    const s = await env.KV.get('snapshot');
    return s ? rawJson(s, 30) : json({ error: 'todavía no hay datos: el primer ciclo de ingesta tarda unos minutos' }, { status: 503 });
  }
  if (path === '/api/series') {
    const { results } = await env.DB.prepare('SELECT key, first_day, last_day, source, updated_at FROM series ORDER BY key').all();
    return json(results, { maxAge: 300 });
  }
  if (path.startsWith('/api/series/')) {
    const key = decodeURIComponent(path.slice(12));
    const r = await env.DB.prepare('SELECT data FROM series WHERE key = ?').bind(key).first<{ data: string }>();
    return r ? rawJson(r.data, 600) : json({ error: 'serie desconocida' }, { status: 404 });
  }
  if (path === '/api/previsiones') {
    const { results } = await env.DB.prepare('SELECT * FROM forecasts ORDER BY made_on DESC, horizon LIMIT 1500').all();
    return json(results, { maxAge: 300 });
  }
  if (path.startsWith('/api/publicado/')) {
    const r = await env.DB.prepare('SELECT data, updated_at FROM published WHERE key = ?').bind(path.slice(15)).first<{ data: string; updated_at: number }>();
    return r ? rawJson(`{"actualizado":${r.updated_at},"datos":${r.data}}`, 300) : json({ actualizado: null, datos: null }, { maxAge: 300 });
  }
  if (path === '/api/indices/historico') {
    const { results } = await env.DB.prepare('SELECT day, key, value FROM index_log ORDER BY day').all();
    return json(results, { maxAge: 600 });
  }
  if (path === '/api/acontecimientos') {
    const cat = new URL(req.url).searchParams.get('categoria');
    const q = cat
      ? env.DB.prepare('SELECT id, title, category, countries, first_seen, last_seen, n_sources, credibility, tone, weight, rumor, sources FROM events WHERE category = ? ORDER BY last_seen DESC LIMIT 100').bind(cat)
      : env.DB.prepare('SELECT id, title, category, countries, first_seen, last_seen, n_sources, credibility, tone, weight, rumor, sources FROM events ORDER BY last_seen DESC LIMIT 150');
    return json((await q.all()).results, { maxAge: 60 });
  }

  // --- Usuarios con cuenta ---
  if (path === '/api/escenarios-guardados') {
    if (!can(user, 'analista')) return json({ error: 'requiere rol analista' }, { status: 403 });
    if (m === 'GET') return json((await env.DB.prepare('SELECT id, name, config, created_at FROM saved_scenarios WHERE email = ? ORDER BY created_at DESC').bind(user!.email).all()).results);
    if (m === 'POST' && sameOrigin(req)) {
      const b: any = await req.json();
      const name = String(b.name ?? '').trim().slice(0, 80);
      const config = JSON.stringify(b.config ?? {});
      if (!name || config.length > 4000) return json({ error: 'datos no válidos' }, { status: 400 });
      const id = hashId(user!.email + name + now());
      await env.DB.prepare('INSERT INTO saved_scenarios (id, email, name, config, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, user!.email, name, config, now()).run();
      return json({ id });
    }
  }
  if (path.startsWith('/api/escenarios-guardados/') && m === 'DELETE' && sameOrigin(req)) {
    if (!can(user, 'analista')) return json({ error: 'requiere rol analista' }, { status: 403 });
    await env.DB.prepare('DELETE FROM saved_scenarios WHERE id = ? AND email = ?').bind(path.split('/').pop(), user!.email).run();
    return json({ ok: true });
  }

  // --- Administración ---
  if (path.startsWith('/api/admin/')) {
    if (!can(user, 'admin')) return json({ error: 'requiere rol admin' }, { status: 403 });
    if (m !== 'GET' && !sameOrigin(req)) return json({ error: 'origen no permitido' }, { status: 403 });
    const actor = user!.email;
    if (path === '/api/admin/usuarios' && m === 'GET') {
      return json((await env.DB.prepare('SELECT email, name, role, active, created_at, created_by, last_seen FROM users ORDER BY role, email').all()).results);
    }
    if (path === '/api/admin/usuarios' && m === 'POST') {
      const b: any = await req.json();
      const mail = String(b.email ?? '').trim().toLowerCase();
      const role = b.role as Role;
      if (!EMAIL.test(mail) || !ROLES.includes(role)) return json({ error: 'email o rol no válidos' }, { status: 400 });
      const trial = now() + (parseInt(env.TRIAL_DAYS ?? '30', 10) || 30) * 864e5;
      await env.DB.prepare(`INSERT INTO users (email, name, role, active, created_at, created_by, trial_until) VALUES (?, ?, ?, 1, ?, ?, ?)
        ON CONFLICT(email) DO UPDATE SET name = excluded.name, role = excluded.role, active = 1`).bind(mail, String(b.name ?? '').slice(0, 80) || null, role, now(), actor, trial).run();
      await audit(env, actor, 'asignar_usuario', { email: mail, role });
      return json({ ok: true });
    }
    if (path.startsWith('/api/admin/usuarios/') && (m === 'PATCH' || m === 'DELETE')) {
      const mail = decodeURIComponent(path.slice(20)).toLowerCase();
      if (mail === actor && (m === 'DELETE' || (await req.clone().json<any>()).role !== 'admin')) return json({ error: 'no puedes quitarte a ti mismo el rol de administrador' }, { status: 400 });
      if (m === 'DELETE') {
        await env.DB.batch([env.DB.prepare('DELETE FROM users WHERE email = ?').bind(mail), env.DB.prepare('DELETE FROM saved_scenarios WHERE email = ?').bind(mail)]);
        await audit(env, actor, 'eliminar_usuario', { email: mail });
        return json({ ok: true });
      }
      const b: any = await req.json();
      if (b.role && !ROLES.includes(b.role)) return json({ error: 'rol no válido' }, { status: 400 });
      await env.DB.prepare('UPDATE users SET role = COALESCE(?, role), active = COALESCE(?, active), name = COALESCE(?, name) WHERE email = ?')
        .bind(b.role ?? null, b.active === undefined ? null : b.active ? 1 : 0, b.name ?? null, mail).run();
      await audit(env, actor, 'modificar_usuario', { email: mail, ...b });
      return json({ ok: true });
    }
    if (path === '/api/admin/suscriptores' && m === 'GET') {
      const { results } = await env.DB.prepare(`SELECT u.email, u.name, u.role, u.active, u.created_at, u.created_by, u.last_seen, u.trial_until, u.paid_until, u.notes, u.pay_claim, u.pay_claim_at,
        (SELECT COUNT(*) FROM payments p WHERE p.email = u.email) pagos, (SELECT COALESCE(SUM(amount), 0) FROM payments p WHERE p.email = u.email) total
        FROM users u ORDER BY u.created_at DESC`).all<any>();
      const ingresos = await env.DB.prepare('SELECT COALESCE(SUM(amount), 0) total, COUNT(*) n FROM payments').first<any>();
      return json({ usuarios: results.map((r) => ({ ...r, ...subState(r) })), ingresos, precio: parseFloat(env.PRICE_EUR ?? '10'), prueba: parseInt(env.TRIAL_DAYS ?? '30', 10) });
    }
    if (path === '/api/admin/pagos' && m === 'GET') {
      return json((await env.DB.prepare('SELECT * FROM payments ORDER BY created_at DESC LIMIT 300').all()).results);
    }
    const sm = /^\/api\/admin\/suscriptores\/([^/]+)\/(pago|ampliar|nota)$/.exec(path);
    if (sm && m === 'POST') {
      const mail = decodeURIComponent(sm[1]).toLowerCase();
      const row = await env.DB.prepare('SELECT trial_until, paid_until FROM users WHERE email = ?').bind(mail).first<any>();
      if (!row) return json({ error: 'usuario no encontrado' }, { status: 404 });
      const b: any = await req.json().catch(() => ({}));
      const t = now();
      if (sm[2] === 'pago') {
        const from = Math.max(t, row.paid_until ?? 0);
        const to = from + 365 * 864e5;
        const amount = Number.isFinite(+b.importe) && +b.importe > 0 ? +b.importe : parseFloat(env.PRICE_EUR ?? '10');
        await env.DB.batch([
          env.DB.prepare('UPDATE users SET paid_until = ?, active = 1, pay_claim = NULL, pay_claim_at = NULL WHERE email = ?').bind(to, mail),
          env.DB.prepare('INSERT INTO payments (id, email, amount, method, reference, period_from, period_to, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
            .bind(hashId(mail + t), mail, amount, 'paypal', String(b.referencia ?? '').slice(0, 120) || null, from, to, t, actor),
        ]);
        await audit(env, actor, 'registrar_pago', { email: mail, importe: amount, hasta: new Date(to).toISOString().slice(0, 10), referencia: b.referencia ?? null });
        return json({ ok: true, hasta: to });
      }
      if (sm[2] === 'ampliar') {
        const dias = Math.min(365, Math.max(1, parseInt(b.dias, 10) || 30));
        const to = Math.max(t, row.trial_until ?? 0) + dias * 864e5;
        await env.DB.prepare('UPDATE users SET trial_until = ?, active = 1 WHERE email = ?').bind(to, mail).run();
        await audit(env, actor, 'ampliar_prueba', { email: mail, dias });
        return json({ ok: true, hasta: to });
      }
      await env.DB.prepare('UPDATE users SET notes = ? WHERE email = ?').bind(String(b.nota ?? '').slice(0, 300) || null, mail).run();
      return json({ ok: true });
    }
    if (path === '/api/admin/auditoria') return json((await env.DB.prepare('SELECT * FROM audit ORDER BY at DESC LIMIT 200').all()).results);
    if (path === '/api/admin/recargar-historico' && m === 'POST') {
      await env.DB.prepare("INSERT INTO meta (key, value) VALUES ('backfill', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(JSON.stringify({ job: 0, cursor: null, errors: {}, done: false })).run();
      await audit(env, actor, 'recargar_historico', {});
      return json({ ok: true });
    }
    if (path === '/api/admin/ejecutar' && m === 'POST') {
      const r = await runTick(env);
      return json(r);
    }
    if (path === '/api/admin/estado') {
      const bf = await env.DB.prepare("SELECT value FROM meta WHERE key = 'backfill'").first<{ value: string }>();
      const counts = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM items) items, (SELECT COUNT(*) FROM items WHERE status='pendiente') pendientes, (SELECT COUNT(*) FROM events) acontecimientos, (SELECT COUNT(*) FROM forecasts) previsiones").first();
      return json({ historico: bf ? JSON.parse(bf.value) : null, ...counts });
    }
  }
  return json({ error: 'no encontrado' }, { status: 404 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    // En local (wrangler dev) con DEV_USER se simula la identidad; en producción DEV_USER se ignora siempre
    const devEnv = local ? (env.DEV_USER ? { ...env, ACCESS_TEAM: '', ACCESS_AUD: '' } : env) : { ...env, DEV_USER: undefined };
    const { email, user } = await currentUser(req, devEnv);
    if (url.pathname === '/entrar') return Response.redirect(new URL('/', url).toString(), 302);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, devEnv, ctx, url.pathname, user, email);
      } catch (e) {
        return json({ error: 'error interno', detalle: (e as Error).message }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(req);
  },

  async scheduled(ev: ScheduledController, env: Env, ctx: ExecutionContext) {
    const date = new Date(ev.scheduledTime);
    ctx.waitUntil((async () => {
      const r = await runTick(env, date);
      if (date.getUTCHours() === 0 && Math.floor(date.getUTCMinutes() / 5) === 3) r.verificadas = await verifyForecasts(env);
      console.log(JSON.stringify(r));
    })());
  },
} satisfies ExportedHandler<Env>;
