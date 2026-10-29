// Motor de previsión: GARCH-t (amplitud) + ajuste de volatilidad (implícita y macro) + ridge (sesgo de dirección).
import { fit as fitGarch, filter, variancePath, type GarchParams } from './garch';
import { DIRECTION_FEATURES, VOL_FEATURES, featureMatrix, logReturns, type History } from './history';
import { contributions, fitRidge, fitRidgeCV, predictRidge, type RidgeModel } from './ridge';
import { clamp, quantile, rng, studentStd, tStdCdf, tStdInv, tStdLogPdf } from './stats';

export const HORIZONS = [1, 7, 30, 90] as const;
export type Horizon = (typeof HORIZONS)[number];

/**
 * Varianza a H días = level · [w·GARCH + (1−w)·histórica 365 d] · exp(ajuste).
 * w y el uso del ajuste (implícita, VIX, EPU) se eligen por validación temporal.
 */
export interface VolModel { keys: string[]; ridge: RidgeModel | null; level: number; w: number }

export interface Calibration {
  t: number; // índice del último día usado
  asOf: string;
  price: number;
  garch: GarchParams;
  h1: number;
  drift: Partial<Record<Horizon, RidgeModel>>;
  vol: Partial<Record<Horizon, VolModel>>;
  options: EngineOptions;
}

export interface EngineOptions {
  useDrift: boolean;
  useVolAdj: boolean;
  driftMask?: boolean[]; // por variable de dirección (ablación)
  minTrain?: number;
}

export const DEFAULT_OPTIONS: EngineOptions = { useDrift: true, useVolAdj: true };

export interface Prepared {
  h: History;
  r: number[];
  Xd: (number | null)[][];
  Xv: (number | null)[][];
  fwd: Record<number, number[]>; // rendimiento log futuro a h días
  rv: Record<number, number[]>; // suma de r² en los próximos h días
  nv: number[]; // varianza diaria muestral de los últimos 365 días
}

export function prepare(h: History): Prepared {
  const r = logReturns(h.s.close);
  const Xd = featureMatrix(h, DIRECTION_FEATURES);
  const Xv = featureMatrix(h, VOL_FEATURES);
  const fwd: Prepared['fwd'] = {}, rv: Prepared['rv'] = {};
  const n = r.length;
  const c = h.s.close;
  for (const H of HORIZONS) {
    fwd[H] = new Array(n).fill(NaN);
    rv[H] = new Array(n).fill(NaN);
    for (let t = 0; t + H < n; t++) {
      const a = c[t], b = c[t + H];
      if (a && b) fwd[H][t] = Math.log(b / a);
      let s = 0, ok = true;
      for (let k = t + 1; k <= t + H; k++) { if (!isFinite(r[k])) { ok = false; break; } s += r[k] * r[k]; }
      if (ok) rv[H][t] = s;
    }
  }
  const nv = new Array(n).fill(NaN);
  let ss = 0, cnt = 0;
  for (let t = 0; t < n; t++) {
    if (isFinite(r[t])) { ss += r[t] * r[t]; cnt++; }
    const o = t - 365;
    if (o >= 0 && isFinite(r[o])) { ss -= r[o] * r[o]; cnt--; }
    if (cnt > 200) nv[t] = ss / cnt;
  }
  return { h, r, Xd, Xv, fwd, rv, nv };
}

function validReturns(r: number[], from: number, to: number): number[] {
  const out: number[] = [];
  for (let i = from; i <= to; i++) if (isFinite(r[i])) out.push(r[i]);
  return out;
}

/** Varianza GARCH acumulada a h días desde cada t (para el modelo de volatilidad). */
function garchCumVar(hseries: number[], r: number[], g: GarchParams, t: number, H: number): number {
  const e = (r[t] ?? 0) - g.mu;
  const h1 = g.omega + g.alpha * e * e + g.beta * hseries[t];
  return variancePath(h1, g, H).reduce((a, b) => a + b, 0);
}

