import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION, type LinkIntake } from '@catch/shared';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../context';
import { env } from '../env';
import { requireCompatibleProtocol } from '../lib/protocol';
import { fetchPreview } from '../linkPreviews';
import { linkPreviewRoutes } from './linkPreviews';

vi.mock('../linkPreviews', () => ({ fetchPreview: vi.fn(), queuePreviews: vi.fn() }));
const metadata: LinkIntake = {
  title: 'A page',
  description: 'Some context',
  siteName: 'Example',
  imageHash: null,
  imageWidth: null,
  imageHeight: null,
  iconHash: null,
  hue: null,
};
let signedIn = true;
const app = new Hono<AppEnv>();
app.use('/api/*', requireCompatibleProtocol);
app.use('/api/*', async (c, next) => {
  c.set(
    'user',
    signedIn
      ? {
          id: 'user-1',
          name: '',
          email: 'user@example.com',
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          role: 'user',
        }
      : null,
  );
  await next();
});
app.route('/api/link-previews', linkPreviewRoutes);

const request = (
  url = 'https://example.com/#section',
  protocol: string | null = String(API_PROTOCOL_VERSION),
) =>
  app.request('/api/link-previews/intake', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(protocol === null ? {} : { [API_PROTOCOL_HEADER]: protocol }),
    },
    body: JSON.stringify({ url }),
  });

beforeEach(() => {
  signedIn = true;
  env.LINK_PREVIEWS = true;
  vi.mocked(fetchPreview).mockReset().mockResolvedValue(metadata);
});

describe('link intake', () => {
  it('requires authentication and a compatible protocol before fetching', async () => {
    signedIn = false;
    expect((await request()).status).toBe(401);
    signedIn = true;
    expect((await request(undefined, null)).status).toBe(426);
    expect((await request(undefined, '999')).status).toBe(426);
    expect(fetchPreview).not.toHaveBeenCalled();
  });
  it('validates links and respects the server setting', async () => {
    for (const url of ['javascript:alert(1)', 'not a URL', 'x'.repeat(2049)])
      expect((await request(url)).status).toBe(400);
    env.LINK_PREVIEWS = false;
    expect((await request()).status).toBe(503);
    expect(fetchPreview).not.toHaveBeenCalled();
  });
  it('uses the preview fetcher and returns only optional capture metadata', async () => {
    const response = await request();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(metadata);
    expect(fetchPreview).toHaveBeenCalledWith('https://example.com/');
  });
  it('reports fetch failure without exposing internal details and permits retry', async () => {
    vi.mocked(fetchPreview).mockRejectedValueOnce(new Error('Private internal address'));
    const response = await request();
    expect(response.status).toBe(422);
    expect(await response.text()).not.toContain('Private internal address');
    expect((await request()).status).toBe(200);
  });
  it('bounds concurrent intake for an account', async () => {
    let finish!: (value: LinkIntake) => void;
    vi.mocked(fetchPreview).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    const first = request();
    await vi.waitFor(() => expect(fetchPreview).toHaveBeenCalledTimes(1));
    expect((await request()).status).toBe(429);
    finish(metadata);
    expect((await first).status).toBe(200);
    expect((await request()).status).toBe(200);
  });
});
