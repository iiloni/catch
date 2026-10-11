import type { WidgetSnapshot } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  begin: vi.fn(),
  sync: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
  watch: vi.fn(),
  stop: vi.fn(),
  pending: vi.fn(),
  acknowledge: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(async () => {}),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => native,
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.addListener } }));
vi.mock('./auth', () => ({
  getSignedInUser: () => ({ id: 'alice', name: 'Alice' }),
  getAccounts: () => [
    { user: { id: 'alice', name: 'Alice' } },
    { user: { id: 'bob', name: 'Bob' } },
  ],
}));
vi.mock('./collections', () => ({ watchWidgetSnapshot: native.watch }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));

import { nativeWidgets, watchNativeWidgets } from './nativeWidgets';

const snapshot: WidgetSnapshot = { version: 1, notes: [], tags: [], columns: [] };
beforeEach(() => {
  vi.clearAllMocks();
  native.begin.mockResolvedValue({ session: 'generation-1' });
  native.watch.mockReturnValue(native.stop);
  native.addListener.mockResolvedValue({ remove: native.remove });
});
describe('native widget bridge', () => {
  it('sends only account labels and snapshots, never session tokens', async () => {
    const stop = watchNativeWidgets();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    expect(native.begin).toHaveBeenCalledWith({
      account: 'alice',
      server: 'https://catch.example',
      accounts: [
        { id: 'alice', label: 'Alice' },
        { id: 'bob', label: 'Bob' },
      ],
    });
    native.watch.mock.calls[0]?.[0](snapshot);
    expect(native.sync).toHaveBeenCalledWith({ session: 'generation-1', snapshot });
    stop();
    expect(native.stop).toHaveBeenCalled();
  });
  it('does not start a subscription after its page was disposed', async () => {
    let resolve: (value: unknown) => void = () => {};
    native.begin.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const stop = watchNativeWidgets();
    stop();
    resolve({ session: 'late' });
    await Promise.resolve();
    await Promise.resolve();
    expect(native.watch).not.toHaveBeenCalled();
  });
  it('does not stop this account when another signs out', async () => {
    const stop = watchNativeWidgets();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    await nativeWidgets.clear('bob');
    native.watch.mock.calls[0]?.[0](snapshot);
    expect(native.sync).toHaveBeenCalledTimes(1);
    stop();
  });
  it('stops publishing immediately when the active account signs out', async () => {
    const stop = watchNativeWidgets();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    await nativeWidgets.clear('alice');
    native.watch.mock.calls[0]?.[0](snapshot);
    expect(native.sync).not.toHaveBeenCalled();
    stop();
  });
});
