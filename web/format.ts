export const usd = (x: number | null | undefined, d = 0) =>
  x == null || !isFinite(x) ? '—' : x.toLocaleString('es-ES', { style: 'currency', currency: 'USD', maximumFractionDigits: d, minimumFractionDigits: d });
export const num = (x: number | null | undefined, d = 1) => (x == null || !isFinite(x) ? '—' : x.toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d }));
export const pct = (x: number | null | undefined, d = 1, sign = false) =>
  x == null || !isFinite(x) ? '—' : `${sign && x > 0 ? '+' : ''}${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d })}\u00a0%`;
export const big = (x: number | null | undefined) => {
  if (x == null || !isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e12) return `${num(x / 1e12, 2)} billones`;
  if (a >= 1e9) return `${num(x / 1e9, 1)} mil M`;
  if (a >= 1e6) return `${num(x / 1e6, 1)} M`;
  return num(x, 0);
};
export function ago(ms: number | null | undefined): string {
  if (!ms) return 'nunca';
  const s = (Date.now() - ms) / 1000;
  if (s < 90) return 'hace un momento';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}
export const fecha = (d: string | number) => new Date(typeof d === 'number' ? d : d + 'T12:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
export const fechaCorta = (d: string | number) => new Date(typeof d === 'number' ? d : d + 'T12:00:00Z').toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const sign = (x: number | null | undefined) => (x == null ? '' : x > 0.0005 ? 'up' : x < -0.0005 ? 'down' : '');
export const horizonteNombre = (h: number) => (h === 1 ? '24 horas' : h === 7 ? '7 días' : h === 30 ? '30 días' : '90 días');
