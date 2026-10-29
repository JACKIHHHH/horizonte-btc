import { S } from '../state';
import { dbar } from '../charts';
import { big, esc, num, pct, usd, sign } from '../format';
import { CATEGORY_NAME } from './nombres';
import { blocking, header, legal, row, snapStatus, source } from './common';

const m = (x: any, f: (v: number) => string, sub?: string) => (x && x.valor != null ? { v: f(x.valor), src: source(x.fuente, x.observado), sub } : { v: 'sin datos', src: '', sub });

function opticaGroup(titulo: string, nota: string, rows: [string, { v: string; src: string; sub?: string }][]) {
  return `<h2 class="section-title">${titulo}</h2><p class="section-note">${nota}</p>
    <div class="group">${rows.map(([label, r]) => row(esc(label), r.v, r.sub, r.src)).join('')}</div>`;
}

export function renderOpticas(app: HTMLElement) {
  const b = blocking();
  if (b) { app.innerHTML = b; return; }
  const s = S.snap;
  if (!s) { app.innerHTML = header('Ópticas') + snapStatus(); return; }
  const d = s.derivados, o = s.onchain, mac = s.macro, sen = s.sentimiento;
  const fundAnual = d.fundingAnual;
  const mod = S.model;
  const varRows = (mod?.features ?? []).map((f: any) => {
    const c30 = mod.contributions?.[30]?.find((c: any) => c.key === f.key)?.value;
    return `<tr><td>${esc(f.label)}<br><span class="tiny">${esc(f.horizonte)}</span></td><td>${f.role === 'direccion' ? 'Dirección' : 'Volatilidad'}</td>
      <td class="num">${f.value == null ? 'sin datos' : num(f.value, 3)}</td><td class="num">${c30 == null ? '—' : `<span class="${sign(c30)}">${pct(c30, 2, true)}</span>`}</td></tr>`;
  }).join('');
  const eff = (H: number, cat: string) => mod?.effects?.[H]?.find((e: any) => e.cat === cat);
  const cats = (mod?.effects?.[7] ?? []).map((e: any) => e.cat);

  app.innerHTML = `${header('Ópticas', 'Cada óptica es una forma distinta de mirar el mercado. Aquí está su lectura actual con la fuente y la antigüedad de cada dato. El peso real de cada variable en la previsión lo decide el backtest, no esta página.')}
    ${opticaGroup('Derivados', 'Anticipan sobre todo la amplitud del movimiento. Un apalancamiento muy cargado hacia un lado aumenta el riesgo de liquidaciones en cascada.', [
      ['Volatilidad implícita (DVOL)', m(d.dvol, (v) => `${num(v, 1)} %`, 'Anual, opciones a 30 días')],
      ['Sesgo de opciones', m(d.skew, (v) => `${v > 0 ? '+' : ''}${num(v, 1)} pts`, 'Puts −10 % menos calls +10 %, ~30 días. Positivo: más demanda de protección')],
      ['Interés abierto put/call', m(d.putCall, (v) => num(v, 2))],
      ['Base de futuros', m(d.basis, (v) => pct(v, 1), 'Anualizada, vencimiento ~90 días')],
      ['Funding medio', { v: fundAnual == null ? 'sin datos' : `${pct(fundAnual, 1)} anual`, src: '<span class="tiny">OKX y Bybit</span>', sub: 'Positivo: los largos pagan a los cortos' }],
      ['Interés abierto en perpetuos', { v: d.interesAbierto == null ? 'sin datos' : `${big(d.interesAbierto)} US$`, src: '<span class="tiny">OKX y Bybit</span>' }],
    ])}
    ${opticaGroup('On-chain', 'Posición en el ciclo y salud de la red. Útil a meses vista, poco a días.', [
      ['Hashrate', m(o.hashrate, (v) => `${num(v, 0)} EH/s`)],
      ['Hash ribbons', m(o.ribbon, (v) => pct(v, 1, true), 'Media 30 d frente a 60 d. Negativo prolongado: capitulación de mineros')],
      ['Próximo ajuste de dificultad', m(o.dificultad, (v) => `${v > 0 ? '+' : ''}${num(v, 1)} %`)],
      ['Comisión rápida', m(o.fees, (v) => `${num(v, 0)} sat/vB`)],
      ['MVRV', m(o.mvrv, (v) => num(v, 2), 'Capitalización de mercado frente a realizada')],
      ['Precio realizado', m(o.realizado, (v) => usd(v))],
      ['Transacciones diarias', m(o.tx, (v) => big(v))],
      ['Commits en Bitcoin Core (30 d)', m(o.commits, (v) => num(v, 0))],
    ])}
    ${opticaGroup('Liquidez', 'Dinero disponible para entrar en cripto y liquidez global en dólares.', [
      ['Stablecoins en circulación', m(s.liquidez.stables, (v) => `${big(v)} US$`)],
      ['Variación en 30 días', m(s.liquidez.stables30, (v) => pct(v, 1, true))],
    ])}
    ${opticaGroup('Macro', 'Dólar, tipos reales y apetito por el riesgo. BTC suele seguir a la liquidez con semanas de retraso.', [
      ['Dólar amplio', m(mac.dxy, (v) => num(v, 2))],
      ['Tipo real a 10 años', m(mac.real10, (v) => `${num(v, 2)} %`)],
      ['Bono a 10 años', m(mac.nom10, (v) => `${num(v, 2)} %`)],
      ['Fondos federales', m(mac.fedfunds, (v) => `${num(v, 2)} %`)],
      ['VIX', m(mac.vix, (v) => num(v, 1))],
      ['Incertidumbre de política económica', m(mac.epu, (v) => num(v, 0))],
      ['Nasdaq', m(mac.nasdaq, (v) => num(v, 0))],
      ['Petróleo WTI', m(mac.oil, (v) => usd(v, 2))],
      ['Deuda pública de EE. UU.', m(mac.deuda, (v) => `${big(v)} US$`)],
    ])}
    ${opticaGroup('Sentimiento y atención', 'Solo es informativo en los extremos, y entonces suele leerse al revés.', [
      ['Fear & Greed', m(sen.fng, (v) => `${num(v, 0)}`, sen.fng?.texto ?? undefined)],
      ['Visitas a «Bitcoin» en Wikipedia', m(sen.wiki, (v) => big(v), 'Inglés, último día')],
      ['Atención frente a su media', m(sen.wikiRatio, (v) => `×${num(v, 2)}`, '7 días frente a los dos meses previos')],
      ['Historias en Hacker News (24 h)', m(sen.hn, (v) => num(v, 0))],
      ['Ritmo en Mastodon #bitcoin', m(sen.mastodon, (v) => `${num(v, 1)} por hora`)],
      ['Prima de Coinbase', { v: s.coinbasePremium == null ? 'sin datos' : pct(s.coinbasePremium, 3, true), src: '<span class="tiny">Coinbase frente a exchanges en USDT</span>', sub: 'Demanda en EE. UU.; incluye la diferencia USD/USDT' }],
    ])}
    <h2 class="section-title">Índices propios</h2>
    <div class="group">${s.indices.map((i: any) => `<div class="row"><div class="label">${esc(i.nombre)}<span class="sub">${esc(i.lectura)}, ${esc(i.signo)}</span></div>${dbar(i.valor)}<div class="value" style="min-width:44px">${i.valor == null ? '—' : num(i.valor, 2)}</div></div>`).join('')}</div>
    <p class="tiny" style="margin-top:8px"><a href="/mundo">Desglose de cada índice</a></p>

    <h2 class="section-title">Variables del modelo</h2>
    <p class="section-note">Valor actual de cada variable predictora y, si el modelo de dirección está activo a 30 días, su aporte a la mediana prevista.</p>
    <div class="panel scroll-x"><table class="data"><thead><tr><th>Variable</th><th>Papel</th><th class="num">Valor</th><th class="num">Aporte 30 d</th></tr></thead><tbody>${varRows || '<tr><td colspan="4" class="muted">Calibrando…</td></tr>'}</tbody></table></div>

    <h2 class="section-title">Cómo reaccionó BTC a cada tipo de acontecimiento</h2>
    <p class="section-note">Reacción media en desviaciones típicas (z) tras el día del suceso. "Ajustado" aplica una contracción hacia cero según el número de casos; es lo que usa el simulador.</p>
    <div class="panel scroll-x"><table class="data"><thead><tr><th>Tipo</th><th class="num">Casos</th><th class="num">1 d</th><th class="num">7 d</th><th class="num">30 d</th><th class="num">Ajustado 7 d</th><th class="num">Volatilidad posterior</th></tr></thead><tbody>
      ${cats.map((c: string) => { const e1 = eff(1, c), e7 = eff(7, c), e30 = eff(30, c); return `<tr><td>${esc(CATEGORY_NAME[c] ?? c)}</td><td class="num">${e7?.n ?? 0}</td><td class="num">${e1 ? num(e1.meanZ, 2) : '—'}</td><td class="num">${e7 ? num(e7.meanZ, 2) : '—'}</td><td class="num">${e30 ? num(e30.meanZ, 2) : '—'}</td><td class="num">${e7 ? num(e7.shrunkZ, 2) : '—'}</td><td class="num">${e7 ? `×${num(Math.exp(e7.volLogRatio), 2)}` : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    ${legal()}`;
}
