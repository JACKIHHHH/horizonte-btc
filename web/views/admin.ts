import { S, getJson } from '../state';
import { ago, esc, fecha } from '../format';
import { header, legal } from './common';

const ROLE: Record<string, string> = { admin: 'Administrador', analista: 'Analista', lector: 'Lector' };
const ESTADO: Record<string, [string, string]> = {
  admin: ['info', 'Administrador'], activo: ['ok', 'Activo'], prueba: ['warn', 'En prueba'], caducado: ['bad', 'Caducado'], bloqueado: ['', 'Bloqueado'],
};
const FILTROS: [string, string][] = [['todos', 'Todos'], ['aviso', 'Pago avisado'], ['prueba', 'En prueba'], ['activo', 'Activos'], ['caducado', 'Caducados'], ['bloqueado', 'Bloqueados']];

let data: any = null, pagos: any[] | null = null, auditLog: any[] | null = null, estado: any = null;
let filtro = 'todos', busca = '', msg = '';

async function load(app: HTMLElement) {
  try {
    [data, pagos, auditLog, estado] = await Promise.all([
      getJson<any>('/api/admin/suscriptores'), getJson<any[]>('/api/admin/pagos'), getJson<any[]>('/api/admin/auditoria'), getJson<any>('/api/admin/estado'),
    ]);
  } catch (e) { msg = (e as Error).message; }
  renderAdmin(app);
}
const reload = (app: HTMLElement) => { data = null; load(app); };
const eur = (x: number) => (x ?? 0).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

function vence(u: any): string {
  if (u.estado === 'admin') return 'Sin caducidad';
  if (u.estado === 'bloqueado') return 'Bloqueado';
  if (!u.hasta) return '—';
  return u.diasRestantes > 0 ? `${fecha(u.hasta)} (${u.diasRestantes} d)` : `Caducó el ${fecha(u.hasta)}`;
}

