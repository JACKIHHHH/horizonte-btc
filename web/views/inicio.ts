import { S } from '../state';
import { fanChart } from '../charts';
import { ago, esc, fecha, horizonteNombre, pct, sign, usd } from '../format';
import { blocking, legal, row, snapStatus } from './common';
import { simulate } from './sim';

let horizon = 7;

function hero(): string {
  const p = S.snap?.precio;
  const ch = (S.snap as any)?.cambio24h ?? null;
  const reg = S.model?.regime;
  return `<section class="hero" aria-label="Precio actual">
    <div class="asset">Bitcoin, precio de referencia</div>
    <div class="price">${p ? usd(p.price) : '<span class="skeleton">00.000 US$</span>'}</div>
    <div class="change ${sign(ch)}">${ch != null ? `${pct(ch, 2, true)} en 24 h` : '&nbsp;'}</div>
    <div class="regime-slot">${reg ? `<div class="regime"><span class="regime-word">${esc(reg.regime)}</span><span class="muted small">${esc(reg.reason)}</span></div>` : ''}</div>
    ${p ? `<div class="tiny">Mediana de ${p.used.length} exchanges${p.discarded.length ? `; descartado${p.discarded.length > 1 ? 's' : ''} ${p.discarded.map((d: any) => d.source).join(', ')} por desviarse más de un 0,5 %` : ''}. Actualizado ${ago(S.snap!.generado)}.</div>` : ''}
  </section>`;
}

function drivers(): string {
  const snap = S.snap;
  if (!snap) return '';
  const top = snap.acontecimientos.filter((a: any) => !a.rumor).slice(0, 3);
  const idx = Object.fromEntries(snap.indices.map((i: any) => [i.key, i]));
  const dvol = snap.derivados.dvol?.valor;
  const frases: string[] = [];
  if (idx.riesgo_geopolitico?.valor != null) frases.push(`Riesgo geopolítico ${idx.riesgo_geopolitico.lectura.toLowerCase()}`);
  if (idx.tono_macro?.valor != null) frases.push(`tono macro ${idx.tono_macro.lectura.toLowerCase()}`);
  if (idx.sentimiento_social?.valor != null) frases.push(`sentimiento en ${idx.sentimiento_social.lectura.toLowerCase()}`);
  let resumen = frases.length ? frases.join(', ') + '.' : '';
  resumen = resumen.charAt(0).toUpperCase() + resumen.slice(1);
  if (dvol != null) resumen += ` Las opciones descuentan una volatilidad anual del ${dvol.toFixed(0)}\u00a0%${S.model?.regime ? `, frente al ${(S.model.regime.vol30 * 100).toFixed(0)}\u00a0% realizado en 30 días` : ''}.`;
  const contrib = (S.model?.contributions?.[horizon] ?? []).filter((c: any) => Math.abs(c.value) > 0.002).sort((a: any, b: any) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 2);
  return `<h2 class="section-title">Qué lo está moviendo</h2>
    ${resumen ? `<p class="section-note" style="margin-top:0">${esc(resumen)}</p>` : ''}
    <div class="group">
      ${top.length ? top.map((a: any) => `<div class="event"><h3><a href="${esc(a.fuentes[0]?.url)}" target="_blank" rel="noopener">${esc(a.titulo)}</a></h3>
        <div class="meta"><span>${esc(a.categoriaNombre)}</span><span>${a.nFuentes} fuente${a.nFuentes > 1 ? 's' : ''}</span><span>${ago(a.visto)}</span></div></div>`).join('')
        : '<div class="empty">Sin acontecimientos relevantes en las últimas 72 horas.</div>'}
      ${contrib.map((c: any) => row(esc(c.label), `<span class="${sign(c.value)}">${pct(c.value, 1, true)}</span>`, 'Variable del modelo de dirección', 'aporte a la mediana')).join('')}
    </div>
    <p class="tiny" style="margin-top:8px"><a href="/mundo">Ver todos los acontecimientos y sus fuentes</a></p>`;
}

function summaryTable(): string {
  const m = S.model;
  if (!m) return '';
  return `<h2 class="section-title">Todos los horizontes</h2>
    <div class="group">${[1, 7, 30, 90].map((H) => {
      const f = m.forecasts[H];
      const q = (p: number) => f.quantiles.find((x: any) => x.p === p).price;
      return row(`${horizonteNombre(H)}`, `${usd(q(0.05))} – ${usd(q(0.95))}`, `Mediana ${usd(q(0.5))}`, `Prob. de subir ${pct(f.probUp, 0)}`);
    }).join('')}</div>
    <p class="tiny" style="margin-top:8px">Rango con un 90\u00a0% de probabilidad. Calibrado con datos hasta el ${fecha(m.asOf)}. <a href="/precision">Qué modelo se usa en cada horizonte</a></p>`;
}

function calendar(): string {
  const cal = S.snap?.calendario ?? [];
  if (!cal.length) return '';
  return `<h2 class="section-title">Próximas citas que suelen mover el mercado</h2>
    <div class="group">${cal.slice(0, 5).map((c: any) => row(esc(c.evento), fecha(c.fecha))).join('')}</div>`;
}

export function renderInicio(app: HTMLElement) {
  const b = blocking();
  if (b) { app.innerHTML = b; return; }
  const m = S.model;
  app.innerHTML = `${hero()}${snapStatus()}
    <h2 class="section-title">Hacia dónde puede ir</h2>
    <div class="seg" role="group" aria-label="Horizonte">${[7, 30, 90].map((h) => `<button data-h="${h}" aria-pressed="${h === horizon}">${horizonteNombre(h)}</button>`).join('')}</div>
    <div class="panel" style="margin-top:12px">
      <div id="cone">${m ? '' : `<div class="empty">${S.modelError ? esc(S.modelError) : 'Calibrando el modelo con el histórico…'}</div>`}</div>
      <p id="cone-text" class="small" style="margin:10px 0 0"></p>
    </div>
    ${drivers()}${summaryTable()}${calendar()}${legal()}`;
  app.querySelectorAll<HTMLButtonElement>('.seg button').forEach((btn) => btn.addEventListener('click', () => { horizon = +btn.dataset.h!; renderInicio(app); }));
  if (!m) return;
  simulate(horizon).then((sim) => {
    const host = app.querySelector<HTMLElement>('#cone');
    if (!host) return;
    fanChart(host, { history: m.history, bands: sim.bands, today: m.asOf, price: m.price, label: `Cono de probabilidad a ${horizonteNombre(horizon)}` });
    const mode = m.modes[horizon];
    app.querySelector('#cone-text')!.innerHTML = `Con un 90 % de probabilidad, entre <strong>${usd(sim.p05)}</strong> y <strong>${usd(sim.p95)}</strong> dentro de ${horizonteNombre(horizon)}. Probabilidad de terminar por encima del precio actual: <strong>${pct(sim.probUp, 0)}</strong>.<br><span class="tiny">${esc(mode.motivo)}</span>`;
  });
}
