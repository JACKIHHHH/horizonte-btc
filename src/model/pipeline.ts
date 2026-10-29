// Orquestación común al navegador y al calibrador: histórico → calibración → previsiones.
import type { BacktestResult } from './backtest';
import { HORIZONS, calibrate, driftContributions, forecast, inputsAt, prepare, simulate, type Calibration, type Horizon, type Mode, type Prepared, type ScenarioShock } from './engine';
import { eventStudy, SCENARIOS, type EventEffect } from './events';
import { DIRECTION_FEATURES, VOL_FEATURES, buildHistory, type SeriesPoints } from './history';
import { regimeAt } from './regime';

/** Elige, por horizonte, la variante con menor CRPS en el backtest publicado. */
export function chooseModes(bt: BacktestResult | null): Record<Horizon, { mode: Mode; motivo: string }> {
  const out = {} as Record<Horizon, { mode: Mode; motivo: string }>;
  for (const H of HORIZONS) {
    if (!bt) { out[H] = { mode: 'vol', motivo: 'Sin backtest publicado: se usa solo la amplitud (sin sesgo de dirección).' }; continue; }
    const ranked = bt.variants.filter((v) => v.scores[H]?.n > 100).sort((a, b) => a.scores[H].crps - b.scores[H].crps);
    const best = ranked[0];
    const mode = (best?.id === 'ingenuo' ? 'ingenuo' : best?.id ?? 'vol') as Mode;
    const naive = bt.variants.find((v) => v.id === 'ingenuo')!.scores[H].crps;
    out[H] = {
      mode,
      motivo: mode === 'ingenuo'
        ? 'Ningún modelo mejoró al paseo aleatorio en este horizonte; se muestra la referencia ingenua.'
        : `Mejor CRPS en el backtest: ${((1 - best.scores[H].crps / naive) * 100).toFixed(1).replace('.', ',')}\u00a0% mejor que el paseo aleatorio.`,
    };
  }
  return out;
}

export interface IndexWeights { [key: string]: number }
/** Pesos provisionales de los índices vivos sobre la volatilidad (log-varianza), hasta tener histórico propio. */
export const PROVISIONAL_INDEX_WEIGHTS: IndexWeights = { riesgo_geopolitico: 0.1, presion_regulatoria: 0.06 };

export function extraVolFromIndices(indices: { key: string; valor: number | null }[], w: IndexWeights = PROVISIONAL_INDEX_WEIGHTS): number {
  let s = 0;
  for (const i of indices) if (i.valor !== null && w[i.key]) s += w[i.key] * Math.max(0, i.valor);
  return Math.min(0.4, s);
}

export interface ModelRun {
  P: Prepared;
  cal: Calibration;
  t: number;
  modes: ReturnType<typeof chooseModes>;
  forecasts: Record<Horizon, ReturnType<typeof forecast>>;
  contributions: Record<Horizon, { key: string; label: string; group: string; value: number }[]>;
  regime: ReturnType<typeof regimeAt>;
  effects: Record<number, EventEffect[]>;
  features: { key: string; label: string; group: string; role: string; horizonte: string; value: number | null }[];
}

export function runModel(raw: Record<string, SeriesPoints>, bt: BacktestResult | null, extraVolLog = 0, livePrice?: number): ModelRun {
  const h = buildHistory(raw);
  const P = prepare(h);
  let t = h.days.length - 1;
  while (t > 0 && !h.s.close[t]) t--;
  const cal = calibrate(P, t);
  if (livePrice) cal.price = livePrice; // la previsión parte del precio de referencia actual
  const modes = chooseModes(bt);
  const inp = inputsAt(P, t);
  const forecasts = {} as ModelRun['forecasts'];
  const contributions = {} as ModelRun['contributions'];
  for (const H of HORIZONS) {
    forecasts[H] = forecast(cal, inp, H, [0.05, 0.25, 0.5, 0.75, 0.95], extraVolLog, modes[H].mode);
    contributions[H] = modes[H].mode === 'completo'
      ? driftContributions(cal, inp, H).map((c) => { const f = DIRECTION_FEATURES.find((x) => x.key === c.key)!; return { ...c, label: f.label, group: f.group }; })
      : [];
  }
  const effects: ModelRun['effects'] = { 1: eventStudy(h, 1), 7: eventStudy(h, 7), 30: eventStudy(h, 30) };
  const features = [...DIRECTION_FEATURES.map((f, j) => ({ f, v: inp.Xd[j] })), ...VOL_FEATURES.map((f, j) => ({ f, v: inp.Xv[j] }))]
    .map(({ f, v }) => ({ key: f.key, label: f.label, group: f.group, role: f.role, horizonte: f.horizonte, value: v }));
  return { P, cal, t, modes, forecasts, contributions, regime: regimeAt(h, t), effects, features };
}

/** Convierte escenarios activos (o con probabilidad de mercado) en choques para el Monte Carlo. */
export function shocksFor(run: ModelRun, H: Horizon, active: Record<string, number>): ScenarioShock[] {
  const eh = H === 1 ? 1 : H === 7 ? 7 : 30;
  return SCENARIOS.filter((s) => (active[s.id] ?? 0) > 0).map((s) => {
    const e = run.effects[eh].find((x) => x.cat === s.cat);
    return { id: s.id, prob: active[s.id], driftZ: e?.shrunkZ ?? 0, volLog: e?.volLogRatio ?? 0, days: eh };
  });
}

export function runSimulation(run: ModelRun, H: Horizon, active: Record<string, number>, extraVolLog = 0, nPaths = 10000) {
  return simulate(run.cal, inputsAt(run.P, run.t), H, shocksFor(run, H, active), nPaths, 7, extraVolLog, run.modes[H].mode);
}
