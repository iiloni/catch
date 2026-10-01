import { API_PROTOCOL_HEADER, API_PROTOCOL_VERSION } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp();
const request = (path: string, init: RequestInit = {}) => {
  const headers = new Headers(init.headers);
  headers.set(API_PROTOCOL_HEADER, String(API_PROTOCOL_VERSION));
  return app.request(path, { ...init, headers });
};

describe('api', () => {
  it('reports health', async () => {
    const res = await request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects unauthenticated note writes', async () => {
    const res = await request('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '0199a0a0-0000-7000-8000-000000000000', content: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated shape requests', async () => {
    const res = await request('/api/shapes/notes?offset=-1');
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated administrative reads and writes', async () => {
    expect((await request('/api/admin/users')).status).toBe(401);
    expect(
      (await request('/api/admin/users/some-user/reset-password', { method: 'POST' })).status,
    ).toBe(401);
    expect((await request('/api/admin/users/some-user', { method: 'DELETE' })).status).toBe(401);
    expect(
      (
        await request('/api/admin/users/some-user/role', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'admin' }),
        })
      ).status,
    ).toBe(401);
  });
});
