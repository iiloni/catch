import {
  aiModelDiscoveryRequestSchema,
  aiProviderRequestSchema,
  aiRebuildRequestSchema,
  saveAiConfigurationSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import {
  AiAccessDenied,
  ConfigurationConflict,
  overview,
  resolveProvider,
  restartIndex,
  saveConfiguration,
  testProvider,
} from '../ai/configuration';
import { listModels, ProviderError } from '../ai/provider';
import type { AppEnv } from '../context';

export const aiRoutes = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.header('Cache-Control', 'no-store');
    await next();
  })
  .onError((error, c) => {
    if (error instanceof AiAccessDenied) return c.json({ error: 'Admin access required' }, 403);
    if (error instanceof ConfigurationConflict)
      return c.json(
        { error: 'AI configuration changed in another session. Reload this page before saving.' },
        409,
      );
    if (error instanceof ProviderError) return c.json({ error: error.message }, 502);
    console.error('AI configuration request failed.');
    return c.json({ error: 'Could not update AI configuration.' }, 500);
  })
  .get('/', async (c) => c.json(await overview()))
  .put('/', zValidator('json', saveAiConfigurationSchema), async (c) =>
    c.json(await saveConfiguration(c.req.valid('json'), c.get('user')!.id)),
  )
  .post('/models', zValidator('json', aiModelDiscoveryRequestSchema), async (c) => {
    const provider = await resolveProvider(c.req.valid('json'));
    return c.json(await listModels(provider));
  })
  .post('/test', zValidator('json', aiProviderRequestSchema), async (c) => {
    const provider = await resolveProvider(c.req.valid('json'));
    const start = performance.now();
    const dimensions = await testProvider(provider);
    return c.json({
      dimensions,
      milliseconds: Math.round(performance.now() - start),
    });
  })
  .post('/retry', async (c) => c.json(await restartIndex(c.get('user')!.id, false)))
  .post('/rebuild', zValidator('json', aiRebuildRequestSchema), async (c) =>
    c.json(await restartIndex(c.get('user')!.id, true, c.req.valid('json').revision)),
  );
