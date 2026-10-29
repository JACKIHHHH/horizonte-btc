// Histórico diario alineado por fecha (UTC) y construcción de variables predictoras.
// Regla estricta: cada variable en el día t solo usa datos publicados hasta t (con su retardo).

export interface History {
  days: string[]; // YYYY-MM-DD ascendente, sin huecos
  s: Record<string, (number | null)[]>;
}

export type SeriesPoints = [string, number][]; // [día, valor]

/** Retardo de publicación (días) por serie: el dato del día d se conoce en d+lag. */
export const PUBLICATION_LAG: Record<string, number> = {
  close: 0, high: 0, low: 0, volume: 0,
  fng: 0, stables: 1, wiki: 1, hashrate: 1, dvol: 0,
  dxy: 2, real10: 2, walcl: 2, tga: 2, rrp: 1, vix: 1, epu: 2, nasdaq: 1, oil: 2, m2: 35,
};

export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Une series sueltas en un History; aplica retardo de publicación y arrastra el último valor conocido (máx. maxFill días). */
export function buildHistory(raw: Record<string, SeriesPoints>, from?: string, to?: string, maxFill = 45): History {
  const close = raw.close ?? [];
  const start = from ?? close[0]?.[0];
  const end = to ?? close[close.length - 1]?.[0];
  if (!start || !end) return { days: [], s: {} };
  const days = dayRange(start, end);
  const idx = new Map(days.map((d, i) => [d, i]));
  const s: History['s'] = {};
  for (const [key, pts] of Object.entries(raw)) {
    const lag = PUBLICATION_LAG[key] ?? 1;
    const arr: (number | null)[] = new Array(days.length).fill(null);
    for (const [d, v] of pts) {
      if (!isFinite(v)) continue;
      const i = idx.get(addDays(d, lag));
      if (i !== undefined) arr[i] = v;
    }
    let last: number | null = null, age = 0;
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] !== null) { last = arr[i]; age = 0; }
      else if (last !== null && age < maxFill && key !== 'close') { arr[i] = last; age++; }
      else if (key === 'close' && last !== null && age < 3) { arr[i] = last; age++; }
    }
    s[key] = arr;
  }
  return { days, s };
}

export function logReturns(close: (number | null)[]): number[] {
  const r: number[] = new Array(close.length).fill(NaN);
  for (let i = 1; i < close.length; i++) {
    const a = close[i - 1], b = close[i];
    if (a && b) r[i] = Math.log(b / a);
  }
  return r;
}

// ---------- Variables predictoras ----------

export interface FeatureDef {
  key: string;
  label: string;
  group: 'mercado' | 'liquidez' | 'sentimiento' | 'onchain' | 'macro';
  role: 'direccion' | 'volatilidad';
  horizonte: string;
  calc: (h: History, t: number) => number | null;
}

const v = (h: History, k: string, t: number) => (t >= 0 ? h.s[k]?.[t] ?? null : null);
const lr = (a: number | null, b: number | null) => (a && b && a > 0 && b > 0 ? Math.log(a / b) : null);

function sma(h: History, k: string, t: number, n: number): number | null {
  if (t - n + 1 < 0) return null;
  let s = 0;
  for (let i = t - n + 1; i <= t; i++) {
    const x = v(h, k, i);
    if (x === null) return null;
    s += x;
  }
  return s / n;
}

function zLog(h: History, k: string, t: number, win: number, smooth = 1): number | null {
  if (t - win < 0) return null;
  const cur = sma(h, k, t, smooth);
  if (!cur || cur <= 0) return null;
  const vals: number[] = [];
  for (let i = t - win; i < t; i++) { const x = v(h, k, i); if (x && x > 0) vals.push(Math.log(x)); }
  if (vals.length < win * 0.6) return null;
  const m = vals.reduce((a, b) => a + b, 0) / vals.length;
  const sd = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
  return sd > 0 ? (Math.log(cur) - m) / sd : 0;
}

function netLiq(h: History, t: number): number | null {
  const w = v(h, 'walcl', t), g = v(h, 'tga', t), r = v(h, 'rrp', t);
  if (w === null || g === null || r === null) return null;
  return w - g - r * 1000; // WALCL y WTREGEN en millones; RRPONTSYD en miles de millones
}

