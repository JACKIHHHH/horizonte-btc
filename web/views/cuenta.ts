import { S } from '../state';
import { esc, fecha } from '../format';
import { header, legal } from './common';

const ROLE: Record<string, string> = { admin: 'Administrador', analista: 'Analista', lector: 'Lector' };
const ESTADO: Record<string, string> = { admin: 'Sin caducidad', activo: 'Suscripción activa', prueba: 'Prueba gratuita', caducado: 'Caducada', bloqueado: 'Bloqueada' };

export function renderCuenta(app: HTMLElement) {
  const me = S.me;
  const u = me?.usuario;
  let body = '';
  if (!me) body = '<div class="empty">Cargando…</div>';
  else if (!me.accesoConfigurado && !u) body = '<div class="notice">El inicio de sesión todavía no está configurado.</div>';
  else if (!me.email) {
    body = `<div class="group"><div class="row"><div class="label">Entra con tu correo<span class="sub">Recibirás un código de un solo uso. No hace falta contraseña.${me.modo === 'suscripcion' ? ` La primera vez empiezas ${me.pago.pruebaDias} días de prueba gratis.` : ''}</span></div><a class="btn" href="/entrar">Entrar</a></div></div>`;
  } else {
    body = `<div class="group">
      <div class="row"><div class="label">Correo</div><div class="value">${esc(me.email)}</div></div>
      <div class="row"><div class="label">Rol</div><div class="value">${u ? ROLE[u.role] : 'Sin asignar'}</div></div>
      ${u && me.modo === 'suscripcion' ? `<a class="row link" href="/suscripcion"><span class="label">Suscripción<span class="sub">${ESTADO[u.estado]}${u.hasta && u.estado !== 'admin' ? `, hasta el ${fecha(u.hasta)}` : ''}</span></span><span class="chev" aria-hidden="true">›</span></a>` : ''}
      ${u?.role === 'admin' ? '<a class="row link" href="/admin"><span class="label">Administración<span class="sub">Suscriptores, pagos, roles y datos</span></span><span class="chev" aria-hidden="true">›</span></a>' : ''}
      ${u ? '' : '<div class="row"><div class="label"><span class="sub">Tu correo no está asignado. Pide acceso a un administrador.</span></div></div>'}
      <div class="row"><a href="/cdn-cgi/access/logout">Salir</a></div>
    </div>`;
  }
  app.innerHTML = `${header('Cuenta')}${body}${legal()}`;
}
