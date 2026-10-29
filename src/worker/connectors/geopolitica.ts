// Geopolítica, conflictos, sanciones, desastres y cortes de internet.
import { fetchJson, fetchText, SourceError, now } from '../util';
import { decode } from '../rss';
import { LIC, type Connector, type Metric, type RawItem } from './types';

const GDELT = 'https://api.gdeltproject.org/api/v2/doc/doc';

/** Consultas temáticas de GDELT: volumen de cobertura mundial (normalizado) y su intensidad frente a 30 días. */
export const GDELT_TOPICS: { key: string; nombre: string; q: string }[] = [
  { key: 'conflicto', nombre: 'Conflicto armado', q: '(war OR airstrike OR missile OR invasion OR "military strike" OR shelling)' },
  { key: 'sanciones', nombre: 'Sanciones y embargos', q: '(sanctions OR embargo OR "export controls")' },
  { key: 'crisis_financiera', nombre: 'Tensión financiera', q: '("bank run" OR "debt default" OR recession OR "financial crisis" OR "credit crunch")' },
  { key: 'aranceles', nombre: 'Guerra comercial', q: '(tariff OR tariffs OR "trade war")' },
  { key: 'cripto', nombre: 'Atención a cripto', q: '(bitcoin OR cryptocurrency OR stablecoin)' },
];

/** Agrupa la línea temporal en ventanas de 24 h y calcula z del último día frente a los anteriores. */
export function timelineIntensity(data: { date: string; value: number; norm?: number }[]) {
  if (!data.length) return null;
  const parse = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), +d.slice(9, 11) || 0, +d.slice(11, 13) || 0);
  const end = parse(data[data.length - 1].date);
  const buckets = new Map<number, { v: number; n: number }>();
  for (const p of data) {
    const b = Math.floor((end - parse(p.date)) / 864e5);
    const cur = buckets.get(b) ?? { v: 0, n: 0 };
    cur.v += p.value; cur.n += p.norm ?? 0;
    buckets.set(b, cur);
  }
  const ratio = (x: { v: number; n: number }) => (x.n > 0 ? x.v / x.n : x.v);
  const last = buckets.get(0);
  const prev = [...buckets.entries()].filter(([k]) => k > 0).map(([, x]) => ratio(x));
  if (!last || prev.length < 5) return null;
  const m = prev.reduce((a, b) => a + b, 0) / prev.length;
  const sd = Math.sqrt(prev.reduce((a, b) => a + (b - m) ** 2, 0) / (prev.length - 1)) || m * 0.1 || 1;
  return { z: (ratio(last) - m) / sd, last: last.v, ratio: ratio(last) / (m || 1) };
}

