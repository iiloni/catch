import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { isRestoring } from '../backups/service';

vi.mock('../backups/service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../backups/service')>()),
  isRestoring: vi.fn(() => false),
}));

const app = createApp();
const backup = 'catch-backup-2026-10-01_03-04-05-manual.zip';

afterEach(() => vi.mocked(isRestoring).mockReturnValue(false));

describe('server backups api', () => {
  it('answers nobody who is not signed in', async () => {
    for (const [method, path] of [
      ['GET', ''],
      ['POST', ''],
      ['PUT', '/schedule'],
      ['POST', '/upload'],
      ['GET', `/${backup}/access`],
      ['DELETE', `/${backup}`],
      ['POST', `/${backup}/restore`],
    ] as const) {
      const res = await app.request(`/api/admin/backups${path}`, { method });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('does not hand out a backup for a missing or made-up ticket', async () => {
    for (const query of ['', '?access=', '?access=bm90LWEtdGlja2V0.c2lnbmF0dXJl']) {
      const res = await app.request(`/api/admin/backups/${backup}/download${query}`);
      expect(res.status, query).toBe(401);
    }
  });

  it('turns every request away while a restore runs, except the health check', async () => {
    vi.mocked(isRestoring).mockReturnValue(true);
    for (const path of ['/api/notes', '/api/shapes/notes?offset=-1', '/api/admin/backups']) {
      const res = await app.request(path);
      expect(res.status, path).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('5');
    }
    // The server is up, only busy: whatever watches its health must not replace it mid-restore.
    expect((await app.request('/api/health')).status).toBe(200);
  });
});
