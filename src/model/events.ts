// Estudio de eventos: cómo reaccionó BTC en el pasado a cada tipo de acontecimiento.
// El catálogo es público y ampliable; las fechas son el día en que el hecho se hizo público.
import type { History } from './history';

export type EventCategory =
  | 'recorte_tipos' | 'subida_tipos' | 'conflicto' | 'hackeo_quiebra' | 'crisis_bancaria'
  | 'regulacion_favorable' | 'regulacion_restrictiva' | 'aranceles' | 'halving';

export interface HistoricEvent { date: string; cat: EventCategory; label: string }

export const EVENT_CATALOGUE: HistoricEvent[] = [
  // Política monetaria de la Reserva Federal (fecha de decisión)
  { date: '2019-07-31', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2019-09-18', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2019-10-30', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2020-03-03', cat: 'recorte_tipos', label: 'Fed recorte de urgencia 50 pb' },
  { date: '2020-03-15', cat: 'recorte_tipos', label: 'Fed recorte de urgencia 100 pb' },
  { date: '2024-09-18', cat: 'recorte_tipos', label: 'Fed recorta 50 pb' },
  { date: '2024-11-07', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2024-12-18', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2025-09-17', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2025-10-29', cat: 'recorte_tipos', label: 'Fed recorta 25 pb' },
  { date: '2018-03-21', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2018-06-13', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2018-09-26', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2018-12-19', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2022-03-16', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2022-05-04', cat: 'subida_tipos', label: 'Fed sube 50 pb' },
  { date: '2022-06-15', cat: 'subida_tipos', label: 'Fed sube 75 pb' },
  { date: '2022-07-27', cat: 'subida_tipos', label: 'Fed sube 75 pb' },
  { date: '2022-09-21', cat: 'subida_tipos', label: 'Fed sube 75 pb' },
  { date: '2022-11-02', cat: 'subida_tipos', label: 'Fed sube 75 pb' },
  { date: '2022-12-14', cat: 'subida_tipos', label: 'Fed sube 50 pb' },
  { date: '2023-02-01', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2023-03-22', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2023-05-03', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2023-07-26', cat: 'subida_tipos', label: 'Fed sube 25 pb' },
  { date: '2026-09-16', cat: 'subida_tipos', label: 'Fed sube 25 pb (primera subida desde 2023)' },
  // Geopolítica
  { date: '2020-01-03', cat: 'conflicto', label: 'EE. UU. abate a Soleimani' },
  { date: '2022-02-24', cat: 'conflicto', label: 'Rusia invade Ucrania' },
  { date: '2023-10-07', cat: 'conflicto', label: 'Ataque de Hamás a Israel' },
  { date: '2024-04-13', cat: 'conflicto', label: 'Irán ataca Israel con drones y misiles' },
  { date: '2024-10-01', cat: 'conflicto', label: 'Irán lanza misiles balísticos contra Israel' },
  { date: '2025-06-13', cat: 'conflicto', label: 'Israel ataca Irán' },
  { date: '2025-06-22', cat: 'conflicto', label: 'EE. UU. bombardea instalaciones nucleares iraníes' },
  // Hackeos y quiebras del sector
  { date: '2018-01-26', cat: 'hackeo_quiebra', label: 'Hackeo de Coincheck' },
  { date: '2019-05-07', cat: 'hackeo_quiebra', label: 'Hackeo de Binance (7.000 BTC)' },
  { date: '2022-05-09', cat: 'hackeo_quiebra', label: 'Colapso de Terra/UST' },
  { date: '2022-06-13', cat: 'hackeo_quiebra', label: 'Celsius congela retiradas' },
  { date: '2022-11-08', cat: 'hackeo_quiebra', label: 'Crisis de FTX' },
  { date: '2025-02-21', cat: 'hackeo_quiebra', label: 'Hackeo de Bybit' },
  // Crisis financieras
  { date: '2020-03-12', cat: 'crisis_bancaria', label: 'Pánico de liquidez por la COVID-19' },
  { date: '2023-03-10', cat: 'crisis_bancaria', label: 'Quiebra de Silicon Valley Bank' },
  { date: '2023-03-19', cat: 'crisis_bancaria', label: 'Rescate de Credit Suisse por UBS' },
  // Regulación
  { date: '2020-07-22', cat: 'regulacion_favorable', label: 'La OCC permite a bancos custodiar cripto' },
  { date: '2021-10-19', cat: 'regulacion_favorable', label: 'Primer ETF de futuros de BTC en EE. UU.' },
  { date: '2023-08-29', cat: 'regulacion_favorable', label: 'Grayscale gana a la SEC en apelación' },
  { date: '2024-01-10', cat: 'regulacion_favorable', label: 'La SEC aprueba los ETF spot de BTC' },
  { date: '2025-03-06', cat: 'regulacion_favorable', label: 'Orden ejecutiva de reserva estratégica de BTC' },
  { date: '2025-07-18', cat: 'regulacion_favorable', label: 'Firma de la ley GENIUS de stablecoins' },
  { date: '2021-05-21', cat: 'regulacion_restrictiva', label: 'China anuncia ofensiva contra la minería' },
  { date: '2021-09-24', cat: 'regulacion_restrictiva', label: 'China prohíbe las operaciones con cripto' },
  { date: '2023-06-05', cat: 'regulacion_restrictiva', label: 'La SEC demanda a Binance' },
  { date: '2023-06-06', cat: 'regulacion_restrictiva', label: 'La SEC demanda a Coinbase' },
  // Comercio internacional
  { date: '2018-03-22', cat: 'aranceles', label: 'EE. UU. anuncia aranceles a China' },
  { date: '2019-05-05', cat: 'aranceles', label: 'EE. UU. eleva aranceles a China' },
  { date: '2025-04-02', cat: 'aranceles', label: 'Aranceles generalizados de EE. UU.' },
  { date: '2025-10-10', cat: 'aranceles', label: 'Amenaza de aranceles del 100 % a China' },
  // Ciclo
  { date: '2016-07-09', cat: 'halving', label: 'Halving 2016' },
  { date: '2020-05-11', cat: 'halving', label: 'Halving 2020' },
  { date: '2024-04-20', cat: 'halving', label: 'Halving 2024' },
];

export interface EventEffect {
  cat: EventCategory;
  n: number;
  horizon: number;
  meanZ: number; // reacción media en desviaciones típicas
  shrunkZ: number;
  volLogRatio: number; // log(vol posterior / vol previa), encogido
  hitUp: number; // % de casos en que subió
  samples: { date: string; label: string; ret: number }[];
}

const SHRINK_K = 6;

export function eventStudy(h: History, horizon: number, upTo?: string): EventEffect[] {
  const close = h.s.close;
  const idx = new Map(h.days.map((d, i) => [d, i]));
  const cats = [...new Set(EVENT_CATALOGUE.map((e) => e.cat))];
  const out: EventEffect[] = [];
  for (const cat of cats) {
    const zs: number[] = [], vr: number[] = [], samples: EventEffect['samples'] = [];
    for (const e of EVENT_CATALOGUE.filter((x) => x.cat === cat)) {
      const i = idx.get(e.date);
      if (i === undefined || i < 31) continue;
      const i0 = i - 1, i1 = i0 + horizon;
      if (i1 >= close.length) continue;
      if (upTo && h.days[i1] > upTo) continue; // sin fuga: el efecto debe haber madurado
      const c0 = close[i0], c1 = close[i1];
      if (!c0 || !c1) continue;
      const pre: number[] = [];
      for (let k = i0 - 29; k <= i0; k++) { const a = close[k - 1], b = close[k]; if (a && b) pre.push(Math.log(b / a)); }
      const post: number[] = [];
      for (let k = i0 + 1; k <= i0 + Math.max(horizon, 7) && k < close.length; k++) { const a = close[k - 1], b = close[k]; if (a && b) post.push(Math.log(b / a)); }
      const sd = (a: number[]) => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1)); };
      const s0 = sd(pre);
      if (!(s0 > 0) || post.length < 3) continue;
      const ret = Math.log(c1 / c0);
      zs.push(ret / (s0 * Math.sqrt(horizon)));
      vr.push(Math.log(sd(post) / s0));
      samples.push({ date: e.date, label: e.label, ret });
    }
    const n = zs.length;
    const m = n ? zs.reduce((a, b) => a + b, 0) / n : 0;
    const v = n ? vr.reduce((a, b) => a + b, 0) / n : 0;
    const w = n / (n + SHRINK_K);
    out.push({ cat, n, horizon, meanZ: m, shrunkZ: m * w, volLogRatio: v * w, hitUp: n ? samples.filter((s) => s.ret > 0).length / n : NaN, samples });
  }
  return out;
}

// ---------- Escenarios interactivos ----------

export interface ScenarioDef {
  id: string;
  cat: EventCategory;
  titulo: string;
  supuesto: string;
  // Patrones para emparejar con mercados de predicción (se muestra siempre la pregunta emparejada).
  mercado?: RegExp;
}

export const SCENARIOS: ScenarioDef[] = [
  { id: 'fed-recorta', cat: 'recorte_tipos', titulo: 'La Fed recorta tipos', supuesto: 'Recorte en la próxima reunión del FOMC. Se aplica la reacción media histórica a recortes desde 2019.', mercado: /\b(fed|fomc|federal reserve)\b.*\b(cut|decrease|lower)/i },
  { id: 'fed-sube', cat: 'subida_tipos', titulo: 'La Fed sube tipos', supuesto: 'Subida en la próxima reunión. Basado en las subidas de 2018, 2022–2023 y septiembre de 2026.', mercado: /\b(fed|fomc|federal reserve)\b.*\b(hike|raise|increase)/i },
  { id: 'escalada', cat: 'conflicto', titulo: 'Escalada militar grave', supuesto: 'Conflicto armado de alcance internacional o ataque entre Estados. Basado en siete episodios desde 2020.' },
  { id: 'regulacion-favorable', cat: 'regulacion_favorable', titulo: 'Avance regulatorio favorable', supuesto: 'Ley, aprobación de producto u orden ejecutiva favorable en EE. UU.', mercado: /(strategic bitcoin reserve|bitcoin reserve|market structure bill|clarity act)/i },
  { id: 'regulacion-restrictiva', cat: 'regulacion_restrictiva', titulo: 'Endurecimiento regulatorio', supuesto: 'Prohibición o demanda contra actores principales del mercado.' },
  { id: 'hackeo', cat: 'hackeo_quiebra', titulo: 'Hackeo o quiebra de un exchange', supuesto: 'Pérdida de fondos o insolvencia de una plataforma de primer nivel.' },
  { id: 'crisis-bancaria', cat: 'crisis_bancaria', titulo: 'Crisis bancaria o de liquidez', supuesto: 'Quiebra bancaria relevante o pánico de liquidez.' },
  { id: 'aranceles', cat: 'aranceles', titulo: 'Shock comercial', supuesto: 'Subida brusca de aranceles entre grandes economías.', mercado: /\btariff/i },
];
