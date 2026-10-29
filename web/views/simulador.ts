import { S, getJson } from '../state';
import { PROVISIONAL_INDEX_WEIGHTS } from '../../src/model/pipeline';
import { fanChart } from '../charts';
import { esc, horizonteNombre, num, pct, usd, fecha } from '../format';
import { blocking, header, legal, row } from './common';
import { simulate } from './sim';

// Estado del simulador (se conserva entre recargas de datos)
const st = {
  horizon: 30,
  forced: {} as Record<string, boolean>,
  useMarkets: true,
  volAdj: 0, // −50..+100 (%)
  geo: null as number | null, // anulación manual del índice (−1..1)
  reg: null as number | null,
  level: null as number | null,
  saved: null as any[] | null,
};

const effectAt = (cat: string, H: number) => {
  const eh = H === 1 ? 1 : H === 7 ? 7 : 30;
  return S.model?.effects?.[eh]?.find((e: any) => e.cat === cat);
};

function activeMap(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of S.snap?.escenarios ?? []) {
    if (st.forced[s.id]) out[s.id] = 1;
    else if (st.useMarkets && s.mercado) out[s.id] = s.mercado.prob;
  }
  return out;
}

function totalExtraVol(): number {
  const w = S.indexWeights;
  const idx = Object.fromEntries((S.snap?.indices ?? []).map((i: any) => [i.key, i.valor ?? 0]));
  const geoDelta = st.geo === null ? 0 : (w.riesgo_geopolitico ?? 0) * (Math.max(0, st.geo) - Math.max(0, idx.riesgo_geopolitico ?? 0));
  const regDelta = st.reg === null ? 0 : (w.presion_regulatoria ?? 0) * (Math.max(0, st.reg) - Math.max(0, idx.presion_regulatoria ?? 0));
  // El modelo ya incorpora la lectura actual de los índices; aquí solo se suman las diferencias y el ajuste manual.
  return geoDelta + regDelta + Math.log(1 + st.volAdj / 100) * 2;
}

function scenarioRows(): string {
  const list = S.snap?.escenarios ?? [];
  return list.map((s: any) => {
    const e = effectAt(s.cat, st.horizon);
    const sg = (x: number) => `${x >= 0 ? '+' : ''}${num(x, 2)}`;
    const eff = e && e.n ? `${e.n} casos desde 2016. Reacción media ${sg(e.meanZ)} desviaciones típicas; el modelo aplica ${sg(e.shrunkZ)} y volatilidad ×${num(Math.exp(e.volLogRatio), 2)}.` : 'Sin casos históricos suficientes.';
    const mk = s.mercado ? `<span class="pill" title="${esc(s.mercado.pregunta)}">${esc(s.mercado.fuente)}: ${pct(s.mercado.prob, 0)}</span>` : '';
    return `<div class="row"><div class="label"><strong>${esc(s.titulo)}</strong> ${mk}<span class="sub">${esc(s.supuesto)}</span><span class="sub">${eff}</span>
      ${s.mercado ? `<span class="sub">Mercado emparejado: <a href="${esc(s.mercado.url)}" target="_blank" rel="noopener">${esc(s.mercado.pregunta)}</a></span>` : ''}</div>
      <label class="switch"><input type="checkbox" data-sc="${s.id}" ${st.forced[s.id] ? 'checked' : ''} aria-label="Activar escenario: ${esc(s.titulo)}"><span></span></label></div>`;
  }).join('');
}

function slider(id: string, label: string, sub: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string) {
  return `<div class="row"><div class="label"><label for="${id}">${label}</label><span class="sub">${sub}</span>
    <input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" style="width:100%;margin-top:8px;accent-color:var(--accent)"></div>
    <div class="value" id="${id}-v" style="min-width:72px">${fmt(value)}</div></div>`;
}

async function loadSaved(app: HTMLElement) {
  if (!S.me?.usuario || S.me.usuario.role === 'lector' || st.saved) return;
  try { st.saved = await getJson<any[]>('/api/escenarios-guardados'); renderSimulador(app); } catch { st.saved = []; }
}