export const geopolitica: Connector[] = [
  {
    id: 'gdelt-intensidad', nombre: 'GDELT — intensidad temática mundial', optica: 'geopolitica', web: 'https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/',
    licencia: LIC.apta('Datos abiertos de GDELT; uso libre con atribución.'), frecuencia: '1 h',
    async run(env) {
      // GDELT pide como máximo una consulta cada 5 segundos por IP: se hacen en serie
      const res: PromiseSettledResult<any>[] = [];
      for (let i = 0; i < GDELT_TOPICS.length; i++) {
        if (i) await new Promise((r) => setTimeout(r, 5500));
        try { res.push({ status: 'fulfilled', value: await fetchJson(`${GDELT}?query=${encodeURIComponent(GDELT_TOPICS[i].q)}&mode=timelinevolraw&format=json&timespan=30d`, env, {}, 25000) }); }
        catch (e) { res.push({ status: 'rejected', reason: e }); }
      }
      const metrics: Metric[] = [];
      res.forEach((r, i) => {
        if (r.status !== 'fulfilled') return;
        const data = r.value.timeline?.[0]?.data ?? [];
        const it = timelineIntensity(data);
        if (it) metrics.push({ key: 'gdelt.' + GDELT_TOPICS[i].key, value: it.z, text: JSON.stringify({ ratio: it.ratio, articulos24h: it.last }), unit: 'z' });
      });
      if (!metrics.length) throw new SourceError('GDELT sin respuesta');
      return { metrics };
    },
  },
  {
    id: 'gdelt-articulos', nombre: 'GDELT — artículos de geopolítica y economía', optica: 'geopolitica', web: 'https://www.gdeltproject.org/', credibilidad: 0.6,
    licencia: LIC.apta('Solo titular, medio y enlace; atribución a GDELT.'), frecuencia: '1 h',
    async run(env) {
      const q = '(war OR sanctions OR "central bank" OR tariff OR bitcoin OR "interest rates" OR missile OR invasion) (sourcelang:english OR sourcelang:spanish)';
      const d = await fetchJson(`${GDELT}?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=75&timespan=3h&sort=hybridrel`, env, {}, 25000);
      const items: RawItem[] = (d.articles ?? []).map((a: any) => {
        const s = a.seendate as string; // 20261029T103000Z
        const t = Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(9, 11), +s.slice(11, 13));
        return { title: a.title, url: a.url, publishedAt: t, lang: a.language === 'Spanish' ? 'es' : 'en', source: 'gdelt:' + a.domain };
      });
      return { items };
    },
  },
  {
    id: 'ofac', nombre: 'OFAC — acciones recientes (sanciones de EE. UU.)', optica: 'geopolitica', web: 'https://ofac.treasury.gov/recent-actions', credibilidad: 1,
    licencia: LIC.apta('Página pública del Gobierno de EE. UU. (el RSS oficial se retiró en 2025).'), frecuencia: '1 día',
    async run(env) {
      const html = await fetchText('https://ofac.treasury.gov/recent-actions', env, {}, 25000);
      const items: RawItem[] = [];
      const re = /<a[^>]+href="(\/recent-actions\/(\d{8})[^"]*)"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && items.length < 15) {
        const title = decode(m[3]);
        if (title.length < 8) continue;
        const d = m[2];
        items.push({ title: 'OFAC: ' + title, url: 'https://ofac.treasury.gov' + m[1], publishedAt: Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8), 15), lang: 'en', source: 'ofac', hint: 'sanciones' });
      }
      if (!items.length) throw new SourceError('no se encontraron acciones');
      return { items };
    },
  },
  {
    id: 'usgs', nombre: 'USGS — terremotos significativos', optica: 'geopolitica', web: 'https://earthquake.usgs.gov/earthquakes/feed/', credibilidad: 1,
    licencia: LIC.apta('Dominio público (USGS).'), frecuencia: '1 h',
    async run(env) {
      const d = await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_week.geojson', env);
      const items: RawItem[] = (d.features ?? []).map((f: any) => ({ title: `Terremoto: ${f.properties.title}`, url: f.properties.url, publishedAt: f.properties.time, lang: 'en', source: 'usgs', hint: 'desastre' }));
      return { items, metrics: [{ key: 'terremotos.semana', value: items.length, unit: 'significativos' }] };
    },
  },
  {
    id: 'reliefweb', nombre: 'ReliefWeb — crisis humanitarias (ONU OCHA)', optica: 'geopolitica', web: 'https://apidoc.reliefweb.int/', credibilidad: 1,
    licencia: LIC.verificar('API gratuita; desde 2025 exige un nombre de aplicación registrado.'), frecuencia: '1 día',
    async run(env) {
      const d = await fetchJson('https://api.reliefweb.int/v2/disasters?appname=escenarios-btc&profile=list&preset=latest&limit=15', env);
      const items: RawItem[] = (d.data ?? []).map((r: any) => ({ title: `Crisis: ${r.fields?.name}`, url: r.fields?.url ?? r.href, publishedAt: Date.parse(r.fields?.date?.created ?? '') || now(), lang: 'en', source: 'reliefweb', hint: 'desastre' }));
      return { items };
    },
  },
  {
    id: 'cloudflare-radar', nombre: 'Cloudflare Radar — cortes de internet', optica: 'geopolitica', web: 'https://developers.cloudflare.com/radar/', clave: ['CF_RADAR_TOKEN'], credibilidad: 1,
    licencia: LIC.nc('Los datos de Cloudflare Radar se publican bajo CC BY-NC 4.0.'), frecuencia: '1 h',
    async run(env) {
      if (!env.CF_RADAR_TOKEN) throw new SourceError('falta CF_RADAR_TOKEN');
      const d = await fetchJson('https://api.cloudflare.com/client/v4/radar/annotations/outages?limit=25&dateRange=7d&format=json', env, { headers: { Authorization: `Bearer ${env.CF_RADAR_TOKEN}` } });
      const ann = d.result?.annotations ?? [];
      const items: RawItem[] = ann.map((a: any) => ({
        title: `Corte de internet en ${(a.locationsDetails ?? []).map((l: any) => l.name).join(', ') || (a.locations ?? []).join(', ')}: ${a.outage?.outageCause ?? a.description ?? ''}`.slice(0, 250),
        url: a.linkedUrl || 'https://radar.cloudflare.com/outage-center', publishedAt: Date.parse(a.startDate), lang: 'en', source: 'cloudflare-radar', hint: 'cortes_internet',
      }));
      return { items, metrics: [{ key: 'cortes.7d', value: ann.length, unit: 'cortes' }] };
    },
  },
];
