import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { auth } from './auth';
import type { AppEnv } from './context';
import { env, NATIVE_APP_ORIGINS } from './env';
import { boardColumnRoutes } from './routes/boardColumns';
import { linkPreviewRoutes } from './routes/linkPreviews';
import { notesRoutes } from './routes/notes';
import { shapeRoutes } from './routes/shapes';

export function createApp() {
  const app = new Hono<AppEnv>();

  if (env.NODE_ENV !== 'test') app.use(logger());

  app.use(
    '/api/*',
    cors({
      origin: [...NATIVE_APP_ORIGINS, ...env.TRUSTED_ORIGINS],
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization'],
      exposeHeaders: [
        'set-auth-token',
        'electric-offset',
        'electric-handle',
        'electric-schema',
        'electric-cursor',
        'electric-up-to-date',
      ],
    }),
  );

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
    .route('/notes', notesRoutes)
    .route('/board-columns', boardColumnRoutes)
    .route('/link-previews', linkPreviewRoutes)
    .route('/shapes', shapeRoutes);

  return api;
}

export type AppType = ReturnType<typeof createApp>;
