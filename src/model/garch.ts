// GARCH(1,1) con innovaciones t de Student y "variance targeting".
// Parámetros libres: persistencia (α+β), cuota de α y grados de libertad ν.
import { mean, nelderMeadInit, nelderMeadStep, type NMState, tStdLogPdf } from './stats';

export interface GarchParams {
  omega: number;
  alpha: number;
  beta: number;
  nu: number;
  mu: number; // media diaria del rendimiento usada para centrar
  uncond: number; // varianza incondicional (objetivo)
}

const sig = (x: number) => 1 / (1 + Math.exp(-x));

export function unpack(x: number[], uncond: number, mu: number): GarchParams {
  const p = 0.9995 * sig(x[0]);
  const alpha = p * sig(x[1]) * 0.5; // α ≤ 0.5·p evita soluciones degeneradas
  const beta = p - alpha;
  const nu = 2.2 + Math.exp(x[2]);
  return { omega: uncond * (1 - p), alpha, beta, nu: Math.min(nu, 200), mu, uncond };
}

const logit = (p: number) => Math.log(p / (1 - p));
/** Inversa de unpack: permite arrancar el ajuste desde los parámetros anteriores. */
export function pack(g: GarchParams): number[] {
  const p = g.alpha + g.beta;
  return [logit(Math.min(0.999999, p / 0.9995)), logit(Math.min(0.999999, Math.max(1e-6, g.alpha / (0.5 * p)))), Math.log(Math.max(1e-3, g.nu - 2.2))];
}

/** Serie de varianzas condicionales h_t (h_t usa información hasta t-1). */
export function filter(r: number[], g: GarchParams): number[] {
  const h = new Array(r.length);
  let prev = g.uncond;
  let prevE = 0;
  for (let t = 0; t < r.length; t++) {
    const ht = t === 0 ? g.uncond : g.omega + g.alpha * prevE * prevE + g.beta * prev;
    h[t] = ht;
    prev = ht;
    prevE = r[t] - g.mu;
  }
  return h;
}

export function negLogLik(r: number[], g: GarchParams): number {
  let prev = g.uncond, prevE = 0, ll = 0;
  const nu = g.nu, s2 = (nu - 2) / nu;
  const k0 = tStdLogPdf(0, nu), a = (nu + 1) / 2, b = nu * s2;
  for (let t = 0; t < r.length; t++) {
    const ht = t === 0 ? g.uncond : g.omega + g.alpha * prevE * prevE + g.beta * prev;
    const e = r[t] - g.mu;
    ll += k0 - a * Math.log(1 + (e * e) / ht / b) - 0.5 * Math.log(ht);
    prev = ht;
    prevE = e;
  }
  return -ll;
}

export interface GarchFitState {
  nm: NMState;
  uncond: number;
  mu: number;
  n: number;
}

function objective(r: number[], uncond: number, mu: number) {
  return (x: number[]) => {
    const v = negLogLik(r, unpack(x, uncond, mu));
    return isFinite(v) ? v : 1e12;
  };
}

export function fitInit(r: number[], x0: number[] = [3.5, -1.0, 1.0]): GarchFitState {
  const mu = mean(r);
  let uncond = 0;
  for (const x of r) uncond += (x - mu) ** 2;
  uncond /= r.length;
  const f = objective(r, uncond, mu);
  return { nm: nelderMeadInit(f, x0, x0[0] === 3.5 ? [0.8, 0.8, 0.6] : [0.25, 0.25, 0.2]), uncond, mu, n: r.length };
}

/** Avanza el ajuste; pensado para repartir el cálculo entre ejecuciones con poco CPU. */
export function fitStep(r: number[], st: GarchFitState, iters: number): GarchFitState {
  nelderMeadStep(objective(r, st.uncond, st.mu), st.nm, iters);
  return st;
}

export function fitResult(st: GarchFitState): GarchParams {
  const v = st.nm.values;
  const i = v.indexOf(Math.min(...v));
  return unpack(st.nm.simplex[i], st.uncond, st.mu);
}

export function fit(r: number[], maxIter = 400, warm?: GarchParams): GarchParams {
  const st = fitInit(r, warm ? pack(warm) : undefined);
  fitStep(r, st, maxIter);
  return fitResult(st);
}

/** Varianza a 1 paso tras el último dato. */
export function nextVariance(r: number[], g: GarchParams): number {
  const h = filter(r, g);
  const n = r.length;
  const e = r[n - 1] - g.mu;
  return g.omega + g.alpha * e * e + g.beta * h[n - 1];
}

/** Trayectoria de varianzas esperadas h_{t+1..t+H}. */
export function variancePath(h1: number, g: GarchParams, H: number): number[] {
  const p = g.alpha + g.beta;
  const out = new Array(H);
  for (let k = 0; k < H; k++) out[k] = g.uncond + Math.pow(p, k) * (h1 - g.uncond);
  return out;
}
