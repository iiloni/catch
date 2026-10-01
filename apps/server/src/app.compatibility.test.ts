import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION, SUPPORTED_API_PROTOCOLS } from '@catch/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from './app';

vi.mock('./auth', () => ({
  auth: {
    handler: () => new Response('{}', { status: 200 }),
    api: { getSession: vi.fn().mockResolvedValue(null) },
  },
}));
afterEach(() => vi.unstubAllGlobals());

const app = createApp();
const supportedHeaders = { [API_PROTOCOL_HEADER]: String(API_PROTOCOL_VERSION) };

describe('API compatibility gate', () => {
  it('advertises its range without a session or protocol header', async () => {
    const response = await app.request('/api/compatibility');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUPPORTED_API_PROTOCOLS);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });

  it.each([
    undefined,
    '',
    '0',
    '1.0',
    '01',
    '-1',
    'garbage',
    '9007199254740992',
    String(SUPPORTED_API_PROTOCOLS.max + 1),
  ])(
    'rejects missing, malformed or unsupported protocol %s before a write or shape fetch',
    async (version) => {
      const fetcher = vi.fn();
      vi.stubGlobal('fetch', fetcher);
      for (const [path, method] of [
        ['/api/notes', 'POST'],
        ['/api/shapes/notes', 'GET'],
        ['/api/attachments/id/content', 'PUT'],
        ['/api/admin/backups/upload', 'POST'],
      ] as const) {
        const response = await app.request(path, {
          method,
          headers: version === undefined ? {} : { [API_PROTOCOL_HEADER]: version },
        });
        expect(response.status).toBe(426);
        expect(await response.json()).toMatchObject({
          code: 'INCOMPATIBLE_PROTOCOL',
          protocol: SUPPORTED_API_PROTOCOLS,
        });
        expect(response.headers.get('Cache-Control')).toBe('no-store');
      }
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it('allows a compatible request through to the authentication guard', async () => {
    expect(
      (await app.request('/api/notes', { method: 'POST', headers: supportedHeaders })).status,
    ).toBe(401);
    expect((await app.request('/api/shapes/notes', { headers: supportedHeaders })).status).toBe(
      401,
    );
  });

  it('keeps health, authentication, updates and byte downloads outside the gate', async () => {
    expect((await app.request('/api/health')).status).toBe(200);
    expect((await app.request('/api/auth/get-session')).status).toBe(200);
    for (const path of [
      '/api/updates',
      '/api/updates/releases',
      '/api/attachments/invalid/content',
      '/api/admin/backups/example.zip/download',
      '/api/link-previews/assets/invalid',
    ]) {
      expect((await app.request(path)).status).not.toBe(426);
    }
    expect((await app.request('/api/updates', { method: 'POST' })).status).toBe(426);
  });

  it('allows Android CORS preflights to declare the protocol', async () => {
    const response = await app.request('/api/notes', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://localhost',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': API_PROTOCOL_HEADER,
      },
    });
    expect(response.status).toBe(204);
    expect(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toContain(
      API_PROTOCOL_HEADER.toLowerCase(),
    );
  });
});
