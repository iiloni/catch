import { API_PROTOCOL_HEADER, INVITE_HEADER, SUPPORTED_API_PROTOCOLS } from '@catch/shared';
import { getConnInfo } from '@hono/node-server/conninfo';
import { type Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { isRestoring } from './backups/service';
import type { AppEnv } from './context';
import { env, NATIVE_APP_ORIGINS } from './env';
import { CLIENT_IP_HEADER, clientIp, proxyList } from './lib/clientIp';
import { requireCompatibleProtocol } from './lib/protocol';
import { adminRoutes } from './routes/admin';
import { attachmentRoutes } from './routes/attachments';
import { backupDownloadRoutes } from './routes/backups';
import { boardColumnRoutes } from './routes/boardColumns';
import { historyRoutes } from './routes/history';
import { linkPreviewRoutes } from './routes/linkPreviews';
import { notesRoutes } from './routes/notes';
import { pushRoutes } from './routes/push';
import { reminderRoutes } from './routes/reminders';
import { shapeRoutes } from './routes/shapes';
import { noteShareRoutes, sharedNoteRoutes, shareLinkRoutes } from './routes/sharing';
import { noteTagRoutes, tagRoutes } from './routes/tags';
import { updateRoutes } from './routes/updates';
import { vaultRoutes } from './routes/vault';

/** JSON bodies are read into memory whole. The largest real one is a batch of imported notes. */
export const MAX_JSON_BODY_BYTES = 16 * 1024 * 1024;

const jsonBodyLimit = bodyLimit({
  maxSize: MAX_JSON_BODY_BYTES,
  onError: (c) => c.json({ error: 'The request is too large' }, 413),
});

/** Uploads stream to disk under limits of their own. */
function isStreamedUpload(method: string, path: string) {
  return (
    (method === 'PUT' && /^\/api\/attachments\/[^/]+\/content$/.test(path)) ||
    (method === 'POST' && path === '/api/admin/backups/upload')
  );
}

const trustedProxies = proxyList(env.TRUSTED_PROXIES);

/** The request as Better Auth should see it: with the address it really came from. */
function withClientIp(c: Context) {
  let peer: string | undefined;
  try {
    peer = getConnInfo(c).remote.address;
  } catch {
    // No socket: a request made in a test.
  }
  const headers = new Headers(c.req.raw.headers);
  const ip = clientIp(peer, headers.get('x-forwarded-for') ?? undefined, trustedProxies);
  headers.delete(CLIENT_IP_HEADER);
  if (ip) headers.set(CLIENT_IP_HEADER, ip);
  return new Request(c.req.raw, { headers });
}

export function createApp() {
  const app = new Hono<AppEnv>();

  if (env.NODE_ENV !== 'test')
    app.use(
      logger((...messages) =>
        console.log(
          ...messages.map((message) =>
            message
              .replace(/([?&]access=)[^&\s]+/g, '$1[redacted]')
              // A share link's token is all it takes to read the note (ADR 0021).
              .replace(/(\/(?:api\/shares|s)\/)[A-Za-z0-9_-]{43}/g, '$1[redacted]'),
          ),
        ),
      ),
    );

  app.use(
    '/api/*',
    cors({
      origin: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'Range', API_PROTOCOL_HEADER, INVITE_HEADER],
      exposeHeaders: [
        'set-auth-token',
        'electric-offset',
        'electric-handle',
        'electric-schema',
        'electric-cursor',
        'electric-up-to-date',
        'content-range',
        'accept-ranges',
      ],
    }),
  );

  // A restore replaces every table. Requests wait it out with a retryable error instead of
  // reading half of it, and Electric gets no new shape to snapshot in the middle.
  app.use('/api/*', async (c, next) => {
    if (isRestoring() && c.req.path !== '/api/health') {
      c.header('Retry-After', '5');
      return c.json({ error: 'Catch is restoring a backup. Try again in a moment.' }, 503);
    }
    await next();
  });

  app.use('/api/*', requireCompatibleProtocol);

  app.use('/api/*', (c, next) =>
    isStreamedUpload(c.req.method, c.req.path) ? next() : jsonBodyLimit(c, next),
  );

  app.get('/api/compatibility', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(SUPPORTED_API_PROTOCOLS);
  });

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(withClientIp(c)));

  app.use('/api/*', async (c, next) => {
    const result = await auth.api.getSession({ headers: c.req.raw.headers });
    c.set('user', result?.user ?? null);
    c.set('session', result?.session ?? null);
    await next();
  });

  const api = app
    .basePath('/api')
    .get('/health', (c) => c.json({ ok: true }))
    // Ahead of the admin routes: a download link carries a ticket, not the session their
    // guard requires.
    .route('/admin/backups', backupDownloadRoutes)
    .route('/admin', adminRoutes)
    .route('/notes', notesRoutes)
    .route('/note-history', historyRoutes)
    .route('/tags', tagRoutes)
    .route('/note-tags', noteTagRoutes)
    .route('/attachments', attachmentRoutes)
    .route('/board-columns', boardColumnRoutes)
    .route('/link-previews', linkPreviewRoutes)
    .route('/reminders', reminderRoutes)
    .route('/note-shares', noteShareRoutes)
    .route('/shared-notes', sharedNoteRoutes)
    .route('/shares', shareLinkRoutes)
    .route('/push', pushRoutes)
    .route('/vault', vaultRoutes)
    .route('/updates', updateRoutes)
    .route('/shapes', shapeRoutes);

  return api;
}

export type AppType = ReturnType<typeof createApp>;
