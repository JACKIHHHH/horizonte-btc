// Noticias, comunicados oficiales y regulación por RSS, más fuentes con API.
// Solo se guarda titular, medio, fecha y enlace: nunca el texto de los artículos.
import { fetchJson, fetchText, SourceError, now } from '../util';
import { parseFeed } from '../rss';
import { LIC, type Connector, type Optica } from './types';

interface FeedDef { id: string; nombre: string; url: string; optica: Optica; lang: string; cred: number; lic?: ReturnType<typeof LIC.apta>; hint?: string }

const RSS_LIC = LIC.verificar('RSS público: se muestran solo titular, medio y enlace al original. Revisar las condiciones del medio para uso comercial.');
const OFICIAL = LIC.apta('Comunicados oficiales de organismos públicos.');

export const FEEDS: FeedDef[] = [
  // Generalistas e internacionales
  { id: 'bbc-world', nombre: 'BBC News — World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', optica: 'noticias', lang: 'en', cred: 0.9 },
  { id: 'bbc-business', nombre: 'BBC News — Business', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', optica: 'noticias', lang: 'en', cred: 0.9 },
  { id: 'aljazeera', nombre: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', optica: 'noticias', lang: 'en', cred: 0.8 },
  { id: 'dw', nombre: 'Deutsche Welle', url: 'https://rss.dw.com/rdf/rss-en-all', optica: 'noticias', lang: 'en', cred: 0.85 },
  { id: 'dw-es', nombre: 'DW en español', url: 'https://rss.dw.com/rdf/rss-sp-all', optica: 'noticias', lang: 'es', cred: 0.85 },
  { id: 'france24', nombre: 'France 24', url: 'https://www.france24.com/en/rss', optica: 'noticias', lang: 'en', cred: 0.85 },
  { id: 'nhk', nombre: 'NHK (Japón)', url: 'https://www3.nhk.or.jp/rss/news/cat0.xml', optica: 'noticias', lang: 'ja', cred: 0.85 },
  { id: 'elpais', nombre: 'El País — Economía', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada', optica: 'noticias', lang: 'es', cred: 0.85 },
  { id: 'elpais-int', nombre: 'El País — Internacional', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/internacional/portada', optica: 'noticias', lang: 'es', cred: 0.85 },
  { id: 'cincodias', nombre: 'Cinco Días', url: 'https://feeds.elpais.com/mrss-s/pages/ep/site/cincodias.elpais.com/portada', optica: 'noticias', lang: 'es', cred: 0.8 },
  { id: 'expansion', nombre: 'Expansión — Mercados', url: 'https://e00-expansion.uecdn.es/rss/mercados.xml', optica: 'noticias', lang: 'es', cred: 0.8 },
  { id: 'europapress', nombre: 'Europa Press — Economía', url: 'https://www.europapress.es/rss/rss.aspx?ch=00136', optica: 'noticias', lang: 'es', cred: 0.8 },
  { id: 'ft', nombre: 'Financial Times (titulares)', url: 'https://www.ft.com/rss/home', optica: 'noticias', lang: 'en', cred: 0.9 },
  { id: 'bloomberg', nombre: 'Bloomberg Markets (titulares)', url: 'https://feeds.bloomberg.com/markets/news.rss', optica: 'noticias', lang: 'en', cred: 0.9 },
  // Cripto
  { id: 'coindesk', nombre: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', optica: 'noticias', lang: 'en', cred: 0.7, hint: 'cripto' },
  { id: 'cointelegraph', nombre: 'Cointelegraph', url: 'https://cointelegraph.com/rss', optica: 'noticias', lang: 'en', cred: 0.6, hint: 'cripto' },
  { id: 'theblock', nombre: 'The Block', url: 'https://www.theblock.co/rss.xml', optica: 'noticias', lang: 'en', cred: 0.7, hint: 'cripto' },
  { id: 'decrypt', nombre: 'Decrypt', url: 'https://decrypt.co/feed', optica: 'noticias', lang: 'en', cred: 0.6, hint: 'cripto' },
  { id: 'bitcoinmagazine', nombre: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/.rss/full/', optica: 'noticias', lang: 'en', cred: 0.55, hint: 'cripto' },
  { id: 'blockworks', nombre: 'Blockworks', url: 'https://blockworks.co/feed', optica: 'noticias', lang: 'en', cred: 0.7, hint: 'cripto' },
  { id: 'cryptoslate', nombre: 'CryptoSlate', url: 'https://cryptoslate.com/feed/', optica: 'noticias', lang: 'en', cred: 0.55, hint: 'cripto' },
  { id: 'optech', nombre: 'Bitcoin Optech', url: 'https://bitcoinops.org/feed.xml', optica: 'noticias', lang: 'en', cred: 0.9, hint: 'tecnologia_btc' },
  // Bancos centrales
  { id: 'fed', nombre: 'Reserva Federal — Comunicados', url: 'https://www.federalreserve.gov/feeds/press_all.xml', optica: 'macro', lang: 'en', cred: 1, lic: OFICIAL, hint: 'politica_monetaria' },
  { id: 'bce', nombre: 'Banco Central Europeo — Prensa', url: 'https://www.ecb.europa.eu/rss/press.html', optica: 'macro', lang: 'en', cred: 1, lic: OFICIAL, hint: 'politica_monetaria' },
  { id: 'boe', nombre: 'Bank of England — Noticias', url: 'https://www.bankofengland.co.uk/rss/news', optica: 'macro', lang: 'en', cred: 1, lic: OFICIAL, hint: 'politica_monetaria' },
  { id: 'boj', nombre: 'Banco de Japón — Novedades', url: 'https://www.boj.or.jp/en/rss/whatsnew.xml', optica: 'macro', lang: 'en', cred: 1, lic: OFICIAL, hint: 'politica_monetaria' },
  { id: 'bde', nombre: 'Banco de España — Notas de prensa', url: 'https://www.bde.es/bde/es/utiles/Canal_RSS/Notas_informati1/', optica: 'macro', lang: 'es', cred: 1, lic: OFICIAL, hint: 'politica_monetaria' },
  // Reguladores
  { id: 'sec', nombre: 'SEC — Comunicados', url: 'https://www.sec.gov/news/pressreleases.rss', optica: 'regulacion', lang: 'en', cred: 1, lic: OFICIAL, hint: 'regulacion' },
  { id: 'cftc', nombre: 'CFTC — Comunicados', url: 'https://www.cftc.gov/RSS/RSSGP/rssgp.xml', optica: 'regulacion', lang: 'en', cred: 1, lic: OFICIAL, hint: 'regulacion' },
  { id: 'esma', nombre: 'ESMA (MiCA)', url: 'https://www.esma.europa.eu/rss.xml', optica: 'regulacion', lang: 'en', cred: 1, lic: OFICIAL, hint: 'regulacion' },
  { id: 'eba', nombre: 'EBA', url: 'https://www.eba.europa.eu/rss.xml', optica: 'regulacion', lang: 'en', cred: 1, lic: OFICIAL, hint: 'regulacion' },
  { id: 'fsa-japon', nombre: 'FSA de Japón', url: 'https://www.fsa.go.jp/fsaEnNewsList_rss2.xml', optica: 'regulacion', lang: 'en', cred: 1, lic: OFICIAL, hint: 'regulacion' },
];

function feedConnector(f: FeedDef): Connector {
  return {
    id: f.id, nombre: f.nombre, optica: f.optica, web: f.url, licencia: f.lic ?? RSS_LIC, credibilidad: f.cred, frecuencia: '1 h',
    async run(env) {
      const xml = await fetchText(f.url, env);
      const items = parseFeed(xml, 30).map((i) => ({ ...i, lang: f.lang, source: f.id, hint: f.hint }));
      if (!items.length) throw new SourceError('feed sin entradas');
      return { items };
    },
  };
}

export const rss: Connector[] = FEEDS.map(feedConnector);

export const apiNoticias: Connector[] = [
  {
    id: 'guardian', nombre: 'The Guardian Open Platform', optica: 'noticias', web: 'https://open-platform.theguardian.com/', clave: ['GUARDIAN_API_KEY'], credibilidad: 0.9,
    licencia: LIC.nc('La clave gratuita de desarrollador es para uso no comercial.'), frecuencia: '1 h',
    async run(env) {
      if (!env.GUARDIAN_API_KEY) throw new SourceError('falta GUARDIAN_API_KEY');
      const d = await fetchJson(`https://content.guardianapis.com/search?q=(bitcoin OR crypto OR "federal reserve" OR sanctions OR war)&order-by=newest&page-size=30&api-key=${env.GUARDIAN_API_KEY}`, env);
      return { items: (d.response?.results ?? []).map((r: any) => ({ title: r.webTitle, url: r.webUrl, publishedAt: Date.parse(r.webPublicationDate), lang: 'en', source: 'guardian' })) };
    },
  },
  {
    id: 'edgar', nombre: 'SEC EDGAR (8-K que mencionan bitcoin)', optica: 'regulacion', web: 'https://efts.sec.gov/LATEST/search-index?q=bitcoin', credibilidad: 1,
    licencia: LIC.apta('Datos públicos de la SEC; exige User-Agent con contacto y máx. 10 peticiones/s.'), frecuencia: '1 día',
    async run(env) {
      const end = new Date(now()).toISOString().slice(0, 10), start = new Date(now() - 3 * 864e5).toISOString().slice(0, 10);
      const d = await fetchJson(`https://efts.sec.gov/LATEST/search-index?q=%22bitcoin%22&forms=8-K,S-1,10-Q&dateRange=custom&startdt=${start}&enddt=${end}`, env);
      const hits = d.hits?.hits ?? [];
      const items = hits.slice(0, 20).map((h: any) => {
        const s = h._source ?? {};
        const empresa = (s.display_names?.[0] ?? 'Empresa').replace(/\s*\(CIK.*$/, '');
        const cik = String(s.ciks?.[0] ?? '').replace(/^0+/, '');
        return { title: `${empresa} presenta un ${s.form} que menciona bitcoin`, url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${cik}&type=${s.form}`, publishedAt: Date.parse(s.file_date), lang: 'es', source: 'edgar', hint: 'adopcion' };
      });
      return { items, metrics: [{ key: 'edgar.menciones3d', value: d.hits?.total?.value ?? hits.length, unit: 'documentos' }] };
    },
  },
  {
    id: 'congress', nombre: 'Congress.gov (proyectos de ley cripto)', optica: 'regulacion', web: 'https://api.congress.gov/', clave: ['CONGRESS_API_KEY'], credibilidad: 1,
    licencia: LIC.apta('Datos públicos del Congreso de EE. UU. (clave gratuita de api.data.gov).'), frecuencia: '1 día',
    async run(env) {
      if (!env.CONGRESS_API_KEY) throw new SourceError('falta CONGRESS_API_KEY');
      const d = await fetchJson(`https://api.congress.gov/v3/bill?api_key=${env.CONGRESS_API_KEY}&format=json&limit=250&sort=updateDate+desc`, env);
      const re = /(digital asset|crypto|stablecoin|bitcoin|blockchain|cbdc)/i;
      const items = (d.bills ?? []).filter((b: any) => re.test(b.title)).slice(0, 15).map((b: any) => ({
        title: `${b.type} ${b.number}: ${b.title} — ${b.latestAction?.text ?? ''}`.slice(0, 280),
        url: `https://www.congress.gov/bill/${b.congress}th-congress/${b.type === 'HR' ? 'house-bill' : b.type === 'S' ? 'senate-bill' : 'bill'}/${b.number}`,
        publishedAt: Date.parse(b.latestAction?.actionDate ?? b.updateDate), lang: 'en', source: 'congress', hint: 'regulacion',
      }));
      return { items };
    },
  },
];
