// Calibrador oficial: descarga el histórico de la propia web, calibra, (opcional) ejecuta el backtest
// y publica la previsión del día para que quede registrada y se verifique al vencer.
//
// Uso:  BASE=https://tu-dominio PUBLISH_TOKEN=xxx npx tsx scripts/calibrar.ts [--backtest]
// Pensado para ejecutarse a diario (NAS con Docker, GitHub Actions o cron local).
import { backtest, type BacktestResult } from '../src/model/backtest';
import { HORIZONS } from '../src/model/engine';
import { addDays, type SeriesPoints } from '../src/model/history';
import { runModel } from '../src/model/pipeline';

const BASE = (process.env.BASE ?? 'http://localhost:8787').replace(/\/$/, '');
const TOKEN = process.env.PUBLISH_TOKEN;
const RUN_BT = process.argv.includes('--backtest');
const DRY = process.argv.includes('--sin-publicar');

async function get<T>(path: string): Promise<T | null> {
  const r = await fetch(BASE + path);
  if (!r.ok) return null;
  return (await r.json()) as T;
}

/**
 * y = log(varianza realizada a 7 días / varianza histórica esperada); x = parte positiva de cada índice.
 * Mínimos cuadrados con constante; los pesos se acotan a [0, 0,5] (solo pueden ampliar la volatilidad).
 */
function estimateIndexWeights(run: ReturnType<typeof runModel>, hist: { day: string; key: string; value: number }[]) {
  const KEYS = ['riesgo_geopolitico', 'presion_regulatoria'];
  const byDay = new Map<string, Record<string, number>>();
  for (const r of hist) { const o = byDay.get(r.day) ?? {}; o[r.key] = r.value; byDay.set(r.day, o); }
  const idx = new Map(run.P.h.days.map((d, i) => [d, i]));
  const X: number[][] = [], y: number[] = [];
  for (const [day, v] of byDay) {
    const i = idx.get(day);
    if (i === undefined || !KEYS.every((k) => k in v)) continue;
    const rv = run.P.rv[7][i], nv = run.P.nv[i];
    if (!isFinite(rv) || !isFinite(nv) || rv <= 0) continue;
    X.push([1, ...KEYS.map((k) => Math.max(0, v[k]))]);
    y.push(Math.log(rv / (nv * 7)));
  }
  if (y.length < 120) return { estado: 'insuficiente', n: y.length, necesarios: 120 };
  // Ecuaciones normales 3×3
  const p = X[0].length, A = Array.from({ length: p }, () => new Array(p + 1).fill(0));
  X.forEach((x, r) => { for (let i = 0; i < p; i++) { A[i][p] += x[i] * y[r]; for (let j = 0; j < p; j++) A[i][j] += x[i] * x[j] + (i === j && i > 0 ? 1e-3 : 0); } });
  for (let c = 0; c < p; c++) for (let r = 0; r < p; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k <= p; k++) A[r][k] -= f * A[c][k]; }
  const beta = A.map((row, i) => row[p] / row[i]);
  return { estado: 'estimado', n: y.length, pesos: Object.fromEntries(KEYS.map((k, j) => [k, Math.min(0.5, Math.max(0, beta[j + 1]))])) };
}

async function main() {
  const list = await get<{ key: string }[]>('/api/series');
  if (!list?.length) throw new Error('La web aún no tiene series históricas (espera a que termine la carga inicial).');
  const raw: Record<string, SeriesPoints> = {};
  for (const { key } of list) raw[key] = (await get<SeriesPoints>('/api/series/' + encodeURIComponent(key))) ?? [];
  console.log('Series:', Object.entries(raw).map(([k, v]) => `${k}(${v.length})`).join(' '));

  let bt: BacktestResult | null = (await get<{ datos: BacktestResult | null }>('/api/publicado/backtest'))?.datos ?? null;
  const run0 = runModel(raw, bt);
  if (RUN_BT) {
    const t0 = Date.now();
    bt = backtest(run0.P, { from: '2018-01-01', onProgress: (f) => process.stdout.write(`\rBacktest ${(f * 100).toFixed(0)} %`) });
    console.log(`\nBacktest en ${((Date.now() - t0) / 1000).toFixed(0)} s (${bt.from} → ${bt.to})`);
  }
  const run = runModel(raw, bt);
  const day = run.P.h.days[run.t];
  const previsiones = HORIZONS.map((H) => {
    const f = run.forecasts[H];
    const q = Object.fromEntries(f.quantiles.map((x) => [x.p, x.price]));
    return { made_on: day, horizon: H, price: run.cal.price, p05: q[0.05], p25: q[0.25], p50: q[0.5], p75: q[0.75], p95: q[0.95], prob_up: f.probUp, model: run.modes[H].mode, due_on: addDays(day, H) };
  });
  const calibracion = {
    fecha: day,
    garch: run.cal.garch,
    modos: run.modes,
    regimen: run.regime,
    variables: run.features,
    deriva: Object.fromEntries(HORIZONS.map((H) => [H, run.cal.drift[H] ? { activa: !run.cal.drift[H]!.disabled, lambda: run.cal.drift[H]!.lambda, beta: run.cal.drift[H]!.beta, claves: run.cal.drift[H]!.keys } : null])),
    volatilidad: Object.fromEntries(HORIZONS.map((H) => [H, run.cal.vol[H] ? { w: run.cal.vol[H]!.w, nivel: run.cal.vol[H]!.level, ajuste: !!run.cal.vol[H]!.ridge } : null])),
  };
  // Pesos de los índices vivos sobre la volatilidad, cuando hay histórico propio suficiente
  const hist = (await get<{ day: string; key: string; value: number }[]>('/api/indices/historico')) ?? [];
  const pesos_indices = estimateIndexWeights(run, hist);
  console.log('Pesos de índices:', JSON.stringify(pesos_indices));
  for (const p of previsiones) console.log(`${p.horizon} d [${p.model}]  p05 ${p.p05.toFixed(0)}  p50 ${p.p50.toFixed(0)}  p95 ${p.p95.toFixed(0)}  P(sube) ${(p.prob_up * 100).toFixed(0)} %`);
  if (DRY) return;
  if (!TOKEN) throw new Error('Falta PUBLISH_TOKEN');
  const res = await fetch(BASE + '/api/publish', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ calibracion, previsiones, pesos_indices, ...(RUN_BT && bt ? { backtest: bt } : {}) }),
  });
  console.log('Publicación:', res.status, await res.text());
}

main().catch((e) => { console.error(e.message); process.exit(1); });
