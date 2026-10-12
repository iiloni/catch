import { hybridSearchSchema } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { ProviderError } from '../ai/provider';
import { capabilities, hybridSearch } from '../ai/search';
import type { AppEnv } from '../context';
import { requireUser } from '../lib/requireUser';

// A query per pause in typing is ordinary use; these only stop a client that floods the provider.
const WINDOW = 10_000;
const MAX_PER_WINDOW = 40;
const MAX_ACTIVE = 8;
const MAX_ACTIVE_PER_USER = 3;
const active = new Map<string, number>();
const recent = new Map<string, number[]>();
export const searchRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .get('/capabilities', async (c) => c.json(await capabilities(c.get('user')!.id)))
  .post('/', zValidator('json', hybridSearchSchema), async (c) => {
    const id = c.get('user')!.id;
    const now = Date.now();
    for (const [key, times] of recent) {
      const kept = times.filter((time) => now - time < WINDOW);
      if (kept.length > 0) recent.set(key, kept);
      else recent.delete(key);
    }
    const running = [...active.values()].reduce((sum, count) => sum + count, 0);
    const sent = recent.get(id) ?? [];
    if (
      running >= MAX_ACTIVE ||
      (active.get(id) ?? 0) >= MAX_ACTIVE_PER_USER ||
      sent.length >= MAX_PER_WINDOW
    ) {
      c.header('Retry-After', '1');
      return c.json({ error: 'Search is busy. Try again shortly.' }, 429);
    }
    active.set(id, (active.get(id) ?? 0) + 1);
    recent.set(id, [...sent, now]);
    const timings: Record<string, number> = {};
    try {
      const result = await hybridSearch(id, c.req.valid('json'), c.req.raw.signal, timings);
      c.header(
        'Server-Timing',
        Object.entries(timings)
          .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
          .join(', '),
      );
      return c.json(result);
    } catch (error) {
      return c.json(
        {
          error:
            error instanceof ProviderError
              ? error.message
              : 'AI search is unavailable. Keyword search still works.',
        },
        503,
      );
    } finally {
      const left = (active.get(id) ?? 1) - 1;
      if (left > 0) active.set(id, left);
      else active.delete(id);
    }
  });
