import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  platform: 'android',
  versionInfo: vi.fn(),
  getVersion: vi.fn(),
  install: vi.fn(),
  addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => mocks.platform },
  registerPlugin: () => ({ getVersion: mocks.getVersion, install: mocks.install }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: mocks.addListener } }));
vi.mock('./api', () => ({ api: { versionInfo: mocks.versionInfo } }));

beforeEach(() => {
  vi.resetModules();
  mocks.platform = 'android';
  mocks.getVersion.mockResolvedValue({ version: '1.2.0', channel: 'stable' });
  mocks.versionInfo.mockResolvedValue({ version: '1.3.0', channel: 'stable' });
  mocks.install.mockReset().mockResolvedValue(undefined);
});
afterEach(() => vi.useRealTimers());

describe('update checks', () => {
  it('rechecks the server before installing its exact current version', async () => {
    const updates = await import('./updates');
    await updates.checkForUpdates();
    mocks.versionInfo.mockResolvedValueOnce({ version: '1.4.0', channel: 'stable' });
    await updates.installServerVersion();
    expect(mocks.install).toHaveBeenCalledWith({ version: '1.4.0', channel: 'stable' });
  });

  it('never installs when the server cannot be reached or changes channels', async () => {
    const updates = await import('./updates');
    await updates.checkForUpdates();
    mocks.versionInfo.mockRejectedValueOnce(new Error('offline'));
    await updates.installServerVersion();
    mocks.versionInfo.mockResolvedValueOnce({ version: '1.4.0-preview', channel: 'preview' });
    await updates.installServerVersion();
    expect(mocks.install).not.toHaveBeenCalled();
  });

  it('prevents duplicate install requests while a download is pending', async () => {
    const updates = await import('./updates');
    await updates.checkForUpdates();
    let finish = () => {};
    mocks.install.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const first = updates.installServerVersion();
    await vi.waitFor(() => expect(mocks.install).toHaveBeenCalledTimes(1));
    await updates.installServerVersion();
    expect(mocks.install).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });

  it('checks again when connectivity returns and removes its listeners', async () => {
    vi.useFakeTimers();
    const updates = await import('./updates');
    const stop = updates.watchUpdates();
    await updates.checkForUpdates();
    const before = mocks.versionInfo.mock.calls.length;
    window.dispatchEvent(new Event('online'));
    await updates.checkForUpdates();
    expect(mocks.versionInfo.mock.calls.length).toBe(before + 1);
    stop();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(mocks.versionInfo.mock.calls.length).toBe(before + 1);
  });

  it('does not call native code for a web client', async () => {
    mocks.platform = 'web';
    mocks.getVersion.mockClear();
    const updates = await import('./updates');
    await updates.checkForUpdates();
    expect(mocks.getVersion).not.toHaveBeenCalled();
    await updates.installServerVersion();
    expect(mocks.install).not.toHaveBeenCalled();
  });
});