function savedBlock(): string {
  const u = S.me?.usuario;
  if (!u) return `<p class="tiny" style="margin-top:12px">Para guardar escenarios necesitas una cuenta asignada. <a href="/cuenta">Cuenta</a></p>`;
  if (u.role === 'lector') return '';
  return `<h2 class="section-title">Tus escenarios guardados</h2>
    <div class="group">
      <div class="row"><input class="field" id="save-name" placeholder="Nombre del escenario" maxlength="80" style="flex:1"><button class="btn" id="save-btn">Guardar escenario</button></div>
      ${(st.saved ?? []).map((s) => `<div class="row"><div class="label">${esc(s.name)}<span class="sub">${fecha(s.created_at)}</span></div><button class="btn secondary" data-load="${s.id}">Cargar</button><button class="btn danger" data-del="${s.id}">Eliminar</button></div>`).join('')}
    </div>`;
}

export function renderSimulador(app: HTMLElement) {
  const b = blocking();
  if (b) { app.innerHTML = b; return; }
  const m = S.model;
  const idx = Object.fromEntries((S.snap?.indices ?? []).map((i: any) => [i.key, i.valor]));
  app.innerHTML = `${header('Simulador', 'Activa supuestos y mira cómo cambia la distribución de precios. Cada escenario aplica la reacción media que tuvo Bitcoin en episodios parecidos, ajustada por el número de casos. Las probabilidades de los mercados de predicción ponderan los escenarios que no actives a mano.')}
    <div class="seg" role="group" aria-label="Horizonte">${[1, 7, 30, 90].map((h) => `<button data-h="${h}" aria-pressed="${h === st.horizon}">${horizonteNombre(h)}</button>`).join('')}</div>
    <div class="grid-2" style="margin-top:16px">
      <div>
        <div class="panel"><div id="sim-cone">${m ? '' : `<div class="empty">${esc(S.modelError ?? 'Calibrando el modelo…')}</div>`}</div>
          <div class="row" style="padding:12px 0 0"><div class="label"><label for="level">Precio objetivo</label><span class="sub">Probabilidad de estar por encima al final del horizonte</span></div>
            <input class="field" id="level" inputmode="decimal" placeholder="${m ? Math.round(m.price * 1.1) : ''}" value="${st.level ?? ''}" style="width:120px;text-align:right"></div>
        </div>
        <div class="group" style="margin-top:16px" id="sim-results"></div>
      </div>
      <div>
        <div class="group">
          <div class="row"><div class="label"><strong>Ponderar con mercados de predicción</strong><span class="sub">Usa la probabilidad de Polymarket, Kalshi o Manifold cuando hay un mercado emparejado.</span></div>
            <label class="switch"><input type="checkbox" id="use-markets" ${st.useMarkets ? 'checked' : ''} aria-label="Ponderar con mercados de predicción"><span></span></label></div>
          ${scenarioRows()}
        </div>
        <h2 class="section-title">Supuestos de las ópticas</h2>
        <div class="group">
          ${slider('vol', 'Volatilidad esperada', 'Ajuste manual sobre la amplitud calibrada', -50, 100, 5, st.volAdj, (v) => `${v > 0 ? '+' : ''}${v} %`)}
          ${slider('geo', 'Riesgo geopolítico', `Lectura actual: ${idx.riesgo_geopolitico != null ? idx.riesgo_geopolitico.toFixed(2) : 'sin datos'}`, -1, 1, 0.05, st.geo ?? idx.riesgo_geopolitico ?? 0, (v) => v.toFixed(2))}
          ${slider('reg', 'Presión regulatoria', `Lectura actual: ${idx.presion_regulatoria != null ? idx.presion_regulatoria.toFixed(2) : 'sin datos'}`, -1, 1, 0.05, st.reg ?? idx.presion_regulatoria ?? 0, (v) => v.toFixed(2))}
          <div class="row"><button class="btn secondary" id="reset">Restablecer supuestos</button></div>
        </div>
        <p class="tiny" style="margin-top:8px">El riesgo geopolítico y la presión regulatoria solo amplían la volatilidad (no fijan dirección): con el histórico disponible no tienen un efecto direccional estable. ${S.indexWeights === PROVISIONAL_INDEX_WEIGHTS ? 'Sus pesos son provisionales hasta acumular 120 días de histórico propio.' : 'Sus pesos se han estimado con el histórico propio de la web.'}</p>
      </div>
    </div>
    ${savedBlock()}${legal()}`;

  app.querySelectorAll<HTMLButtonElement>('.seg button').forEach((x) => x.addEventListener('click', () => { st.horizon = +x.dataset.h!; renderSimulador(app); }));
  app.querySelectorAll<HTMLInputElement>('input[data-sc]').forEach((x) => x.addEventListener('change', () => { st.forced[x.dataset.sc!] = x.checked; update(app); }));
  app.querySelector<HTMLInputElement>('#use-markets')!.addEventListener('change', (e) => { st.useMarkets = (e.target as HTMLInputElement).checked; update(app); });
  const bindRange = (id: 'vol' | 'geo' | 'reg', set: (v: number) => void, fmt: (v: number) => string) => {
    const inp = app.querySelector<HTMLInputElement>('#' + id)!;
    inp.addEventListener('input', () => { set(+inp.value); app.querySelector('#' + id + '-v')!.textContent = fmt(+inp.value); });
    inp.addEventListener('change', () => update(app));
  };
  bindRange('vol', (v) => (st.volAdj = v), (v) => `${v > 0 ? '+' : ''}${v} %`);
  bindRange('geo', (v) => (st.geo = v), (v) => v.toFixed(2));
  bindRange('reg', (v) => (st.reg = v), (v) => v.toFixed(2));
  app.querySelector('#reset')!.addEventListener('click', () => { Object.assign(st, { forced: {}, useMarkets: true, volAdj: 0, geo: null, reg: null, level: null }); renderSimulador(app); });
  const lvl = app.querySelector<HTMLInputElement>('#level')!;
  lvl.addEventListener('change', () => { const v = parseFloat(lvl.value.replace(/\./g, '').replace(',', '.')); st.level = isFinite(v) && v > 0 ? v : null; update(app); });

  app.querySelector('#save-btn')?.addEventListener('click', async () => {
    const name = (app.querySelector('#save-name') as HTMLInputElement).value.trim();
    if (!name) { (app.querySelector('#save-name') as HTMLInputElement).focus(); return; }
    const { horizon, forced, useMarkets, volAdj, geo, reg, level } = st;
    await getJson('/api/escenarios-guardados', { method: 'POST', body: JSON.stringify({ name, config: { horizon, forced, useMarkets, volAdj, geo, reg, level } }) });
    st.saved = null; loadSaved(app);
  });
  app.querySelectorAll<HTMLButtonElement>('[data-load]').forEach((x) => x.addEventListener('click', () => {
    const s = st.saved?.find((y) => y.id === x.dataset.load);
    if (s) { Object.assign(st, JSON.parse(s.config)); renderSimulador(app); }
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((x) => x.addEventListener('click', async () => {
    await getJson('/api/escenarios-guardados/' + x.dataset.del, { method: 'DELETE' });
    st.saved = null; loadSaved(app);
  }));
  loadSaved(app);
  update(app);
}

async function update(app: HTMLElement) {
  const m = S.model;
  if (!m) return;
  const active = activeMap();
  const [sim, base] = await Promise.all([simulate(st.horizon, active, totalExtraVol(), st.level), simulate(st.horizon, {}, 0, st.level)]);
  const host = app.querySelector<HTMLElement>('#sim-cone');
  if (!host) return;
  fanChart(host, { history: m.history, bands: sim.bands, today: m.asOf, price: m.price, level: st.level, label: `Simulación a ${horizonteNombre(st.horizon)}` });
  const changed = Object.keys(active).length > 0 || totalExtraVol() !== 0;
  const d = (b: number) => (changed ? `<span class="sub">sin supuestos: ${usd(b)}</span>` : undefined);
  app.querySelector('#sim-results')!.innerHTML = [
    row('Mediana', usd(sim.p50), undefined, d(base.p50)),
    row('Rango del 90 %', `${usd(sim.p05)} – ${usd(sim.p95)}`, undefined, changed ? `<span class="sub">sin supuestos: ${usd(base.p05)} – ${usd(base.p95)}</span>` : undefined),
    row('Probabilidad de subir', pct(sim.probUp, 0), undefined, changed ? `<span class="sub">sin supuestos: ${pct(base.probUp, 0)}</span>` : undefined),
    st.level ? row(`Por encima de ${usd(st.level)}`, pct(sim.probAbove, 0), undefined, changed ? `<span class="sub">sin supuestos: ${pct(base.probAbove, 0)}</span>` : undefined) : '',
    row('Escenarios aplicados', String(Object.keys(active).length), Object.entries(active).map(([k, p]) => `${S.snap?.escenarios.find((s: any) => s.id === k)?.titulo} (${pct(p, 0)})`).join(', ') || 'Ninguno'),
  ].join('');
}
