import type { WidgetLaunch } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  ack: vi.fn(async () => {}),
  stop: vi.fn(),
  switch: vi.fn(),
  leave: vi.fn(),
  toast: vi.fn(),
  user: vi.fn(() => ({ id: 'alice' })),
  accounts: vi.fn(() => [{ user: { id: 'alice' } }, { user: { id: 'bob' } }]),
}));
vi.mock('./nativeWidgets', () => ({
  nativeWidgets: { watchLaunch: mocks.watch, acknowledge: mocks.ack },
}));
vi.mock('./accounts', () => ({ switchAccount: mocks.switch }));
vi.mock('./auth', () => ({ getAccounts: mocks.accounts, getSignedInUser: mocks.user }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));
vi.mock('./vault', () => ({ leaveVault: mocks.leave }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('./dockState', () => ({
  editorNote: createStore<unknown>(null),
  quickNote: createStore('closed'),
  quickNoteMounted: createStore(false),
  quickNoteColumn: createStore<string | null>(null),
}));
vi.mock('./linkCapture', () => ({ linkCaptureOpen: createStore(false) }));

import { editorNote, quickNote, quickNoteColumn, quickNoteMounted } from './dockState';
import { watchWidgetLaunch } from './widgetLaunch';

const launch: WidgetLaunch = {
  id: 'tap-1',
  account: 'alice',
  server: 'https://catch.example',
  action: 'compose',
  column: 'garden',
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.watch.mockReturnValue(mocks.stop);
  editorNote.set(null);
  quickNote.set('closed');
  quickNoteMounted.set(false);
  mocks.user.mockReturnValue({ id: 'alice' });
  quickNoteColumn.set(null);
});
function deliver(command = launch) {
  mocks.watch.mock.calls.at(-1)?.[0](command);
}

describe('widget launch delivery', () => {
  it('opens the composer once with its destination and leaves the vault first', async () => {
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate);
    deliver();
    deliver();
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(mocks.leave).toHaveBeenCalledTimes(1);
    expect(quickNote.get()).toBe('open');
    expect(quickNoteColumn.get()).toBe('garden');
    stop();
  });
  it('keeps a command pending across the full account-switch reload', async () => {
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate);
    deliver({ ...launch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('bob'));
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    stop();
    mocks.user.mockReturnValue({ id: 'bob' });
    const stopAfterReload = watchWidgetLaunch(navigate);
    deliver({ ...launch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(quickNoteColumn.get()).toBe('garden');
    stopAfterReload();
  });
  it('waits for an unsaved composer to close before changing accounts', async () => {
    quickNote.set('open');
    quickNoteMounted.set(true);
    const stop = watchWidgetLaunch(vi.fn(async () => {}));
    deliver({ ...launch, account: 'bob' });
    expect(mocks.switch).not.toHaveBeenCalled();
    quickNote.set('closed');
    expect(mocks.switch).not.toHaveBeenCalled();
    quickNoteMounted.set(false);
    await vi.waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('bob'));
    stop();
  });
  it('waits for the exiting composer to unmount before applying a new destination', async () => {
    quickNoteMounted.set(true);
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate);
    deliver();
    expect(navigate).not.toHaveBeenCalled();
    expect(quickNoteColumn.get()).toBeNull();
    quickNoteMounted.set(false);
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(quickNoteColumn.get()).toBe('garden');
    expect(quickNote.get()).toBe('open');
    stop();
  });
  it('discards launches for a signed-out account or another server', async () => {
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate);
    deliver({ ...launch, account: 'gone' });
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledTimes(1));
    deliver({ ...launch, id: 'tap-2', server: 'https://elsewhere.example' });
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledTimes(2));
    expect(navigate).not.toHaveBeenCalled();
    stop();
  });
});
