import { describe, expect, it } from 'vitest';
import { fit, variancePath } from '../src/model/garch';
import { rng, studentStd, tStdCdf, tStdInv, normInv } from '../src/model/stats';
import { buildHistory, addDays } from '../src/model/history';
import { prepare, calibrate, forecast, inputsAt, simulate } from '../src/model/engine';
import { fitRidgeCV } from '../src/model/ridge';
import { eventStudy } from '../src/model/events';
import { chooseModes, extraVolFromIndices } from '../src/model/pipeline';

function simulateGarch(n: number, omega: number, alpha: number, beta: number, nu: number, seed = 3) {
  const u = rng(seed);
  const r: number[] = [];
  let h = omega / (1 - alpha - beta), e = 0;
  for (let i = 0; i < n; i++) { h = omega + alpha * e * e + beta * h; e = Math.sqrt(h) * studentStd(nu, u); r.push(e); }
  return r;
}

function syntheticHistory(n = 1600, seed = 5) {
  const r = simulateGarch(n, 2e-5, 0.08, 0.9, 5, seed);
  const close: [string, number][] = [];
  let p = 20000, d = '2020-01-01';
  for (const x of r) { p *= Math.exp(x); close.push([d, p]); d = addDays(d, 1); }
  return { close };
}

describe('estadística', () => {
  it('cuantiles de la t estandarizada', () => {
    expect(tStdInv(0.5, 5)).toBeCloseTo(0, 6);
    expect(tStdCdf(tStdInv(0.95, 6), 6)).toBeCloseTo(0.95, 4);
    expect(tStdInv(0.975, 1e5)).toBeCloseTo(normInv(0.975), 3);
  });
  it('la t estandarizada tiene varianza 1', () => {
    const u = rng(1); let s = 0; const n = 200000;
    for (let i = 0; i < n; i++) s += studentStd(6, u) ** 2;
    expect(s / n).toBeGreaterThan(0.93); expect(s / n).toBeLessThan(1.07);
  });
});

describe('GARCH-t', () => {
  it('recupera la persistencia de una serie simulada', () => {
    const g = fit(simulateGarch(4000, 2e-5, 0.08, 0.9, 5), 600);
    expect(g.alpha + g.beta).toBeGreaterThan(0.93);
    expect(g.alpha + g.beta).toBeLessThan(0.995);
    expect(g.nu).toBeGreaterThan(3); expect(g.nu).toBeLessThan(9);
  });
  it('la varianza revierte a la incondicional', () => {
    const g = { omega: 1e-5, alpha: 0.1, beta: 0.85, nu: 5, mu: 0, uncond: 2e-4 };
    const p = variancePath(1e-3, g, 400);
    expect(p[0]).toBeCloseTo(1e-3, 8);
    expect(p[399]).toBeCloseTo(2e-4, 6);
  });
});

describe('motor de previsión', () => {
  const h = buildHistory(syntheticHistory());
  const P = prepare(h);
  const t = h.days.length - 1;
  const cal = calibrate(P, t);
  it('los cuantiles están ordenados y el cono se abre con el horizonte', () => {
    const f7 = forecast(cal, inputsAt(P, t), 7), f30 = forecast(cal, inputsAt(P, t), 30);
    const q = f7.quantiles.map((x) => x.price);
    for (let i = 1; i < q.length; i++) expect(q[i]).toBeGreaterThan(q[i - 1]);
    expect(f30.sd).toBeGreaterThan(f7.sd);
  });
  it('el modo ingenuo no tiene deriva', () => {
    const f = forecast(cal, inputsAt(P, t), 30, [0.5], 0, 'ingenuo');
    expect(f.center).toBe(0);
    expect(f.probUp).toBeCloseTo(0.5, 6);
  });
  it('Monte Carlo coherente con la previsión analítica', () => {
    const sim = simulate(cal, inputsAt(P, t), 30, [], 6000, 11, 0, 'vol');
    const f = forecast(cal, inputsAt(P, t), 30, [0.05, 0.95], 0, 'vol');
    const last = sim.bands[29];
    expect(last.p95 / f.quantiles[1].price).toBeGreaterThan(0.9);
    expect(last.p95 / f.quantiles[1].price).toBeLessThan(1.1);
  });
  it('un escenario negativo desplaza la mediana hacia abajo', () => {
    const base = simulate(cal, inputsAt(P, t), 7, [], 4000, 3, 0, 'vol');
    const shock = simulate(cal, inputsAt(P, t), 7, [{ id: 'x', prob: 1, driftZ: -1, volLog: 0.3, days: 7 }], 4000, 3, 0, 'vol');
    expect(shock.bands[6].p50).toBeLessThan(base.bands[6].p50);
    expect(shock.bands[6].p95 - shock.bands[6].p05).toBeGreaterThan(base.bands[6].p95 - base.bands[6].p05);
  });
});

