// SOLO DESARROLLO LOCAL: siembra la base D1 local para revisar la interfaz sin acceso a las APIs.
// - Series: CSV público de Coin Metrics (precio y hashrate diarios), descargado aparte.
// - Métricas y titulares: valores reales observados el 28-29/10/2026, marcados con la fuente "vista-previa-local".
// Nunca se ejecuta en producción: en producción todo lo rellena el cron.
import { readFileSync, writeFileSync } from 'node:fs';

const csv = readFileSync(process.argv[2], 'utf8').trim().split('\n');
const hdr = csv[0].split(',');
const ci = hdr.indexOf('PriceUSD'), cj = hdr.indexOf('ReferenceRateUSD'), hi = hdr.indexOf('HashRate');
const close: [string, number][] = [], hash: [string, number][] = [];
for (const l of csv.slice(1)) {
  const c = l.split(',');
  const px = c[ci] || c[cj];
  if (px && c[0] >= '2014-01-01') close.push([c[0], +(+px).toPrecision(8)]);
  if (c[hi] && c[0] >= '2023-01-01') hash.push([c[0], +(+c[hi] / 1e6).toPrecision(6)]);
}
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const now = Date.now();
const sql: string[] = [];
for (const [key, pts] of [['close', close], ['hashrate', hash]] as const) {
  sql.push(`INSERT OR REPLACE INTO series (key, data, first_day, last_day, source, updated_at) VALUES (${q(key)}, ${q(JSON.stringify(pts))}, ${q(pts[0][0])}, ${q(pts[pts.length - 1][0])}, 'vista-previa-local', ${now});`);
}
const M: [string, number | null, string | null, string, string][] = [
  ['px.kraken', 80084.8, null, 'USD', 'kraken'], ['px.coinbase', 81027, null, 'USD', 'coinbase'], ['px.okx', 80060, null, 'USDT', 'okx'],
  ['dvol', 37.58, null, '% anual', 'deribit'], ['funding.okx', 0.0000645873, null, 'por 8 h', 'okx-swap'], ['oi.okx', 2606821728, null, 'USD', 'okx-swap'],
  ['fng', 51, 'Neutral', '0–100', 'feargreed'], ['fees.rapida', 1, null, 'sat/vB', 'mempool'],
  ['top10', null, JSON.stringify([{ id: 'bitcoin', simbolo: 'BTC', nombre: 'Bitcoin', precio: 80084.8, cambio24h: -1.07, cambio7d: 0.8 }]), '', 'coingecko'],
  ['calendario', null, JSON.stringify([{ fecha: '2026-11-13', evento: 'IPC de EE. UU.' }, { fecha: '2026-12-04', evento: 'Informe de empleo de EE. UU.' }, { fecha: '2026-12-09', evento: 'Decisión de tipos del FOMC' }]), '', 'fred-calendario'],
];
for (const [k, v, t, u, s] of M) sql.push(`INSERT OR REPLACE INTO metrics (key, value, text, unit, source, observed_at) VALUES (${q(k)}, ${v ?? 'NULL'}, ${t ? q(t) : 'NULL'}, ${q(u)}, ${q(s)}, ${now - 120000});`);
const items: [string, string, string, number][] = [
  ['coindesk', 'Fed leaves interest rates unchanged, as expected', 'https://www.coindesk.com/markets/2026/10/28/fed-leaves-interest-rates-unchanged-as-expected', Date.parse('2026-10-28T18:00:42Z')],
  ['gdelt:pbs.org', 'Warsh holds briefing after Fed leaves key interest rate unchanged', 'https://www.pbs.org/newshour/economy/watch-live-fed-chair-warsh-holds-briefing-after-latest-interest-rate-decision', Date.parse('2026-10-28T19:14:00Z')],
  ['gdelt:finance.yahoo.com', 'Bitcoin shrugs off a hawkish Fed as volatility bets barely budge', 'https://finance.yahoo.com/markets/crypto/articles/bitcoin-shrugs-off-hawkish-fed-220347204.html', Date.parse('2026-10-28T22:03:47Z')],
  ['gdelt:investing.com', 'Fed holds rates, but dissent keeps bitcoin, gold and tech stocks under pressure', 'https://www.investing.com/analysis/fed-holds-rates-but-dissent-keeps-bitcoin-gold-and-tech-stocks-under-pressure-200690463', Date.parse('2026-10-28T19:05:24Z')],
  ['ofac', 'OFAC: North Korea Designations; Democratic Republic of the Congo-related Designations', 'https://ofac.treasury.gov/recent-actions', Date.parse('2026-10-28T15:00:00Z')],
];
for (const [s, t, u, p] of items) sql.push(`INSERT OR IGNORE INTO items (id, source, title, url, lang, published_at, fetched_at) VALUES (${q('dev' + Buffer.from(u).toString('base64url').slice(-16))}, ${q(s)}, ${q(t)}, ${q(u)}, 'en', ${p}, ${now});`);
writeFileSync(process.argv[3], sql.join('\n'));
console.log('SQL generado:', sql.length, 'sentencias');
