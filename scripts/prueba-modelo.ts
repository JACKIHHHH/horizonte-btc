// Prueba local del motor con el CSV público de Coin Metrics (solo para desarrollo).
import { readFileSync } from 'node:fs';
import { buildHistory } from '../src/model/history';
import { prepare, calibrate, forecast, inputsAt, simulate } from '../src/model/engine';
import { backtest } from '../src/model/backtest';
import { eventStudy } from '../src/model/events';
import { regimeAt } from '../src/model/regime';

const csv = readFileSync(process.argv[2], 'utf8').trim().split('\n');
const hdr = csv[0].split(',');
const ci = hdr.indexOf('PriceUSD'), cj = hdr.indexOf('ReferenceRateUSD'), hi = hdr.indexOf('HashRate');
const close: [string, number][] = [], hash: [string, number][] = [];
for (const l of csv.slice(1)) { const c = l.split(','); const px = c[ci] || c[cj]; if (px) close.push([c[0], +px]); if (c[hi]) hash.push([c[0], +c[hi]]); }
const h = buildHistory({ close: close.filter(([d]) => d >= '2014-01-01'), hashrate: hash });
console.log('días', h.days.length, h.days[0], h.days.at(-1));
let t0 = performance.now();
const P = prepare(h);
const t = h.days.length - 1;
const cal = calibrate(P, t);
console.log('calibración ms', (performance.now() - t0).toFixed(0), cal.garch);
for (const H of [1, 7, 30, 90] as const) {
  const f = forecast(cal, inputsAt(P, t), H);
  console.log(H, f.quantiles.map((q) => q.price.toFixed(0)).join(' '), 'pUp', f.probUp.toFixed(3), 'volMult', f.volMult.toFixed(2), 'center', f.center.toFixed(4));
}
t0 = performance.now();
const sim = simulate(cal, inputsAt(P, t), 30, []);
console.log('MC 10k×30 ms', (performance.now() - t0).toFixed(0), sim.bands.at(-1));
console.log(regimeAt(h, t));
console.log(eventStudy(h, 7).map((e) => `${e.cat} n=${e.n} z=${e.meanZ.toFixed(2)} enc=${e.shrunkZ.toFixed(2)} vol=${e.volLogRatio.toFixed(2)}`).join('\n'));
t0 = performance.now();
const bt = backtest(P, { from: '2018-01-01' });
console.log('backtest s', ((performance.now() - t0) / 1000).toFixed(1), bt.from, bt.to);
for (const v of bt.variants) console.log(v.label.padEnd(36), [1, 7, 30, 90].map((H) => `${H}d cov90=${v.scores[H].cov90.toFixed(2)} cov50=${v.scores[H].cov50.toFixed(2)} crps=${(v.scores[H].crps * 100).toFixed(3)} brier=${v.scores[H].brier.toFixed(3)}`).join(' | '));
console.log(bt.ablation);
