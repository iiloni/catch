import { z } from 'zod';

type Json = Record<string, unknown>;

/** A link in a note: `url` identifies its preview, `href` is what the note links to. */
export type NoteLink = { url: string; href: string };

/** Previews shown per note. Links past this still work, they just get no card. */
export const MAX_NOTE_LINKS = 20;

const MAX_URL_LENGTH = 2048;

// Bare URLs in text. BlockNote turns typed and pasted URLs into links, but imported or
// synced text may hold plain ones.
const BARE_URL = /\bhttps?:\/\/[^\s<>"'`]+/gi;
// Punctuation that usually ends the sentence around a URL rather than the URL itself.
const TRAILING_PUNCTUATION = /[.,;:!?'")\]}>]+$/;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null;
}

/**
 * The key a link's preview is stored under: an absolute http(s) URL without its fragment,
 * which only moves within the same page. Null for anything else (mailto:, relative, junk).
 */
export function normalizeUrl(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname.includes('.') && !url.hostname.startsWith('[')) return null;
  url.hash = '';
  const normalized = url.href;
  return normalized.length > MAX_URL_LENGTH ? null : normalized;
}

function trimBareUrl(match: string) {
  let url = match.replace(TRAILING_PUNCTUATION, '');
  // Keep a closing parenthesis that has its opening one inside the URL (Wikipedia titles).
  if (match.slice(url.length).startsWith(')') && url.includes('(')) url += ')';
  return url;
}

/**
 * The web addresses written out in plain text, each with where it starts. Punctuation that
 * ends the sentence around an address is left out of it.
 */
export function findBareUrls(text: string): { index: number; url: string }[] {
  return [...text.matchAll(BARE_URL)].flatMap((match) => {
    const url = trimBareUrl(match[0]);
    return normalizeUrl(url) ? [{ index: match.index, url }] : [];
  });
}

function visitInline(
  content: unknown,
  onLink: (href: string) => void,
  onText: (text: string) => void,
) {
  if (typeof content === 'string') {
    onText(content);
    return;
  }
  if (Array.isArray(content)) {
    for (const item of content) visitInline(item, onLink, onText);
    return;
  }
  if (!isObject(content)) return;
  if (content.type === 'link') {
    if (typeof content.href === 'string') onLink(content.href);
    return;
  }
  if (typeof content.text === 'string') {
    onText(content.text);
    return;
  }
  // Table blocks hold rows of cells, each cell being inline content.
  if (Array.isArray(content.rows)) {
    for (const row of content.rows) {
      if (!isObject(row) || !Array.isArray(row.cells)) continue;
      for (const cell of row.cells) {
        visitInline(Array.isArray(cell) || !isObject(cell) ? cell : cell.content, onLink, onText);
      }
    }
    return;
  }
  visitInline(content.content, onLink, onText);
}

function visitBlocks(
  blocks: readonly Json[],
  onLink: (href: string) => void,
  onText: (text: string) => void,
) {
  for (const block of blocks) {
    visitInline(block.content, onLink, onText);
    if (Array.isArray(block.children)) visitBlocks(block.children.filter(isObject), onLink, onText);
  }
}

/**
 * The web links in a BlockNote document, in reading order, each preview once. Covers link
 * marks and bare URLs in text.
 */
export function extractLinks(blocks: readonly Json[]): NoteLink[] {
  const links = new Map<string, NoteLink>();
  const add = (href: string) => {
    const url = normalizeUrl(href);
    if (url && !links.has(url)) links.set(url, { url, href: href.trim() });
  };
  visitBlocks(blocks, add, (text) => {
    for (const { url } of findBareUrls(text)) add(url);
  });
  return [...links.values()];
}

/**
 * Whether a note is nothing but a single link, as notes shared from another app often are.
 */
export function isLinkOnly(blocks: readonly Json[]): boolean {
  let links = 0;
  let text = '';
  visitBlocks(
    blocks,
    () => {
      links += 1;
    },
    (value) => {
      text += value.replace(BARE_URL, () => {
        links += 1;
        return '';
      });
    },
  );
  return links === 1 && text.trim() === '';
}

/** A URL's host as people say it: without `www.`. */
export function linkDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export const LINK_PREVIEW_STATUSES = ['pending', 'ready', 'failed'] as const;

/** A 64-character hex SHA-256, naming a stored thumbnail or icon. */
export const assetHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * What the server found at a link. Previews are per user and keyed by normalized URL, so a
 * link in several notes is fetched once. `hue` is the site's color as an OKLCH hue; the
 * client supplies lightness and chroma per theme, as it does for note colors. Null means
 * the site has no clear color.
 */
export const linkPreviewSchema = z.object({
  userId: z.string(),
  url: z.string(),
  status: z.enum(LINK_PREVIEW_STATUSES),
  title: z.string().nullable(),
  description: z.string().nullable(),
  siteName: z.string().nullable(),
  imageHash: assetHashSchema.nullable(),
  imageWidth: z.number().int().nullable(),
  imageHeight: z.number().int().nullable(),
  iconHash: assetHashSchema.nullable(),
  hue: z.number().int().min(0).max(359).nullable(),
  fetchedAt: z.coerce.date().nullable(),
});

export type LinkPreview = z.infer<typeof linkPreviewSchema>;

export const refreshLinkPreviewSchema = z.object({
  url: z.string().max(MAX_URL_LENGTH),
});

export type RefreshLinkPreview = z.infer<typeof refreshLinkPreviewSchema>;

/** Optional metadata for a link being captured, before a note exists. */
export const linkIntakeSchema = linkPreviewSchema.pick({
  title: true,
  description: true,
  siteName: true,
  imageHash: true,
  imageWidth: true,
  imageHeight: true,
  iconHash: true,
  hue: true,
});

export type LinkIntake = z.infer<typeof linkIntakeSchema>;

/** Links whose previews a note does not show, by normalized URL. */
export const hiddenLinksSchema = z.array(z.string().max(MAX_URL_LENGTH)).max(200);
