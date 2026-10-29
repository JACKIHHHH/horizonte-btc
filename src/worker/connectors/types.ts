import type { Env } from '../env';

export type Optica =
  | 'mercado' | 'derivados' | 'onchain' | 'liquidez' | 'macro'
  | 'geopolitica' | 'regulacion' | 'noticias' | 'sentimiento' | 'prediccion';

export interface Metric { key: string; value?: number | null; text?: string; unit?: string; observedAt?: number }
export interface SeriesUpdate { key: string; points: [string, number][]; mode: 'replace' | 'merge' }
export interface RawItem { title: string; url: string; publishedAt: number; lang?: string; source?: string; hint?: string }

export interface Output { metrics?: Metric[]; series?: SeriesUpdate[]; items?: RawItem[] }

export type LicenseStatus = 'apta' | 'no-comercial' | 'verificar';

export interface Connector {
  id: string;
  nombre: string;
  optica: Optica;
  web: string;
  licencia: { estado: LicenseStatus; nota: string };
  clave?: (keyof Env)[]; // secrets necesarios
  credibilidad?: number; // 0–1, para fuentes de noticias
  frecuencia: string;
  run(env: Env): Promise<Output>;
}

export const LIC = {
  apta: (nota: string) => ({ estado: 'apta' as const, nota }),
  verificar: (nota: string) => ({ estado: 'verificar' as const, nota }),
  nc: (nota: string) => ({ estado: 'no-comercial' as const, nota }),
};
