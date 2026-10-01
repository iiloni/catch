import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import { isRestoring } from './backups/service';
import type { AppEnv } from './context';
import { env, NATIVE_APP_ORIGINS } from './env';
import { adminRoutes } from './routes/admin';
import { attachmentRoutes } from './routes/attachments';
import { backupDownloadRoutes } from './routes/backups';
import { boardColumnRoutes } from './routes/boardColumns';
import { linkPreviewRoutes } from './routes/linkPreviews';
import { notesRoutes } from './routes/notes';
import { shapeRoutes } from './routes/shapes';

export function createApp() {
  const app = new Hono<AppEnv>();

  if (env.NODE_ENV !== 'test')
    app.use(
      logger((...messages) =>
        console.log(
          ...messages.map((message) => message.replace(/([?&]access=)[^&\s]+/g, '$1[redacted]')),
        ),
      ),
    );

  app.use(
    '/api/*',
    cors({
      origin: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'Range'],
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

  app.on(['GET', 'POST'], '/api/auth/*', (c) => auth.handler(c.req.raw));

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
    .route('/attachments', attachmentRoutes)
    .route('/board-columns', boardColumnRoutes)
    .route('/link-previews', linkPreviewRoutes)
    .route('/shapes', shapeRoutes);

  return api;
}

export type AppType = ReturnType<typeof createApp>;
