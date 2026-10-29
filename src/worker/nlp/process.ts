// Procesado de noticias: clasificación, deduplicación en "acontecimientos" y fiabilidad.
import type { Env } from '../env';
import { BY_ID } from '../connectors';
import { hashId, now } from '../util';
import { CATEGORY_ANCHORS, classify, countriesIn, isRumor, tone, type Category } from './lexicon';

export const EMBED_MODEL = '@cf/baai/bge-m3'; // multilingüe (español e inglés)
const SIM_THRESHOLD = 0.78;
const LEX_THRESHOLD = 0.5;
const BATCH = 24;

/** Credibilidad por fuente; para GDELT se usa una lista de medios de referencia. */
const MAJOR = /(reuters|apnews|bbc\.|ft\.com|bloomberg|wsj\.com|nytimes|theguardian|economist|elpais|elmundo|lavanguardia|expansion|cincodias|lemonde|spiegel|dw\.com|france24|aljazeera|nikkei|cnbc|politico|axios|npr\.org|washingtonpost)/i;
export function credibilityOf(source: string): number {
  if (source.startsWith('gdelt:')) return MAJOR.test(source) ? 0.85 : 0.45;
  return BY_ID.get(source)?.credibilidad ?? 0.5;
}
export function sourceName(source: string): string {
  return source.startsWith('gdelt:') ? source.slice(6) : BY_ID.get(source)?.nombre ?? source;
}

// ---------- Vectores ----------
export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0)) || 1;
  return v.map((x) => x / n);
}
export function quantize(v: number[]): string {
  const b = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) b[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127 * 4)));
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i] & 0xff);
  return btoa(s);
}
export function dequantize(s: string): number[] {
  const bin = atob(s);
  const out = new Array(bin.length);
  for (let i = 0; i < bin.length; i++) { const x = bin.charCodeAt(i); out[i] = (x > 127 ? x - 256 : x) / (127 * 4); }
  return normalize(out);
}
const dot = (a: number[], b: number[]) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };

const STOP = new Set('the a an of to in on for and or with at by from as is are was be has have its it this that de la el los las del y en a por para con un una que se su al lo como más sobre tras'.split(' '));
export function tokens(t: string): Set<string> {
  return new Set(t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)));
}
export function jaccard(a: Set<string>, b: Set<string>): number {
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  return i / Math.max(1, a.size + b.size - i);
}
/** Similitud léxica de respaldo (sin embeddings): Jaccard, o solapamiento alto dentro de la misma categoría. */
export function lexicalSame(a: Set<string>, b: Set<string>, sameCategory: boolean): number {
  const j = jaccard(a, b);
  if (j >= 0.5 || !sameCategory) return j;
  let i = 0;
  for (const x of a) if (b.has(x)) i++;
  const overlap = i / Math.max(1, Math.min(a.size, b.size));
  return i >= 3 && overlap >= 0.5 ? Math.max(j, 0.5) : j;
}

async function embed(env: Env, texts: string[]): Promise<number[][] | null> {
  if (!env.AI || !texts.length) return null;
  try {
    const r: any = await env.AI.run(EMBED_MODEL as any, { text: texts } as any);
    const data: number[][] | undefined = r?.data ?? r?.response;
    return Array.isArray(data) && data.length === texts.length ? data.map(normalize) : null;
  } catch {
    return null;
  }
}

/** Anclas de categoría (se calculan una vez y se guardan en KV). */
async function anchors(env: Env): Promise<{ cat: Category; v: number[] }[] | null> {
  const cached = await env.KV.get('nlp:anchors', 'json');
  if (cached) return cached as any;
  const cats = Object.keys(CATEGORY_ANCHORS) as Category[];
  const vs = await embed(env, cats.map((c) => CATEGORY_ANCHORS[c]!));
  if (!vs) return null;
  const out = cats.map((cat, i) => ({ cat, v: vs[i].map((x) => Math.round(x * 1e4) / 1e4) }));
  await env.KV.put('nlp:anchors', JSON.stringify(out));
  return out;
}

interface EventRow { id: string; title: string; category: string; countries: string; first_seen: number; last_seen: number; n_items: number; n_sources: number; credibility: number; tone: number; weight: number; rumor: number; sources: string; centroid: string | null }

