// Validación walk-forward: en cada día solo se usa información disponible ese día.
import { DIRECTION_FEATURES } from './history';
import { HORIZONS, calibrate, fitGarchAt, forecast, inputsAt, tq, type Calibration, type EngineOptions, type Horizon, type Prepared } from './engine';
import { normInv, tStdCdf, normCdf } from './stats';

const K = 20;
const TAUS = Array.from({ length: K }, (_, k) => (k + 0.5) / K);
const NORM_Q = TAUS.map(normInv);

export interface Score { n: number; cov90: number; cov50: number; crps: number; brier: number; pit: number[] }
export interface VariantResult { id: string; label: string; scores: Record<number, Score> }
export interface BacktestResult {
  from: string; to: string; refitDays: number;
  variants: VariantResult[];
  ablation: { group: string; label: string; delta: Record<number, number> }[]; // + = la variable mejora el CRPS
}

const pinball = (y: number, q: number, tau: number) => (y >= q ? tau * (y - q) : (1 - tau) * (q - y));

class Acc {
  n = 0; in90 = 0; in50 = 0; crps = 0; brier = 0; pit = new Array(10).fill(0);
  add(y: number, qs: number[], q05: number, q95: number, q25: number, q75: number, pUp: number, F: number) {
    this.n++;
    if (y >= q05 && y <= q95) this.in90++;
    if (y >= q25 && y <= q75) this.in50++;
    let c = 0;
    for (let k = 0; k < K; k++) c += pinball(y, qs[k], TAUS[k]);
    this.crps += (2 * c) / K;
    this.brier += (pUp - (y > 0 ? 1 : 0)) ** 2;
    this.pit[Math.min(9, Math.floor(F * 10))]++;
  }
  score(): Score {
    const n = Math.max(1, this.n);
    return { n: this.n, cov90: this.in90 / n, cov50: this.in50 / n, crps: this.crps / n, brier: this.brier / n, pit: this.pit.map((x) => x / n) };
  }
}

const GROUP_LABEL: Record<string, string> = { mercado: 'Mercado', liquidez: 'Liquidez', sentimiento: 'Sentimiento', onchain: 'On-chain', macro: 'Macro' };

export function backtest(P: Prepared, opts: { from?: string; refitDays?: number; onProgress?: (f: number) => void } = {}): BacktestResult {
  const refitDays = opts.refitDays ?? 30;
  const days = P.h.days;
  const firstValid = P.h.s.close.findIndex((x) => !!x);
  let s0 = Math.max(firstValid + 1100, opts.from ? days.indexOf(opts.from) : 0);
  if (s0 < 0) s0 = firstValid + 1100;
  const last = days.length - 1;

  const groups = [...new Set(DIRECTION_FEATURES.map((f) => f.group))];
  type V = { id: string; label: string; opts?: EngineOptions; acc: Record<number, Acc>; cal?: Calibration };
  const mk = (id: string, label: string, o?: EngineOptions): V => ({ id, label, opts: o, acc: Object.fromEntries(HORIZONS.map((H) => [H, new Acc()])) });
  const naive = mk('ingenuo', 'Paseo aleatorio (referencia)');
  const variants: V[] = [
    mk('garch', 'GARCH-t (solo amplitud)', { useDrift: false, useVolAdj: false }),
    mk('vol', '+ volatilidad implícita y macro', { useDrift: false, useVolAdj: true }),
    mk('completo', 'Modelo completo (+ dirección)', { useDrift: true, useVolAdj: true }),
  ];
  // Para la ablación se compara contra el modelo completo sin filtro de validación (misma lambda).
  const ref = mk('ref', 'Referencia de ablación', { useDrift: true, useVolAdj: true });
  const ablations: (V & { group: string })[] = groups.map((g) => ({
    ...mk('sin-' + g, 'Sin ' + GROUP_LABEL[g], { useDrift: true, useVolAdj: true, driftMask: DIRECTION_FEATURES.map((f) => f.group !== g) }),
    group: g,
  }));

  const total = last - s0;
  for (let t = s0; t < last; t++) {
    if ((t - s0) % refitDays === 0) {
      const gf = fitGarchAt(P, t, t === s0 ? 450 : 120, variants[0].cal?.garch);
      for (const v of variants) v.cal = calibrate(P, t, v.opts, gf);
      const full = variants[2].cal!;
      const lambdas = Object.fromEntries(HORIZONS.map((H) => [H, full.drift[H]?.lambda])) as Partial<Record<Horizon, number>>;
      ref.cal = calibrate(P, t, ref.opts, gf, lambdas);
      for (const a of ablations) a.cal = calibrate(P, t, a.opts, gf, lambdas);
      opts.onProgress?.((t - s0) / total);
    } else {
      // Actualiza el estado GARCH del día sin reajustar parámetros
      for (const v of [...variants, ref, ...ablations]) {
        const c = v.cal!;
        const g = c.garch;
        const prevH = c.h1;
        const e = (P.r[t] ?? 0) - g.mu;
        c.h1 = g.omega + g.alpha * e * e + g.beta * prevH;
        c.price = P.h.s.close[t] as number;
        c.t = t;
      }
    }
    const inp = inputsAt(P, t);
    // Volatilidad muestral de 365 días para el modelo ingenuo
    let ss = 0, cnt = 0;
    for (let i = t - 364; i <= t; i++) if (isFinite(P.r[i])) { ss += P.r[i] ** 2; cnt++; }
    const sdNaive = Math.sqrt(ss / Math.max(1, cnt));
    for (const H of HORIZONS) {
      const y = P.fwd[H][t];
      if (!isFinite(y)) continue;
      const sN = sdNaive * Math.sqrt(H);
      const qN = NORM_Q.map((z) => z * sN);
      naive.acc[H].add(y, qN, -1.645 * sN, 1.645 * sN, -0.674 * sN, 0.674 * sN, 0.5, normCdf(y / sN));
      for (const v of [...variants, ref, ...ablations]) {
        const f = forecast(v.cal!, inp, H, [0.5]);
        const qs = TAUS.map((p) => f.center + f.sd * tq(p, f.nu));
        const q = (p: number) => f.center + f.sd * tq(p, f.nu);
        v.acc[H].add(y, qs, q(0.05), q(0.95), q(0.25), q(0.75), f.probUp, tStdCdf((y - f.center) / f.sd, f.nu));
      }
    }
  }
  opts.onProgress?.(1);
  const toRes = (v: V): VariantResult => ({ id: v.id, label: v.label, scores: Object.fromEntries(HORIZONS.map((H) => [H, v.acc[H].score()])) });
  const full = ref;
  return {
    from: days[s0], to: days[last], refitDays,
    variants: [toRes(naive), ...variants.map(toRes)],
    ablation: ablations.map((a) => ({
      group: a.group, label: GROUP_LABEL[a.group],
      delta: Object.fromEntries(HORIZONS.map((H) => [H, a.acc[H].score().crps - full.acc[H].score().crps])),
    })),
  };
}