describe('ridge con filtro de validación', () => {
  it('se desactiva si las variables son ruido', () => {
    const u = rng(9);
    const X = Array.from({ length: 800 }, () => [u() - 0.5, u() - 0.5]);
    const y = X.map(() => (u() - 0.5) * 0.01);
    const m = fitRidgeCV(X, y, X.map((_, i) => i), ['a', 'b']);
    expect(m.disabled).toBe(true);
  });
  it('se activa si hay señal real', () => {
    const u = rng(4);
    const X = Array.from({ length: 800 }, () => [u() - 0.5, u() - 0.5]);
    const y = X.map((x) => 0.05 * x[0] + (u() - 0.5) * 0.01);
    const m = fitRidgeCV(X, y, X.map((_, i) => i), ['a', 'b']);
    expect(m.disabled).toBeFalsy();
    expect(Math.abs(m.beta[0])).toBeGreaterThan(Math.abs(m.beta[1]));
  });
});

describe('sin fuga de datos', () => {
  it('las variables respetan el retardo de publicación', () => {
    const h = buildHistory({ close: [['2024-01-01', 1], ['2024-01-05', 1]], dxy: [['2024-01-01', 100]] });
    expect(h.s.dxy[0]).toBeNull(); // el DXY del día 1 se conoce el día 3
    expect(h.s.dxy[2]).toBe(100);
  });
  it('el estudio de eventos ignora efectos no vencidos', () => {
    const h = buildHistory(syntheticHistory(3000, 7) as any);
    const all = eventStudy(h, 7);
    const early = eventStudy(h, 7, '2021-01-01');
    const n = (x: typeof all) => x.reduce((a, e) => a + e.n, 0);
    expect(n(early)).toBeLessThan(n(all));
  });
});

describe('selección de modelo por horizonte', () => {
  it('sin backtest usa solo amplitud', () => {
    expect(chooseModes(null)[30].mode).toBe('vol');
  });
  it('elige la variante con menor CRPS', () => {
    const sc = (crps: number) => ({ n: 500, cov90: 0.9, cov50: 0.5, crps, brier: 0.25, pit: [] });
    const bt: any = { variants: [
      { id: 'ingenuo', scores: { 1: sc(1), 7: sc(1), 30: sc(1), 90: sc(1) } },
      { id: 'garch', scores: { 1: sc(0.9), 7: sc(1.1), 30: sc(1.2), 90: sc(1.2) } },
      { id: 'vol', scores: { 1: sc(0.95), 7: sc(0.98), 30: sc(1.1), 90: sc(1.1) } },
      { id: 'completo', scores: { 1: sc(0.96), 7: sc(1.05), 30: sc(1.3), 90: sc(1.4) } },
    ] };
    const m = chooseModes(bt);
    expect(m[1].mode).toBe('garch'); expect(m[7].mode).toBe('vol'); expect(m[30].mode).toBe('ingenuo');
  });
  it('los índices solo amplían la volatilidad y con tope', () => {
    expect(extraVolFromIndices([{ key: 'riesgo_geopolitico', valor: -1 }])).toBe(0);
    expect(extraVolFromIndices([{ key: 'riesgo_geopolitico', valor: 1 }, { key: 'presion_regulatoria', valor: 1 }], { riesgo_geopolitico: 1, presion_regulatoria: 1 })).toBe(0.4);
  });
});
