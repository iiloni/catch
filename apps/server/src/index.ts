import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app';
import { startBackupSchedule } from './backups/service';
import { env } from './env';
import { appContentSecurityPolicy, securityHeaders } from './lib/securityHeaders';
import { resumePendingPreviews } from './linkPreviews';
import { startReminderSchedule } from './reminders/scheduler';

const webDist = env.WEB_DIST_DIR;
const indexHtml = webDist ? await readFile(join(webDist, 'index.html'), 'utf8') : null;

const app = new Hono()
  .use(
    securityHeaders({
      app: indexHtml ? appContentSecurityPolicy(indexHtml) : null,
      https: env.BETTER_AUTH_URL.startsWith('https:'),
    }),
  )
  .route('/', createApp());

if (webDist && indexHtml !== null) {
  app.use('/*', async (c, next) => {
    if (c.req.path === '/sw.js' || c.req.path === '/build.json') {
      c.header('Cache-Control', 'no-store');
    } else if (!c.req.path.startsWith('/assets/')) {
      c.header('Cache-Control', 'no-cache');
    }
    await next();
  });
  app.use('/*', serveStatic({ root: webDist }));
  // Client-side routes fall back to the SPA shell.
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Catch server listening on http://localhost:${info.port}`);
  resumePendingPreviews().catch((error: unknown) => {
    console.error('Could not resume link previews', error);
  });
  startBackupSchedule();
  startReminderSchedule();
});
