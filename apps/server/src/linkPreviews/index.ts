import { extractLinks, MAX_NOTE_LINKS, type Note } from '@catch/shared';
import { and, eq, inArray, lt, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { db } from '../db/client';
import { linkPreviews } from '../db/schema';
import { env } from '../env';
import { colorHue, parseCssColor } from './colors';
import { fetchIcon, fetchThumbnail } from './images';
import { decodeHtml, MAX_HEAD, parseHtml } from './parseHtml';
import { safeFetch } from './safeFetch';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

type Found = Pick<
  typeof linkPreviews.$inferInsert,
  | 'title'
  | 'description'
  | 'siteName'
  | 'imageHash'
  | 'imageWidth'
  | 'imageHeight'
  | 'iconHash'
  | 'hue'
>;

/** Runs a step that may fail without failing the preview: a missing icon still leaves a title. */
async function optional<T>(step: () => Promise<T>): Promise<T | null> {
  try {
    return await step();
  } catch {
    return null;
  }
}

function fileName(url: string) {
  const path = new URL(url).pathname;
  return decodeURIComponent(path.split('/').filter(Boolean).at(-1) ?? '') || null;
}

/** Fetches a link and gathers its preview. Throws when the page cannot be read at all. */
export async function fetchPreview(url: string): Promise<Found> {
  const page = await safeFetch(url, { maxBytes: MAX_HEAD, accept: [''], truncate: true });
  const mime = page.contentType.split(';')[0]?.trim() ?? '';

  // A link straight to an image previews as that image.
  if (mime.startsWith('image/')) {
    const image = await fetchThumbnail(page.url);
    return {
      title: fileName(page.url),
      description: null,
      siteName: null,
      imageHash: image?.hash ?? null,
      imageWidth: image?.width ?? null,
      imageHeight: image?.height ?? null,
      iconHash: null,
      hue: null,
    };
  }
  if (!mime.includes('html')) {
    return {
      title: fileName(page.url),
      description: null,
      siteName: null,
      imageHash: null,
      imageWidth: null,
      imageHeight: null,
      iconHash: null,
      hue: null,
    };
  }

  const meta = parseHtml(decodeHtml(page.contentType, page.body), page.url);
  const [image, icon] = await Promise.all([
    meta.image ? optional(() => fetchThumbnail(meta.image as string)) : null,
    (async () => {
      for (const candidate of meta.icons) {
        const found = await optional(() => fetchIcon(candidate));
        if (found) return found;
      }
      return null;
    })(),
  ]);
  // The site's declared color wins; otherwise the color of its icon.
  const themeRgb = meta.themeColor ? parseCssColor(meta.themeColor) : null;
  const hue = (themeRgb && colorHue(themeRgb)) ?? icon?.hue ?? null;

  return {
    title: meta.title,
    description: meta.description,
    siteName: meta.siteName,
    imageHash: image?.hash ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    iconHash: icon?.hash ?? null,
    hue,
  };
}

// An in-process queue: previews are best effort, and rows left `pending` by a restart are
// queued again at startup (`resumePendingPreviews`).
const CONCURRENCY = 4;
const queued = new Map<string, { userId: string; url: string }>();
let running = 0;

async function run(userId: string, url: string) {
  let values: Partial<typeof linkPreviews.$inferInsert>;
  try {
    values = { ...(await fetchPreview(url)), status: 'ready' };
  } catch {
    values = { status: 'failed' };
  }
  await db
    .update(linkPreviews)
    .set({ ...values, fetchedAt: new Date() })
    .where(and(eq(linkPreviews.userId, userId), eq(linkPreviews.url, url)));
}

function drain() {
  while (running < CONCURRENCY && queued.size > 0) {
    const [key, job] = queued.entries().next().value as [string, { userId: string; url: string }];
    queued.delete(key);
    running += 1;
    void run(job.userId, job.url)
      .catch((error: unknown) => console.error('Link preview failed to save', error))
      .finally(() => {
        running -= 1;
        drain();
      });
  }
}

export function queuePreviews(userId: string, urls: readonly string[]) {
  for (const url of urls) queued.set(`${userId}\n${url}`, { userId, url });
  drain();
}

/**
 * Fetches previews right away and waits for them, for scripts (seeding) that exit before the
 * queue would get to them. A preview that cannot be fetched is saved as failed.
 */
export async function fetchPreviewsNow(userId: string, urls: readonly string[]) {
  await Promise.all(urls.map((url) => run(userId, url)));
}

/** A failed preview is tried again when its note is saved, at most this often. */
const RETRY_FAILED_AFTER = sql`now() - interval '1 day'`;

/**
 * Adds a pending preview for each new link in the content of notes, inside the notes' own
 * transaction so the rows sync with them. Returns the URLs to fetch once it commits.
 */
export async function trackNoteLinks(
  tx: Tx,
  userId: string,
  contents: readonly Note['content'][],
): Promise<string[]> {
  if (!env.LINK_PREVIEWS) return [];
  const urls = [
    ...new Set(
      contents.flatMap((content) =>
        extractLinks(content)
          .slice(0, MAX_NOTE_LINKS)
          .map((link) => link.url),
      ),
    ),
  ];
  if (urls.length === 0) return [];

  const added = await tx
    .insert(linkPreviews)
    .values(urls.map((url) => ({ userId, url })))
    .onConflictDoNothing()
    .returning({ url: linkPreviews.url });
  const retried = await tx
    .update(linkPreviews)
    .set({ status: 'pending' })
    .where(
      and(
        eq(linkPreviews.userId, userId),
        inArray(linkPreviews.url, urls),
        eq(linkPreviews.status, 'failed'),
        or(lt(linkPreviews.fetchedAt, RETRY_FAILED_AFTER), sql`${linkPreviews.fetchedAt} IS NULL`),
      ),
    )
    .returning({ url: linkPreviews.url });
  return [...added, ...retried].map((row) => row.url);
}

/**
 * Queues previews a previous run of the server left unfinished. A server job across every
 * user, so unlike request handlers it does not filter by one.
 */
export async function resumePendingPreviews() {
  if (!env.LINK_PREVIEWS) return;
  const rows = await db
    .select({ userId: linkPreviews.userId, url: linkPreviews.url })
    .from(linkPreviews)
    .where(eq(linkPreviews.status, 'pending'));
  for (const row of rows) queuePreviews(row.userId, [row.url]);
}
