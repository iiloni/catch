import { describe, expect, it } from 'vitest';
import { authRedirectSearchSchema, authReturnTo } from './authRedirect';

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

it('retains capture fragments without replacing a destination’s own fragment', () => {
  expect(authReturnTo('/capture', '#url=https%3A%2F%2Fexample.com&text=Selected')).toBe(
    '/capture#url=https%3A%2F%2Fexample.com&text=Selected',
  );
  expect(authReturnTo('/?note=one#details', '#other')).toBe('/?note=one#details');
  expect(authReturnTo(undefined, '#unrelated')).toBe('/');
});
