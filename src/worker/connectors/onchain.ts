// On-chain y liquidez.
import { fetchJson, fetchText, SourceError, dayOf, now } from '../util';
import { LIC, type Connector } from './types';

export const onchain: Connector[] = [
  {
    id: 'mempool', nombre: 'mempool.space', optica: 'onchain', web: 'https://mempool.space/docs/api', licencia: LIC.apta('API pública del proyecto de código abierto mempool.space, con límites de uso; atribuir.'), frecuencia: '1 h',
    async run(env) {
      const [fees, diff, hr, tip] = await Promise.all([
        fetchJson('https://mempool.space/api/v1/fees/recommended', env),
        fetchJson('https://mempool.space/api/v1/difficulty-adjustment', env),
        fetchJson('https://mempool.space/api/v1/mining/hashrate/3m', env),
        fetchText('https://mempool.space/api/blocks/tip/height', env),
      ]);
      const pts: [string, number][] = (hr.hashrates ?? []).map((h: any) => [dayOf(h.timestamp * 1000), h.avgHashrate / 1e18]);
      const mean = (a: [string, number][]) => a.reduce((x, y) => x + y[1], 0) / Math.max(1, a.length);
      const ribbon = pts.length >= 60 ? mean(pts.slice(-30)) / mean(pts.slice(-60)) - 1 : null;
      return {
        metrics: [
          { key: 'fees.rapida', value: fees.fastestFee, unit: 'sat/vB' },
          { key: 'fees.hora', value: fees.hourFee, unit: 'sat/vB' },
          { key: 'dificultad.cambio', value: diff.difficultyChange, unit: '%' },
          { key: 'dificultad.progreso', value: diff.progressPercent, unit: '%' },
          { key: 'hashrate', value: (hr.currentHashrate ?? 0) / 1e18, unit: 'EH/s' },
          { key: 'altura', value: parseInt(tip, 10), unit: 'bloques' },
          { key: 'ribbon', value: ribbon, unit: 'SMA30/SMA60 − 1' },
        ],
        series: [{ key: 'hashrate', mode: 'merge', points: pts }],
      };
    },
  },
  {
    id: 'blockchain-com', nombre: 'Blockchain.com Charts', optica: 'onchain', web: 'https://www.blockchain.com/explorer/api/charts_api', licencia: LIC.verificar('API de gráficos gratuita; revisar términos de Blockchain.com para uso comercial.'), frecuencia: '1 día',
    async run(env) {
      const [tx, rev] = await Promise.all([
        fetchJson('https://api.blockchain.info/charts/n-transactions?timespan=30days&format=json', env),
        fetchJson('https://api.blockchain.info/charts/miners-revenue?timespan=30days&format=json', env),
      ]);
      const last = (d: any) => d.values?.[d.values.length - 1]?.y ?? null;
      return { metrics: [{ key: 'tx.diarias', value: last(tx), unit: 'tx' }, { key: 'mineros.ingresos', value: last(rev), unit: 'USD/día' }] };
    },
  },
  {
    id: 'coinmetrics', nombre: 'Coin Metrics Community (MVRV, precio realizado)', optica: 'onchain', web: 'https://docs.coinmetrics.io/api', licencia: LIC.nc('Datos comunitarios bajo CC BY-NC 4.0: solo uso no comercial.'), frecuencia: '1 día',
    async run(env) {
      const start = dayOf(now() - 10 * 864e5);
      const d = await fetchJson(`https://community-api.coinmetrics.io/v4/timeseries/asset-metrics?assets=btc&metrics=CapMVRVCur,CapMrktCurUSD,SplyCur&frequency=1d&start_time=${start}`, env);
      const rows = d.data ?? [];
      if (!rows.length) throw new SourceError('sin datos');
      const r = rows[rows.length - 1];
      const mvrv = parseFloat(r.CapMVRVCur), cap = parseFloat(r.CapMrktCurUSD), sply = parseFloat(r.SplyCur);
      return {
        metrics: [{ key: 'mvrv', value: mvrv, unit: 'ratio' }, { key: 'precio.realizado', value: cap / mvrv / sply, unit: 'USD' }],
        series: [{ key: 'mvrv', mode: 'merge', points: rows.map((x: any) => [x.time.slice(0, 10), parseFloat(x.CapMVRVCur)] as [string, number]) }],
      };
    },
  },
  {
    id: 'blockchair', nombre: 'Blockchair', optica: 'onchain', web: 'https://blockchair.com/api/docs', licencia: LIC.verificar('Plan gratuito con límite diario; uso comercial requiere plan de pago según sus términos.'), frecuencia: '1 día',
    async run(env) {
      const d = await fetchJson('https://api.blockchair.com/bitcoin/stats', env);
      const s = d.data ?? {};
      return { metrics: [{ key: 'mempool.tx', value: s.mempool_transactions ?? null, unit: 'tx' }, { key: 'nodos', value: s.nodes ?? null, unit: 'nodos' }] };
    },
  },
  {
    id: 'github-bitcoin', nombre: 'Actividad de Bitcoin Core (GitHub)', optica: 'onchain', web: 'https://github.com/bitcoin/bitcoin', licencia: LIC.apta('API pública de GitHub; solo se usan recuentos.'), frecuencia: '1 día',
    async run(env) {
      const since = new Date(now() - 30 * 864e5).toISOString();
      const d = await fetchJson(`https://api.github.com/repos/bitcoin/bitcoin/commits?since=${since}&per_page=100`, env, { headers: { Accept: 'application/vnd.github+json' } });
      return { metrics: [{ key: 'core.commits30d', value: Array.isArray(d) ? d.length : null, unit: 'commits (máx. 100)' }] };
    },
  },
];

export const liquidez: Connector[] = [
  {
    id: 'defillama', nombre: 'DefiLlama (stablecoins)', optica: 'liquidez', web: 'https://defillama.com/docs/api', licencia: LIC.apta('API abierta y gratuita; atribuir a DefiLlama.'), frecuencia: '12 h',
    async run(env) {
      const d = await fetchJson<any[]>('https://stablecoins.llama.fi/stablecoincharts/all', env, {}, 12000);
      const tail = d.slice(-40);
      const pts: [string, number][] = tail.map((r) => [dayOf(+r.date * 1000), r.totalCirculatingUSD?.peggedUSD ?? 0]);
      const last = pts[pts.length - 1][1], prev30 = pts[Math.max(0, pts.length - 31)][1];
      return {
        metrics: [{ key: 'stables.total', value: last, unit: 'USD' }, { key: 'stables.30d', value: last / prev30 - 1, unit: 'ratio' }],
        series: [{ key: 'stables', mode: 'merge', points: pts }],
      };
    },
  },
];
