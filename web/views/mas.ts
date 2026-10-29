import { S } from '../state';
import { esc } from '../format';
import { header } from './common';

export function renderMas(app: HTMLElement) {
  const u = S.me?.usuario;
  app.innerHTML = `${header('Datos y cuenta')}
    <div class="group">
      <a class="row link" href="/precision"><span class="label">Precisión<span class="sub">Backtest y registro de previsiones</span></span><span class="chev" aria-hidden="true">›</span></a>
      <a class="row link" href="/fuentes"><span class="label">Fuentes y metodología<span class="sub">Estado y licencia de cada fuente</span></span><span class="chev" aria-hidden="true">›</span></a>
      ${u?.role === 'admin' ? '<a class="row link" href="/admin"><span class="label">Administración<span class="sub">Suscriptores, pagos y datos</span></span><span class="chev" aria-hidden="true">›</span></a>' : ''}
      <a class="row link" href="/suscripcion"><span class="label">Suscripción<span class="sub">Estado y forma de pago</span></span><span class="chev" aria-hidden="true">›</span></a>
      <a class="row link" href="/cuenta"><span class="label">Cuenta<span class="sub">${u ? esc(u.email) : 'Entrar'}</span></span><span class="chev" aria-hidden="true">›</span></a>
    </div>`;
}
