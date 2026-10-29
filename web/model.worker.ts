// El modelo se calibra en el navegador (Web Worker) a partir de las series públicas de la web.
import { backtest, type BacktestResult } from '../src/model/backtest';
import { HORIZONS, type Horizon } from '../src/model/engine';
import { runModel, runSimulation, type ModelRun } from '../src/model/pipeline';
import type { SeriesPoints } from '../src/model/history';

let run: ModelRun | null = null;
let extraVol = 0;

self.onmessage = (ev: MessageEvent) => {
  const { id, type, payload } = ev.data;
  try {
    if (type === 'init') {
      extraVol = payload.extraVol ?? 0;
      run = runModel(payload.series as Record<string, SeriesPoints>, payload.backtest as BacktestResult | null, extraVol, payload.livePrice);
      const r = run;
      const close = r.P.h.s.close;
      const history: [string, number][] = [];
      for (let i = Math.max(0, r.t - 400); i <= r.t; i++) if (close[i]) history.push([r.P.h.days[i], close[i] as number]);
      postMessage({ id, ok: true, result: {
        asOf: r.P.h.days[r.t], price: r.cal.price, garch: r.cal.garch, modes: r.modes, forecasts: r.forecasts, contributions: r.contributions,
        regime: r.regime, effects: r.effects, features: r.features, history,
        drift: Object.fromEntries(HORIZONS.map((H) => [H, r.cal.drift[H] ? { activa: !r.cal.drift[H]!.disabled } : null])),
        vol: Object.fromEntries(HORIZONS.map((H) => [H, r.cal.vol[H] ? { w: r.cal.vol[H]!.w, ajuste: !!r.cal.vol[H]!.ridge, nivel: r.cal.vol[H]!.level } : null])),
        nDays: r.P.h.days.length, firstDay: r.P.h.days[0],
      } });
    } else if (type === 'simulate') {
      if (!run) throw new Error('modelo sin calibrar');
      const H = payload.horizon as Horizon;
      const sim = runSimulation(run, H, payload.active, extraVol + (payload.extraVol ?? 0), payload.paths ?? 10000);
      const level = payload.level as number | null;
      const f = sim.finals;
      postMessage({ id, ok: true, result: {
        bands: sim.bands, probAbove: level ? sim.probAbove(level) : null,
        p05: f[Math.floor(f.length * 0.05)], p50: f[Math.floor(f.length * 0.5)], p95: f[Math.floor(f.length * 0.95)],
        probUp: sim.probAbove(run.cal.price),
      } });
    } else if (type === 'backtest') {
      if (!run) throw new Error('modelo sin calibrar');
      const bt = backtest(run.P, { from: '2018-01-01', onProgress: (p) => postMessage({ id, progress: p }) });
      postMessage({ id, ok: true, result: bt });
    }
  } catch (e) {
    postMessage({ id, ok: false, error: (e as Error).message });
  }
};
