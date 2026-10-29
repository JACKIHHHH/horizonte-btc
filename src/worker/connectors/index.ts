import { derivados } from './derivados';
import { geopolitica } from './geopolitica';
import { macro } from './macro';
import { mercado } from './mercado';
import { apiNoticias, rss } from './noticias';
import { liquidez, onchain } from './onchain';
import { prediccion } from './prediccion';
import { sentimiento } from './sentimiento';
import type { Connector } from './types';

export const CONNECTORS: Connector[] = [...mercado, ...derivados, ...onchain, ...liquidez, ...macro, ...geopolitica, ...rss, ...apiNoticias, ...sentimiento, ...prediccion];
export const BY_ID = new Map(CONNECTORS.map((c) => [c.id, c]));

export { DESCARTADAS } from './descartadas';
