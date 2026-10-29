// Utilidades estadísticas sin dependencias. Compartidas por el Worker y el navegador.

export const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);

export function std(a: number[], ddof = 1): number {
  if (a.length <= ddof) return NaN;
  const m = mean(a);
  let s = 0;
  for (const x of a) s += (x - m) ** 2;
  return Math.sqrt(s / (a.length - ddof));
}

export function quantile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function median(a: number[]): number {
  return quantile([...a].sort((x, y) => x - y), 0.5);
}

export const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function zscore(value: number, sample: number[]): number {
  const s = std(sample);
  if (!isFinite(s) || s === 0) return 0;
  return (value - mean(sample)) / s;
}

// ---------- Generador pseudoaleatorio reproducible (mulberry32) ----------
export function rng(seed = 1): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function normal(u: () => number): number {
  let x = 0;
  while (x === 0) x = u();
  return Math.sqrt(-2 * Math.log(x)) * Math.cos(2 * Math.PI * u());
}

// Gamma(k,1) por Marsaglia-Tsang
export function gamma(k: number, u: () => number): number {
  if (k < 1) return gamma(k + 1, u) * Math.pow(u(), 1 / k);
  const d = k - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number, v: number;
    do {
      x = normal(u);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const w = u();
    if (w < 1 - 0.0331 * x ** 4) return d * v;
    if (Math.log(w) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** t de Student estandarizada a varianza 1 (requiere nu > 2). */
export function studentStd(nu: number, u: () => number): number {
  const z = normal(u);
  const chi = 2 * gamma(nu / 2, u);
  return (z / Math.sqrt(chi / nu)) * Math.sqrt((nu - 2) / nu);
}

// ---------- Funciones especiales ----------
export function lgamma(x: number): number {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function betacf(a: number, b: number, x: number): number {
  const MAXIT = 200, EPS = 3e-14, FPMIN = 1e-300;
  const qab = a + b, qap = a + 1, qam = a - 1;
  let c = 1, d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= MAXIT; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d; h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return h;
}

export function ibeta(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(a, b, x)) / a : 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** CDF de la t de Student (no estandarizada a varianza 1). */
export function tCdf(t: number, nu: number): number {
  const x = nu / (nu + t * t);
  const p = 0.5 * ibeta(nu / 2, 0.5, x);
  return t > 0 ? 1 - p : p;
}

/** Cuantil de la t de Student por bisección (suficiente para uso interactivo). */
export function tInv(p: number, nu: number): number {
  if (nu > 1e4) return normInv(p);
  let lo = -200, hi = 200;
  for (let i = 0; i < 90; i++) {
    const mid = (lo + hi) / 2;
    if (tCdf(mid, nu) < p) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Cuantil de la t estandarizada a varianza 1. */
export function tStdInv(p: number, nu: number): number {
  return nu > 1e4 ? normInv(p) : tInv(p, nu) * Math.sqrt((nu - 2) / nu);
}

export function tStdCdf(x: number, nu: number): number {
  return nu > 1e4 ? normCdf(x) : tCdf(x / Math.sqrt((nu - 2) / nu), nu);
}

export function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26 vía erf
  const t = 1 / (1 + 0.3275911 * Math.abs(x / Math.SQRT2));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2);
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export function normInv(p: number): number {
  // Acklam
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5, r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** Log-densidad de la t estandarizada a varianza 1. */
export function tStdLogPdf(x: number, nu: number): number {
  const s2 = (nu - 2) / nu;
  return lgamma((nu + 1) / 2) - lgamma(nu / 2) - 0.5 * Math.log(Math.PI * nu * s2) - ((nu + 1) / 2) * Math.log(1 + (x * x) / (nu * s2));
}

// ---------- Nelder-Mead ----------
export interface NMState { simplex: number[][]; values: number[]; iter: number; done: boolean }

export function nelderMeadInit(f: (x: number[]) => number, x0: number[], step: number[]): NMState {
  const simplex = [x0.slice()];
  for (let i = 0; i < x0.length; i++) {
    const p = x0.slice();
    p[i] += step[i];
    simplex.push(p);
  }
  return { simplex, values: simplex.map(f), iter: 0, done: false };
}

/** Avanza `maxIter` iteraciones; se puede reanudar (útil con el límite de CPU del Worker). */
export function nelderMeadStep(f: (x: number[]) => number, st: NMState, maxIter: number, tol = 1e-7): NMState {
  const n = st.simplex[0].length;
  const S = st.simplex, V = st.values;
  for (let k = 0; k < maxIter && !st.done; k++, st.iter++) {
    const order = V.map((v, i) => i).sort((a, b) => V[a] - V[b]);
    const s2 = order.map((i) => S[i]);
    const v2 = order.map((i) => V[i]);
    for (let i = 0; i <= n; i++) { S[i] = s2[i]; V[i] = v2[i]; }
    if (Math.abs(V[n] - V[0]) <= tol * (Math.abs(V[0]) + 1e-12)) { st.done = true; break; }
    const c = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += S[i][j] / n;
    const lerp = (t: number) => c.map((cj, j) => cj + t * (S[n][j] - cj));
    const xr = lerp(-1), fr = f(xr);
    if (fr < V[0]) {
      const xe = lerp(-2), fe = f(xe);
      if (fe < fr) { S[n] = xe; V[n] = fe; } else { S[n] = xr; V[n] = fr; }
    } else if (fr < V[n - 1]) {
      S[n] = xr; V[n] = fr;
    } else {
      const xc = fr < V[n] ? lerp(-0.5) : lerp(0.5);
      const fc = f(xc);
      if (fc < Math.min(fr, V[n])) { S[n] = xc; V[n] = fc; }
      else {
        for (let i = 1; i <= n; i++) {
          S[i] = S[i].map((x, j) => S[0][j] + 0.5 * (x - S[0][j]));
          V[i] = f(S[i]);
        }
      }
    }
  }
  return st;
}

export function nelderMead(f: (x: number[]) => number, x0: number[], step: number[], maxIter = 600): { x: number[]; f: number } {
  const st = nelderMeadStep(f, nelderMeadInit(f, x0, step), maxIter);
  const i = st.values.indexOf(Math.min(...st.values));
  return { x: st.simplex[i], f: st.values[i] };
}
