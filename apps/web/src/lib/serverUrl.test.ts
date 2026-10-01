import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => vi.fn(() => true));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: native } }));

import { getServerUrl, needsServerUrl, setServerUrl } from './serverUrl';

beforeEach(() => {
  localStorage.clear();
  native.mockReturnValue(true);
  vi.stubEnv('DEV', false);
  vi.stubEnv('CATCH_DEV_SERVER_URL', '');
});
afterEach(() => vi.unstubAllEnvs());

describe('server selection', () => {
  it('pins a bundled native dev app to its worktree instead of a previously configured server', () => {
    setServerUrl('https://catch.example');
    vi.stubEnv('CATCH_DEV_SERVER_URL', 'http://llm:26080');
    expect(getServerUrl()).toBe('http://llm:26080');
    expect(needsServerUrl()).toBe(false);
  });

  it('keeps ordinary native builds on the server setup path', () => {
    expect(needsServerUrl()).toBe(true);
    setServerUrl('https://catch.example/path');
    expect(getServerUrl()).toBe('https://catch.example');
    expect(needsServerUrl()).toBe(false);
  });

  it('uses the page origin for the web even when a dev API URL is supplied', () => {
    native.mockReturnValue(false);
    vi.stubEnv('CATCH_DEV_SERVER_URL', 'http://llm:26080');
    expect(getServerUrl()).toBe(window.location.origin);
    expect(needsServerUrl()).toBe(false);
  });

  it('uses the Vite origin for native live reload', () => {
    vi.stubEnv('DEV', true);
    expect(getServerUrl()).toBe(window.location.origin);
    expect(needsServerUrl()).toBe(false);
  });
});
