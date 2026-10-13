import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  appChannel: null as 'stable' | 'preview' | 'dev' | null,
  channel: null as 'stable' | 'preview' | 'dev' | null,
  serverUrl: 'https://preview.example',
  setIcon: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: () => ({ setIcon: mocks.setIcon }),
}));
vi.mock('./serverUrl', () => ({ getServerUrl: () => mocks.serverUrl }));
vi.mock('./updates', () => ({
  useUpdates: () => ({
    android: mocks.platform === 'android',
    app: mocks.appChannel ? { channel: mocks.appChannel } : null,
    server: mocks.channel ? { channel: mocks.channel } : null,
  }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { APP_ICON_KEY, setNativeAppIcon, useAppIconPreference, useApplyAppIcon } from './appIcon';

beforeEach(() => {
  vi.stubEnv('CATCH_CHANNEL', 'stable');
  localStorage.clear();
  mocks.platform = 'web';
  mocks.appChannel = null;
  mocks.channel = null;
  mocks.serverUrl = 'https://preview.example';
  mocks.setIcon.mockReset().mockResolvedValue(undefined);
  document.head.insertAdjacentHTML(
    'beforeend',
    '<link rel="icon" href="/favicon.ico"><link rel="icon" href="/favicon-mark.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">',
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  for (const link of document.head.querySelectorAll('link')) link.remove();
});

describe('app icon preference', () => {
  it('dev builds default to dev, preserve all choices, and use dev install artwork', () => {
    vi.stubEnv('CATCH_CHANNEL', 'dev');
    mocks.channel = 'stable';
    const preference = renderHook(useAppIconPreference);
    expect(preference.result.current[0]).toBe('dev');
    const applied = renderHook(useApplyAppIcon);
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/dev/favicon.ico');
    expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest-dev.webmanifest',
    );
    act(() => preference.result.current[1]('stable'));
    expect(preference.result.current[0]).toBe('stable');
    expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest-stable.webmanifest',
    );
    applied.unmount();
  });

  it('uses the installed dev app identity even with released web metadata', () => {
    mocks.platform = 'android';
    mocks.appChannel = 'dev';
    mocks.channel = 'preview';
    expect(renderHook(useAppIconPreference).result.current[0]).toBe('dev');
  });

  it('released builds ignore a dev preference', () => {
    mocks.channel = 'preview';
    localStorage.setItem(APP_ICON_KEY, JSON.stringify({ icon: 'dev', server: mocks.serverUrl }));
    expect(renderHook(useAppIconPreference).result.current[0]).toBe('stable');
  });
  it('defaults to stable and ignores corrupt preferences', () => {
    localStorage.setItem(APP_ICON_KEY, 'invalid');
    expect(renderHook(useAppIconPreference).result.current[0]).toBe('stable');
  });

  it('keeps a choice after remount, scoped to the chosen server', () => {
    const hook = renderHook(useAppIconPreference);
    act(() => hook.result.current[1]('preview'));
    hook.unmount();
    expect(renderHook(useAppIconPreference).result.current[0]).toBe('preview');
    mocks.serverUrl = 'https://stable.example';
    expect(renderHook(useAppIconPreference).result.current[0]).toBe('stable');
  });

  it('changes all browser/install icons, keeps preview offline, and falls back on stable servers', () => {
    localStorage.setItem(
      APP_ICON_KEY,
      JSON.stringify({ icon: 'preview', server: mocks.serverUrl }),
    );
    const hook = renderHook(useApplyAppIcon);
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/preview/favicon.ico',
    );
    expect(document.querySelectorAll('link[rel="icon"]')[1]).toHaveAttribute(
      'href',
      '/preview/favicon-mark.svg',
    );
    expect(document.querySelector('link[rel="apple-touch-icon"]')).toHaveAttribute(
      'href',
      '/preview/apple-touch-icon.png',
    );
    expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest-preview.webmanifest',
    );
    mocks.channel = 'stable';
    hook.rerender();
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute('href', '/favicon.ico');
    expect(document.querySelector('link[rel="manifest"]')).toHaveAttribute(
      'href',
      '/manifest-stable.webmanifest',
    );
    mocks.channel = 'preview';
    hook.rerender();
    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      'href',
      '/preview/favicon.ico',
    );
  });

  it('orders native changes and recovers after a failed change', async () => {
    mocks.platform = 'android';
    mocks.setIcon.mockRejectedValueOnce(new Error('Failed'));
    const first = setNativeAppIcon('preview');
    const second = setNativeAppIcon('stable');
    await expect(first).rejects.toThrow('Failed');
    await second;
    expect(mocks.setIcon.mock.calls).toEqual([[{ icon: 'preview' }], [{ icon: 'stable' }]]);
  });

  it('restores the Android icon at launch and resets it on a non-preview server', async () => {
    mocks.platform = 'android';
    localStorage.setItem(
      APP_ICON_KEY,
      JSON.stringify({ icon: 'preview', server: mocks.serverUrl }),
    );
    const hook = renderHook(useApplyAppIcon);
    await waitFor(() => expect(mocks.setIcon).toHaveBeenLastCalledWith({ icon: 'preview' }));
    mocks.channel = 'dev';
    hook.rerender();
    await waitFor(() => expect(mocks.setIcon).toHaveBeenLastCalledWith({ icon: 'stable' }));
  });
});
