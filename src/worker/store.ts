// Persistencia en D1 con pocas consultas por ejecución (límite del plan gratuito).
import type { Env } from './env';
import type { Metric, RawItem, SeriesUpdate } from './connectors/types';
import { hashId, now } from './util';

const chunk = <T,>(a: T[], n: number) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

export function metricStatements(env: Env, source: string, metrics: Metric[]): D1PreparedStatement[] {
  const t = now();
  // 6 parámetros por fila → 16 filas por sentencia (D1 admite 100 parámetros)
  return chunk(metrics.filter((m) => m.value === undefined || m.value === null || isFinite(m.value)), 16).map((rows) =>
    env.DB.prepare(`INSERT INTO metrics (key, value, text, unit, source, observed_at) VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, text=excluded.text, unit=excluded.unit, source=excluded.source, observed_at=excluded.observed_at`)
      .bind(...rows.flatMap((m) => [m.key, m.value ?? null, m.text ?? null, m.unit ?? null, source, m.observedAt ?? t])));
}

export function itemStatements(env: Env, items: RawItem[]): D1PreparedStatement[] {
  const t = now();
  const fresh = items.filter((i) => i.publishedAt > t - 3 * 864e5 && i.publishedAt < t + 36e5);
  return chunk(fresh, 12).map((rows) =>
    env.DB.prepare(`INSERT OR IGNORE INTO items (id, source, title, url, lang, published_at, fetched_at) VALUES ${rows.map(() => '(?,?,?,?,?,?,?)').join(',')}`)
      .bind(...rows.flatMap((i) => [hashId(i.url), i.source ?? 'desconocida', i.title, i.url, i.lang ?? null, i.publishedAt, t])));
}

export function sourceStatements(env: Env, statuses: { id: string; ok: boolean; error?: string; items?: number }[]): D1PreparedStatement[] {
  const t = now();
  return chunk(statuses, 16).map((rows) =>
    env.DB.prepare(`INSERT INTO sources (id, status, last_ok, last_error, last_run, items) VALUES ${rows.map(() => '(?,?,?,?,?,?)').join(',')}
      ON CONFLICT(id) DO UPDATE SET status=excluded.status, last_ok=COALESCE(excluded.last_ok, sources.last_ok), last_error=excluded.last_error, last_run=excluded.last_run, items=excluded.items`)
      .bind(...rows.flatMap((s) => [s.id, s.ok ? 'ok' : s.error?.startsWith('falta') ? 'sin_clave' : s.error === 'licencia' ? 'sin_licencia' : 'caido', s.ok ? t : null, s.ok ? null : (s.error ?? '').slice(0, 200), t, s.items ?? 0])));
}

/** Fusiona puntos en una serie: carga el JSON, sustituye/añade por día y guarda. */
export async function mergeSeries(env: Env, updates: (SeriesUpdate & { source: string })[]): Promise<D1PreparedStatement[]> {
  if (!updates.length) return [];
  const keys = [...new Set(updates.map((u) => u.key))];
  const { results } = await env.DB.prepare(`SELECT key, data FROM series WHERE key IN (${keys.map(() => '?').join(',')})`).bind(...keys).all<{ key: string; data: string }>();
  const existing = new Map(results.map((r) => [r.key, r.data]));
  const out: D1PreparedStatement[] = [];
  for (const key of keys) {
    const ups = updates.filter((u) => u.key === key);
    let pts: [string, number][] = ups.some((u) => u.mode === 'replace') ? [] : JSON.parse(existing.get(key) ?? '[]');
    const map = new Map(pts);
    for (const u of ups) for (const [d, v] of u.points) if (isFinite(v)) map.set(d, +v.toPrecision(8));
    pts = [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    if (!pts.length) continue;
    out.push(env.DB.prepare(`INSERT INTO series (key, data, first_day, last_day, source, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET data=excluded.data, first_day=excluded.first_day, last_day=excluded.last_day, source=excluded.source, updated_at=excluded.updated_at`)
      .bind(key, JSON.stringify(pts), pts[0][0], pts[pts.length - 1][0], ups[0].source, now()));
  }
  return out;
}

export async function getMeta(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export const setMeta = (env: Env, key: string, value: string) =>
  env.DB.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value);
