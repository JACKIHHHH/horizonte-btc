// Mercados de predicción: probabilidades con dinero (o reputación) detrás.
import { SCENARIOS } from '../../model/events';
import { fetchJson, now } from '../util';
import { LIC, type Connector } from './types';

export interface Market { fuente: string; pregunta: string; prob: number; cierre: number; volumen: number; url: string }

export function matchScenarios(markets: Market[], t = now()) {
  const out: Record<string, Market> = {};
  for (const s of SCENARIOS) {
    if (!s.mercado) continue;
    const c = markets.filter((m) => s.mercado!.test(m.pregunta) && m.cierre > t && m.cierre < t + 120 * 864e5 && m.prob > 0 && m.prob < 1);
    c.sort((a, b) => b.volumen - a.volumen);
    if (c[0]) out[s.id] = c[0];
  }
  return out;
}

const BTC_RE = /\b(bitcoin|btc)\b/i;

export const prediccion: Connector[] = [
  {
    id: 'polymarket', nombre: 'Polymarket', optica: 'prediccion', web: 'https://docs.polymarket.com/', licencia: LIC.verificar('API pública Gamma; revisar términos para mostrar probabilidades en web comercial.'), frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson<any[]>('https://gamma-api.polymarket.com/markets?closed=false&active=true&limit=150&order=volume24hr&ascending=false', env, {}, 12000);
      const markets: Market[] = d.flatMap((m) => {
        try {
          const outs = JSON.parse(m.outcomes), prices = JSON.parse(m.outcomePrices);
          const yes = outs.indexOf('Yes');
          if (yes < 0) return [];
          return [{ fuente: 'Polymarket', pregunta: m.question, prob: +prices[yes], cierre: Date.parse(m.endDate), volumen: +(m.volume24hr ?? m.volume ?? 0), url: `https://polymarket.com/market/${m.slug}` }];
        } catch { return []; }
      });
      return { metrics: [{ key: 'pred.polymarket', text: JSON.stringify(markets.filter((m) => BTC_RE.test(m.pregunta) || SCENARIOS.some((s) => s.mercado?.test(m.pregunta))).slice(0, 60)) }] };
    },
  },
  {
    id: 'kalshi', nombre: 'Kalshi', optica: 'prediccion', web: 'https://trading-api.readme.io/', licencia: LIC.verificar('Datos públicos de mercado; revisar términos de uso de datos.'), frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson('https://api.elections.kalshi.com/trade-api/v2/events?status=open&with_nested_markets=true&limit=100', env, {}, 12000);
      const markets: Market[] = [];
      for (const e of d.events ?? []) for (const m of e.markets ?? []) {
        const q = `${e.title}${m.yes_sub_title ? ' — ' + m.yes_sub_title : ''}`;
        const p = parseFloat(m.last_price_dollars ?? (m.last_price != null ? m.last_price / 100 : NaN));
        if (!isFinite(p)) continue;
        markets.push({ fuente: 'Kalshi', pregunta: q, prob: p, cierre: Date.parse(m.close_time), volumen: parseFloat(m.volume_24h_fp ?? m.volume_24h ?? m.open_interest_fp ?? 0) || 0, url: `https://kalshi.com/markets/${e.event_ticker}` });
      }
      return { metrics: [{ key: 'pred.kalshi', text: JSON.stringify(markets.filter((m) => BTC_RE.test(m.pregunta) || SCENARIOS.some((s) => s.mercado?.test(m.pregunta))).slice(0, 60)) }] };
    },
  },
  {
    id: 'manifold', nombre: 'Manifold', optica: 'prediccion', web: 'https://docs.manifold.markets/api', licencia: LIC.verificar('API pública; mercados con moneda de juego (menos fiables).'), frecuencia: '1 h',
    async run(env) {
      const terms = ['federal reserve rate', 'bitcoin reserve', 'tariff', 'bitcoin price'];
      const res = await Promise.allSettled(terms.map((t) => fetchJson<any[]>(`https://api.manifold.markets/v0/search-markets?term=${encodeURIComponent(t)}&filter=open&contractType=BINARY&limit=20`, env)));
      const markets: Market[] = [];
      for (const r of res) if (r.status === 'fulfilled') for (const m of r.value) {
        if (m.uniqueBettorCount < 15) continue;
        markets.push({ fuente: 'Manifold', pregunta: m.question, prob: m.probability, cierre: m.closeTime, volumen: m.volume24Hours ?? 0, url: m.url });
      }
      return { metrics: [{ key: 'pred.manifold', text: JSON.stringify(markets) }] };
    },
  },
];
