// Precio de BTC en exchanges y agregadores. Cada conector devuelve px.<id> (USD o USDT).
import { fetchJson, SourceError } from '../util';
import { LIC, type Connector } from './types';

const num = (x: unknown) => {
  const v = typeof x === 'string' ? parseFloat(x) : (x as number);
  if (!isFinite(v) || v <= 0) throw new SourceError('precio no válido');
  return v;
};

const PUBLIC_DATA = LIC.verificar('API pública de datos de mercado; las condiciones de uso del exchange pueden exigir atribución o limitar la redistribución.');

export const mercado: Connector[] = [
  {
    id: 'kraken', nombre: 'Kraken', optica: 'mercado', web: 'https://docs.kraken.com/api/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      const d = await fetchJson('https://api.kraken.com/0/public/Ticker?pair=XBTUSD', env);
      const t = d.result?.XXBTZUSD;
      return { metrics: [{ key: 'px.kraken', value: num(t?.c?.[0]), unit: 'USD' }, { key: 'vol24.kraken', value: parseFloat(t?.v?.[1]), unit: 'BTC' }] };
    },
  },
  {
    id: 'coinbase', nombre: 'Coinbase Exchange', optica: 'mercado', web: 'https://docs.cdp.coinbase.com/exchange/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      const d = await fetchJson('https://api.exchange.coinbase.com/products/BTC-USD/ticker', env);
      return { metrics: [{ key: 'px.coinbase', value: num(d.price), unit: 'USD' }, { key: 'vol24.coinbase', value: parseFloat(d.volume), unit: 'BTC' }] };
    },
  },
  {
    id: 'bitstamp', nombre: 'Bitstamp', optica: 'mercado', web: 'https://www.bitstamp.net/api/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      const d = await fetchJson('https://www.bitstamp.net/api/v2/ticker/btcusd/', env);
      return { metrics: [{ key: 'px.bitstamp', value: num(d.last), unit: 'USD' }] };
    },
  },
  {
    id: 'gemini', nombre: 'Gemini', optica: 'mercado', web: 'https://docs.gemini.com/rest-api/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      const d = await fetchJson('https://api.gemini.com/v1/pubticker/btcusd', env);
      return { metrics: [{ key: 'px.gemini', value: num(d.last), unit: 'USD' }] };
    },
  },
  {
    id: 'bitfinex', nombre: 'Bitfinex', optica: 'mercado', web: 'https://docs.bitfinex.com/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      // [BID, BID_SIZE, ASK, ASK_SIZE, DAILY_CHANGE, DAILY_CHANGE_RELATIVE, LAST_PRICE, VOLUME, HIGH, LOW]
      const d = await fetchJson<number[]>('https://api-pub.bitfinex.com/v2/ticker/tBTCUSD', env);
      return { metrics: [{ key: 'px.bitfinex', value: num(d[6]), unit: 'USD' }, { key: 'btc.cambio24h', value: d[5], unit: 'ratio' }] };
    },
  },
  {
    id: 'okx', nombre: 'OKX', optica: 'mercado', web: 'https://www.okx.com/docs-v5/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      const d = await fetchJson('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT', env);
      return { metrics: [{ key: 'px.okx', value: num(d.data?.[0]?.last), unit: 'USDT' }] };
    },
  },
  {
    id: 'bybit', nombre: 'Bybit', optica: 'mercado', web: 'https://bybit-exchange.github.io/docs/', licencia: PUBLIC_DATA, frecuencia: '5 min',
    async run(env) {
      const d = await fetchJson('https://api.bybit.com/v5/market/tickers?category=spot&symbol=BTCUSDT', env);
      return { metrics: [{ key: 'px.bybit', value: num(d.result?.list?.[0]?.lastPrice), unit: 'USDT' }] };
    },
  },
  {
    id: 'coingecko', nombre: 'CoinGecko', optica: 'mercado', web: 'https://www.coingecko.com/en/api', clave: ['COINGECKO_API_KEY'],
    licencia: LIC.verificar('Plan Demo gratuito con atribución obligatoria («Data provided by CoinGecko»); revisar si el uso comercial está cubierto.'), frecuencia: '15 min',
    async run(env) {
      const h = env.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': env.COINGECKO_API_KEY } : undefined;
      const d = await fetchJson('https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=11&page=1&price_change_percentage=24h,7d', env, { headers: h });
      const btc = d.find((c: any) => c.id === 'bitcoin');
      const top = d.filter((c: any) => !['tether', 'usd-coin'].includes(c.id)).slice(0, 10).map((c: any) => ({
        id: c.id, simbolo: String(c.symbol).toUpperCase(), nombre: c.name, precio: c.current_price, cap: c.market_cap,
        cambio24h: c.price_change_percentage_24h_in_currency, cambio7d: c.price_change_percentage_7d_in_currency,
      }));
      const total = d.reduce((a: number, c: any) => a + (c.market_cap || 0), 0);
      return {
        metrics: [
          { key: 'px.coingecko', value: num(btc?.current_price), unit: 'USD' },
          { key: 'top10', text: JSON.stringify(top) },
          { key: 'btc.cap', value: btc?.market_cap, unit: 'USD' },
          { key: 'btc.dominancia_top', value: btc ? btc.market_cap / total : null, unit: 'ratio' },
        ],
      };
    },
  },
];

export const PRICE_SOURCES = mercado.map((c) => c.id);

/**
 * Precio de referencia = mediana de las fuentes frescas. Se descartan las que se desvían más de un 0,5 %.
 * Las cotizaciones en USDT se tratan como USD (diferencia habitual < 0,1 %), y se indica.
 */
export function aggregatePrice(quotes: { source: string; value: number; unit: string; age: number }[]) {
  const fresh = quotes.filter((q) => q.age < 20 * 60 * 1000 && q.value > 0);
  if (!fresh.length) return null;
  const s = fresh.map((q) => q.value).sort((a, b) => a - b);
  const m = s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  const used = fresh.filter((q) => Math.abs(q.value / m - 1) <= 0.005);
  const discarded = fresh.filter((q) => Math.abs(q.value / m - 1) > 0.005).map((q) => ({ source: q.source, desviacion: q.value / m - 1 }));
  const u = used.map((q) => q.value).sort((a, b) => a - b);
  const ref = u.length % 2 ? u[u.length >> 1] : (u[u.length / 2 - 1] + u[u.length / 2]) / 2;
  const cb = used.find((q) => q.source === 'coinbase')?.value;
  const usdt = used.filter((q) => q.unit === 'USDT').map((q) => q.value);
  const premium = cb && usdt.length ? cb / (usdt.reduce((a, b) => a + b, 0) / usdt.length) - 1 : null;
  return { price: ref, used: used.map((q) => q.source), discarded, coinbasePremium: premium };
}