function dvolGap(P: Prepared, cum: number, t: number, H: number): number | null {
  const d = P.h.s.dvol?.[t];
  if (!d) return null;
  return Math.log(((d / 100) ** 2 * H) / 365 / cum);
}

export interface GarchFit { garch: GarchParams; hFull: number[]; h1: number; start: number }

export function fitGarchAt(P: Prepared, t: number, iters = 450, warm?: GarchParams): GarchFit {
  const start = Math.max(1, t - 365 * 6); // hasta 6 años de rendimientos
  const garch = fitGarch(validReturns(P.r, start, t), iters, warm);
  const window = P.r.slice(start, t + 1).map((x) => (isFinite(x) ? x : 0));
  const hs = filter(window, garch);
  const hFull: number[] = new Array(P.r.length).fill(NaN);
  for (let i = 0; i < hs.length; i++) hFull[start + i] = hs[i];
  const e = (P.r[t] ?? 0) - garch.mu;
  const h1 = garch.omega + garch.alpha * e * e + garch.beta * hFull[t];
  return { garch, hFull, h1, start };
}

export function calibrate(P: Prepared, t: number, opts: EngineOptions = DEFAULT_OPTIONS, gf?: GarchFit, lambdas?: Partial<Record<Horizon, number>>): Calibration {
  const { garch, hFull, h1, start } = gf ?? fitGarchAt(P, t);
  const drift: Calibration['drift'] = {};
  const vol: Calibration['vol'] = {};
  const minTrain = opts.minTrain ?? 365;
  const dkeys = DIRECTION_FEATURES.map((f) => f.key);
  for (const H of HORIZONS) {
    // Solo filas cuyo objetivo ya ha vencido en t (sin fuga de datos)
    const rows: number[] = [];
    for (let i = Math.max(200, start); i + H <= t; i++) if (isFinite(P.fwd[H][i])) rows.push(i);
    if (opts.useDrift && rows.length >= minTrain) {
      const l = lambdas?.[H];
      drift[H] = l !== undefined ? fitRidge(P.Xd, P.fwd[H], rows, l, dkeys, opts.driftMask) : fitRidgeCV(P.Xd, P.fwd[H], rows, dkeys, opts.driftMask);
    }
    if (opts.useVolAdj && rows.length >= minTrain) vol[H] = fitVol(P, rows, hFull, garch, H, minTrain);
  }
  return { t, asOf: P.h.days[t], price: P.h.s.close[t] as number, garch, h1, drift, vol, options: opts };
}

function fitVol(P: Prepared, rows: number[], hFull: number[], garch: GarchParams, H: Horizon, minTrain: number): VolModel | undefined {
  const keys = ['dvolGap', ...VOL_FEATURES.map((f) => f.key)];
  const X: (number | null)[][] = new Array(P.r.length);
  const GV: number[] = new Array(P.r.length).fill(NaN), NV: number[] = new Array(P.r.length).fill(NaN);
  const vrows: number[] = [];
  for (const i of rows) {
    if (!isFinite(hFull[i]) || !isFinite(P.rv[H][i]) || !isFinite(P.nv[i])) continue;
    GV[i] = garchCumVar(hFull, P.r, garch, i, H);
    NV[i] = P.nv[i] * H;
    X[i] = [dvolGap(P, GV[i], i, H), ...P.Xv[i]];
    vrows.push(i);
  }
  if (vrows.length < minTrain) return undefined;
  const nu = nuH(garch.nu, H);
  const cut = Math.floor(vrows.length * 0.75);
  const tr = vrows.slice(0, cut), va = vrows.slice(cut);
  const build = (w: number, adj: boolean, fitRows: number[]): VolModel => {
    const y: number[] = new Array(P.r.length).fill(NaN);
    for (const i of fitRows) y[i] = Math.log(Math.max(P.rv[H][i], 1e-10) / (w * GV[i] + (1 - w) * NV[i]));
    const ridge = adj ? fitRidge(X, y, fitRows, 0.5, keys) : null;
    // Corrección de nivel: E[RV] = level · E[base · exp(ŷ)]
    let num = 0, den = 0;
    for (const i of fitRows) {
      const base = w * GV[i] + (1 - w) * NV[i];
      num += P.rv[H][i];
      den += base * (ridge ? Math.exp(predictRidge(ridge, X[i])) : 1);
    }
    return { keys, ridge, level: num / Math.max(den, 1e-12), w };
  };
  const varOf = (m: VolModel, i: number) => m.level * (m.w * GV[i] + (1 - m.w) * NV[i]) * (m.ridge ? Math.exp(predictRidge(m.ridge, X[i])) : 1);
  let best: { w: number; adj: boolean } = { w: 1, adj: false }, bestScore = -Infinity;
  for (const w of [0, 0.25, 0.5, 0.75, 1]) {
    for (const adj of [false, true]) {
      const m = build(w, adj, tr);
      let sc = 0;
      for (const i of va) {
        const sd = Math.sqrt(varOf(m, i));
        sc += tStdLogPdfFast(P.fwd[H][i] / sd, nu) - Math.log(sd);
      }
      if (sc > bestScore) { bestScore = sc; best = { w, adj }; }
    }
  }
  return build(best.w, best.adj, vrows);
}

