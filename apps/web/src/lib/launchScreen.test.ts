import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'android',
  ready: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: () => ({ ready: mocks.ready }),
}));

// The module remembers whether it has let the launch screen go, as a page load does.
async function load() {
  vi.resetModules();
  return import('./launchScreen');
}

beforeEach(() => {
  mocks.platform = 'android';
  mocks.ready.mockReset().mockResolvedValue(undefined);
});

describe('launch screen', () => {
  it('lets it go once, at the first page that is ready', async () => {
    const { useFinishLaunch } = await load();
    const { rerender } = renderHook(({ ready }) => useFinishLaunch(ready), {
      initialProps: { ready: false },
    });
    expect(mocks.ready).not.toHaveBeenCalled();
    rerender({ ready: true });
    expect(mocks.ready).toHaveBeenCalledTimes(1);
    renderHook(() => useFinishLaunch(true));
    expect(mocks.ready).toHaveBeenCalledTimes(1);
  });

  it('does nothing outside Android', async () => {
    mocks.platform = 'web';
    const { finishLaunch } = await load();
    finishLaunch();
    expect(mocks.ready).not.toHaveBeenCalled();
  });

  it('tolerates an app without the plugin', async () => {
    mocks.ready.mockRejectedValue(new Error('not implemented'));
    const { finishLaunch } = await load();
    expect(() => finishLaunch()).not.toThrow();
    await Promise.resolve();
  });
});
