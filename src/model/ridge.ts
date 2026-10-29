// Regresión ridge con estandarización; los ausentes se imputan a la media (0 tras estandarizar).

export interface RidgeModel {
  keys: string[];
  means: number[];
  sds: number[];
  beta: number[]; // sobre variables estandarizadas
  intercept: number;
  lambda: number;
  n: number;
  disabled?: boolean; // la validación no supera a "sin deriva": la predicción es 0
}

function solve(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}

export function standardizer(X: (number | null)[][], rows: number[]) {
  const p = rows.length ? X[rows[0]]?.length ?? 0 : 0;
  const means = new Array(p).fill(0), sds = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    const vals: number[] = [];
    for (const i of rows) { const x = X[i][j]; if (x !== null) vals.push(x); }
    if (vals.length > 10) {
      const m = vals.reduce((a, b) => a + b, 0) / vals.length;
      const s = Math.sqrt(vals.reduce((a, b) => a + (b - m) ** 2, 0) / (vals.length - 1));
      means[j] = m; sds[j] = s > 0 ? s : 1;
    } else { means[j] = 0; sds[j] = Infinity; } // variable sin datos → sin efecto
  }
  return { means, sds };
}

export const zrow = (x: (number | null)[], means: number[], sds: number[]) =>
  x.map((v, j) => (v === null || !isFinite(sds[j]) ? 0 : Math.max(-4, Math.min(4, (v - means[j]) / sds[j]))));

export function fitRidge(X: (number | null)[][], y: number[], rows: number[], lambda: number, keys: string[], mask?: boolean[]): RidgeModel {
  const { means, sds } = standardizer(X, rows);
  const p = means.length;
  const use = rows.filter((i) => isFinite(y[i]));
  const ym = use.reduce((a, i) => a + y[i], 0) / Math.max(1, use.length);
  const A = Array.from({ length: p }, () => new Array(p).fill(0));
  const b = new Array(p).fill(0);
  for (const i of use) {
    const z = zrow(X[i], means, sds).map((v, j) => (mask && !mask[j] ? 0 : v));
    const yi = y[i] - ym;
    for (let j = 0; j < p; j++) {
      b[j] += z[j] * yi;
      for (let k = j; k < p; k++) A[j][k] += z[j] * z[k];
    }
  }
  const n = Math.max(1, use.length);
  for (let j = 0; j < p; j++) {
    for (let k = 0; k < j; k++) A[j][k] = A[k][j];
    A[j][j] += lambda * n;
  }
  const beta = p ? solve(A, b).map((v, j) => (mask && !mask[j] ? 0 : v)) : [];
  return { keys, means, sds, beta, intercept: ym, lambda, n: use.length };
}

export function predictRidge(m: RidgeModel, x: (number | null)[]): number {
  if (m.disabled) return 0;
  const z = zrow(x, m.means, m.sds);
  let s = m.intercept;
  for (let j = 0; j < z.length; j++) s += m.beta[j] * z[j];
  return s;
}

/** Contribución de cada variable a la predicción actual (sobre la media). */
export function contributions(m: RidgeModel, x: (number | null)[]): { key: string; value: number }[] {
  if (m.disabled) return m.keys.map((key) => ({ key, value: 0 }));
  const z = zrow(x, m.means, m.sds);
  return m.keys.map((key, j) => ({ key, value: m.beta[j] * z[j] }));
}

/**
 * Elige lambda por validación temporal (último 25 % de las filas de entrenamiento) y la compara
 * con no predecir deriva (0). Si ninguna lambda mejora a 0, el modelo queda desactivado.
 */
export function fitRidgeCV(X: (number | null)[][], y: number[], rows: number[], keys: string[], mask?: boolean[], grid = [0.05, 0.2, 1, 5, 20]): RidgeModel {
  const cut = Math.floor(rows.length * 0.75);
  const tr = rows.slice(0, cut), va = rows.slice(cut).filter((i) => isFinite(y[i]));
  let best = grid[grid.length - 1], bestErr = Infinity, zeroErr = Infinity;
  if (va.length > 30) {
    zeroErr = va.reduce((e, i) => e + y[i] ** 2, 0);
    for (const l of grid) {
      const m = fitRidge(X, y, tr, l, keys, mask);
      let e = 0;
      for (const i of va) e += (y[i] - predictRidge(m, X[i])) ** 2;
      if (e < bestErr) { bestErr = e; best = l; }
    }
  }
  const m = fitRidge(X, y, rows, best, keys, mask);
  // Exige una mejora mínima (0,5 % del error) para no activar la deriva por azar
  if (bestErr >= zeroErr * 0.995) m.disabled = true;
  return m;
}
