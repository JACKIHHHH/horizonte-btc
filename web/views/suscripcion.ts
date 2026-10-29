import { S, getJson } from '../state';
import { ago, esc, fecha, usd } from '../format';
import { header, legal } from './common';

const pago = () => S.me?.pago ?? { importe: 10, periodo: 'año', pruebaDias: 30, paypal: '@garavide', enlace: 'https://www.paypal.com/qrcodes/p2pqrc/PKJX9NY49UAXS', tipo: 'Amigos y familiares', nota: 'regalo familiar', email: null };
const eur = (x: number) => x.toLocaleString('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

let aviso: { pay_claim: string | null; pay_claim_at: number | null } | null = null;
let avisoMsg = '';

/** Instrucciones de pago (PayPal) con el código QR y el aviso de pago. */
export function pagoBlock(): string {
  const p = pago();
  const logged = !!S.me?.usuario;
  return `<div class="group pay">
    <div class="row"><div class="label"><strong>${eur(p.importe)} al ${p.periodo}</strong><span class="sub">Sin renovación automática: la web te avisa 15 días antes de que caduque.</span></div></div>
    <div class="row pay-steps">
      <ol class="steps">
        <li>Envía ${eur(p.importe)} por PayPal a <strong>${esc(p.paypal)}</strong>, con el botón o escaneando el código.</li>
        <li>Elige <strong>${esc(p.tipo)}</strong> y escribe en la nota: <code class="concept" id="concepto">${esc(p.nota)}</code> <button class="btn secondary small-btn" id="copiar" type="button">Copiar</button></li>
        <li>Avísanos aquí con el nombre o el correo de tu cuenta de PayPal, para saber que el pago es tuyo.</li>
        <li>Activamos tu año de suscripción en cuanto comprobamos el pago, normalmente en menos de 24 horas.</li>
      </ol>
      <figure class="qr"><img src="/paypal-qr.svg" width="180" height="180" alt="Código QR para pagar por PayPal a ${esc(p.paypal)}"><figcaption>PayPal ${esc(p.paypal)}</figcaption></figure>
    </div>
    <div class="row"><a class="btn" href="${esc(p.enlace)}" target="_blank" rel="noopener">Pagar con PayPal</a></div>
    ${logged ? `<form class="row" id="aviso" style="flex-wrap:wrap">
      <div class="label" style="flex:1 1 220px"><label for="pagador">Ya he pagado</label><span class="sub">${aviso?.pay_claim_at ? `Aviso enviado ${ago(aviso.pay_claim_at)} (${esc(aviso.pay_claim)}). Lo estamos comprobando.` : 'Nombre o correo de la cuenta de PayPal con la que pagaste'}</span></div>
      <input class="field" id="pagador" name="pagador" autocomplete="name" maxlength="120" placeholder="Nombre o correo de PayPal" value="${esc(aviso?.pay_claim ?? '')}" style="flex:1 1 200px">
      <button class="btn" type="submit">${aviso?.pay_claim_at ? 'Actualizar aviso' : 'Avisar del pago'}</button>
      ${avisoMsg ? `<span class="tiny" role="status" style="flex-basis:100%">${esc(avisoMsg)}</span>` : ''}
    </form>` : ''}
  </div>`;
}

function bindCopy(app: HTMLElement, rerender: (a: HTMLElement) => void) {
  app.querySelector('#copiar')?.addEventListener('click', async (e) => {
    const b = e.target as HTMLButtonElement;
    try { await navigator.clipboard.writeText(app.querySelector('#concepto')!.textContent ?? ''); b.textContent = 'Copiado'; } catch { b.textContent = 'Cópialo a mano'; }
  });
  app.querySelector<HTMLFormElement>('#aviso')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pagador = (app.querySelector('#pagador') as HTMLInputElement).value.trim();
    try {
      await getJson('/api/suscripcion/aviso', { method: 'POST', body: JSON.stringify({ pagador }) });
      aviso = { pay_claim: pagador, pay_claim_at: Date.now() };
      avisoMsg = 'Aviso recibido. Te activamos el año en cuanto comprobemos el pago.';
    } catch (err) { avisoMsg = (err as Error).message; }
    rerender(app);
  });
  if (S.me?.usuario && aviso === null) {
    aviso = { pay_claim: null, pay_claim_at: null };
    getJson<any>('/api/suscripcion/aviso').then((r) => { if (r) { aviso = r; rerender(app); } }).catch(() => {});
  }
}