export async function processPending(env: Env): Promise<{ processed: number; discarded: number; events: number }> {
  // Lo que lleve más de 48 h sin procesar ya no aporta: se descarta
  await env.DB.prepare("UPDATE items SET status = 'descartado' WHERE status = 'pendiente' AND published_at < ?").bind(now() - 48 * 36e5).run();
  const { results: items } = await env.DB.prepare("SELECT id, source, title, url, published_at FROM items WHERE status = 'pendiente' ORDER BY fetched_at LIMIT ?").bind(BATCH).all<any>();
  if (!items.length) return { processed: 0, discarded: 0, events: 0 };
  const t = now();
  const vecs = await embed(env, items.map((i) => i.title));
  const anc = vecs ? await anchors(env) : null;
  const { results: recent } = await env.DB.prepare('SELECT * FROM events WHERE last_seen > ? ORDER BY last_seen DESC LIMIT 150').bind(t - 36 * 36e5).all<EventRow>();
  const evs = recent.map((e) => ({ row: e, vec: e.centroid ? dequantize(e.centroid) : null, tok: tokens(e.title), srcs: JSON.parse(e.sources) as { id: string; nombre: string; url: string; cred: number }[], dirty: false, isNew: false }));

  const itemUpdates: D1PreparedStatement[] = [];
  let discarded = 0;
  for (let k = 0; k < items.length; k++) {
    const it = items[k];
    const hint = BY_ID.get(it.source)?.optica === 'regulacion' ? 'regulacion' : (it.source === 'ofac' ? 'sanciones' : undefined);
    let { category } = classify(it.title, hint);
    const v = vecs?.[k] ?? null;
    if (category === 'otro' && v && anc) {
      let best = anc[0], bs = -1;
      for (const a of anc) { const s = dot(v, a.v); if (s > bs) { bs = s; best = a; } }
      if (bs > 0.55) category = best.cat;
    }
    if (category === 'otro') {
      itemUpdates.push(env.DB.prepare("UPDATE items SET status = 'descartado', category = 'otro' WHERE id = ?").bind(it.id));
      discarded++;
      continue;
    }
    const tn = tone(it.title), ctry = countriesIn(it.title), cred = credibilityOf(it.source);
    const tok = tokens(it.title);
    // Buscar acontecimiento existente
    let target = null as (typeof evs)[number] | null, bestSim = 0;
    for (const e of evs) {
      const sim = v && e.vec ? dot(v, e.vec) : lexicalSame(tok, e.tok, e.row.category === category);
      const thr = v && e.vec ? SIM_THRESHOLD : LEX_THRESHOLD;
      if (sim >= thr && sim > bestSim) { bestSim = sim; target = e; }
    }
    const src = { id: it.source, nombre: sourceName(it.source), url: it.url, cred };
    if (!target) {
      const row: EventRow = {
        id: hashId(it.url + it.title), title: it.title, category, countries: JSON.stringify(ctry), first_seen: it.published_at, last_seen: it.published_at,
        n_items: 1, n_sources: 1, credibility: cred, tone: tn, weight: 0, rumor: isRumor(it.title) ? 1 : 0, sources: '[]', centroid: v ? quantize(v) : null,
      };
      target = { row, vec: v, tok, srcs: [src], dirty: true, isNew: true };
      evs.push(target);
    } else {
      const e = target.row;
      e.n_items += 1;
      if (!target.srcs.some((s) => s.id === src.id)) target.srcs.push(src);
      e.n_sources = target.srcs.length;
      e.last_seen = Math.max(e.last_seen, it.published_at);
      e.first_seen = Math.min(e.first_seen, it.published_at);
      e.tone = (e.tone * (e.n_items - 1) + tn) / e.n_items;
      e.rumor = e.rumor && isRumor(it.title) ? 1 : 0;
      const cs = new Set([...JSON.parse(e.countries), ...ctry]);
      e.countries = JSON.stringify([...cs].slice(0, 6));
      // El titular visible es el de la fuente más fiable
      if (cred > Math.max(...target.srcs.filter((s) => s.id !== src.id).map((s) => s.cred), 0)) e.title = it.title;
      if (v && target.vec) {
        target.vec = normalize(target.vec.map((x, i) => x * (e.n_items - 1) + v[i]));
        e.centroid = quantize(target.vec);
      }
      target.dirty = true;
    }
    // Fiabilidad combinada (o-ruidoso): varias fuentes independientes refuerzan
    const r = target.row;
    r.credibility = 1 - target.srcs.reduce((p, s) => p * (1 - s.cred * 0.9), 1);
    if (r.n_sources >= 2) r.rumor = 0;
    r.weight = r.credibility * Math.min(1, Math.log2(1 + r.n_sources) / 2) * (r.rumor ? 0.3 : 1);
    r.sources = JSON.stringify(target.srcs.slice(0, 12));
    itemUpdates.push(env.DB.prepare("UPDATE items SET status = 'procesado', category = ?, tone = ?, countries = ?, event_id = ? WHERE id = ?").bind(category, tn, JSON.stringify(ctry), r.id, it.id));
  }
  const evUpdates = evs.filter((e) => e.dirty).map((e) => {
    const r = e.row;
    return env.DB.prepare(`INSERT INTO events (id, title, category, countries, first_seen, last_seen, n_items, n_sources, credibility, tone, weight, rumor, sources, centroid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET title=excluded.title, countries=excluded.countries, first_seen=excluded.first_seen, last_seen=excluded.last_seen, n_items=excluded.n_items,
      n_sources=excluded.n_sources, credibility=excluded.credibility, tone=excluded.tone, weight=excluded.weight, rumor=excluded.rumor, sources=excluded.sources, centroid=excluded.centroid`)
      .bind(r.id, r.title, r.category, r.countries, r.first_seen, r.last_seen, r.n_items, r.n_sources, r.credibility, r.tone, r.weight, r.rumor, r.sources, r.centroid);
  });
  await env.DB.batch([...itemUpdates, ...evUpdates]);
  return { processed: items.length - discarded, discarded, events: evUpdates.length };
}
