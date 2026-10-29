// Estado de la aplicación: datos del servidor y resultados del modelo (calculados en el Worker).
import type { Snapshot } from '../src/worker/indices';
import type { BacktestResult } from '../src/model/backtest';
import { extraVolFromIndices, PROVISIONAL_INDEX_WEIGHTS } from '../src/model/pipeline';

export type Estado = 'admin' | 'activo' | 'prueba' | 'caducado' | 'bloqueado';
export interface Pago { importe: number; periodo: string; pruebaDias: number; paypal: string; enlace: string; tipo: string; nota: string; email: string | null }
export interface Me {
  email: string | null;
  usuario: { email: string; name: string | null; role: 'admin' | 'analista' | 'lector'; estado: Estado; hasta: number | null; diasRestantes: number | null } | null;
  modo: 'publico' | 'privado' | 'suscripcion'; accesoConfigurado: boolean; anuncios: boolean; pago: Pago;
}

/** ¿Puede ver los datos? (en modo suscripción: admin, suscripción activa o prueba en curso) */
export function puedeVer(me: Me | null): boolean {
  if (!me) return false;
  if (me.modo === 'publico') return true;
  if (me.modo === 'privado') return !!me.usuario;
  return !!me.usuario && ['admin', 'activo', 'prueba'].includes(me.usuario.estado);
}

export const S: {
  me: Me | null;
  snap: Snapshot | null;
  snapError: string | null;
  series: Record<string, [string, number][]> | null;
  backtest: { actualizado: number; datos: BacktestResult } | null;
  calibracionPublicada: any;
  model: any | null;
  modelError: string | null;
  indexWeights: Record<string, number>;
} = { me: null, snap: null, snapError: null, series: null, backtest: null, calibracionPublicada: null, model: null, modelError: null, indexWeights: PROVISIONAL_INDEX_WEIGHTS };

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((body as any).error ?? `Error ${r.status}`);
  return body as T;
}

// ---- Worker del modelo ----
const worker = new Worker(new URL('./model.worker.ts', import.meta.url), { type: 'module' });
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; progress?: (p: number) => void }>();
worker.onmessage = (ev) => {
  const { id, ok, result, error, progress } = ev.data;
  const p = pending.get(id);
  if (!p) return;
  if (progress !== undefined) { p.progress?.(progress); return; }
  pending.delete(id);
  ok ? p.resolve(result) : p.reject(new Error(error));
};
export function callModel<T = any>(type: string, payload: unknown, progress?: (p: number) => void): Promise<T> {
  const id = ++seq;
  return new Promise((resolve, reject) => { pending.set(id, { resolve, reject, progress }); worker.postMessage({ id, type, payload }); });
}

export const extraVol = () => (S.snap ? extraVolFromIndices(S.snap.indices, S.indexWeights) : 0);

let loading: Promise<void> | null = null;
export function loadAll(onUpdate: () => void): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
    S.me = await getJson<Me>('/api/me').catch(() => null);
    if (S.me?.anuncios) document.body.dataset.ads = 'true';
    if (!puedeVer(S.me)) { onUpdate(); return; } // sin acceso: no se piden datos
    const [snap, bt, cal, pesos] = await Promise.allSettled([
      getJson<Snapshot>('/api/snapshot'), getJson<any>('/api/publicado/backtest'), getJson<any>('/api/publicado/calibracion'), getJson<any>('/api/publicado/pesos_indices'),
    ]);
    if (snap.status === 'fulfilled') S.snap = snap.value; else S.snapError = (snap.reason as Error).message;
    if (bt.status === 'fulfilled' && bt.value?.datos) S.backtest = bt.value;
    if (cal.status === 'fulfilled' && cal.value?.datos) S.calibracionPublicada = cal.value;
    if (pesos.status === 'fulfilled' && pesos.value?.datos?.estado === 'estimado') S.indexWeights = pesos.value.datos.pesos;
    onUpdate();
    try {
      const list = await getJson<{ key: string }[]>('/api/series');
      const entries = await Promise.all(list.map(async ({ key }) => [key, await getJson<[string, number][]>('/api/series/' + encodeURIComponent(key))] as const));
      S.series = Object.fromEntries(entries);
      const close = S.series.close ?? [];
      const last = close.length ? close[close.length - 1][0] : null;
      // No se calibra con un histórico incompleto: daría previsiones sin sentido
      if (close.length < 400 || !last || Date.now() - Date.parse(last + 'T00:00:00Z') > 5 * 864e5) {
        throw new Error(`El histórico de precios aún se está cargando${last ? ` (va por el ${new Date(last + 'T12:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })})` : ''}. Tarda unas horas tras el primer despliegue; el modelo aparecerá entonces.`);
      }
      S.model = await callModel('init', { series: S.series, backtest: S.backtest?.datos ?? null, extraVol: extraVol(), livePrice: S.snap?.precio?.price });
    } catch (e) {
      S.modelError = (e as Error).message;
    }
    onUpdate();
  })();
  return loading;
}

/** Recarga solo la instantánea (cada minuto). */
export async function refreshSnap(onUpdate: () => void) {
  try { S.snap = await getJson<Snapshot>('/api/snapshot'); S.snapError = null; onUpdate(); } catch { /* se mantiene la última */ }
}