let teaser: any = null;
/** Página de bienvenida para quien no ha entrado (modo suscripción). */
export function renderBienvenida(app: HTMLElement) {
  const p = pago();
  app.innerHTML = `<section class="hero" aria-label="Bitcoin ahora">
      <div class="asset">Bitcoin, precio de referencia</div>
      <div class="price">${teaser?.precio ? usd(teaser.precio) : '<span class="skeleton">00.000 US$</span>'}</div>
      <div class="change">&nbsp;</div>
    </section>
    <h1 class="page-title" style="margin-top:8px">Escenarios de Bitcoin con lo que pasa en el mundo</h1>
    <p class="page-sub">Rangos de probabilidad del precio a 24 horas, 7, 30 y 90 días, calculados con mercado, derivados, datos on-chain, macro, geopolítica, regulación, noticias y mercados de predicción. Con su precisión histórica publicada.</p>
    <div class="group">
      <div class="row"><div class="label">Cono de probabilidad<span class="sub">Hasta dónde puede llegar el precio y con qué probabilidad</span></div></div>
      <div class="row"><div class="label">Simulador de escenarios<span class="sub">La Fed sube tipos, una escalada militar, un hackeo: mira cómo cambia la distribución</span></div></div>
      <div class="row"><div class="label">El mundo en índices<span class="sub">Riesgo geopolítico, presión regulatoria y tono macro a partir de ${teaser?.fuentes || 70} fuentes</span></div></div>
      <div class="row"><div class="label">Precisión verificable<span class="sub">Cada previsión se registra y se comprueba cuando vence</span></div></div>
    </div>
    <div class="group" style="margin-top:16px">
      <div class="row"><div class="label"><strong>${p.pruebaDias} días gratis</strong><span class="sub">Después, ${eur(p.importe)} al ${p.periodo}. Solo necesitas tu correo: te llega un código para entrar.</span></div>
        <a class="btn" href="/entrar">Empezar la prueba</a></div>
    </div>
    <p class="tiny" style="margin-top:10px">¿Ya tienes cuenta? <a href="/entrar">Entrar</a></p>
    ${legal()}`;
  if (!teaser) getJson('/api/publico').then((t) => { teaser = t; renderBienvenida(app); }).catch(() => {});
}

/** Pantalla cuando la prueba o la suscripción han terminado. */
export function renderCaducada(app: HTMLElement) {
  const u = S.me!.usuario!;
  const bloqueada = u.estado === 'bloqueado';
  app.innerHTML = `${header(bloqueada ? 'Cuenta desactivada' : 'Tu acceso ha terminado', bloqueada
      ? 'Un administrador ha desactivado esta cuenta. Si crees que es un error, responde al correo de acceso o escribe al administrador.'
      : `Tu periodo de acceso terminó${u.hasta ? ` el ${fecha(u.hasta)}` : ''}. Para seguir usando Horizonte BTC, activa la suscripción anual.`)}
    ${bloqueada ? '' : pagoBlock()}
    <p class="tiny" style="margin-top:12px">Has entrado como ${esc(u.email)}. <a href="/cdn-cgi/access/logout">Salir</a></p>
    ${legal()}`;
  bindCopy(app, renderCaducada);
}

/** Página de suscripción (siempre accesible para quien ha entrado). */
export function renderSuscripcion(app: HTMLElement) {
  const u = S.me?.usuario;
  const estadoTxt: Record<string, string> = {
    admin: 'Administrador: acceso sin caducidad.',
    activo: `Suscripción activa hasta el ${u?.hasta ? fecha(u.hasta) : '—'} (${u?.diasRestantes ?? 0} días).`,
    prueba: `Prueba gratuita: te quedan ${u?.diasRestantes ?? 0} días (hasta el ${u?.hasta ? fecha(u.hasta) : '—'}).`,
    caducado: 'Tu acceso ha caducado.',
    bloqueado: 'Cuenta desactivada por un administrador.',
  };
  app.innerHTML = `${header('Suscripción')}
    ${u ? `<div class="group"><div class="row"><div class="label">${esc(u.email)}<span class="sub">${estadoTxt[u.estado]}</span></div></div></div>` : '<div class="notice">Entra con tu correo para empezar la prueba gratuita. <a href="/entrar">Entrar</a></div>'}
    <h2 class="section-title">Cómo pagar</h2>
    ${pagoBlock()}
    ${legal()}`;
  bindCopy(app, renderSuscripcion);
}

/** Aviso fijo durante la prueba o cuando falta poco para caducar. */
export function bannerHtml(): string {
  const u = S.me?.usuario;
  if (!u || S.me?.modo !== 'suscripcion') return '';
  if (u.estado === 'prueba') return `<div class="banner">Prueba gratuita: te quedan <strong>${u.diasRestantes} ${u.diasRestantes === 1 ? 'día' : 'días'}</strong>. <a href="/suscripcion">Suscribirse por ${eur(pago().importe)} al año</a></div>`;
  if (u.estado === 'activo' && (u.diasRestantes ?? 99) <= 15) return `<div class="banner">Tu suscripción termina en ${u.diasRestantes} días. <a href="/suscripcion">Renovar</a></div>`;
  return '';
}
export { ago };
