// Lector ligero de RSS 2.0, RDF y Atom (sin dependencias, poco CPU).
import type { RawItem } from './connectors/types';

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => {
      if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : null;
}

export function parseFeed(xml: string, maxItems = 40): RawItem[] {
  const out: RawItem[] = [];
  const re = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && out.length < maxItems) {
    const b = m[2];
    const title = decode(tag(b, 'title') ?? '');
    let link = tag(b, 'link');
    if (!link || !link.trim()) {
      const href = /<link[^>]*href="([^"]+)"[^>]*\/?>/i.exec(b);
      link = href ? href[1] : tag(b, 'guid');
    }
    const url = decode(link ?? '');
    const date = tag(b, 'pubDate') ?? tag(b, 'dc:date') ?? tag(b, 'published') ?? tag(b, 'updated');
    const t = date ? Date.parse(decode(date)) : NaN;
    if (title && /^https?:\/\//.test(url)) out.push({ title: title.slice(0, 300), url, publishedAt: isFinite(t) ? t : Date.now() });
  }
  return out;
}
