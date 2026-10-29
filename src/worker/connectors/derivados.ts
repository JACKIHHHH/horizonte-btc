// Derivados: volatilidad implícita, sesgo de opciones, base de futuros, funding e interés abierto.
import { fetchJson, SourceError, now } from '../util';
import { LIC, type Connector } from './types';

const MONTHS: Record<string, number> = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };

/** "BTC-27NOV26-90000-C" → { expiry, strike, type } */
export function parseDeribitInstrument(name: string) {
  const m = /^BTC-(\d{1,2})([A-Z]{3})(\d{2})(?:-(\d+)-([CP]))?$/.exec(name);
  if (!m) return null;
  const expiry = Date.UTC(2000 + +m[3], MONTHS[m[2]], +m[1], 8);
  return { expiry, strike: m[4] ? +m[4] : null, type: (m[5] ?? 'F') as 'C' | 'P' | 'F' };
}

/** Sesgo ≈ IV de puts 10 % fuera de dinero − IV de calls 10 % fuera de dinero, vencimiento más cercano a 30 días. */
export function optionSkew(items: { instrument_name: string; mark_iv: number; open_interest: number }[], spot: number, t = now()) {
  const parsed = items.map((i) => ({ ...i, p: parseDeribitInstrument(i.instrument_name) })).filter((i) => i.p && i.p.strike && i.mark_iv > 0);
  const expiries = [...new Set(parsed.map((i) => i.p!.expiry))].filter((e) => e > t + 7 * 864e5);
  if (!expiries.length) return null;
  const target = t + 30 * 864e5;
  const exp = expiries.sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
  const pick = (type: 'C' | 'P', k: number) => {
    const c = parsed.filter((i) => i.p!.expiry === exp && i.p!.type === type);
    c.sort((a, b) => Math.abs(a.p!.strike! - k) - Math.abs(b.p!.strike! - k));
    return c[0]?.mark_iv ?? null;
  };
  const put = pick('P', spot * 0.9), call = pick('C', spot * 1.1), atm = pick('C', spot);
  let oiP = 0, oiC = 0;
  for (const i of parsed) (i.p!.type === 'P' ? (oiP += i.open_interest) : (oiC += i.open_interest));
  return { expiry: exp, skew: put !== null && call !== null ? put - call : null, atmIv: atm, putCallOi: oiC ? oiP / oiC : null };
}

const DERIBIT = LIC.verificar('API pública de Deribit; revisar sus términos sobre redistribución de datos de mercado.');

export const derivados: Connector[] = [
  {
    id: 'deribit', nombre: 'Deribit (DVOL, opciones, futuros)', optica: 'derivados', web: 'https://docs.deribit.com/', licencia: DERIBIT, frecuencia: '1 h',
    async run(env) {
      const t = now();
      const [dvol, idx, opt, fut] = await Promise.all([
        fetchJson(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=86400&start_timestamp=${t - 6 * 864e5}&end_timestamp=${t}`, env),
        fetchJson('https://www.deribit.com/api/v2/public/get_index_price?index_name=btc_usd', env),
        fetchJson('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=option', env, {}, 12000),
        fetchJson('https://www.deribit.com/api/v2/public/get_book_summary_by_currency?currency=BTC&kind=future', env),
      ]);
      const rows: number[][] = dvol.result?.data ?? [];
      if (!rows.length) throw new SourceError('DVOL vacío');
      const spot = idx.result?.index_price;
      const sk = optionSkew(opt.result ?? [], spot, t);
      // Base anualizada del futuro con vencimiento más cercano a 90 días
      const futs = (fut.result ?? []).map((f: any) => ({ ...f, p: parseDeribitInstrument(f.instrument_name) })).filter((f: any) => f.p && f.p.expiry > t + 14 * 864e5);
      futs.sort((a: any, b: any) => Math.abs(a.p.expiry - t - 90 * 864e5) - Math.abs(b.p.expiry - t - 90 * 864e5));
      const f0 = futs[0];
      const basis = f0 && spot ? (f0.mark_price / spot - 1) * (365 * 864e5) / (f0.p.expiry - t) : null;
      return {
        metrics: [
          { key: 'dvol', value: rows[rows.length - 1][4], unit: '% anual' },
          { key: 'iv.atm30', value: sk?.atmIv ?? null, unit: '% anual' },
          { key: 'skew.10otm', value: sk?.skew ?? null, unit: 'puntos de vol' },
          { key: 'putcall.oi', value: sk?.putCallOi ?? null, unit: 'ratio' },
          { key: 'basis.90d', value: basis, unit: 'anual' },
        ],
        series: [{ key: 'dvol', mode: 'merge', points: rows.map((r) => [new Date(r[0]).toISOString().slice(0, 10), r[4]] as [string, number]) }],
      };
    },
  },
  {
    id: 'okx-swap', nombre: 'OKX perpetuos (funding, interés abierto)', optica: 'derivados', web: 'https://www.okx.com/docs-v5/', licencia: LIC.verificar('API pública de OKX.'), frecuencia: '1 h',
    async run(env) {
      const [f, oi] = await Promise.all([
        fetchJson('https://www.okx.com/api/v5/public/funding-rate?instId=BTC-USDT-SWAP', env),
        fetchJson('https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=BTC-USDT-SWAP', env),
      ]);
      return { metrics: [{ key: 'funding.okx', value: parseFloat(f.data?.[0]?.fundingRate), unit: 'por 8 h' }, { key: 'oi.okx', value: parseFloat(oi.data?.[0]?.oiUsd), unit: 'USD' }] };
    },
  },
  {
    id: 'deribit-perp', nombre: 'Deribit perpetuo (funding, interés abierto)', optica: 'derivados', web: 'https://docs.deribit.com/', licencia: DERIBIT, frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson('https://www.deribit.com/api/v2/public/ticker?instrument_name=BTC-PERPETUAL', env);
      const r = d.result ?? {};
      if (r.funding_8h == null) throw new SourceError('sin datos del perpetuo');
      return { metrics: [{ key: 'funding.deribit', value: r.funding_8h, unit: 'por 8 h' }, { key: 'oi.deribit', value: r.open_interest ?? null, unit: 'USD' }] };
    },
  },
  {
    id: 'bybit-linear', nombre: 'Bybit perpetuos', optica: 'derivados', web: 'https://bybit-exchange.github.io/docs/', licencia: LIC.verificar('API pública de Bybit; puede no responder desde algunas regiones.'), frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson('https://api.bybit.com/v5/market/tickers?category=linear&symbol=BTCUSDT', env);
      const t = d.result?.list?.[0];
      return { metrics: [{ key: 'funding.bybit', value: parseFloat(t?.fundingRate), unit: 'por 8 h' }, { key: 'oi.bybit', value: parseFloat(t?.openInterestValue), unit: 'USD' }] };
    },
  },
];