export const FEATURES: FeatureDef[] = [
  { key: 'mom30', label: 'Momentum 30 días', group: 'mercado', role: 'direccion', horizonte: '1–4 semanas', calc: (h, t) => lr(v(h, 'close', t), v(h, 'close', t - 30)) },
  { key: 'mom90', label: 'Momentum 90 días', group: 'mercado', role: 'direccion', horizonte: '1–3 meses', calc: (h, t) => lr(v(h, 'close', t), v(h, 'close', t - 90)) },
  { key: 'trend200', label: 'Precio frente a media de 200 días', group: 'mercado', role: 'direccion', horizonte: '1–3 meses', calc: (h, t) => lr(v(h, 'close', t), sma(h, 'close', t, 200)) },
  { key: 'stables30', label: 'Crecimiento de stablecoins (30 d)', group: 'liquidez', role: 'direccion', horizonte: '2–8 semanas', calc: (h, t) => lr(v(h, 'stables', t), v(h, 'stables', t - 30)) },
  { key: 'netliq30', label: 'Liquidez neta de la Fed (30 d)', group: 'liquidez', role: 'direccion', horizonte: '4–12 semanas', calc: (h, t) => lr(netLiq(h, t), netLiq(h, t - 30)) },
  { key: 'dxy20', label: 'Dólar (DXY amplio), cambio 20 d invertido', group: 'macro', role: 'direccion', horizonte: '2–8 semanas', calc: (h, t) => { const x = lr(v(h, 'dxy', t), v(h, 'dxy', t - 20)); return x === null ? null : -x; } },
  { key: 'real20', label: 'Tipo real a 10 años, cambio 20 d invertido', group: 'macro', role: 'direccion', horizonte: '2–8 semanas', calc: (h, t) => { const a = v(h, 'real10', t), b = v(h, 'real10', t - 20); return a === null || b === null ? null : -(a - b); } },
  { key: 'nasdaq20', label: 'Nasdaq, rendimiento 20 d', group: 'macro', role: 'direccion', horizonte: '2–8 semanas', calc: (h, t) => lr(v(h, 'nasdaq', t), v(h, 'nasdaq', t - 20)) },
  { key: 'fng', label: 'Índice Fear & Greed', group: 'sentimiento', role: 'direccion', horizonte: '1–4 semanas', calc: (h, t) => { const x = v(h, 'fng', t); return x === null ? null : (x - 50) / 50; } },
  { key: 'wiki', label: 'Atención en Wikipedia (7 d frente a 90 d)', group: 'sentimiento', role: 'direccion', horizonte: '1–7 días', calc: (h, t) => lr(sma(h, 'wiki', t, 7), sma(h, 'wiki', t, 90)) },
  { key: 'ribbon', label: 'Hash ribbons (30 d / 60 d)', group: 'onchain', role: 'direccion', horizonte: '1–6 meses', calc: (h, t) => lr(sma(h, 'hashrate', t, 30), sma(h, 'hashrate', t, 60)) },
  // Volatilidad
  { key: 'vixz', label: 'VIX (z-score 1 año)', group: 'macro', role: 'volatilidad', horizonte: '1–30 días', calc: (h, t) => zLog(h, 'vix', t, 365) },
  { key: 'epuz', label: 'Incertidumbre de política económica (EPU, z 1 año)', group: 'macro', role: 'volatilidad', horizonte: '1–30 días', calc: (h, t) => zLog(h, 'epu', t, 365, 7) },
];

export const DIRECTION_FEATURES = FEATURES.filter((f) => f.role === 'direccion');
export const VOL_FEATURES = FEATURES.filter((f) => f.role === 'volatilidad');

/** Matriz de variables (filas = días). Valores ausentes → null. */
export function featureMatrix(h: History, defs: FeatureDef[]): (number | null)[][] {
  const n = h.days.length;
  const X: (number | null)[][] = new Array(n);
  for (let t = 0; t < n; t++) X[t] = defs.map((f) => { const x = f.calc(h, t); return x === null || !isFinite(x) ? null : x; });
  return X;
}
