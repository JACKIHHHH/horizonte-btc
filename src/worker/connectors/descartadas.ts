/** Fuentes valoradas y descartadas, para la página de metodología. */
export const DESCARTADAS = [
  { nombre: 'X / Twitter', motivo: 'Su API dejó de ser gratuita.' },
  { nombre: 'Binance (spot y perpetuos)', motivo: 'Responde 403/451 a las peticiones desde Cloudflare (bloqueo regional); sustituido por Gemini, Bitfinex y el perpetuo de Deribit.' },
  { nombre: 'CNMV', motivo: 'Bloquea el acceso automatizado (403).' },
  { nombre: 'U.S. Treasury Fiscal Data', motivo: 'Devuelve un error SSL (525) a las peticiones desde Cloudflare; la deuda de EE. UU. puede seguirse con FRED.' },
  { nombre: 'CoinPaprika', motivo: 'Su API responde 402 (pago requerido) desde octubre de 2026.' },
  { nombre: 'Bluesky (búsqueda pública)', motivo: 'El endpoint público de búsqueda responde 403; Jetstream exige una conexión WebSocket permanente (Durable Object), fuera del plan gratuito previsto.' },
  { nombre: 'Flujos de ETF spot de BTC', motivo: 'No hay fuente gratuita con licencia clara para redistribuir; se usa EDGAR como indicio de adopción.' },
  { nombre: 'CME (futuros y opciones)', motivo: 'Datos con licencia de pago.' },
  { nombre: 'Liquidaciones agregadas', motivo: 'Solo disponibles por WebSocket o en servicios de pago.' },
  { nombre: 'ACLED', motivo: 'Licencia no comercial por defecto y acceso por OAuth con registro aprobado.' },
  { nombre: 'Geopolitical Risk Index (Caldara-Iacoviello)', motivo: 'Se publica como hoja de cálculo mensual; se usa en su lugar el índice diario EPU vía FRED y la intensidad de GDELT.' },
  { nombre: 'NYT API, Alpha Vantage, Finnhub, GNews', motivo: 'Planes gratuitos limitados a uso personal o no comercial.' },
  { nombre: 'OFAC RSS', motivo: 'Retirado por el Tesoro en 2025; se lee la página pública de acciones recientes.' },
  { nombre: 'Listas de sanciones de la UE y la ONU', motivo: 'Solo como ficheros consolidados de gran tamaño; se cubren por noticias y comunicados.' },
  { nombre: 'EIA (energía)', motivo: 'Redundante con el WTI de FRED.' },
];
