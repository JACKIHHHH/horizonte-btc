import type { Env } from './env';

export const now = () => Date.now();
export const today = () => new Date().toISOString().slice(0, 10);
export const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class SourceError extends Error {}

export async function fetchText(url: string, env: Env, init: RequestInit = {}, timeoutMs = 8000): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: { 'User-Agent': env.CONTACT_UA || 'EscenariosBTC', Accept: 'application/json, application/xml, text/xml, */*', ...(init.headers ?? {}) },
      cf: { cacheTtl: 60 },
    } as RequestInit);
    if (!res.ok) throw new SourceError(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    if (e instanceof SourceError) throw e;
    throw new SourceError((e as Error).name === 'AbortError' ? 'tiempo agotado' : (e as Error).message);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJson<T = any>(url: string, env: Env, init: RequestInit = {}, timeoutMs = 8000): Promise<T> {
  const txt = await fetchText(url, env, init, timeoutMs);
  try {
    return JSON.parse(txt) as T;
  } catch {
    throw new SourceError('respuesta no es JSON');
  }
}

/** Hash corto (FNV-1a 52 bits) para identificadores deterministas. */
export function hashId(s: string): string {
  let h1 = 0x811c9dc5, h2 = 0x1b873593;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822507);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

export function json(data: unknown, init: ResponseInit & { maxAge?: number } = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  if (init.maxAge !== undefined) headers.set('Cache-Control', `public, max-age=${init.maxAge}`);
  else if (!headers.has('Cache-Control')) headers.set('Cache-Control', 'no-store');
  return new Response(JSON.stringify(data), { status: init.status ?? 200, headers });
}

export function rawJson(text: string, maxAge = 60): Response {
  return new Response(text, { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': `public, max-age=${maxAge}` } });
}

export const median = (a: number[]) => {
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
