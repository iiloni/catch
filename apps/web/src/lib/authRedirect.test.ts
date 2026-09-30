import { describe, expect, it } from 'vitest';
import { authRedirectSearchSchema } from './authRedirect';

describe('authRedirectSearchSchema', () => {
  it.each([
    '/',
    '/archive',
    '/?note=0199a0a0-0000-7000-8000-000000000001#details',
    '/search?q=a%20b',
  ])('preserves the local destination %s', (redirect) => {
    expect(authRedirectSearchSchema.parse({ redirect })).toEqual({ redirect });
  });

  it.each([
    undefined,
    null,
    123,
    ['/', '/archive'],
    '',
    'https://example.com',
    '//example.com',
    '/\\example.com',
    '/\t/example.com',
    '/\r/example.com',
    '/\n/example.com',
    'javascript:alert(1)',
    'archive',
  ])('ignores invalid or external destinations: %j', (redirect) => {
    expect(authRedirectSearchSchema.parse({ redirect }).redirect).toBeUndefined();
  });
});
