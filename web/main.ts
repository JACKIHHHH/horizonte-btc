import { S, loadAll, refreshSnap } from './state';
import { esc } from './format';
import { renderInicio } from './views/inicio';
import { renderSimulador } from './views/simulador';
import { renderMundo } from './views/mundo';
import { renderOpticas } from './views/opticas';
import { renderPrecision } from './views/precision';
import { renderFuentes } from './views/fuentes';
import { renderCuenta } from './views/cuenta';
import { renderMas } from './views/mas';
import { renderAdmin } from './views/admin';
import { bannerHtml, renderBienvenida, renderCaducada, renderSuscripcion } from './views/suscripcion';
import { puedeVer } from './state';

const ICON: Record<string, string> = {
  inicio: '<path d="M4 18c4.5-.3 8-3 8-9 0 6 3.5 8.7 8 9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  simulador: '<path d="M5 7h14M5 12h14M5 17h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="7" r="2" fill="var(--surface)" stroke="currentColor" stroke-width="1.8"/><circle cx="15" cy="12" r="2" fill="var(--surface)" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2" fill="var(--surface)" stroke="currentColor" stroke-width="1.8"/>',
  mundo: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M4 12h16M12 4c2.5 2.5 2.5 13.5 0 16M12 4c-2.5 2.5-2.5 13.5 0 16" fill="none" stroke="currentColor" stroke-width="1.5"/>',
  opticas: '<circle cx="8" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="16" cy="13" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 13h0M6 9l2-4M18 9l-2-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  mas: '<circle cx="6" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="18" cy="12" r="1.6" fill="currentColor"/>',
};

export const ROUTES: { path: string; nombre: string; render: (app: HTMLElement) => void | Promise<void>; top: boolean; tab?: string }[] = [
  { path: '/', nombre: 'Inicio', render: renderInicio, top: true, tab: 'inicio' },
  { path: '/simulador', nombre: 'Simulador', render: renderSimulador, top: true, tab: 'simulador' },
  { path: '/mundo', nombre: 'El mundo', render: renderMundo, top: true, tab: 'mundo' },
  { path: '/opticas', nombre: 'Ópticas', render: renderOpticas, top: true, tab: 'opticas' },
  { path: '/precision', nombre: 'Precisión', render: renderPrecision, top: true },
  { path: '/fuentes', nombre: 'Fuentes', render: renderFuentes, top: true },
  { path: '/cuenta', nombre: 'Cuenta', render: renderCuenta, top: false },
  { path: '/mas', nombre: 'Datos', render: renderMas, top: false, tab: 'mas' },
  { path: '/suscripcion', nombre: 'Suscripción', render: renderSuscripcion, top: false },
  { path: '/admin', nombre: 'Administración', render: renderAdmin, top: false },
];

const app = document.getElementById('app')!;
let current = '';

function nav() {
  const path = location.pathname;
  const isMas = ['/precision', '/fuentes', '/cuenta', '/mas'].includes(path);
  document.getElementById('nav-top')!.innerHTML = ROUTES.filter((r) => r.top)
    .map((r) => `<a href="${r.path}" ${r.path === path ? 'aria-current="page"' : ''}>${r.nombre}</a>`).join('');
  document.getElementById('nav-bottom')!.innerHTML = ROUTES.filter((r) => r.tab)
    .map((r) => `<a href="${r.path}" ${r.path === path || (r.tab === 'mas' && isMas) ? 'aria-current="page"' : ''}><svg viewBox="0 0 24 24" aria-hidden="true">${ICON[r.tab!]}</svg>${r.nombre === 'El mundo' ? 'Mundo' : r.nombre}</a>`).join('');
  const u = S.me?.usuario;
  document.getElementById('account')!.innerHTML = (u?.role === 'admin' ? `<a href="/admin" ${path === '/admin' ? 'aria-current="page"' : ''} style="margin-right:14px">Administración</a>` : '') + (u
    ? `<a href="/cuenta" ${path === '/cuenta' ? 'aria-current="page"' : ''}>${esc(u.name || u.email.split('@')[0])}</a>`
    : `<a href="/entrar">Entrar</a>`);
}

export function render() {
  const route = ROUTES.find((r) => r.path === location.pathname) ?? ROUTES[0];
  document.title = route.path === '/' ? 'Horizonte BTC' : `${route.nombre} — Horizonte BTC`;
  nav();
  const changed = current !== route.path;
  current = route.path;
  const y = window.scrollY;
  document.getElementById('banner')!.innerHTML = bannerHtml();
  // Modo suscripción: sin cuenta, bienvenida; con la cuenta caducada, pago. Cuenta y suscripción siempre accesibles.
  const free = ['/cuenta', '/suscripcion'].includes(route.path);
  if (S.me && !puedeVer(S.me) && !free) {
    if (S.me.modo === 'suscripcion' && S.me.usuario) renderCaducada(app);
    else if (S.me.modo === 'suscripcion') renderBienvenida(app);
    else route.render(app);
  } else route.render(app);
  if (!changed) window.scrollTo(0, y);
}

document.addEventListener('click', (e) => {
  const a = (e.target as HTMLElement).closest('a');
  if (!a || a.target || e.metaKey || e.ctrlKey || e.shiftKey) return;
  const url = new URL(a.href);
  if (url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/cdn-cgi/') || url.pathname === '/entrar') return;
  if (!ROUTES.some((r) => r.path === url.pathname)) return;
  e.preventDefault();
  if (url.pathname !== location.pathname) {
    history.pushState(null, '', url.pathname);
    render();
    window.scrollTo(0, 0);
    app.focus({ preventScroll: true });
  }
});
window.addEventListener('popstate', render);

render();
loadAll(render);
setInterval(() => refreshSnap(render), 60_000);
