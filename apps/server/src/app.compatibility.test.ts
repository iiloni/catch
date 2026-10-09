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
    '1',
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
        ['/api/tags', 'POST'],
        ['/api/note-tags/id', 'PATCH'],
        ['/api/shapes/tags', 'GET'],
        ['/api/shapes/note-tags', 'GET'],
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
      '/api/shares/invalid/attachments/invalid/content',
      '/api/admin/backups/example.zip/download',
      '/api/link-previews/assets/invalid',
    ]) {
      expect((await app.request(path)).status).not.toBe(426);
    }
    expect((await app.request('/api/updates', { method: 'POST' })).status).toBe(426);
  });

  it('still serves protocol 2 clients, which have no reminders or shared notes (ADRs 0018, 0021)', async () => {
    expect(SUPPORTED_API_PROTOCOLS).toEqual({ min: 2, max: 5 });
    const older = { [API_PROTOCOL_HEADER]: '2' };
    expect((await app.request('/api/notes', { method: 'POST', headers: older })).status).toBe(401);
    expect((await app.request('/api/shapes/notes', { headers: older })).status).toBe(401);
  });

  it('gates the reminder and push routes like every other data route', async () => {
    const id = '0199a0a0-0000-7000-8000-000000000000';
    for (const [path, method] of [
      [`/api/reminders/${id}`, 'PUT'],
      [`/api/reminders/${id}`, 'DELETE'],
      ['/api/reminders/time-zone', 'PUT'],
      ['/api/reminders/settings', 'GET'],
      ['/api/reminders/alarms', 'GET'],
      ['/api/reminders/settings', 'PUT'],
      ['/api/shapes/reminders', 'GET'],
      ['/api/push/key', 'GET'],
      ['/api/push/subscriptions', 'POST'],
      ['/api/push/subscriptions', 'DELETE'],
      ['/api/push/test', 'POST'],
    ] as const) {
      expect((await app.request(path, { method })).status).toBe(426);
      expect((await app.request(path, { method, headers: supportedHeaders })).status).toBe(401);
    }
  });

  it('gates the sharing routes, and lets a share link be read without an account', async () => {
    const id = '0199a0a0-0000-7000-8000-000000000000';
    const token = 'a'.repeat(43);
    for (const [path, method] of [
      [`/api/note-shares/${id}`, 'PUT'],
      [`/api/note-shares/${id}`, 'DELETE'],
      [`/api/shared-notes/${id}`, 'PATCH'],
      [`/api/shared-notes/${id}`, 'DELETE'],
      [`/api/shares/${token}/accept`, 'POST'],
      ['/api/shapes/note-shares', 'GET'],
      ['/api/shapes/shared-notes', 'GET'],
    ] as const) {
      expect((await app.request(path, { method })).status).toBe(426);
      expect((await app.request(path, { method, headers: supportedHeaders })).status).toBe(401);
    }
    expect((await app.request(`/api/shares/${token}`)).status).toBe(426);
    // A token of the wrong shape never reaches the database.
    expect((await app.request('/api/shares/short', { headers: supportedHeaders })).status).toBe(
      400,
    );
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
