// Carga del histórico diario en pasos pequeños (uno por ejecución del cron).
import type { Env } from './env';
import { FRED_SERIES, fredUrl, parseFred } from './connectors/macro';
import { dayOf, fetchJson, now } from './util';

type Points = [string, number][];
interface Step { points: Record<string, Points>; next: string | null }
interface Job { id: string; enabled?: (env: Env) => boolean; run: (env: Env, cursor: string | null) => Promise<Step> }

const START = Date.UTC(2014, 0, 1) / 1000;
const ymd = (d: string) => d.replace(/-/g, '');

export async function bitstampDaily(env: Env, startSec: number, limit = 1000): Promise<{ close: Points; volume: Points; lastTs: number }> {
  const d = await fetchJson(`https://www.bitstamp.net/api/v2/ohlc/btcusd/?step=86400&limit=${limit}&start=${startSec}`, env, {}, 15000);
  const rows = d.data?.ohlc ?? [];
  const close: Points = [], volume: Points = [];
  for (const r of rows) {
    const day = dayOf(+r.timestamp * 1000);
    close.push([day, +r.close]);
    volume.push([day, +r.volume]);
  }
  return { close, volume, lastTs: rows.length ? +rows[rows.length - 1].timestamp : startSec };
}

export const JOBS: Job[] = [
  {
    id: 'bitstamp',
    async run(env, cursor) {
      const start = cursor ? +cursor : START;
      const r = await bitstampDaily(env, start);
      // Se omite el día en curso (vela incompleta)
      const hoy = dayOf(now());
      const close = r.close.filter(([d]) => d < hoy), volume = r.volume.filter(([d]) => d < hoy);
      const next = r.lastTs + 86400 < now() / 1000 - 86400 ? String(r.lastTs + 86400) : null;
      return { points: { close, volume }, next };
    },
  },
  {
    id: 'feargreed',
    async run(env) {
      const d = await fetchJson('https://api.alternative.me/fng/?limit=0', env, {}, 15000);
      return { points: { fng: (d.data ?? []).map((r: any) => [dayOf(+r.timestamp * 1000), +r.value]) }, next: null };
    },
  },
  {
    id: 'stables',
    async run(env) {
      const d = await fetchJson<any[]>('https://stablecoins.llama.fi/stablecoincharts/all', env, {}, 15000);
      return { points: { stables: d.map((r) => [dayOf(+r.date * 1000), r.totalCirculatingUSD?.peggedUSD ?? 0] as [string, number]).filter(([, v]) => v > 0) }, next: null };
    },
  },
  {
    id: 'wiki',
    async run(env, cursor) {
      const from = cursor ?? '2015-07-01';
      const to = dayOf(Math.min(Date.parse(from) + 3 * 365 * 864e5, now() - 864e5));
      const d = await fetchJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Bitcoin/daily/${ymd(from)}00/${ymd(to)}00`, env, {}, 15000);
      const pts: Points = (d.items ?? []).map((x: any) => [`${x.timestamp.slice(0, 4)}-${x.timestamp.slice(4, 6)}-${x.timestamp.slice(6, 8)}`, x.views]);
      const next = to < dayOf(now() - 2 * 864e5) ? dayOf(Date.parse(to) + 864e5) : null;
      return { points: { wiki: pts }, next };
    },
  },
  {
    id: 'hashrate',
    async run(env) {
      const d = await fetchJson('https://mempool.space/api/v1/mining/hashrate/3y', env, {}, 15000);
      return { points: { hashrate: (d.hashrates ?? []).map((h: any) => [dayOf(h.timestamp * 1000), h.avgHashrate / 1e18]) }, next: null };
    },
  },
  {
    id: 'dvol',
    async run(env, cursor) {
      const from = cursor ? +cursor : Date.UTC(2021, 2, 24);
      const to = Math.min(from + 300 * 864e5, now());
      const d = await fetchJson(`https://www.deribit.com/api/v2/public/get_volatility_index_data?currency=BTC&resolution=86400&start_timestamp=${from}&end_timestamp=${to}`, env, {}, 15000);
      const pts: Points = (d.result?.data ?? []).map((r: number[]) => [dayOf(r[0]), r[4]]);
      return { points: { dvol: pts }, next: to < now() - 864e5 ? String(to + 864e5) : null };
    },
  },
  ...FRED_SERIES.map((s): Job => ({
    id: 'fred:' + s.id,
    enabled: (env) => !!env.FRED_API_KEY,
    async run(env) {
      const d = await fetchJson(fredUrl(env, s.id, '2013-01-01'), env, {}, 15000);
      return { points: { [s.key]: parseFred(d) }, next: null };
    },
  })),
  {
    id: 'mvrv',
    enabled: (env) => env.NONCOMMERCIAL_SOURCES === 'on',
    async run(env, cursor) {
      const url = `https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur&frequency=1d&start_time=2014-01-01&page_size=10000${cursor ? '&next_page_token=' + cursor : ''}`;
      const d = await fetchJson(url, env, {}, 15000);
      return { points: { mvrv: (d.data ?? []).map((x: any) => [x.time.slice(0, 10), parseFloat(x.CapMVRVCur)]) }, next: d.next_page_token ?? null };
    },
  },
];

/** Estado: { job: índice, cursor } en meta.backfill. Devuelve los puntos de un paso o null si ha terminado. */
export async function backfillStep(env: Env, state: { job: number; cursor: string | null; errors: Record<string, string> }) {
  while (state.job < JOBS.length && JOBS[state.job].enabled && !JOBS[state.job].enabled!(env)) state.job++;
  if (state.job >= JOBS.length) return null;
  const job = JOBS[state.job];
  try {
    const r = await job.run(env, state.cursor);
    if (r.next) state.cursor = r.next;
    else { state.job++; state.cursor = null; }
    return { job: job.id, points: r.points };
  } catch (e) {
    state.errors[job.id] = (e as Error).message;
    state.job++; state.cursor = null; // se reintentará en la próxima carga completa
    return { job: job.id, points: {} as Record<string, Points> };
  }
}
