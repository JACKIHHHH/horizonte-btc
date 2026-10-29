import { S } from '../state';
import { ago, esc } from '../format';

export const legal = () => `<p class="legal">Información educativa, no asesoramiento financiero. Las previsiones son rangos de probabilidad calculados con datos públicos y pueden fallar; su precisión histórica está publicada en <a href="/precision">Precisión</a>. Datos de mercado de exchanges públicos, CoinGecko y otras fuentes citadas en <a href="/fuentes">Fuentes</a>.</p><aside class="ad-slot" aria-label="Publicidad"></aside>`;

export function header(title: string, sub?: string) {
  return `<h1 class="page-title">${esc(title)}</h1>${sub ? `<p class="page-sub">${sub}</p>` : ''}`;
}

export function blocking(): string | null {
  if (S.me?.modo === 'privado' && !S.me.usuario) {
    return `<div class="empty"><p><strong>Acceso restringido.</strong></p><p>Esta web solo está disponible para usuarios asignados.</p>${S.me.email ? `<p class="small">Has entrado como ${esc(S.me.email)}, pero tu cuenta no está asignada. Pide acceso a un administrador.</p>` : '<p><a class="btn" href="/entrar">Entrar</a></p>'}</div>`;
  }
  return null;
}

export function snapStatus(): string {
  if (S.snapError) return `<div class="notice warn">${esc(S.snapError)}</div>`;
  if (!S.snap) return '<div class="empty">Cargando datos…</div>';
  return '';
}

export const source = (name: string | undefined | null, t?: number | null) =>
  `<span class="tiny">${esc(name ?? '—')}${t ? `, ${ago(t)}` : ''}</span>`;

export function row(label: string, value: string, sub?: string, valueSub?: string, extra = '') {
  return `<div class="row ${extra}"><div class="label">${label}${sub ? `<span class="sub">${sub}</span>` : ''}</div><div class="value">${value}${valueSub ? `<span class="sub">${valueSub}</span>` : ''}</div></div>`;
}
