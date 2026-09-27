import { ELECTRIC_PROTOCOL_QUERY_PARAMS } from '@electric-sql/client';
import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { env } from '../env';
import { requireUser } from '../lib/requireUser';

/** Columns clients may sync. Server-only columns (search vectors) stay out. */
const NOTE_COLUMNS = [
  'id',
  'user_id',
  'content',
  'color',
  'status',
  'is_pinned',
  'is_archived',
  'created_at',
  'updated_at',
  'deleted_at',
];

/**
 * Auth proxy in front of Electric. Clients never talk to Electric directly;
 * the server decides which table and rows each user can sync.
 */
export const shapeRoutes = new Hono<AppEnv>().use(requireUser).get('/notes', async (c) => {
  const user = c.get('user')!;
  const incoming = new URL(c.req.url);
  const upstream = new URL('/v1/shape', env.ELECTRIC_URL);

  for (const [key, value] of incoming.searchParams) {
    if (ELECTRIC_PROTOCOL_QUERY_PARAMS.includes(key)) upstream.searchParams.set(key, value);
  }
  upstream.searchParams.set('table', 'notes');
  upstream.searchParams.set('columns', NOTE_COLUMNS.join(','));
  upstream.searchParams.set('where', 'user_id = $1');
  upstream.searchParams.set('params[1]', user.id);
  if (env.ELECTRIC_SECRET) upstream.searchParams.set('secret', env.ELECTRIC_SECRET);

  const response = await fetch(upstream);
  const headers = new Headers(response.headers);
  // fetch already decoded the body, so these no longer describe it.
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('vary', 'cookie, authorization');
  return new Response(response.body, { status: response.status, headers });
});
