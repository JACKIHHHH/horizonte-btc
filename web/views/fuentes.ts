import { S } from '../state';
import { ago, esc } from '../format';
import { blocking, header, legal, snapStatus } from './common';

const OPTICA: Record<string, string> = {
  mercado: 'Precio y volumen', derivados: 'Derivados', onchain: 'On-chain', liquidez: 'Liquidez', macro: 'Macro y bancos centrales',
  geopolitica: 'Geopolítica', regulacion: 'Regulación', noticias: 'Noticias', sentimiento: 'Sentimiento social', prediccion: 'Mercados de predicción',
};
const ESTADO: Record<string, [string, string]> = {
  ok: ['ok', 'Activa'], caido: ['bad', 'Sin respuesta'], sin_clave: ['warn', 'Falta clave'], sin_licencia: ['', 'Desactivada por licencia'], pendiente: ['', 'Pendiente'],
};
const LICENCIA: Record<string, [string, string]> = { apta: ['ok', 'Apta'], verificar: ['warn', 'Verificar'], 'no-comercial': ['bad', 'No comercial'] };

// La lista de descartadas viene del registro de conectores (mismo texto que en el servidor)
import { DESCARTADAS } from '../../src/worker/connectors/descartadas';

export function renderFuentes(app: HTMLElement) {
  const b = blocking();
  if (b) { app.innerHTML = b; return; }
  const f = S.snap?.fuentes ?? [];
  const count = (e: string) => f.filter((x: any) => x.estado === e).length;
  const groups = Object.keys(OPTICA).map((o) => [o, f.filter((x: any) => x.optica === o)] as const).filter(([, l]) => l.length);
  app.innerHTML = `${header('Fuentes y metodología', `${f.length} fuentes conectadas, de ${groups.length} tipos. Cada dato que ves en la web indica de dónde sale y cuándo se obtuvo.`)}
    ${snapStatus()}
    <div class="group">
      <div class="row"><div class="label">Activas</div><div class="value">${count('ok')}</div></div>
      <div class="row"><div class="label">Sin respuesta en el último intento</div><div class="value">${count('caido')}</div></div>
      <div class="row"><div class="label">Pendientes de clave gratuita</div><div class="value">${count('sin_clave')}</div></div>
      <div class="row"><div class="label">Desactivadas por licencia no comercial</div><div class="value">${count('sin_licencia')}</div></div>
    </div>
    ${groups.map(([o, list]) => `<h2 class="section-title">${OPTICA[o]}</h2><div class="group">${list.map((x: any) => {
      const [ec, el] = ESTADO[x.estado] ?? ['', x.estado];
      const [lc, ll] = LICENCIA[x.licencia.estado];
      return `<div class="row"><div class="label"><a href="${esc(x.web)}" target="_blank" rel="noopener">${esc(x.nombre)}</a>
        <span class="sub">${esc(x.licencia.nota)}</span>
        <span class="sub">Cada ${esc(x.frecuencia)}. Último dato correcto: ${ago(x.ultimoOk)}${x.error && x.estado !== 'ok' ? `. ${esc(x.error)}` : ''}</span></div>
        <div class="value" style="display:grid;gap:4px;justify-items:end"><span class="pill ${ec}">${el}</span><span class="pill ${lc}">${ll}</span></div></div>`;
    }).join('')}</div>`).join('')}

    <h2 class="section-title">Fuentes valoradas y descartadas</h2>
    <div class="group">${DESCARTADAS.map((d) => `<div class="row"><div class="label">${esc(d.nombre)}<span class="sub">${esc(d.motivo)}</span></div></div>`).join('')}</div>

    <h2 class="section-title">Metodología</h2>
    <div class="panel small" style="display:grid;gap:12px;max-width:72ch">
      <p style="margin:0"><strong>Precio de referencia.</strong> Mediana de los exchanges que responden en los últimos 20 minutos. Se descarta cualquier cotización que se aleje más de un 0,5 % de la mediana. Las cotizaciones en USDT se tratan como dólares.</p>
      <p style="margin:0"><strong>Amplitud.</strong> Un GARCH(1,1) con colas gruesas (t de Student) estima la volatilidad diaria con hasta seis años de datos. Se combina con la volatilidad histórica de un año y se ajusta con la volatilidad implícita de las opciones (DVOL), el VIX y el índice de incertidumbre de política económica. La mezcla se elige por validación temporal.</p>
      <p style="margin:0"><strong>Dirección.</strong> Una regresión ridge con momentum, tendencia, stablecoins, liquidez de la Fed, dólar, tipos reales, Nasdaq, Fear &amp; Greed, atención en Wikipedia y hash ribbons. Si en la validación no mejora a no predecir dirección, se desactiva. Las variables usan su retardo real de publicación.</p>
      <p style="margin:0"><strong>Acontecimientos.</strong> Titulares de ${f.filter((x: any) => ['noticias', 'regulacion', 'geopolitica'].includes(x.optica)).length} fuentes y de GDELT. Se clasifican por léxico (español e inglés) y, si no hay coincidencia, por similitud semántica con Workers AI. Las noticias que cuentan lo mismo se agrupan; la fiabilidad combina la de cada fuente y los rumores sin confirmar pesan un 70 % menos.</p>
      <p style="margin:0"><strong>Escenarios.</strong> Cada supuesto aplica la reacción media de BTC a episodios históricos de ese tipo, en desviaciones típicas, contraída hacia cero según el número de casos. Los mercados de predicción dan la probabilidad de que ocurra cuando hay un mercado emparejado; la pregunta exacta se muestra siempre.</p>
      <p style="margin:0"><strong>Validación.</strong> Backtest walk-forward desde 2018 sin datos futuros, con cobertura de los intervalos, CRPS, Brier y ablación por grupos de variables. Además, cada previsión diaria queda registrada y se comprueba al vencer.</p>
      <p style="margin:0"><strong>Limitaciones.</strong> Los precios de BTC están dominados por movimientos difíciles de anticipar: es normal que ningún modelo mejore al paseo aleatorio en la dirección. La amplitud sí se puede estimar con cierta fiabilidad. Las noticias solo cuentan desde su hora de publicación y su efecto medio es pequeño salvo en grandes sucesos.</p>
    </div>
    ${legal()}`;
}
