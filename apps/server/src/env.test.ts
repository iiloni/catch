import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
it.each(['a'.repeat(64), '界'.repeat(22)])(
  'rejects template database names above 63 UTF-8 bytes',
  async (name) => {
    vi.stubEnv('BACKUP_TEMPLATE_DATABASE', name);
    vi.resetModules();
    await expect(import('./env')).rejects.toThrow('Must be at most 63 UTF-8 bytes');
  },
);
it('accepts a template name at the 63-byte boundary', async () => {
  const name = '界'.repeat(21);
  vi.stubEnv('BACKUP_TEMPLATE_DATABASE', name);
  vi.resetModules();
  expect((await import('./env')).env.BACKUP_TEMPLATE_DATABASE).toBe(name);
});
