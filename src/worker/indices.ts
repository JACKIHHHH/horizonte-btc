// Índices propios (−1 a +1) y "instantánea" que consume la web.
import type { Env } from './env';
import { aggregatePrice, PRICE_SOURCES } from './connectors/mercado';
import { matchScenarios, type Market } from './connectors/prediccion';
import { CATEGORY_LABEL, COUNTRIES, type Category } from './nlp/lexicon';
import { SCENARIOS } from '../model/events';
import { now } from './util';

export interface MetricRow { key: string; value: number | null; text: string | null; unit: string | null; source: string; observed_at: number }
export interface Component { nombre: string; valor: number | null; aporte: number; fuente: string; detalle?: string }
export interface IndexReading { key: string; nombre: string; valor: number | null; lectura: string; componentes: Component[]; signo: string }

const tanh = Math.tanh;
const fmt = (x: number, d = 2) => x.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });

interface EventLite { id: string; title: string; category: Category; countries: string[]; last_seen: number; first_seen: number; n_sources: number; credibility: number; tone: number; weight: number; rumor: number; sources: { id: string; nombre: string; url: string }[] }

/** Peso actual de un acontecimiento: fiabilidad × difusión × decaimiento (vida media 18 h). */
export const liveWeight = (e: EventLite, t = now()) => e.weight * Math.pow(0.5, (t - e.last_seen) / (18 * 36e5));

function build(key: string, nombre: string, signo: string, comps: Component[], textos: [number, string][]): IndexReading {
  const valid = comps.filter((c) => c.valor !== null && isFinite(c.aporte));
  // Si falta más de la mitad de los componentes, el índice no se calcula (evita lecturas sesgadas)
  const valor = valid.length && valid.length * 2 >= comps.length ? tanh(valid.reduce((a, c) => a + c.aporte, 0)) : null;
  let lectura = 'Sin datos suficientes';
  if (valor !== null) lectura = textos.find(([lim]) => valor <= lim)?.[1] ?? textos[textos.length - 1][1];
  return { key, nombre, valor, lectura, componentes: comps, signo };
}

