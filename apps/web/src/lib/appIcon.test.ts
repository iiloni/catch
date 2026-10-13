import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'web',
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
  useUpdates: () => ({ server: mocks.channel ? { channel: mocks.channel } : null }),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

import { APP_ICON_KEY, setNativeAppIcon, useAppIconPreference, useApplyAppIcon } from './appIcon';

beforeEach(() => {
  localStorage.clear();
  mocks.platform = 'web';
  mocks.channel = null;
  mocks.serverUrl = 'https://preview.example';
  mocks.setIcon.mockReset().mockResolvedValue(undefined);
  document.head.insertAdjacentHTML(
    'beforeend',
    '<link rel="icon" href="/favicon.ico"><link rel="icon" href="/favicon-mark.svg"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="manifest" href="/manifest.webmanifest">',
  );
});
afterEach(() => {
  for (const link of document.head.querySelectorAll('link')) link.remove();
});

describe('app icon preference', () => {
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
      '/manifest.webmanifest',
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
