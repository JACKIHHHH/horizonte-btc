// Reparto del trabajo en un único cron de 5 minutos (12 turnos por hora).
import type { Env } from './env';
import { BY_ID, CONNECTORS } from './connectors';
import { FEEDS } from './connectors/noticias';
import type { Connector, SeriesUpdate } from './connectors/types';
import { backfillStep, bitstampDaily } from './backfill';
import { buildSnapshot, type MetricRow } from './indices';
import { processPending } from './nlp/process';
import { itemStatements, mergeSeries, metricStatements, getMeta, setMeta, sourceStatements } from './store';
import { dayOf, now } from './util';

const ALWAYS = ['kraken', 'coinbase', 'bitstamp', 'gemini', 'bitfinex', 'okx', 'bybit'];
const EVERY_15 = ['coingecko'];
const SLOTS: Record<number, string[]> = {
  0: ['deribit', 'okx-swap', 'deribit-perp', 'bybit-linear'],
  1: ['mempool', 'feargreed', 'hackernews', 'mastodon'],
  2: ['gdelt-intensidad'],
  3: ['gdelt-articulos', 'polymarket'],
  7: ['kalshi', 'manifold'],
  4: ['usgs', 'cloudflare-radar', 'guardian', 'reddit'],
  9: ['gdelt-articulos'],
};
/** Conectores diarios: hora UTC en la que se ejecutan (en el turno 5). */
const DAILY: Record<string, number[]> = {
  fred: [13, 21], 'fred-calendario': [6], worldbank: [6], 'blockchain-com': [7], coinmetrics: [8], blockchair: [9],
  'github-bitcoin': [10], defillama: [3, 15], wikipedia: [11], edgar: [2, 8, 14, 20], congress: [15], ofac: [16, 22], reliefweb: [12],
};

export function plan(date: Date): string[] {
  const slot = Math.floor(date.getUTCMinutes() / 5) % 12;
  const hour = date.getUTCHours();
  const ids = [...ALWAYS];
  if (slot % 3 === 0) ids.push(...EVERY_15);
  ids.push(...(SLOTS[slot] ?? []));
  if (slot === 5) for (const [id, hours] of Object.entries(DAILY)) if (hours.includes(hour)) ids.push(id);
  FEEDS.forEach((f, i) => { if (i % 12 === slot) ids.push(f.id); });
  return ids;
}

function allowed(env: Env, c: Connector): string | null {
  if (c.licencia.estado === 'no-comercial' && env.NONCOMMERCIAL_SOURCES !== 'on') return 'licencia';
  for (const k of c.clave ?? []) if (!(env as any)[k]) return `falta ${String(k)}`;
  return null;
}