export function computeIndices(m: Map<string, MetricRow>, events: EventLite[], t = now()) {
  const v = (k: string) => m.get(k)?.value ?? null;
  const src = (k: string) => m.get(k)?.source ?? '—';
  const evSum = (cats: Category[], days: number, f: (e: EventLite) => number = () => 1) =>
    events.filter((e) => cats.includes(e.category) && e.last_seen > t - days * 864e5).reduce((a, e) => a + liveWeight(e, t) * f(e), 0);
  const c = (nombre: string, valor: number | null, aporte: (x: number) => number, fuente: string, detalle?: string): Component =>
    ({ nombre, valor, aporte: valor === null ? 0 : aporte(valor), fuente, detalle });

  const geo = build('riesgo_geopolitico', 'Riesgo geopolítico', '+ = más riesgo', [
    c('Cobertura de conflictos (GDELT, z 24 h)', v('gdelt.conflicto'), (x) => 0.25 * x, 'GDELT'),
    c('Cobertura de sanciones (GDELT, z 24 h)', v('gdelt.sanciones'), (x) => 0.12 * x, 'GDELT'),
    c('Acontecimientos de conflicto y sanciones (48 h, ponderados)', evSum(['conflicto', 'sanciones'], 2), (x) => 0.18 * (x - 2), 'Noticias y comunicados'),
    c('Cortes de internet relevantes (7 d)', v('cortes.7d'), (x) => 0.04 * (x - 8), 'Cloudflare Radar'),
  ], [[-0.35, 'Calma relativa'], [0.15, 'Normal'], [0.5, 'Elevado'], [1, 'Muy elevado']]);

  const reg = build('presion_regulatoria', 'Presión regulatoria', '+ = más restrictiva', [
    c('Tono de acontecimientos regulatorios (7 d)', evSum(['regulacion'], 7, (e) => -e.tone), (x) => 0.6 * x, 'Reguladores y prensa'),
    c('Volumen de noticias regulatorias (7 d)', evSum(['regulacion'], 7), (x) => 0.05 * (x - 4), 'Reguladores y prensa'),
  ], [[-0.3, 'Favorable'], [0.2, 'Neutral'], [0.5, 'Tensa'], [1, 'Muy restrictiva']]);

  const dxy = v('fred.dxy.chg20'), real = v('fred.real10.chg20'), ndq = v('fred.nasdaq.chg20');
  const macro = build('tono_macro', 'Tono macro', '+ = favorable a BTC', [
    c('Dólar (cambio 20 sesiones)', dxy, (x) => -12 * x, src('fred.dxy.chg20'), dxy === null ? undefined : `${fmt(dxy * 100)} %`),
    c('Tipo real a 10 años (cambio 20 sesiones)', real, (x) => -1.5 * x, src('fred.real10.chg20'), real === null ? undefined : `${fmt(real * 100, 0)} pb`),
    c('Nasdaq (cambio 20 sesiones)', ndq, (x) => 4 * x, src('fred.nasdaq.chg20'), ndq === null ? undefined : `${fmt(ndq * 100)} %`),
    c('Tensión financiera en la prensa (GDELT, z)', v('gdelt.crisis_financiera'), (x) => -0.15 * x, 'GDELT'),
    c('Tono de noticias de política monetaria y datos (72 h)', evSum(['politica_monetaria', 'datos_macro'], 3, (e) => e.tone), (x) => 0.3 * x, 'Bancos centrales y prensa'),
  ], [[-0.4, 'Adverso'], [-0.1, 'Algo adverso'], [0.1, 'Neutral'], [0.4, 'Algo favorable'], [1, 'Favorable']]);

  const wiki = v('visitas.wiki.ratio');
  const aten = build('atencion_cripto', 'Atención a cripto', '+ = más atención', [
    c('Visitas a «Bitcoin» en Wikipedia (7 d frente a previos)', wiki, (x) => 1.5 * Math.log(x), 'Wikipedia', wiki === null ? undefined : `×${fmt(wiki)}`),
    c('Cobertura de cripto en medios (GDELT, z 24 h)', v('gdelt.cripto'), (x) => 0.2 * x, 'GDELT'),
    c('Historias en Hacker News (24 h)', v('hn.historias24h'), (x) => 0.02 * (x - 25), 'Hacker News'),
  ], [[-0.3, 'Baja'], [0.2, 'Normal'], [0.6, 'Alta'], [1, 'Muy alta']]);

  const fng = v('fng');
  const soc = build('sentimiento_social', 'Sentimiento social', '+ = euforia', [
    c('Fear & Greed', fng, (x) => (x - 50) / 30, 'alternative.me', fng === null ? undefined : `${fng} (${m.get('fng')?.text ?? ''})`),
    c('Actividad en Mastodon #bitcoin', v('mastodon.porhora'), (x) => 0.1 * Math.log(Math.max(0.1, x) / 6), 'Mastodon'),
  ], [[-0.6, 'Miedo extremo'], [-0.2, 'Miedo'], [0.2, 'Neutral'], [0.6, 'Codicia'], [1, 'Euforia']]);

  return [geo, reg, macro, aten, soc];
}

