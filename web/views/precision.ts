import { S, callModel, getJson } from '../state';
import { histogram } from '../charts';
import { esc, fecha, horizonteNombre, num, pct, usd } from '../format';
import { MODE_LABEL } from '../../src/model/engine';
import type { BacktestResult } from '../../src/model/backtest';
import { blocking, header, legal } from './common';

let local: BacktestResult | null = null;
let running = false;
let progress = 0;
let log: any[] | null = null;

function btTable(bt: BacktestResult): string {
  const naive = bt.variants.find((v) => v.id === 'ingenuo')!;
  return [1, 7, 30, 90].map((H) => {
    const best = [...bt.variants].sort((a, b) => a.scores[H].crps - b.scores[H].crps)[0];
    return `<h3 style="font-size:16px;margin:24px 0 8px">${horizonteNombre(H)}</h3>
    <div class="panel scroll-x"><table class="data"><thead><tr><th>Modelo</th><th class="num">Cobertura 90 %</th><th class="num">Cobertura 50 %</th><th class="num">CRPS frente al ingenuo</th><th class="num">Brier (dirección)</th></tr></thead><tbody>
    ${bt.variants.map((v) => {
      const s = v.scores[H];
      const skill = 1 - s.crps / naive.scores[H].crps;
      const off90 = Math.abs(s.cov90 - 0.9) > 0.04, off50 = Math.abs(s.cov50 - 0.5) > 0.06;
      return `<tr><td>${esc(v.label)}${v.id === best.id ? ' <span class="pill ok">Mejor</span>' : ''}</td>
        <td class="num ${off90 ? 'down' : ''}">${pct(s.cov90, 0)}</td><td class="num ${off50 ? 'down' : ''}">${pct(s.cov50, 0)}</td>
        <td class="num ${skill > 0.002 ? 'up' : skill < -0.002 ? 'down' : ''}">${v.id === 'ingenuo' ? 'referencia' : pct(skill, 1, true)}</td>
        <td class="num ${s.brier < 0.2495 ? 'up' : s.brier > 0.2505 ? 'down' : ''}">${num(s.brier, 3)}</td></tr>`;
    }).join('')}</tbody></table></div>`;
  }).join('');
}

