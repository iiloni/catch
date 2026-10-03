import {
  assetHashSchema,
  linkIntakeSchema,
  normalizeUrl,
  refreshLinkPreviewSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { linkPreviewAssets, linkPreviews } from '../db/schema';
import { env } from '../env';
import { requireUser } from '../lib/requireUser';
import { fetchPreview, queuePreviews } from '../linkPreviews';

// Intake is interactive rather than queued. Bound image decoding and network work just
// as the background queue does, and refuse repeated clicks from the same account.
const activeIntakes = new Set<string>();

export const linkPreviewRoutes = new Hono<AppEnv>()
  // Thumbnails and icons are public web content named by their hash, so `<img>` tags load
  // them without credentials (the Android app authenticates with a header, not cookies).
  .get('/assets/:hash', zValidator('param', z.object({ hash: assetHashSchema })), async (c) => {
    const { hash } = c.req.valid('param');
    const [asset] = await db
      .select({ contentType: linkPreviewAssets.contentType, data: linkPreviewAssets.data })
      .from(linkPreviewAssets)
      .where(eq(linkPreviewAssets.hash, hash));
    if (!asset) return c.json({ error: 'Not found' }, 404);
    return c.body(new Uint8Array(asset.data), 200, {
      'content-type': asset.contentType,
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'",
    });
  })
  .post('/intake', requireUser, zValidator('json', refreshLinkPreviewSchema), async (c) => {
    if (!env.LINK_PREVIEWS) return c.json({ error: 'Link fetching is disabled' }, 503);
    const url = normalizeUrl(c.req.valid('json').url);
    if (!url) return c.json({ error: 'Not a web link' }, 400);
    const userId = c.get('user')!.id;
    if (activeIntakes.has(userId) || activeIntakes.size >= 4) {
      c.header('Retry-After', '5');
      return c.json({ error: 'Link fetching is busy. Try again shortly.' }, 429);
    }
    activeIntakes.add(userId);
    c.header('Cache-Control', 'no-store');
    try {
      // Reuse the same bounded, SSRF-safe fetcher and local image copies as saved previews.
      return c.json(linkIntakeSchema.parse(await fetchPreview(url)));
    } catch {
      return c.json({ error: 'Could not fetch this page' }, 422);
    } finally {
      activeIntakes.delete(userId);
    }
  })
  .post('/refresh', requireUser, zValidator('json', refreshLinkPreviewSchema), async (c) => {
    const user = c.get('user')!;
    const url = normalizeUrl(c.req.valid('json').url);
    if (!url) return c.json({ error: 'Not a web link' }, 400);
    const txid = await db.transaction(async (tx) => {
      const updated = await tx
        .update(linkPreviews)
        .set({ status: 'pending' })
        .where(and(eq(linkPreviews.userId, user.id), eq(linkPreviews.url, url)))
        .returning({ url: linkPreviews.url });
      if (updated.length === 0) return null;
      const [row] = await tx.execute<{ txid: string }>(
        sql`SELECT pg_current_xact_id()::xid::text AS txid`,
      );
      return Number(row?.txid);
    });
    if (txid === null) return c.json({ error: 'Preview not found' }, 404);
    queuePreviews(user.id, [url]);
    return c.json({ txid });
  });