const LOGPDF_K = new Map<number, number>();
function tStdLogPdfFast(x: number, nu: number): number {
  let k = LOGPDF_K.get(nu);
  if (k === undefined) { k = tStdLogPdf(0, nu); LOGPDF_K.set(nu, k); }
  return k - ((nu + 1) / 2) * Math.log(1 + (x * x) / (nu - 2));
}

export interface HorizonForecast {
  horizon: number;
  center: number; // log-rendimiento esperado (mediana aproximada)
  sd: number; // desviación del log-rendimiento
  nu: number;
  volMult: number;
  quantiles: { p: number; price: number }[];
  probUp: number;
}

// Grados de libertad del rendimiento agregado a H días: la suma de innovaciones t tiende a la normal.
// Aproximación lineal en H (validada por la cobertura del backtest).
export const nuH = (nu: number, H: number) => Math.min(200, 2.2 + (nu - 2.2) * H);

const QCACHE = new Map<string, number>();
export function tq(p: number, nu: number): number {
  const k = p.toFixed(4) + ':' + nu.toFixed(1);
  let v = QCACHE.get(k);
  if (v === undefined) { v = tStdInv(p, Math.round(nu * 10) / 10); QCACHE.set(k, v); }
  return v;
}

export interface ForecastInputs { Xd: (number | null)[]; Xv: (number | null)[]; dvol: number | null; nv: number }

export function inputsAt(P: Prepared, t: number): ForecastInputs {
  return { Xd: P.Xd[t], Xv: P.Xv[t], dvol: P.h.s.dvol?.[t] ?? null, nv: P.nv[t] };
}

/** Componentes activos: el backtest publicado decide cuál usar en cada horizonte. */
export type Mode = 'ingenuo' | 'garch' | 'vol' | 'completo';
export const MODE_LABEL: Record<Mode, string> = {
  ingenuo: 'Paseo aleatorio', garch: 'GARCH-t', vol: 'GARCH-t + volatilidad implícita y macro', completo: 'Modelo completo (amplitud + dirección)',
};

