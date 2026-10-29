// Régimen de mercado por reglas explicables (tendencia y percentil de volatilidad).
import type { History } from './history';

export type Regime = 'Alcista' | 'Bajista' | 'Lateral' | 'Alta volatilidad';

export interface RegimeReading {
  regime: Regime;
  vol30: number; // anualizada
  volPercentile: number; // frente a los últimos 2 años
  priceVsSma200: number;
  sma50Slope: number; // cambio relativo en 20 días
  reason: string;
}

function realizedVol(c: (number | null)[], t: number, n: number): number | null {
  const r: number[] = [];
  for (let i = t - n + 1; i <= t; i++) { const a = c[i - 1], b = c[i]; if (a && b) r.push(Math.log(b / a)); }
  if (r.length < n * 0.8) return null;
  const m = r.reduce((x, y) => x + y, 0) / r.length;
  return Math.sqrt((r.reduce((x, y) => x + (y - m) ** 2, 0) / (r.length - 1)) * 365);
}

function sma(c: (number | null)[], t: number, n: number): number | null {
  if (t - n + 1 < 0) return null;
  let s = 0;
  for (let i = t - n + 1; i <= t; i++) { const x = c[i]; if (!x) return null; s += x; }
  return s / n;
}

export function regimeAt(h: History, t: number): RegimeReading | null {
  const c = h.s.close;
  const vol30 = realizedVol(c, t, 30);
  const s200 = sma(c, t, 200), s50 = sma(c, t, 50), s50p = sma(c, t - 20, 50);
  const price = c[t];
  if (vol30 === null || !s200 || !s50 || !s50p || !price) return null;
  const hist: number[] = [];
  for (let i = Math.max(31, t - 730); i <= t; i += 5) { const v = realizedVol(c, i, 30); if (v !== null) hist.push(v); }
  const volPercentile = hist.filter((v) => v <= vol30).length / Math.max(1, hist.length);
  const priceVsSma200 = price / s200 - 1;
  const sma50Slope = s50 / s50p - 1;
  const pct = (x: number) => `${(x * 100).toFixed(0)} %`;
  let regime: Regime, reason: string;
  if (volPercentile > 0.85) {
    regime = 'Alta volatilidad';
    reason = `Volatilidad de 30 días del ${pct(vol30)} anualizado, por encima del ${pct(volPercentile)} de los dos últimos años.`;
  } else if (priceVsSma200 > 0 && sma50Slope > 0) {
    regime = 'Alcista';
    reason = `Precio ${pct(priceVsSma200)} por encima de la media de 200 días y media de 50 días al alza.`;
  } else if (priceVsSma200 < 0 && sma50Slope < 0) {
    regime = 'Bajista';
    reason = `Precio ${pct(-priceVsSma200)} por debajo de la media de 200 días y media de 50 días a la baja.`;
  } else {
    regime = 'Lateral';
    reason = 'Tendencia de corto y largo plazo en direcciones opuestas.';
  }
  return { regime, vol30, volPercentile, priceVsSma200, sma50Slope, reason };
}