function ablation(bt: BacktestResult): string {
  return `<div class="panel scroll-x"><table class="data"><thead><tr><th>Grupo de variables de dirección</th>${[1, 7, 30, 90].map((H) => `<th class="num">${horizonteNombre(H)}</th>`).join('')}</tr></thead><tbody>
    ${bt.ablation.map((a) => `<tr><td>${esc(a.label)}</td>${[1, 7, 30, 90].map((H) => { const d = a.delta[H]; const ref = bt.variants.find((v) => v.id === 'ingenuo')!.scores[H].crps; const rel = d / ref; return `<td class="num ${rel > 0.001 ? 'up' : rel < -0.001 ? 'down' : ''}">${Math.abs(rel) < 0.0005 ? 'sin efecto' : pct(rel, 2, true)}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div>
  <p class="tiny" style="margin-top:8px">Positivo: quitar el grupo empeora la previsión (el grupo aporta). Negativo: el modelo mejora sin él. "Sin efecto" suele indicar que no hay datos de ese grupo en el periodo.</p>`;
}

function liveLog(): string {
  if (!log) return '<div class="empty">Cargando registro…</div>';
  const done = log.filter((f) => f.realized != null);
  if (!log.length) return '<div class="empty">Aún no hay previsiones publicadas. El calibrador diario las registra aquí y se comprueban al vencer.</div>';
  const byH = [1, 7, 30, 90].map((H) => { const d = done.filter((f) => f.horizon === H); const inside = d.filter((f) => f.realized >= f.p05 && f.realized <= f.p95).length; return { H, n: d.length, cov: d.length ? inside / d.length : null }; });
  return `<div class="group">${byH.map((x) => `<div class="row"><div class="label">${horizonteNombre(x.H)}<span class="sub">${x.n} previsiones vencidas</span></div><div class="value">${x.cov == null ? '—' : pct(x.cov, 0)}<span class="sub">dentro del rango del 90 %</span></div></div>`).join('')}</div>
  <div class="panel scroll-x" style="margin-top:16px"><table class="data"><thead><tr><th>Fecha</th><th>Horizonte</th><th class="num">Rango 90 %</th><th class="num">Mediana</th><th class="num">Real</th><th>Resultado</th></tr></thead><tbody>
  ${log.slice(0, 60).map((f) => `<tr><td>${fecha(f.made_on)}</td><td>${horizonteNombre(f.horizon)}</td><td class="num">${usd(f.p05)} – ${usd(f.p95)}</td><td class="num">${usd(f.p50)}</td><td class="num">${f.realized == null ? '—' : usd(f.realized)}</td>
    <td>${f.realized == null ? `<span class="pill">Vence el ${fecha(f.due_on)}</span>` : f.realized >= f.p05 && f.realized <= f.p95 ? '<span class="pill ok">Dentro</span>' : '<span class="pill bad">Fuera</span>'}</td></tr>`).join('')}
  </tbody></table></div>`;
}

export function renderPrecision(app: HTMLElement) {
  const b = blocking();
  if (b) { app.innerHTML = b; return; }
  const pub = S.backtest;
  const bt = local ?? pub?.datos ?? null;
  const modes = S.model?.modes;
  app.innerHTML = `${header('Precisión', 'Cómo de bien habría funcionado el modelo en el pasado, usando en cada día solo la información disponible ese día. Si un componente no mejora a la referencia ingenua, la web lo desactiva para ese horizonte.')}
    ${modes ? `<h2 class="section-title">Modelo en uso por horizonte</h2><div class="group">${[1, 7, 30, 90].map((H) => `<div class="row"><div class="label">${horizonteNombre(H)}<span class="sub">${esc(modes[H].motivo)}</span></div><div class="value">${esc(MODE_LABEL[modes[H].mode as keyof typeof MODE_LABEL])}</div></div>`).join('')}</div>` : ''}

    <h2 class="section-title">Backtest</h2>
    ${bt ? `<p class="section-note">${local ? 'Resultado calculado en tu navegador' : `Publicado ${fecha(pub!.actualizado)}`}. Periodo ${fecha(bt.from)} – ${fecha(bt.to)}, reajuste cada ${bt.refitDays} días. Cobertura ideal: 90 % y 50 %. CRPS mide el error de toda la distribución (menor es mejor); el Brier de 0,250 equivale a acertar la dirección al azar.</p>${btTable(bt)}
      <h2 class="section-title">Calibración del modelo completo</h2>
      <p class="section-note">Distribución de la posición del precio real dentro de la previsión (PIT). Si el modelo está bien calibrado, las barras quedan a la altura de la línea discontinua.</p>
      <div class="grid-2">${[1, 7, 30, 90].map((H) => `<div class="panel"><div class="small" style="margin-bottom:6px">${horizonteNombre(H)}</div><div id="pit-${H}"></div></div>`).join('')}</div>
      <h2 class="section-title">Qué aporta cada grupo de variables</h2>${ablation(bt)}`
      : '<div class="empty">Todavía no hay backtest publicado.</div>'}
    <div class="row" style="padding:16px 0">
      <div class="label">Reproducir el backtest en tu navegador<span class="sub">Recalcula todo con los datos de la web; tarda alrededor de un minuto.</span></div>
      <button class="btn secondary" id="run-bt" ${running || !S.model ? 'disabled' : ''}>${running ? 'Calculando…' : 'Reproducir'}</button>
    </div>
    ${running ? `<div class="progress" aria-label="Progreso"><i style="width:${progress * 100}%"></i></div>` : ''}

    <h2 class="section-title">Registro público de previsiones</h2>
    <p class="section-note">Cada día se guarda la previsión con su fecha y se contrasta con el precio real cuando vence.</p>
    ${liveLog()}
    ${legal()}`;
  if (bt) {
    const full = bt.variants.find((v) => v.id === 'completo');
    if (full) for (const H of [1, 7, 30, 90]) histogram(app.querySelector(`#pit-${H}`)!, full.scores[H].pit, `Histograma PIT a ${horizonteNombre(H)}`);
  }
  app.querySelector('#run-bt')?.addEventListener('click', async () => {
    running = true; progress = 0; renderPrecision(app);
    try {
      local = await callModel<BacktestResult>('backtest', {}, (p) => {
        progress = p;
        const bar = app.querySelector<HTMLElement>('.progress i');
        if (bar) bar.style.width = `${p * 100}%`;
      });
    } finally { running = false; renderPrecision(app); }
  });
  if (!log) getJson<any[]>('/api/previsiones').then((r) => { log = r; renderPrecision(app); }).catch(() => { log = []; });
}