export function forecast(c: Calibration, inp: ForecastInputs, H: Horizon, ps = [0.05, 0.25, 0.5, 0.75, 0.95], extraVolLog = 0, mode: Mode = 'completo'): HorizonForecast {
  const path = variancePath(c.h1, c.garch, H);
  const cum = path.reduce((a, b) => a + b, 0);
  let volMult = 1, center = 0, nu = nuH(c.garch.nu, H);
  if (mode === 'ingenuo' && isFinite(inp.nv)) {
    volMult = (inp.nv * H) / cum;
    nu = 200;
  }
  const vm = c.vol[H];
  if (vm && (mode === 'vol' || mode === 'completo')) {
    const gap = inp.dvol ? Math.log(((inp.dvol / 100) ** 2 * H) / 365 / cum) : null;
    const base = isFinite(inp.nv) ? vm.w * cum + (1 - vm.w) * inp.nv * H : cum;
    const adj = vm.ridge ? Math.exp(predictRidge(vm.ridge, [gap, ...inp.Xv])) : 1;
    volMult = clamp((vm.level * base * adj) / cum, 0.25, 4);
  }
  volMult *= Math.exp(extraVolLog);
  const dm = c.drift[H];
  if (dm && mode === 'completo') center = clamp(predictRidge(dm, inp.Xd), -0.5, 0.5);
  const sd = Math.sqrt(cum * volMult);
  return {
    horizon: H, center, sd, nu, volMult,
    quantiles: ps.map((p) => ({ p, price: c.price * Math.exp(center + sd * tq(p, nu)) })),
    probUp: 1 - tStdCdf(-center / sd, nu),
  };
}

export function driftContributions(c: Calibration, inp: ForecastInputs, H: Horizon) {
  const m = c.drift[H];
  return m ? contributions(m, inp.Xd) : [];
}

// ---------- Monte Carlo con escenarios ----------

export interface ScenarioShock { id: string; prob: number; driftZ: number; volLog: number; days: number }

export interface SimResult {
  horizon: number;
  bands: { day: number; p05: number; p25: number; p50: number; p75: number; p95: number }[];
  finals: Float64Array; // precios finales ordenados
  probAbove: (level: number) => number;
}

export function simulate(c: Calibration, inp: ForecastInputs, H: Horizon, shocks: ScenarioShock[], nPaths = 10000, seed = 7, extraVolLog = 0, mode: Mode = 'completo'): SimResult {
  const base = forecast(c, inp, H, [0.5], extraVolLog, mode);
  const g = c.garch;
  const u = rng(seed);
  const driftDay = base.center / H;
  const volMult = base.volMult;
  const sigmaNow = Math.sqrt(c.h1);
  const byDay: Float64Array[] = Array.from({ length: H }, () => new Float64Array(nPaths));
  const finals = new Float64Array(nPaths);
  for (let p = 0; p < nPaths; p++) {
    // Escenarios que se activan en esta trayectoria
    let shockDrift = 0, shockDays = 1, shockVol = 0, volDays = 0;
    for (const s of shocks) {
      if (u() < s.prob) {
        shockDrift += s.driftZ * sigmaNow * Math.sqrt(Math.min(H, s.days));
        shockDays = Math.max(shockDays, Math.min(H, 7));
        shockVol += s.volLog;
        volDays = Math.max(volDays, Math.min(H, s.days));
      }
    }
    let hk = c.h1, lp = 0;
    for (let k = 0; k < H; k++) {
      const vm = volMult * (k < volDays ? Math.exp(shockVol) : 1);
      const z = studentStd(g.nu, u);
      const eps = Math.sqrt(hk) * z;
      lp += driftDay + (k < shockDays ? shockDrift / shockDays : 0) + eps * Math.sqrt(vm);
      byDay[k][p] = lp;
      hk = g.omega + g.alpha * eps * eps + g.beta * hk;
    }
    finals[p] = c.price * Math.exp(lp);
  }
  const bands = byDay.map((arr, k) => {
    const s = Array.from(arr).sort((a, b) => a - b);
    const q = (x: number) => c.price * Math.exp(quantile(s, x));
    return { day: k + 1, p05: q(0.05), p25: q(0.25), p50: q(0.5), p75: q(0.75), p95: q(0.95) };
  });
  finals.sort();
  return {
    horizon: H, bands, finals,
    probAbove: (level: number) => {
      let lo = 0, hi = finals.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (finals[m] <= level) lo = m + 1; else hi = m; }
      return (finals.length - lo) / finals.length;
    },
  };
}
