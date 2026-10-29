// Gráficos en SVG sin dependencias: cono de probabilidad, histograma y mapa de puntos.
import { esc, fechaCorta, usd } from './format';

const NS = 'http://www.w3.org/2000/svg';
const el = (tag: string, attrs: Record<string, string | number>, parent?: Element) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  parent?.appendChild(e);
  return e;
};

export interface Band { day: number; p05: number; p25: number; p50: number; p75: number; p95: number }

function niceTicks(lo: number, hi: number, n = 4): number[] {
  const step0 = (hi - lo) / n;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) ?? step0;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) out.push(v);
  return out;
}
const kfmt = (v: number) => (v >= 1000 ? `${(v / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} mil` : v.toFixed(0));
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);

/**
 * Cono de probabilidad: histórico reciente a la izquierda, bandas 5–95 % y 25–75 % hacia el futuro.
 * `bands[0]` corresponde al día 1 después de `today`.
 */
export function fanChart(host: HTMLElement, opts: { history: [string, number][]; bands: Band[]; today: string; price: number; level?: number | null; height?: number; label?: string }) {
  host.innerHTML = '';
  host.classList.add('chart-wrap');
  const W = Math.max(300, host.clientWidth || 600);
  const H = opts.height ?? (W < 560 ? 230 : 280);
  const padL = 8, padR = W < 560 ? 64 : 84, padT = 14, padB = 24;
  const hist = opts.history.slice(-Math.max(45, Math.round(opts.bands.length * 1.5)));
  const nH = hist.length, nF = opts.bands.length;
  const total = nH + nF;
  const all = [...hist.map((h) => h[1]), opts.price, ...opts.bands.flatMap((b) => [b.p05, b.p95]), ...(opts.level ? [opts.level] : [])];
  let lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.06; lo -= pad; hi += pad;
  // El pasado ocupa el 58 % del ancho y el futuro el 42 %, sea cual sea el horizonte
  const split = padL + 0.58 * (W - padL - padR);
  const x = (i: number) => (i <= nH ? padL + (i / Math.max(1, nH)) * (split - padL) : split + ((i - nH) / nF) * (W - padR - split));
  const y = (v: number) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': opts.label ?? 'Cono de probabilidad del precio' }, host) as SVGSVGElement;

  for (const t of niceTicks(lo, hi)) {
    el('line', { x1: padL, x2: W - padR, y1: y(t), y2: y(t), class: 'axis', 'stroke-opacity': 0.6 }, svg);
  }
  const i0 = nH; // índice del "hoy"
  const area = (a: keyof Band, b: keyof Band) => {
    const top = opts.bands.map((bd, k) => `${x(i0 + k + 1)},${y(bd[b] as number)}`);
    const bot = opts.bands.map((bd, k) => `${x(i0 + k + 1)},${y(bd[a] as number)}`).reverse();
    return `M${x(i0)},${y(opts.price)} L${top.join(' L')} L${bot.join(' L')} Z`;
  };
  el('path', { d: area('p05', 'p95'), class: 'cone-outer' }, svg);
  el('path', { d: area('p25', 'p75'), class: 'cone-inner' }, svg);
  el('path', { d: `M${x(i0)},${y(opts.price)} ` + opts.bands.map((b, k) => `L${x(i0 + k + 1)},${y(b.p50)}`).join(' '), class: 'median' }, svg);
  el('path', { d: hist.map((h, k) => `${k ? 'L' : 'M'}${x(k)},${y(h[1])}`).join(' ') + ` L${x(i0)},${y(opts.price)}`, class: 'hist' }, svg);
  if (opts.level) {
    el('line', { x1: padL, x2: W - padR, y1: y(opts.level), y2: y(opts.level), class: 'level' }, svg);
  }
  el('circle', { cx: x(i0), cy: y(opts.price), r: 4.5, class: 'now-dot' }, svg);

  // Etiquetas de cuantiles al final del cono
  const last = opts.bands[nF - 1];
  const labels: [number, string, boolean][] = [[last.p95, '95 %', false], [last.p50, 'Mediana', true], [last.p05, '5 %', false]];
  let prevY = -99;
  for (const [v, name, strong] of labels) {
    let yy = y(v);
    if (yy - prevY < 26) yy = prevY + 26;
    prevY = yy;
    const t = el('text', { x: W - padR + 8, y: yy - 2, class: strong ? 'q-label' : '' }, svg);
    t.textContent = kfmt(v);
    const s = el('text', { x: W - padR + 8, y: yy + 11 }, svg);
    s.textContent = name;
  }
  // Eje temporal: inicio, hoy, fin
  const xl = (i: number, txt: string, anchor: string) => { const t = el('text', { x: x(i), y: H - 6, 'text-anchor': anchor }, svg); t.textContent = txt; };
  xl(0, fechaCorta(hist[0][0]), 'start');
  xl(i0, 'Hoy', 'middle');
  xl(total - 1, fechaCorta(addDays(opts.today, nF)), 'end');

  // Información al pasar el cursor o el dedo
  const tip = document.createElement('div');
  tip.className = 'tip';
  host.appendChild(tip);
  const guide = el('line', { y1: padT, y2: H - padB, class: 'axis', opacity: 0 }, svg);
  const move = (clientX: number) => {
    const r = svg.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * W;
    const i = px <= split ? Math.round(((px - padL) / (split - padL)) * nH) : nH + Math.round(((px - split) / (W - padR - split)) * nF);
    if (i < 0 || i >= total) return;
    guide.setAttribute('x1', String(x(i))); guide.setAttribute('x2', String(x(i))); guide.setAttribute('opacity', '1');
    let html: string;
    if (i < nH) html = `<strong>${fechaCorta(hist[i][0])}</strong><br>${usd(hist[i][1])}`;
    else if (i === nH) html = `<strong>Hoy</strong><br>${usd(opts.price)}`;
    else {
      const b = opts.bands[i - nH - 1];
      html = `<strong>${fechaCorta(addDays(opts.today, b.day))}</strong><br>90 %: ${usd(b.p05)} – ${usd(b.p95)}<br>50 %: ${usd(b.p25)} – ${usd(b.p75)}<br>Mediana: ${usd(b.p50)}`;
    }
    tip.innerHTML = html;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(r.width - 170, Math.max(0, left + 10))}px`;
    tip.style.top = '8px';
    tip.classList.add('show');
  };
  svg.addEventListener('pointermove', (e) => move(e.clientX));
  svg.addEventListener('pointerleave', () => { tip.classList.remove('show'); guide.setAttribute('opacity', '0'); });
}

/** Histograma simple (PIT): 10 barras con línea de referencia uniforme. */
export function histogram(host: HTMLElement, values: number[], label: string) {
  host.innerHTML = '';
  const W = 220, H = 70, n = values.length, max = Math.max(0.2, ...values);
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': label }, host);
  const bw = W / n;
  values.forEach((v, i) => el('rect', { x: i * bw + 1.5, y: H - (v / max) * (H - 6), width: bw - 3, height: (v / max) * (H - 6), rx: 2, fill: 'var(--accent)', opacity: 0.75 }, svg));
  el('line', { x1: 0, x2: W, y1: H - (0.1 / max) * (H - 6), y2: H - (0.1 / max) * (H - 6), class: 'level' }, svg);
}

let LAND: [number, number][] | null = null;
/** Mapa del mundo de puntos (proyección equirectangular) con intensidad por país. */
export async function worldMap(host: HTMLElement, spots: { iso: string; nombre: string; lat: number; lon: number; intensidad: number }[]) {
  if (!LAND) LAND = await (await fetch('/mapa.json')).json();
  host.innerHTML = '';
  host.classList.add('chart-wrap');
  const W = 720, H = 330;
  const x = (lon: number) => ((lon + 180) / 360) * W;
  const y = (lat: number) => ((80 - lat) / 138) * H;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': 'Mapa de intensidad de acontecimientos por país' }, host);
  for (const [lon, lat] of LAND!) el('circle', { cx: x(lon), cy: y(lat), r: 1.7, fill: 'var(--text-3)', opacity: 0.45 }, svg);
  const max = Math.max(0.01, ...spots.map((s) => s.intensidad));
  const tip = document.createElement('div');
  tip.className = 'tip';
  host.appendChild(tip);
  for (const s of spots) {
    const r = 4 + 14 * Math.sqrt(s.intensidad / max);
    el('circle', { cx: x(s.lon), cy: y(s.lat), r, fill: 'var(--down)', opacity: 0.18 }, svg);
    const c = el('circle', { cx: x(s.lon), cy: y(s.lat), r: Math.max(3, r * 0.35), fill: 'var(--down)', tabindex: 0, 'aria-label': `${s.nombre}: intensidad ${s.intensidad.toFixed(2)}` }, svg);
    const show = () => {
      const b = svg.getBoundingClientRect();
      tip.innerHTML = `<strong>${esc(s.nombre)}</strong><br>Intensidad ${s.intensidad.toLocaleString('es-ES', { maximumFractionDigits: 2 })}`;
      tip.style.left = `${Math.min(b.width - 140, (x(s.lon) / W) * b.width + 10)}px`;
      tip.style.top = `${Math.max(0, (y(s.lat) / H) * b.height - 40)}px`;
      tip.classList.add('show');
    };
    c.addEventListener('pointerenter', show);
    c.addEventListener('focus', show);
    c.addEventListener('pointerleave', () => tip.classList.remove('show'));
    c.addEventListener('blur', () => tip.classList.remove('show'));
  }
}

/** Barra divergente para valores de −1 a +1. */
export function dbar(v: number | null): string {
  if (v === null || !isFinite(v)) return '<span class="dbar" aria-hidden="true"></span>';
  const w = Math.min(1, Math.abs(v)) * 50;
  const left = v >= 0 ? 50 : 50 - w;
  return `<span class="dbar" role="img" aria-label="${v.toFixed(2)}"><i style="left:${left}%;width:${w}%"></i></span>`;
}
