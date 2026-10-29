// Macro y política monetaria.
import { fetchJson, SourceError, dayOf, now } from '../util';
import { LIC, type Connector } from './types';

/** Series de FRED → clave interna. */
export const FRED_SERIES: { id: string; key: string; nombre: string; nota?: string }[] = [
  { id: 'DTWEXBGS', key: 'dxy', nombre: 'Dólar amplio (índice nominal)' },
  { id: 'DFII10', key: 'real10', nombre: 'Tipo real a 10 años (TIPS)' },
  { id: 'DGS10', key: 'nom10', nombre: 'Bono a 10 años' },
  { id: 'DGS2', key: 'nom2', nombre: 'Bono a 2 años' },
  { id: 'WALCL', key: 'walcl', nombre: 'Balance de la Fed' },
  { id: 'WTREGEN', key: 'tga', nombre: 'Cuenta del Tesoro (TGA)' },
  { id: 'RRPONTSYD', key: 'rrp', nombre: 'Repo inverso' },
  { id: 'M2SL', key: 'm2', nombre: 'M2 de EE. UU.' },
  { id: 'VIXCLS', key: 'vix', nombre: 'VIX', nota: 'Datos de Cboe vía FRED: revisar condiciones de reproducción.' },
  { id: 'USEPUINDXD', key: 'epu', nombre: 'Incertidumbre de política económica (diaria)' },
  { id: 'NASDAQCOM', key: 'nasdaq', nombre: 'Nasdaq Composite', nota: 'Datos de Nasdaq vía FRED: revisar condiciones de reproducción.' },
  { id: 'DCOILWTICO', key: 'oil', nombre: 'Petróleo WTI' },
  { id: 'DFF', key: 'fedfunds', nombre: 'Tipo efectivo de fondos federales' },
];

export function fredUrl(env: { FRED_API_KEY?: string }, id: string, start: string) {
  return `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${env.FRED_API_KEY}&file_type=json&observation_start=${start}`;
}

export function parseFred(d: any): [string, number][] {
  return (d.observations ?? []).filter((o: any) => o.value !== '.').map((o: any) => [o.date, parseFloat(o.value)] as [string, number]);
}

/** Calendario oficial del FOMC (federalreserve.gov, consultado el 29/10/2026). Día de la decisión. */
export const FOMC_DECISIONS = [
  '2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08',
];

export const macro: Connector[] = [
  {
    id: 'fred', nombre: 'FRED (Reserva Federal de St. Louis)', optica: 'macro', web: 'https://fred.stlouisfed.org/docs/api/fred/', clave: ['FRED_API_KEY'],
    licencia: LIC.verificar('Uso libre con atribución para la mayoría de series; algunas (VIX, Nasdaq) tienen copyright del proveedor original.'), frecuencia: '1 día',
    async run(env) {
      if (!env.FRED_API_KEY) throw new SourceError('falta FRED_API_KEY');
      const start = dayOf(now() - 60 * 864e5);
      const res = await Promise.allSettled(FRED_SERIES.map((s) => fetchJson(fredUrl(env, s.id, start), env)));
      const series = [], metrics = [];
      for (let i = 0; i < FRED_SERIES.length; i++) {
        const r = res[i];
        if (r.status !== 'fulfilled') continue;
        const pts = parseFred(r.value);
        if (!pts.length) continue;
        series.push({ key: FRED_SERIES[i].key, mode: 'merge' as const, points: pts });
        const last = pts[pts.length - 1];
        metrics.push({ key: 'fred.' + FRED_SERIES[i].key, value: last[1], text: last[0] });
        // Cambio en ~20 sesiones (para la lectura macro instantánea)
        const ref = pts.find(([d]) => d >= new Date(Date.parse(last[0]) - 28 * 864e5).toISOString().slice(0, 10));
        if (ref) metrics.push({ key: 'fred.' + FRED_SERIES[i].key + '.chg20', value: ['real10', 'nom10', 'nom2', 'fedfunds'].includes(FRED_SERIES[i].key) ? last[1] - ref[1] : last[1] / ref[1] - 1 });
      }
      if (!series.length) throw new SourceError('ninguna serie respondió');
      return { series, metrics };
    },
  },
  {
    id: 'fred-calendario', nombre: 'Calendario de publicaciones (FRED: IPC, empleo, PIB)', optica: 'macro', web: 'https://fred.stlouisfed.org/releases/calendar', clave: ['FRED_API_KEY'],
    licencia: LIC.apta('Metadatos de calendario de FRED.'), frecuencia: '1 día',
    async run(env) {
      if (!env.FRED_API_KEY) throw new SourceError('falta FRED_API_KEY');
      const rel = [{ id: 10, nombre: 'IPC de EE. UU.' }, { id: 50, nombre: 'Informe de empleo de EE. UU.' }, { id: 53, nombre: 'PIB de EE. UU.' }];
      const hoy = dayOf(now());
      const out: { fecha: string; evento: string }[] = FOMC_DECISIONS.filter((d) => d >= hoy).map((d) => ({ fecha: d, evento: 'Decisión de tipos del FOMC' }));
      const res = await Promise.allSettled(rel.map((r) =>
        fetchJson(`https://api.stlouisfed.org/fred/release/dates?release_id=${r.id}&api_key=${env.FRED_API_KEY}&file_type=json&include_release_dates_with_no_data=true&realtime_start=${hoy}&realtime_end=9999-12-31&sort_order=asc&limit=6`, env)));
      res.forEach((r, i) => {
        if (r.status === 'fulfilled') for (const d of r.value.release_dates ?? []) if (d.date >= hoy) out.push({ fecha: d.date, evento: rel[i].nombre });
      });
      out.sort((a, b) => a.fecha.localeCompare(b.fecha));
      return { metrics: [{ key: 'calendario', text: JSON.stringify(out.slice(0, 12)) }] };
    },
  },
  {
    id: 'worldbank', nombre: 'Banco Mundial', optica: 'macro', web: 'https://datahelpdesk.worldbank.org/knowledgebase/articles/889392', licencia: LIC.apta('CC BY 4.0.'), frecuencia: '1 semana',
    async run(env) {
      const d = await fetchJson('https://api.worldbank.org/v2/country/WLD/indicator/NY.GDP.MKTP.KD.ZG?format=json&mrv=1', env);
      const r = d?.[1]?.[0];
      return { metrics: [{ key: 'pib.mundial', value: r?.value ?? null, unit: '% anual', text: r?.date }] };
    },
  },
];
