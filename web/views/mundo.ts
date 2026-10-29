import { S } from '../state';
import { dbar, worldMap } from '../charts';
import { ago, esc, num, pct } from '../format';
import { blocking, header, legal, snapStatus } from './common';

const FILTERS: [string, string, string[] | null][] = [
  ['todo', 'Todo', null],
  ['geo', 'Geopolítica', ['conflicto', 'sanciones', 'desastre', 'cortes_internet', 'elecciones', 'energia']],
  ['monetaria', 'Monetaria y macro', ['politica_monetaria', 'datos_macro', 'crisis_bancaria', 'aranceles']],
  ['regulacion', 'Regulación', ['regulacion']],
  ['cripto', 'Cripto', ['mercado_cripto', 'hackeo', 'adopcion', 'tecnologia_btc']],
];
let filter = 'todo';

// Categoría del acontecimiento → categoría del estudio de eventos
const EVENT_CAT: Record<string, string> = {
  conflicto: 'conflicto', hackeo: 'hackeo_quiebra', crisis_bancaria: 'crisis_bancaria', aranceles: 'aranceles',
};

function indexRows(): string {
  return (S.snap?.indices ?? []).map((i: any) => `<details class="row" style="display:block">
    <summary style="display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none">
      <span class="label"><strong>${esc(i.nombre)}</strong><span class="sub">${esc(i.lectura)}, ${esc(i.signo)}</span></span>
      ${dbar(i.valor)}<span class="value" style="min-width:44px">${i.valor == null ? '—' : num(i.valor, 2)}</span>
    </summary>
    <table class="data" style="margin-top:8px"><thead><tr><th>Componente</th><th class="num">Valor</th><th class="num">Aporte</th></tr></thead><tbody>
      ${i.componentes.map((c: any) => `<tr><td>${esc(c.nombre)}<br><span class="tiny">${esc(c.fuente)}</span></td><td class="num">${c.detalle ? esc(c.detalle) : c.valor == null ? 'sin datos' : num(c.valor, 2)}</td><td class="num">${c.valor == null ? '—' : num(c.aporte, 2)}</td></tr>`).join('')}
    </tbody></table></details>`).join('');
}

function eventList(): string {
  const cats = FILTERS.find((f) => f[0] === filter)![2];
  const list = (S.snap?.acontecimientos ?? []).filter((a: any) => !cats || cats.includes(a.categoria));
  if (!list.length) return '<div class="empty">No hay acontecimientos en esta categoría en las últimas 72 horas.</div>';
  return list.map((a: any) => {
    const ec = EVENT_CAT[a.categoria];
    const eff = ec ? S.model?.effects?.[7]?.find((e: any) => e.cat === ec) : null;
    return `<article class="event">
      <h3>${esc(a.titulo)}</h3>
      <div class="meta"><span>${esc(a.categoriaNombre)}</span><span>${ago(a.visto)}</span><span>Fiabilidad ${pct(a.fiabilidad, 0)}</span>
        ${a.rumor ? '<span class="pill warn">Sin confirmar</span>' : ''}${a.paises.length ? `<span>${esc(a.paises.join(', '))}</span>` : ''}</div>
      <div class="srcs">${a.fuentes.map((f: any) => `<a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.nombre)}</a>`).join('')}</div>
      ${eff && eff.n ? `<div class="tiny" style="margin-top:6px">Impacto estimado: en ${eff.n} episodios parecidos, BTC se movió de media ${eff.meanZ >= 0 ? '+' : ''}${num(eff.meanZ, 2)} desviaciones típicas en 7 días.</div>` : ''}
    </article>`;
  }).join('');
}

export function renderMundo(app: HTMLElement) {
  const b = blocking();
  if (b) { app.innerHTML = b; return; }
  const snap = S.snap;
  app.innerHTML = `${header('El mundo', 'Lo que pasa fuera del mercado, convertido en índices medibles. Cada noticia se agrupa con las que cuentan lo mismo; un acontecimiento gana peso si lo confirman varias fuentes independientes y lo pierde con el tiempo.')}
    ${snapStatus()}
    <div class="group">${indexRows()}</div>
    <h2 class="section-title">Dónde se concentra</h2>
    <p class="section-note">Intensidad de acontecimientos por país en las últimas 72 horas, ponderada por fiabilidad y difusión.</p>
    <div class="panel"><div id="map"></div></div>
    <h2 class="section-title">Acontecimientos</h2>
    <div class="seg" role="group" aria-label="Filtrar por categoría" style="flex-wrap:wrap">${FILTERS.map(([id, n]) => `<button data-f="${id}" aria-pressed="${id === filter}">${n}</button>`).join('')}</div>
    <div class="group" style="margin-top:12px">${eventList()}</div>
    ${snap?.mercadosPrediccion?.length ? `<h2 class="section-title">Qué descuentan los mercados de predicción</h2>
      <div class="group">${snap.mercadosPrediccion.map((mk: any) => `<div class="row"><div class="label"><a href="${esc(mk.url)}" target="_blank" rel="noopener">${esc(mk.pregunta)}</a><span class="sub">${esc(mk.fuente)}</span></div><div class="value">${pct(mk.prob, 0)}</div></div>`).join('')}</div>` : ''}
    ${legal()}`;
  app.querySelectorAll<HTMLButtonElement>('.seg button').forEach((x) => x.addEventListener('click', () => { filter = x.dataset.f!; renderMundo(app); }));
  if (snap) worldMap(app.querySelector('#map')!, snap.mapa);
}
