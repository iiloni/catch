import { hybridSearchSchema } from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { ProviderError } from '../ai/provider';
import { capabilities, hybridSearch } from '../ai/search';
import type { AppEnv } from '../context';
import { requireUser } from '../lib/requireUser';

const active = new Set<string>();
const recent = new Map<string, number>();
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
    for (const [key, time] of recent) if (now - time > 60_000) recent.delete(key);
    if (active.size >= 8 || active.has(id) || now - (recent.get(id) ?? 0) < 500) {
      c.header('Retry-After', '1');
      return c.json({ error: 'Search is busy. Try again shortly.' }, 429);
    }
    active.add(id);
    recent.set(id, now);
    try {
      return c.json(await hybridSearch(id, c.req.valid('json'), c.req.raw.signal));
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
      active.delete(id);
    }
  });
