// Identidad con Cloudflare Access (JWT RS256) y autorización con la tabla de usuarios asignados.
import type { Env } from './env';
import { now } from './util';

export type Role = 'admin' | 'analista' | 'lector';

const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
let JWKS: { keys: JsonWebKey[]; at: number } | null = null;

async function certs(env: Env): Promise<JsonWebKey[]> {
  if (JWKS && now() - JWKS.at < 36e5) return JWKS.keys;
  const res = await fetch(`https://${env.ACCESS_TEAM}.cloudflareaccess.com/cdn-cgi/access/certs`);
  const d: any = await res.json();
  JWKS = { keys: d.keys ?? [], at: now() };
  return JWKS.keys;
}

export async function verifyAccessJwt(token: string, env: Env): Promise<string | null> {
  const [h, p, s] = token.split('.');
  if (!h || !p || !s) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h)));
  const payload = JSON.parse(new TextDecoder().decode(b64url(p)));
  const jwk = (await certs(env)).find((k: any) => k.kid === header.kid);
  if (!jwk || header.alg !== 'RS256') return null;
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64url(s), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) return null;
  if (payload.iss !== `https://${env.ACCESS_TEAM}.cloudflareaccess.com`) return null;
  if (!payload.exp || payload.exp * 1000 < now()) return null;
  return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
}

function cookie(req: Request, name: string): string | null {
  const m = new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.get('Cookie') ?? '');
  return m ? m[1] : null;
}

export async function identify(req: Request, env: Env): Promise<string | null> {
  if (env.ACCESS_TEAM && env.ACCESS_AUD) {
    const token = req.headers.get('Cf-Access-Jwt-Assertion') ?? cookie(req, 'CF_Authorization');
    if (token) {
      try { return await verifyAccessJwt(token, env); } catch { return null; }
    }
    return null;
  }
  // Solo para desarrollo local (wrangler dev con .dev.vars). Nunca definir en producción.
  return env.DEV_USER ? (req.headers.get('x-dev-user') ?? env.DEV_USER).toLowerCase() : null;
}

const adminList = (env: Env) => env.ADMIN_EMAILS.split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
const DAY = 864e5;

export type SubState = 'admin' | 'activo' | 'prueba' | 'caducado' | 'bloqueado';
export interface User { email: string; name: string | null; role: Role; estado: SubState; hasta: number | null; diasRestantes: number | null }

interface Row { email: string; name: string | null; role: Role; active: number; trial_until: number | null; paid_until: number | null }

/** Estado de la suscripción: los administradores nunca caducan; el pago prevalece sobre la prueba. */
export function subState(r: Pick<Row, 'role' | 'active' | 'trial_until' | 'paid_until'>, t = now()): { estado: SubState; hasta: number | null; diasRestantes: number | null } {
  if (r.role === 'admin') return { estado: 'admin', hasta: null, diasRestantes: null };
  if (!r.active) return { estado: 'bloqueado', hasta: null, diasRestantes: null };
  const until = Math.max(r.paid_until ?? 0, r.trial_until ?? 0);
  const estado: SubState = (r.paid_until ?? 0) > t ? 'activo' : (r.trial_until ?? 0) > t ? 'prueba' : 'caducado';
  return { estado, hasta: until || null, diasRestantes: until > t ? Math.ceil((until - t) / DAY) : 0 };
}

export const hasAccess = (u: User | null) => !!u && ['admin', 'activo', 'prueba'].includes(u.estado);

export async function currentUser(req: Request, env: Env): Promise<{ email: string | null; user: User | null }> {
  const email = await identify(req, env);
  if (!email) return { email: null, user: null };
  let row = await env.DB.prepare('SELECT email, name, role, active, trial_until, paid_until FROM users WHERE email = ?').bind(email).first<Row>();
  if (!row && adminList(env).includes(email)) {
    await env.DB.prepare("INSERT INTO users (email, role, active, created_at, created_by) VALUES (?, 'admin', 1, ?, 'ADMIN_EMAILS')").bind(email, now()).run();
    row = { email, name: null, role: 'admin', active: 1, trial_until: null, paid_until: null };
  }
  // Modo suscripción: quien entra por primera vez recibe la prueba gratuita
  if (!row && env.ACCESS_MODE === 'suscripcion') {
    const trial = now() + (parseInt(env.TRIAL_DAYS ?? '30', 10) || 30) * DAY;
    await env.DB.prepare("INSERT OR IGNORE INTO users (email, role, active, created_at, created_by, trial_until) VALUES (?, 'lector', 1, ?, 'alta automática', ?)").bind(email, now(), trial).run();
    row = { email, name: null, role: 'lector', active: 1, trial_until: trial, paid_until: null };
  }
  if (!row) return { email, user: null };
  // Actualiza "último acceso" como mucho una vez por hora
  env.DB.prepare('UPDATE users SET last_seen = ? WHERE email = ? AND (last_seen IS NULL OR last_seen < ?)').bind(now(), email, now() - 36e5).run().catch(() => {});
  const st = subState(row);
  if (env.ACCESS_MODE !== 'suscripcion' && st.estado !== 'admin') {
    // Fuera del modo suscripción solo cuenta si la cuenta está activa
    return { email, user: row.active ? { email: row.email, name: row.name, role: row.role, estado: 'activo', hasta: null, diasRestantes: null } : null };
  }
  return { email, user: { email: row.email, name: row.name, role: row.role, ...st } };
}

export const can = (u: User | null, need: Role) =>
  !!u && (u.role === 'admin' || (hasAccess(u) && ((need === 'analista' && u.role === 'analista') || need === 'lector')));
