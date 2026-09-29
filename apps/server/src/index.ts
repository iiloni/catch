import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { createApp } from './app';
import { env } from './env';
import { resumePendingPreviews } from './linkPreviews';

const app = new Hono().route('/', createApp());

if (env.WEB_DIST_DIR) {
  const webDist = env.WEB_DIST_DIR;
  const indexHtml = await readFile(join(webDist, 'index.html'), 'utf8');
  app.use('/*', serveStatic({ root: webDist }));
  // Client-side routes fall back to the SPA shell.
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
}

serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`Catch server listening on http://localhost:${info.port}`);
  resumePendingPreviews().catch((error: unknown) => {
    console.error('Could not resume link previews', error);
  });
});
