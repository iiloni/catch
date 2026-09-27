import { describe, expect, it } from 'vitest';
import { createApp } from './app';

const app = createApp();

describe('api', () => {
  it('reports health', async () => {
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('rejects unauthenticated note writes', async () => {
    const res = await app.request('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: '0199a0a0-0000-7000-8000-000000000000', content: [] }),
    });
    expect(res.status).toBe(401);
  });

  it('rejects unauthenticated shape requests', async () => {
    const res = await app.request('/api/shapes/notes?offset=-1');
    expect(res.status).toBe(401);
  });
});
