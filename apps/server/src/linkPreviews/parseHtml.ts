/**
 * Reads what a link preview needs from a page's head: the Open Graph and Twitter card
 * tags, the title, icons and the theme color. Pages are untrusted and often malformed, so
 * this scans tags rather than building a DOM, and every value it returns is plain text or
 * an absolute http(s) URL.
 */

export type PageMeta = {
  title: string | null;
  description: string | null;
  siteName: string | null;
  image: string | null;
  /** Icon URLs, best first. */
  icons: string[];
  themeColor: string | null;
};

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  middot: '·',
  bull: '•',
  copy: '©',
  reg: '®',
  trade: '™',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name: string) => {
    if (name[0] === '#') {
      const code =
        name[1] === 'x' || name[1] === 'X'
          ? Number.parseInt(name.slice(2), 16)
          : Number.parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED_ENTITIES[name.toLowerCase()] ?? entity;
  });
}

/** Collapses whitespace and caps the length, so a page cannot store an essay as its title. */
function clean(value: string | undefined, max: number): string | null {
  if (!value) return null;
  const text = decodeEntities(value).replace(/\s+/g, ' ').trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

function attributes(tag: string): Map<string, string> {
  const result = new Map<string, string>();
  for (const match of tag.matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g,
  )) {
    const name = match[1]?.toLowerCase();
    if (name && !result.has(name)) result.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return result;
}

function absoluteUrl(value: string | undefined, base: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(decodeEntities(value.trim()), base);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The largest dimension in a `sizes` attribute ("32x32 64x64"), or 0 for `any` or none. */
function iconSize(sizes: string | undefined) {
  if (!sizes) return 0;
  let largest = 0;
  for (const match of sizes.matchAll(/(\d+)x(\d+)/gi)) {
    largest = Math.max(largest, Number(match[1]));
  }
  return largest;
}

/**
 * Enough of a page to hold its head, however bloated with inline scripts and styles (YouTube
 * puts its tags about 700 KB in).
 */
export const MAX_HEAD = 1536 * 1024;

/** The head of an HTML document: everything before `<body` (or the whole thing without one). */
function head(html: string) {
  const start = html.slice(0, MAX_HEAD);
  const end = start.search(/<body[\s>]/i);
  return end === -1 ? start : start.slice(0, end);
}

export function parseHtml(html: string, baseUrl: string): PageMeta {
  // Scripts and styles can hold anything, including text that looks like tags.
  const source = head(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '');
  let base = baseUrl;
  const meta = new Map<string, string>();
  const icons: Array<{ url: string; score: number }> = [];

  for (const match of source.matchAll(/<(meta|link|base)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const tag = match[1]?.toLowerCase();
    const attrs = attributes(match[2] ?? '');
    if (tag === 'base') {
      base = absoluteUrl(attrs.get('href'), baseUrl) ?? base;
    } else if (tag === 'meta') {
      const key = (
        attrs.get('property') ??
        attrs.get('name') ??
        attrs.get('itemprop')
      )?.toLowerCase();
      const content = attrs.get('content');
      // A theme color for dark mode only is not the site's main color.
      if (key === 'theme-color' && /dark/i.test(attrs.get('media') ?? '')) continue;
      if (key && content !== undefined && !meta.has(key)) meta.set(key, content);
    } else {
      const rel = attrs.get('rel')?.toLowerCase().split(/\s+/) ?? [];
      const url = absoluteUrl(attrs.get('href'), base);
      if (!url || !rel.some((value) => value.includes('icon')) || rel.includes('mask-icon')) {
        continue;
      }
      // Touch icons are large, opaque and in full color, so they make the best site marks.
      const touch = rel.some((value) => value.startsWith('apple-touch-icon'));
      const size = touch
        ? Math.max(iconSize(attrs.get('sizes')), 180)
        : iconSize(attrs.get('sizes'));
      const svg = /\.svg(?:$|\?)/i.test(url) || attrs.get('type') === 'image/svg+xml';
      icons.push({ url, score: (touch ? 1000 : 0) + (svg ? 500 : 0) + Math.min(size, 256) });
    }
  }

  const title = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1];
  const pick = (...keys: string[]) => keys.map((key) => meta.get(key)).find(Boolean);

  const ordered = icons.sort((a, b) => b.score - a.score).map((icon) => icon.url);
  const fallbackIcon = absoluteUrl('/favicon.ico', base);
  if (fallbackIcon && !ordered.includes(fallbackIcon)) ordered.push(fallbackIcon);

  return {
    title: clean(pick('og:title', 'twitter:title') ?? title, 300),
    description: clean(pick('og:description', 'twitter:description', 'description'), 500),
    siteName: clean(pick('og:site_name', 'application-name', 'apple-mobile-web-app-title'), 100),
    image: absoluteUrl(
      pick(
        'og:image:secure_url',
        'og:image',
        'og:image:url',
        'twitter:image',
        'twitter:image:src',
        'image',
      ),
      base,
    ),
    icons: ordered.slice(0, 4),
    themeColor: pick('theme-color', 'msapplication-tilecolor')?.trim() ?? null,
  };
}

/** The charset a page declares in its Content-Type header or its first bytes. */
export function detectCharset(contentType: string, body: Buffer): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1];
  if (fromHeader) return fromHeader;
  const start = body.subarray(0, 2048).toString('latin1');
  return /<meta[^>]+charset=["']?([\w-]+)/i.exec(start)?.[1] ?? 'utf-8';
}

export function decodeHtml(contentType: string, body: Buffer): string {
  try {
    return new TextDecoder(detectCharset(contentType, body)).decode(body);
  } catch {
    return new TextDecoder('utf-8').decode(body);
  }
}
