import { describe, expect, it } from 'vitest';
import { parseFeed, decode } from '../src/worker/rss';
import { classify, countriesIn, tone, isRumor } from '../src/worker/nlp/lexicon';
import { aggregatePrice } from '../src/worker/connectors/mercado';
import { timelineIntensity } from '../src/worker/connectors/geopolitica';
import { optionSkew, parseDeribitInstrument } from '../src/worker/connectors/derivados';
import { matchScenarios } from '../src/worker/connectors/prediccion';
import { jaccard, lexicalSame, tokens, quantize, dequantize, normalize } from '../src/worker/nlp/process';
import { computeIndices } from '../src/worker/indices';
import { plan } from '../src/worker/scheduler';
import { CONNECTORS } from '../src/worker/connectors';

describe('RSS', () => {
  it('lee RSS 2.0 con CDATA y entidades', () => {
    const xml = `<rss><channel><item><title><![CDATA[La Fed recorta tipos &amp; el BTC sube]]></title><link>https://ejemplo.com/a</link><pubDate>Thu, 29 Oct 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const [i] = parseFeed(xml);
    expect(i.title).toBe('La Fed recorta tipos & el BTC sube');
    expect(i.url).toBe('https://ejemplo.com/a');
    expect(i.publishedAt).toBe(Date.parse('2026-10-29T10:00:00Z'));
  });
  it('lee Atom con enlace en atributo', () => {
    const xml = `<feed><entry><title>SEC approves fund</title><link rel="alternate" href="https://sec.gov/x"/><updated>2026-10-29T09:00:00Z</updated></entry></feed>`;
    expect(parseFeed(xml)[0].url).toBe('https://sec.gov/x');
  });
  it('decodifica entidades numéricas', () => expect(decode('caf&#233; &#x2014; ok')).toBe('café — ok'));
});

describe('clasificación', () => {
  it.each([
    ['Israel launches missile strikes on Iran', 'conflicto'],
    ['EE. UU. impone sanciones a bancos rusos', 'sanciones'],
    ['La Fed recorta los tipos de interés en 25 puntos', 'politica_monetaria'],
    ['SEC sues crypto exchange over unregistered securities', 'regulacion'],
    ['Exchange hacked, $200 million drained', 'hackeo'],
    ['Real Madrid gana la Liga', 'otro'],
  ])('%s → %s', (t, c) => expect(classify(t).category).toBe(c));
  it('"regulación" sin cripto no cuenta salvo que venga de un regulador', () => {
    expect(classify('New rules for airline safety regulation').category).toBe('otro');
    expect(classify('New rules for airline safety regulation', 'regulacion').category).toBe('regulacion');
  });
  it('países', () => {
    expect(countriesIn('Russia and Ukraine talks in Washington')).toEqual(expect.arrayContaining(['US', 'RU', 'UA']));
    expect(countriesIn('Tell us about it')).not.toContain('US');
  });
  it('tono y rumores', () => {
    expect(tone('Bitcoin surges to record high')).toBeGreaterThan(0);
    expect(tone('Markets plunge as war fears grow')).toBeLessThan(0);
    expect(isRumor('Binance reportedly under investigation')).toBe(true);
  });
});

describe('agregación de precio', () => {
  it('mediana y descarte de atípicos', () => {
    const q = [100, 100.1, 99.9, 100.05, 103].map((v, i) => ({ source: 's' + i, value: v, unit: 'USD', age: 1000 }));
    const r = aggregatePrice(q)!;
    expect(r.price).toBeCloseTo(100.025, 3);
    expect(r.discarded.map((d) => d.source)).toEqual(['s4']);
  });
  it('ignora cotizaciones viejas', () => {
    expect(aggregatePrice([{ source: 'a', value: 1, unit: 'USD', age: 3600e3 }])).toBeNull();
  });
});

describe('GDELT', () => {
  it('detecta un pico de cobertura', () => {
    const data = [] as { date: string; value: number; norm: number }[];
    for (let d = 1; d <= 30; d++) data.push({ date: `202610${String(d).padStart(2, '0')}T000000Z`, value: d === 30 ? 300 : 100 + (d % 3), norm: 10000 });
    expect(timelineIntensity(data)!.z).toBeGreaterThan(5);
  });
});

describe('Deribit', () => {
  it('interpreta instrumentos', () => {
    expect(parseDeribitInstrument('BTC-27NOV26-90000-C')).toMatchObject({ strike: 90000, type: 'C' });
    expect(parseDeribitInstrument('BTC-26DEC26')!.type).toBe('F');
  });
  it('calcula el sesgo', () => {
    const t = Date.UTC(2026, 9, 29);
    const items = [
      { instrument_name: 'BTC-27NOV26-72000-P', mark_iv: 52, open_interest: 100 },
      { instrument_name: 'BTC-27NOV26-88000-C', mark_iv: 44, open_interest: 80 },
      { instrument_name: 'BTC-27NOV26-80000-C', mark_iv: 46, open_interest: 50 },
    ];
    const r = optionSkew(items, 80000, t)!;
    expect(r.skew).toBe(8);
    expect(r.atmIv).toBe(46);
  });
});

describe('mercados de predicción', () => {
  it('empareja escenarios por pregunta y plazo', () => {
    const t = Date.UTC(2026, 9, 29);
    const r = matchScenarios([
      { fuente: 'Polymarket', pregunta: 'Will the Fed cut rates in December?', prob: 0.7, cierre: t + 40 * 864e5, volumen: 1e6, url: 'x' },
      { fuente: 'Polymarket', pregunta: 'Will the Fed cut rates in 2028?', prob: 0.9, cierre: t + 800 * 864e5, volumen: 5e6, url: 'y' },
    ], t);
    expect(r['fed-recorta'].prob).toBe(0.7);
  });
});

describe('agrupación de noticias', () => {
  it('similitud léxica entre titulares de la misma noticia', () => {
    const a = tokens('Israel strikes Iranian nuclear sites, officials say');
    const b = tokens('Officials: Israel strikes Iranian nuclear sites');
    const c = tokens('Bitcoin ETF inflows hit record');
    expect(jaccard(a, b)).toBeGreaterThan(0.5);
    expect(jaccard(a, c)).toBeLessThan(0.2);
  });
  it('respaldo léxico agrupa redacciones distintas de la misma categoría', () => {
    const a = tokens('Fed leaves interest rates unchanged, as expected');
    const b = tokens('Warsh holds briefing after Fed leaves key interest rate unchanged');
    expect(lexicalSame(a, b, true)).toBeGreaterThanOrEqual(0.5);
    expect(lexicalSame(a, b, false)).toBeLessThan(0.5);
  });
  it('cuantización de embeddings conserva la dirección', () => {
    const v = normalize(Array.from({ length: 64 }, (_, i) => Math.sin(i)));
    const w = dequantize(quantize(v));
    expect(v.reduce((s, x, i) => s + x * w[i], 0)).toBeGreaterThan(0.99);
  });
});

describe('índices', () => {
  it('devuelven valores entre −1 y 1 y "sin datos" cuando faltan', () => {
    const mk = (key: string, value: number) => [key, { key, value, text: null, unit: 'z', source: 'gdelt', observed_at: Date.now() }] as const;
    const m = new Map([mk('gdelt.conflicto', 4), mk('gdelt.sanciones', 1)]);
    const idx = computeIndices(m as any, []);
    const geo = idx.find((i) => i.key === 'riesgo_geopolitico')!;
    expect(geo.valor).toBeGreaterThan(0); expect(geo.valor).toBeLessThan(1);
    expect(idx.find((i) => i.key === 'sentimiento_social')!.valor).toBeNull();
  });
});

describe('planificador', () => {
  it('cada conector se ejecuta al menos una vez al día y cada turno cabe en el límite de subpeticiones', () => {
    const seen = new Set<string>();
    for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += 5) {
      const ids = plan(new Date(Date.UTC(2026, 9, 29, h, m)));
      ids.forEach((i) => seen.add(i));
      // Peticiones HTTP por conector (las no listadas hacen 1); + histórico, cierre diario y Workers AI
      const REQS: Record<string, number> = { fred: 13, deribit: 4, mempool: 4, 'blockchain-com': 2, wikipedia: 3, 'gdelt-intensidad': 5, manifold: 4, reddit: 4, 'fred-calendario': 3, 'okx-swap': 2, 'binance-futures': 2 };
      const total = ids.reduce((a, id) => a + (REQS[id] ?? 1), 0) + 4;
      expect(total).toBeLessThanOrEqual(45);
    }
    const missing = CONNECTORS.map((c) => c.id).filter((id) => !seen.has(id));
    expect(missing).toEqual([]);
  });
});
