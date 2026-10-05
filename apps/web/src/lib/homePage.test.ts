import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => vi.fn(() => false));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }));

import { rememberHomePage, restoreHomePage } from './homePage';

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  native.mockReturnValue(false);
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('home page on fresh launches', () => {
  it.each(['native', 'standalone', 'iOS standalone'])('restores Deck in %s apps', (platform) => {
    native.mockReturnValue(platform === 'native');
    vi.stubGlobal('matchMedia', () => ({ matches: platform === 'standalone' }));
    if (platform === 'iOS standalone') vi.stubGlobal('navigator', { standalone: true });
    localStorage.setItem('catch-home-page', '/deck');
    window.history.replaceState({ existing: true }, '', '/');
    const length = window.history.length;

    restoreHomePage();

    expect(window.location.pathname).toBe('/deck');
    expect(window.history.state).toEqual({ existing: true });
    expect(window.history.length).toBe(length);
  });

  it.each([null, '/', '/search', 'invalid'])('defaults to Gallery for %j', (saved) => {
    if (saved !== null) localStorage.setItem('catch-home-page', saved);
    restoreHomePage();
    expect(window.location.pathname).toBe('/');
  });

  it.each(['/deck', '/search', '/share?id=one', '/capture#url=example', '/?note=one', '/#details'])(
    'preserves the explicit destination %s',
    (destination) => {
      localStorage.setItem('catch-home-page', '/deck');
      window.history.replaceState(null, '', destination);
      restoreHomePage();
      expect(window.location.pathname + window.location.search + window.location.hash).toBe(
        destination,
      );
    },
  );

  it('keeps ordinary browser tabs on their requested URL without changing the app preference', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    localStorage.setItem('catch-home-page', '/deck');
    restoreHomePage();
    rememberHomePage('/');
    expect(window.location.pathname).toBe('/');
    expect(localStorage.getItem('catch-home-page')).toBe('/deck');
  });

  it('remembers only Deck and Gallery, retaining the choice across other pages', () => {
    rememberHomePage('/deck');
    for (const path of ['/search', '/archive', '/trash', '/settings/general', '/login']) {
      rememberHomePage(path);
    }
    restoreHomePage();
    expect(window.location.pathname).toBe('/deck');

    rememberHomePage('/');
    window.history.replaceState(null, '', '/');
    restoreHomePage();
    expect(window.location.pathname).toBe('/');
  });

  it('still starts and navigates when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Storage unavailable');
    });
    expect(restoreHomePage).not.toThrow();
    expect(() => rememberHomePage('/deck')).not.toThrow();
    expect(window.location.pathname).toBe('/');
  });
});
