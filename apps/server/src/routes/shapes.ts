import { Hono } from 'hono';
import type { AppEnv } from '../context';
import { env } from '../env';
import { requireUser } from '../lib/requireUser';

/** Columns clients may sync. Server-only columns (search vectors) stay out. */
const SHAPES: Record<string, { table: string; columns: string[] }> = {
  tags: { table: 'tags', columns: ['id', 'user_id', 'name', 'parent_id', 'icon', 'color'] },
  'note-tags': {
    table: 'note_tags',
    columns: ['id', 'user_id', 'primary_tag_id', 'secondary_tag_ids'],
  },
  attachments: {
    table: 'attachments',
    columns: [
      'id',
      'user_id',
      'note_id',
      'name',
      'mime_type',
      'size',
      'kind',
      'status',
      'source_id',
      'created_at',
      'deleted_at',
    ],
  },
  notes: {
    table: 'notes',
    columns: [
      'id',
      'user_id',
      'content',
      'color',
      'status',
      'is_pinned',
      'is_archived',
      'position',
      'hidden_links',
      'created_at',
      'updated_at',
      'deleted_at',
    ],
  },
  'board-columns': {
    table: 'board_columns',
    columns: ['id', 'user_id', 'name', 'color', 'position'],
  },
  reminders: {
    table: 'reminders',
    columns: [
      'note_id',
      'user_id',
      'kind',
      'starts_at',
      'time_zone',
      'floating',
      'recurrence',
      'next_at',
      'snoozed_until',
      'fired_at',
    ],
  },
  'note-shares': {
    table: 'note_shares',
    columns: ['note_id', 'user_id', 'token', 'created_at'],
  },
  'shared-notes': {
    table: 'shared_notes',
    columns: [
      'user_id',
      'note_id',
      'token',
      'owner_id',
      'owner_name',
      'content',
      'color',
      'attachments',
      'is_available',
      'is_pinned',
      'is_archived',
      'position',
      'created_at',
      'updated_at',
    ],
  },
  vault: {
    table: 'vaults',
    columns: ['user_id', 'salt', 'iterations', 'password_key', 'recovery_key', 'updated_at'],
  },
  'vault-notes': {
    table: 'vault_notes',
    columns: ['id', 'user_id', 'data', 'created_at', 'updated_at'],
  },
  'link-previews': {
    table: 'link_previews',
    columns: [
      'user_id',
      'url',
      'status',
      'title',
      'description',
      'site_name',
      'image_hash',
      'image_width',
      'image_height',
      'icon_hash',
      'hue',
      'fetched_at',
    ],
  },
};

/**
 * What a client may ask of its shape: where to resume it and how to wait for changes.
 * Electric's other parameters choose rows (`where`, `subset__*`), which is the server's call.
 */
const CLIENT_PARAMS = [
  'offset',
  'handle',
  'cursor',
  'live',
  'live_sse',
  'experimental_live_sse',
  'expired_handle',
  'log',
  'cache-buster',
];

/**
 * Auth proxy in front of Electric. Clients never talk to Electric directly;
 * the server decides which table and rows each user can sync.
 */
export const shapeRoutes = new Hono<AppEnv>().use(requireUser).get('/:shape', async (c) => {
  const shape = Object.hasOwn(SHAPES, c.req.param('shape')) ? SHAPES[c.req.param('shape')] : null;
  if (!shape) return c.json({ error: 'Shape not found' }, 404);
  const user = c.get('user')!;
  const incoming = new URL(c.req.url);
  const upstream = new URL('/v1/shape', env.ELECTRIC_URL);

  for (const [key, value] of incoming.searchParams) {
    if (CLIENT_PARAMS.includes(key)) upstream.searchParams.set(key, value);
  }
  upstream.searchParams.set('table', shape.table);
  upstream.searchParams.set('columns', shape.columns.join(','));
  upstream.searchParams.set('where', 'user_id = $1');
  upstream.searchParams.set('params[1]', user.id);
  if (env.ELECTRIC_SECRET) upstream.searchParams.set('secret', env.ELECTRIC_SECRET);

  const response = await fetch(upstream);
  const headers = new Headers(response.headers);
  // fetch already decoded the body, so these no longer describe it.
  headers.delete('content-encoding');
  headers.delete('content-length');
  headers.set('vary', 'cookie, authorization');
  // Electric answers as if for a CDN in front of it. These are one user's rows, and a shared
  // cache that overlooks `vary` would hand them to the next user to ask.
  const caching = headers.get('cache-control');
  if (caching) {
    headers.set(
      'cache-control',
      caching
        .split(',')
        .map((directive) => directive.trim())
        .filter((directive) => directive !== 'public' && !directive.startsWith('s-maxage'))
        .concat('private')
        .join(', '),
    );
  }
  return new Response(response.body, { status: response.status, headers });
});
