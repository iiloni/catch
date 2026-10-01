import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../context';
import { listReleases } from '../lib/releases';
import { updateRoutes } from './updates';

vi.mock('../lib/releases', () => ({ listReleases: vi.fn() }));
vi.mock('../env', () => ({ env: { CATCH_VERSION: '1.2.3-preview', CATCH_CHANNEL: 'preview' } }));
afterEach(() => vi.restoreAllMocks());
const app = new Hono<AppEnv>()
  .use(async (c, next) => {
    c.set(
      'user',
      c.req.header('Authorization')
        ? ({ id: 'user' } as NonNullable<AppEnv['Variables']['user']>)
        : null,
    );
    await next();
  })
  .route('/updates', updateRoutes);

describe('update metadata API', () => {
  it('requires a signed-in user for metadata and releases', async () => {
    for (const path of ['/updates', '/updates/releases'])
      expect((await app.request(path)).status).toBe(401);
  });

  it('reports build version and channel without contacting GitHub', async () => {
    const response = await app.request('/updates', { headers: { Authorization: 'test' } });
    expect(await response.json()).toEqual({ version: '1.2.3-preview', channel: 'preview' });
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it('returns a retryable error when GitHub cannot be reached', async () => {
    vi.mocked(listReleases).mockRejectedValueOnce(new Error('offline'));
    expect(
      (await app.request('/updates/releases', { headers: { Authorization: 'test' } })).status,
    ).toBe(502);
  });
});