export function renderAdmin(app: HTMLElement) {
  const u = S.me?.usuario;
  if (!u || u.role !== 'admin') { app.innerHTML = `${header('Administración')}<div class="empty">Solo para administradores.</div>`; return; }
  if (!data) {
    app.innerHTML = `${header('Administración')}<div class="empty">${msg ? esc(msg) : 'Cargando…'}</div>`;
    if (!msg) load(app);
    return;
  }
  const users: any[] = data.usuarios;
  const count = (e: string) => users.filter((x) => x.estado === e).length;
  const list = users.filter((x) => (filtro === 'todos' || x.estado === filtro || (filtro === 'aviso' && x.pay_claim_at)) && (!busca || `${x.email} ${x.name ?? ''}`.toLowerCase().includes(busca)));
  const me = u.email;
  app.innerHTML = `${header('Administración', `Prueba gratuita de ${data.prueba} días; después, ${eur(data.precio)} al año. Las cuentas caducadas no ven los datos hasta que registres su pago.`)}
    ${msg ? `<div class="notice" role="status">${esc(msg)}</div>` : ''}
    <div class="group">
      <div class="row"><div class="label">En prueba</div><div class="value">${count('prueba')}</div></div>
      <div class="row"><div class="label">Suscripciones activas</div><div class="value">${count('activo')}</div></div>
      <div class="row"><div class="label">Caducadas, pendientes de pago</div><div class="value">${count('caducado')}</div></div>
      <div class="row"><div class="label">Avisos de pago por comprobar</div><div class="value">${users.filter((x) => x.pay_claim_at).length}</div></div>
      <div class="row"><div class="label">Ingresos registrados</div><div class="value">${eur(data.ingresos.total)}<span class="sub">${data.ingresos.n} pagos</span></div></div>
    </div>

    <h2 class="section-title">Suscriptores</h2>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
      <div class="seg" role="group" aria-label="Filtrar">${FILTROS.map(([id, n]) => `<button data-f="${id}" aria-pressed="${id === filtro}">${n}</button>`).join('')}</div>
      <input class="field" id="busca" placeholder="Buscar por correo o nombre" value="${esc(busca)}" style="flex:1 1 200px" aria-label="Buscar suscriptor">
    </div>
    <div class="group" style="margin-top:12px">
      ${list.map((x) => {
        const [pc, pl] = ESTADO[x.estado];
        const self = x.email === me;
        return `<div class="row" style="flex-wrap:wrap;align-items:flex-start">
          <div class="label" style="flex:1 1 240px">${esc(x.name ? `${x.name} (${x.email})` : x.email)} <span class="pill ${pc}">${pl}</span>
            <span class="sub">Vence: ${vence(x)}. Último acceso: ${ago(x.last_seen)}. Alta ${fecha(x.created_at)}${x.created_by ? ` (${esc(x.created_by)})` : ''}. Pagos: ${x.pagos} (${eur(x.total)})</span>
            ${x.pay_claim_at ? `<span class="sub"><span class="pill warn">Pago avisado</span> ${ago(x.pay_claim_at)}: pagó como «${esc(x.pay_claim)}». Compruébalo en PayPal y registra el pago.</span>` : ''}
            ${x.notes ? `<span class="sub">Nota: ${esc(x.notes)}</span>` : ''}</div>
          ${self ? '<span class="tiny">Tú</span>' : `<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:flex-end">
            <button class="btn small-btn" data-pago="${esc(x.email)}">Registrar pago (+1 año)</button>
            <button class="btn secondary small-btn" data-ampliar="${esc(x.email)}">+30 días de prueba</button>
            <button class="btn secondary small-btn" data-nota="${esc(x.email)}">Nota</button>
            <select class="field small-btn" data-role="${esc(x.email)}" aria-label="Rol de ${esc(x.email)}">${Object.keys(ROLE).map((r) => `<option value="${r}" ${x.role === r ? 'selected' : ''}>${ROLE[r]}</option>`).join('')}</select>
            <button class="btn secondary small-btn" data-active="${esc(x.email)}" data-v="${x.active ? 0 : 1}">${x.active ? 'Bloquear' : 'Desbloquear'}</button>
            <button class="btn danger small-btn" data-del="${esc(x.email)}">Eliminar</button></div>`}
        </div>`;
      }).join('') || '<div class="empty">No hay suscriptores con este filtro.</div>'}
    </div>

    <h2 class="section-title">Dar de alta a mano</h2>
    <form class="group" id="add-user">
      <div class="row" style="flex-wrap:wrap">
        <input class="field" name="email" type="email" required placeholder="correo@ejemplo.com" aria-label="Correo" style="flex:2 1 200px">
        <input class="field" name="name" placeholder="Nombre (opcional)" aria-label="Nombre" style="flex:1 1 140px">
        <select class="field" name="role" aria-label="Rol"><option value="lector">Lector</option><option value="analista">Analista</option><option value="admin">Administrador</option></select>
        <button class="btn" type="submit">Dar de alta con prueba</button>
      </div>
    </form>
    <p class="tiny" style="margin-top:8px">Quien entra por primera vez con su correo recibe la prueba automáticamente; el alta a mano sirve para invitar o para fijar el rol antes.</p>

    <h2 class="section-title">Últimos pagos</h2>
    <div class="panel scroll-x"><table class="data"><thead><tr><th>Fecha</th><th>Usuario</th><th class="num">Importe</th><th>Periodo</th><th>Referencia</th></tr></thead><tbody>
      ${(pagos ?? []).slice(0, 50).map((p) => `<tr><td>${fecha(p.created_at)}</td><td>${esc(p.email)}</td><td class="num">${eur(p.amount)}</td><td>${fecha(p.period_from)} – ${fecha(p.period_to)}</td><td>${esc(p.reference ?? '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Sin pagos registrados.</td></tr>'}
    </tbody></table></div>

    <h2 class="section-title">Datos</h2>
    <div class="group">
      <div class="row"><div class="label">Carga del histórico<span class="sub">${estado?.historico ? (estado.historico.done ? 'Completada' : `En curso, paso ${estado.historico.job + 1}`) : 'Sin iniciar'}</span></div><button class="btn secondary" id="reload-hist">Recargar histórico</button></div>
      <div class="row"><div class="label">Ciclo de ingesta<span class="sub">${estado ? `${estado.items} noticias (${estado.pendientes} pendientes), ${estado.acontecimientos} acontecimientos, ${estado.previsiones} previsiones` : ''}</span></div><button class="btn secondary" id="run-now">Ejecutar ahora</button></div>
    </div>

    <h2 class="section-title">Actividad de administración</h2>
    <div class="group">${(auditLog ?? []).slice(0, 40).map((a) => `<div class="row"><div class="label">${esc(a.action.replace(/_/g, ' '))}<span class="sub">${esc(a.actor)}, ${ago(a.at)}</span></div><div class="value tiny" style="white-space:normal;max-width:50%;text-align:left">${esc(a.detail)}</div></div>`).join('') || '<div class="empty">Sin actividad.</div>'}</div>
    ${legal()}`;

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); msg = ok; } catch (e) { msg = (e as Error).message; } reload(app); };
  app.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => b.addEventListener('click', () => { filtro = b.dataset.f!; renderAdmin(app); }));
  const bq = app.querySelector<HTMLInputElement>('#busca')!;
  bq.addEventListener('change', () => { busca = bq.value.trim().toLowerCase(); renderAdmin(app); });
  const enc = encodeURIComponent;
  app.querySelectorAll<HTMLButtonElement>('[data-pago]').forEach((b) => b.addEventListener('click', () => {
    const ref = prompt(`Pago de ${b.dataset.pago}: referencia o ID de la transacción de PayPal (opcional)`, users.find((x) => x.email === b.dataset.pago)?.pay_claim ?? '');
    if (ref === null) return;
    act(() => getJson(`/api/admin/suscriptores/${enc(b.dataset.pago!)}/pago`, { method: 'POST', body: JSON.stringify({ referencia: ref }) }), `Pago registrado: ${b.dataset.pago} tiene un año más.`);
  }));
  app.querySelectorAll<HTMLButtonElement>('[data-ampliar]').forEach((b) => b.addEventListener('click', () =>
    act(() => getJson(`/api/admin/suscriptores/${enc(b.dataset.ampliar!)}/ampliar`, { method: 'POST', body: JSON.stringify({ dias: 30 }) }), `Prueba ampliada 30 días: ${b.dataset.ampliar}.`)));
  app.querySelectorAll<HTMLButtonElement>('[data-nota]').forEach((b) => b.addEventListener('click', () => {
    const nota = prompt(`Nota para ${b.dataset.nota}`);
    if (nota === null) return;
    act(() => getJson(`/api/admin/suscriptores/${enc(b.dataset.nota!)}/nota`, { method: 'POST', body: JSON.stringify({ nota }) }), 'Nota guardada.');
  }));
  app.querySelectorAll('[data-role]').forEach((el) => {
    const s = el as unknown as { value: string; dataset: DOMStringMap; addEventListener: HTMLElement['addEventListener'] };
    s.addEventListener('change', () => act(() => getJson(`/api/admin/usuarios/${enc(s.dataset.role!)}`, { method: 'PATCH', body: JSON.stringify({ role: s.value }) }), 'Rol actualizado.'));
  });
  app.querySelectorAll<HTMLButtonElement>('[data-active]').forEach((b) => b.addEventListener('click', () =>
    act(() => getJson(`/api/admin/usuarios/${enc(b.dataset.active!)}`, { method: 'PATCH', body: JSON.stringify({ active: b.dataset.v === '1' }) }), b.dataset.v === '1' ? 'Cuenta desbloqueada.' : 'Cuenta bloqueada.')));
  app.querySelectorAll<HTMLButtonElement>('[data-del]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm(`¿Eliminar a ${b.dataset.del}? Se borrarán también sus escenarios guardados. Sus pagos quedan en el registro.`)) return;
    act(() => getJson(`/api/admin/usuarios/${enc(b.dataset.del!)}`, { method: 'DELETE' }), 'Usuario eliminado.');
  }));
  app.querySelector<HTMLFormElement>('#add-user')!.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = Object.fromEntries(new FormData(e.target as HTMLFormElement));
    act(() => getJson('/api/admin/usuarios', { method: 'POST', body: JSON.stringify(fd) }), `Alta hecha: ${fd.email}.`);
  });
  app.querySelector('#reload-hist')!.addEventListener('click', () => act(() => getJson('/api/admin/recargar-historico', { method: 'POST' }), 'La carga del histórico empezará en el próximo ciclo.'));
  app.querySelector('#run-now')!.addEventListener('click', (e) => {
    const b = e.target as HTMLButtonElement; b.disabled = true; b.textContent = 'Ejecutando…';
    act(async () => { const r: any = await getJson('/api/admin/ejecutar', { method: 'POST' }); msg = `Ciclo en ${r.ms} ms.`; return r; }, 'Ciclo completado.');
  });
}
