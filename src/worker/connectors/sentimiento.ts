// Sentimiento social y atención pública.
import { fetchJson, SourceError, now } from '../util';
import { LIC, type Connector, type Metric, type RawItem } from './types';

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

export const sentimiento: Connector[] = [
  {
    id: 'feargreed', nombre: 'Fear & Greed Index (alternative.me)', optica: 'sentimiento', web: 'https://alternative.me/crypto/fear-and-greed-index/',
    licencia: LIC.verificar('Uso gratuito con atribución visible junto al dato; confirmar el uso comercial con alternative.me.'), frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson('https://api.alternative.me/fng/?limit=10', env);
      const rows = d.data ?? [];
      if (!rows.length) throw new SourceError('sin datos');
      return {
        metrics: [{ key: 'fng', value: +rows[0].value, text: rows[0].value_classification, unit: '0–100' }],
        series: [{ key: 'fng', mode: 'merge', points: rows.map((r: any) => [new Date(+r.timestamp * 1000).toISOString().slice(0, 10), +r.value] as [string, number]) }],
      };
    },
  },
  {
    id: 'wikipedia', nombre: 'Wikipedia Pageviews', optica: 'sentimiento', web: 'https://wikitech.wikimedia.org/wiki/Analytics/AQS/Pageviews',
    licencia: LIC.apta('Datos de Wikimedia en dominio público (CC0).'), frecuencia: '1 día',
    async run(env) {
      const end = ymd(now() - 864e5), start = ymd(now() - 70 * 864e5);
      const arts = [['en.wikipedia', 'Bitcoin', 'wiki'], ['es.wikipedia', 'Bitcoin', 'wiki_es'], ['en.wikipedia', 'Recession', 'wiki_recesion']];
      const res = await Promise.allSettled(arts.map(([p, a]) => fetchJson(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${p}/all-access/user/${a}/daily/${start}/${end}`, env)));
      const series = [], metrics = [];
      for (let i = 0; i < arts.length; i++) {
        const r = res[i];
        if (r.status !== 'fulfilled') continue;
        const pts: [string, number][] = (r.value.items ?? []).map((x: any) => [`${x.timestamp.slice(0, 4)}-${x.timestamp.slice(4, 6)}-${x.timestamp.slice(6, 8)}`, x.views]);
        if (!pts.length) continue;
        series.push({ key: arts[i][2], mode: 'merge' as const, points: pts });
        metrics.push({ key: 'visitas.' + arts[i][2], value: pts[pts.length - 1][1], unit: 'visitas/día' });
        const avg = (a: [string, number][]) => a.reduce((x, y) => x + y[1], 0) / Math.max(1, a.length);
        if (pts.length > 30) metrics.push({ key: 'visitas.' + arts[i][2] + '.ratio', value: avg(pts.slice(-7)) / avg(pts.slice(0, -7)), unit: '7 d / previos' });
      }
      if (!series.length) throw new SourceError('sin datos');
      return { series, metrics };
    },
  },
  {
    id: 'hackernews', nombre: 'Hacker News (Algolia)', optica: 'sentimiento', web: 'https://hn.algolia.com/api', credibilidad: 0.3,
    licencia: LIC.apta('API pública; solo recuentos y titulares enlazados.'), frecuencia: '1 h',
    async run(env) {
      const since = Math.floor(now() / 1000) - 86400;
      const d = await fetchJson(`https://hn.algolia.com/api/v1/search_by_date?query=bitcoin&tags=story&numericFilters=created_at_i>${since}&hitsPerPage=50`, env);
      const items: RawItem[] = (d.hits ?? []).filter((h: any) => h.points >= 20).map((h: any) => ({ title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, publishedAt: h.created_at_i * 1000, lang: 'en', source: 'hackernews' }));
      return { items, metrics: [{ key: 'hn.historias24h', value: d.nbHits ?? 0, unit: 'historias' }] };
    },
  },
  {
    id: 'mastodon', nombre: 'Mastodon (#bitcoin)', optica: 'sentimiento', web: 'https://docs.joinmastodon.org/methods/timelines/', credibilidad: 0.2,
    licencia: LIC.apta('Línea temporal pública; solo se cuentan publicaciones, no se muestran.'), frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson<any[]>('https://mastodon.social/api/v1/timelines/tag/bitcoin?limit=40', env);
      if (!Array.isArray(d) || d.length < 2) throw new SourceError('sin publicaciones');
      const t0 = Date.parse(d[d.length - 1].created_at), t1 = Date.parse(d[0].created_at);
      const porHora = (d.length - 1) / Math.max(1 / 60, (t1 - t0) / 36e5);
      return { metrics: [{ key: 'mastodon.porhora', value: porHora, unit: 'publicaciones/h' }] };
    },
  },
  {
    id: 'reddit', nombre: 'Reddit (r/Bitcoin, r/CryptoCurrency, r/worldnews)', optica: 'sentimiento', web: 'https://www.reddit.com/dev/api/', clave: ['REDDIT_CLIENT_ID', 'REDDIT_CLIENT_SECRET'], credibilidad: 0.2,
    licencia: LIC.verificar('La API de datos de Reddit exige aprobación para uso comercial.'), frecuencia: '1 h',
    async run(env) {
      const e = env;
      if (!e.REDDIT_CLIENT_ID || !e.REDDIT_CLIENT_SECRET) throw new SourceError('faltan credenciales de Reddit');
      const tok = await fetchJson('https://www.reddit.com/api/v1/access_token', env, {
        method: 'POST', body: 'grant_type=client_credentials',
        headers: { Authorization: 'Basic ' + btoa(`${e.REDDIT_CLIENT_ID}:${e.REDDIT_CLIENT_SECRET}`), 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      const subs = ['Bitcoin', 'CryptoCurrency', 'worldnews'];
      const res = await Promise.allSettled(subs.map((s) => fetchJson(`https://oauth.reddit.com/r/${s}/hot?limit=50`, env, { headers: { Authorization: `Bearer ${tok.access_token}` } })));
      const items: RawItem[] = [];
      const metrics: Metric[] = [];
      res.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const posts = r.value.data?.children ?? [];
        metrics.push({ key: 'reddit.' + subs[i].toLowerCase(), value: posts.reduce((a: number, p: any) => a + (p.data.num_comments ?? 0), 0), unit: 'comentarios en portada' });
        for (const p of posts.slice(0, 10)) if (p.data.score > 500) items.push({ title: p.data.title, url: 'https://www.reddit.com' + p.data.permalink, publishedAt: p.data.created_utc * 1000, lang: 'en', source: 'reddit' });
      });
      return { items, metrics };
    },
  },
];