export async function runTick(env: Env, date = new Date()): Promise<Record<string, unknown>> {
  const t0 = now();
  const ids = plan(date);
  const conns = ids.map((id) => BY_ID.get(id)).filter((c): c is Connector => !!c);
  const statuses: { id: string; ok: boolean; error?: string; items?: number }[] = [];
  const stmts: D1PreparedStatement[] = [];
  const series: (SeriesUpdate & { source: string })[] = [];

  const runnable = conns.filter((c) => {
    const why = allowed(env, c);
    if (why) statuses.push({ id: c.id, ok: false, error: why });
    return !why;
  });
  const results = await Promise.allSettled(runnable.map((c) => c.run(env)));
  results.forEach((r, i) => {
    const c = runnable[i];
    if (r.status === 'rejected') { statuses.push({ id: c.id, ok: false, error: String(r.reason?.message ?? r.reason) }); return; }
    const o = r.value;
    if (o.metrics?.length) stmts.push(...metricStatements(env, c.id, o.metrics));
    if (o.items?.length) stmts.push(...itemStatements(env, o.items.map((it) => ({ ...it, source: it.source ?? c.id }))));
    for (const s of o.series ?? []) series.push({ ...s, source: c.id });
    statuses.push({ id: c.id, ok: true, items: (o.items?.length ?? 0) + (o.metrics?.length ?? 0) });
  });

  // Tareas diarias: cierre del día anterior (00:05–00:55 UTC) y carga inicial/periódica del histórico
  const extra: Record<string, unknown> = {};
  if (date.getUTCHours() === 0 && Math.floor(date.getUTCMinutes() / 5) % 12 === 1) {
    try {
      const r = await bitstampDaily(env, Math.floor(now() / 1000) - 6 * 86400, 8);
      const hoy = dayOf(now());
      series.push({ key: 'close', mode: 'merge', points: r.close.filter(([d]) => d < hoy), source: 'bitstamp' });
      series.push({ key: 'volume', mode: 'merge', points: r.volume.filter(([d]) => d < hoy), source: 'bitstamp' });
    } catch (e) { extra.cierre = (e as Error).message; }
  }
  const bfRaw = await getMeta(env, 'backfill');
  const bf = bfRaw ? JSON.parse(bfRaw) : { job: 0, cursor: null, errors: {}, done: false };
  if (!bf.done) {
    const step = await backfillStep(env, bf);
    if (step) for (const [key, pts] of Object.entries(step.points)) if (pts.length) series.push({ key, mode: 'merge', points: pts, source: 'historico:' + step.job });
    if (!step) bf.done = true;
    bf.lastRun = now();
    stmts.push(setMeta(env, 'backfill', JSON.stringify(bf)));
    extra.backfill = step?.job ?? 'completado';
  }

  stmts.push(...(await mergeSeries(env, series)));
  stmts.push(...sourceStatements(env, statuses));
  if (stmts.length) await env.DB.batch(stmts);

  const nlp = await processPending(env);
  await refreshSnapshot(env);
  return { ms: now() - t0, conectores: statuses.length, fallos: statuses.filter((s) => !s.ok).map((s) => `${s.id}: ${s.error}`), nlp, ...extra };
}

export async function refreshSnapshot(env: Env) {
  const t = now();
  const [metrics, events, sources, cal] = await env.DB.batch([
    env.DB.prepare('SELECT key, value, text, unit, source, observed_at FROM metrics'),
    env.DB.prepare('SELECT id, title, category, countries, first_seen, last_seen, n_sources, credibility, tone, weight, rumor, sources FROM events WHERE last_seen > ? ORDER BY weight DESC LIMIT 400').bind(t - 7 * 864e5),
    env.DB.prepare('SELECT id, status, last_ok, last_error, last_run, items FROM sources'),
    env.DB.prepare("SELECT data, updated_at FROM published WHERE key = 'calibracion'"),
  ]);
  const evs = (events.results as any[]).map((e) => ({ ...e, countries: JSON.parse(e.countries ?? '[]'), sources: JSON.parse(e.sources ?? '[]') }));
  const st = new Map((sources.results as any[]).map((s) => [s.id, s]));
  const fuentes = CONNECTORS.map((c) => {
    const s = st.get(c.id);
    return { id: c.id, nombre: c.nombre, optica: c.optica, web: c.web, licencia: c.licencia, clave: c.clave ?? [], frecuencia: c.frecuencia, estado: s?.status ?? 'pendiente', ultimoOk: s?.last_ok ?? null, error: s?.last_error ?? null };
  });
  const calRow = (cal.results as any[])[0];
  const snap = buildSnapshot(metrics.results as unknown as MetricRow[], evs, { sources: fuentes, calibration: calRow ? { ...JSON.parse(calRow.data), publicado: calRow.updated_at } : null }, t);
  const body = JSON.stringify(snap);
  await env.KV.put('snapshot', body);
  // Registro diario de índices (para re-estimar sus pesos cuando haya histórico propio)
  const day = dayOf(t);
  const logs = snap.indices.filter((i) => i.valor !== null).map((i) => env.DB.prepare('INSERT INTO index_log (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = excluded.value').bind(day, i.key, i.valor));
  if (snap.precio) logs.push(env.DB.prepare('INSERT INTO index_log (day, key, value) VALUES (?, ?, ?) ON CONFLICT(day, key) DO UPDATE SET value = excluded.value').bind(day, 'precio', snap.precio.price));
  if (logs.length) await env.DB.batch(logs);
  return snap;
}