export function buildSnapshot(rows: MetricRow[], events: EventLite[], extra: { calibration?: any; sources: any[] }, t = now()) {
  const m = new Map(rows.map((r) => [r.key, r]));
  const quotes = PRICE_SOURCES.flatMap((s) => { const r = m.get('px.' + s); return r?.value ? [{ source: s, value: r.value, unit: r.unit ?? 'USD', age: t - r.observed_at, observedAt: r.observed_at }] : []; });
  const price = aggregatePrice(quotes);
  const indices = computeIndices(m, events, t);
  const jsonOf = (k: string) => { try { return JSON.parse(m.get(k)?.text ?? 'null'); } catch { return null; } };
  const markets: Market[] = [...(jsonOf('pred.polymarket') ?? []), ...(jsonOf('pred.kalshi') ?? []), ...(jsonOf('pred.manifold') ?? [])];
  const matched = matchScenarios(markets, t);
  const funding = ['okx', 'deribit', 'bybit'].map((x) => m.get('funding.' + x)?.value).filter((x): x is number => x != null && isFinite(x));
  const oi = ['okx', 'deribit', 'bybit'].map((x) => m.get('oi.' + x)?.value).filter((x): x is number => x != null && isFinite(x));

  const top = events
    .filter((e) => e.last_seen > t - 72 * 36e5)
    .map((e) => ({ ...e, peso: liveWeight(e, t) }))
    .sort((a, b) => b.peso - a.peso);

  // Mapa: intensidad por país (acontecimientos de 72 h ponderados)
  const byCountry = new Map<string, number>();
  for (const e of top) for (const c of e.countries) byCountry.set(c, (byCountry.get(c) ?? 0) + e.peso);
  const mapa = COUNTRIES.filter((c) => byCountry.has(c.iso)).map((c) => ({ iso: c.iso, nombre: c.nombre, lat: c.lat, lon: c.lon, intensidad: byCountry.get(c.iso)! }))
    .sort((a, b) => b.intensidad - a.intensidad);

  const metric = (k: string) => { const r = m.get(k); return r ? { valor: r.value, texto: r.text, unidad: r.unit, fuente: r.source, observado: r.observed_at } : null; };

  return {
    generado: t,
    precio: price && { ...price, fuentes: quotes.map((q) => ({ fuente: q.source, precio: q.value, unidad: q.unit, observado: q.observedAt, usado: price.used.includes(q.source) })) },
    top10: jsonOf('top10'),
    // Variación en 24 h (ratio): Bitfinex; si falta, CoinGecko
    cambio24h: m.get('btc.cambio24h')?.value ?? (() => { const b = (jsonOf('top10') ?? []).find((c: any) => c.id === 'bitcoin'); return b?.cambio24h != null ? b.cambio24h / 100 : null; })(),
    indices,
    acontecimientos: top.slice(0, 40).map((e) => ({
      id: e.id, titulo: e.title, categoria: e.category, categoriaNombre: CATEGORY_LABEL[e.category], paises: e.countries.map((c) => COUNTRIES.find((x) => x.iso === c)?.nombre ?? c), visto: e.last_seen, primero: e.first_seen,
      fuentes: e.sources.slice(0, 6), nFuentes: e.n_sources, fiabilidad: e.credibility, tono: e.tone, rumor: !!e.rumor, peso: e.peso,
    })),
    mapa,
    derivados: {
      dvol: metric('dvol'), ivAtm: metric('iv.atm30'), skew: metric('skew.10otm'), putCall: metric('putcall.oi'), basis: metric('basis.90d'),
      fundingMedio: funding.length ? funding.reduce((a, b) => a + b, 0) / funding.length : null, fundingAnual: funding.length ? (funding.reduce((a, b) => a + b, 0) / funding.length) * 3 * 365 : null,
      interesAbierto: oi.length ? oi.reduce((a, b) => a + b, 0) : null,
    },
    onchain: { fees: metric('fees.rapida'), hashrate: metric('hashrate'), ribbon: metric('ribbon'), dificultad: metric('dificultad.cambio'), altura: metric('altura'), mvrv: metric('mvrv'), realizado: metric('precio.realizado'), tx: metric('tx.diarias'), mineros: metric('mineros.ingresos'), commits: metric('core.commits30d') },
    liquidez: { stables: metric('stables.total'), stables30: metric('stables.30d') },
    macro: {
      dxy: metric('fred.dxy'), real10: metric('fred.real10'), nom10: metric('fred.nom10'), fedfunds: metric('fred.fedfunds'), vix: metric('fred.vix'), epu: metric('fred.epu'),
      oil: metric('fred.oil'), nasdaq: metric('fred.nasdaq'), deuda: metric('deuda.eeuu'), pibMundial: metric('pib.mundial'),
    },
    calendario: jsonOf('calendario') ?? [],
    sentimiento: { fng: metric('fng'), wiki: metric('visitas.wiki'), wikiRatio: metric('visitas.wiki.ratio'), hn: metric('hn.historias24h'), mastodon: metric('mastodon.porhora') },
    escenarios: SCENARIOS.map((s) => ({ id: s.id, cat: s.cat, titulo: s.titulo, supuesto: s.supuesto, mercado: matched[s.id] ?? null })),
    mercadosPrediccion: markets.filter((x) => /\b(bitcoin|btc)\b/i.test(x.pregunta) && x.cierre > t).sort((a, b) => b.volumen - a.volumen).slice(0, 8),
    coinbasePremium: price?.coinbasePremium ?? null,
    fuentes: extra.sources,
    calibracion: extra.calibration ?? null,
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
