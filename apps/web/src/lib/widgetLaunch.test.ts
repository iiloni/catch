import type { Note, WidgetLaunch } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from './store';

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  pending: vi.fn<() => Promise<WidgetLaunch | null>>(async () => null),
  stored: vi.fn(async () => {}),
  ack: vi.fn(async () => {}),
  stop: vi.fn(),
  switch: vi.fn(),
  leave: vi.fn(),
  toast: vi.fn(),
  user: vi.fn(() => ({ id: 'alice' })),
  accounts: vi.fn(() => [{ user: { id: 'alice' } }, { user: { id: 'bob' } }]),
}));
vi.mock('./nativeWidgets', () => ({
  nativeWidgets: { watchLaunch: mocks.watch, acknowledge: mocks.ack, pending: mocks.pending },
}));
vi.mock('./collections', () => ({ waitForPendingWritesStored: mocks.stored }));
vi.mock('./accounts', () => ({ switchAccount: mocks.switch }));
vi.mock('./auth', () => ({
  getAccounts: mocks.accounts,
  getSignedInUser: mocks.user,
  pagePath: (path: string) => path,
}));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));
vi.mock('./vault', () => ({ leaveVault: mocks.leave }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('./dockState', () => ({
  editorNote: createStore<unknown>(null),
  quickNote: createStore('closed'),
  quickNoteMounted: createStore(false),
  quickNoteColumn: createStore<string | null>(null),
  quickNoteFocusRequest: createStore(0),
}));
vi.mock('./linkCapture', () => ({
  linkCaptureOpen: createStore(false),
  linkCaptureControls: createStore(null),
}));

import { editorNote, quickNote, quickNoteColumn, quickNoteMounted } from './dockState';
import { linkCaptureControls, linkCaptureOpen } from './linkCapture';
import { prepareInitialWidgetLaunch, watchWidgetLaunch } from './widgetLaunch';
import { beforeWidgetOpen, widgetNoteOpening } from './widgetNavigation';

const launch: WidgetLaunch = {
  id: 'tap-1',
  account: 'alice',
  server: 'https://catch.example',
  action: 'compose',
  column: 'garden',
};
beforeEach(() => {
  vi.clearAllMocks();
  beforeWidgetOpen.clear();
  widgetNoteOpening.set(null);
  linkCaptureOpen.set(false);
  linkCaptureControls.set(null);
  mocks.pending.mockResolvedValue(null);
  mocks.stored.mockResolvedValue(undefined);
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
    const stop = watchWidgetLaunch(navigate, vi.fn());
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
    const stop = watchWidgetLaunch(navigate, vi.fn());
    deliver({ ...launch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('bob', undefined));
    expect(mocks.ack).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
    stop();
    mocks.user.mockReturnValue({ id: 'bob' });
    const stopAfterReload = watchWidgetLaunch(navigate, vi.fn());
    deliver({ ...launch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(quickNoteColumn.get()).toBe('garden');
    stopAfterReload();
  });
  it('closes an unsaved composer automatically and waits for its save before changing accounts', async () => {
    quickNote.set('open');
    quickNoteMounted.set(true);
    const stop = watchWidgetLaunch(
      vi.fn(async () => {}),
      vi.fn(),
    );
    deliver({ ...launch, account: 'bob' });
    expect(mocks.switch).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(quickNote.get()).toBe('closed'));
    expect(mocks.switch).not.toHaveBeenCalled();
    quickNoteMounted.set(false);
    await vi.waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('bob', undefined));
    stop();
  });
  it('waits for the exiting composer to unmount before applying a new destination', async () => {
    quickNoteMounted.set(true);
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate, vi.fn());
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
    const stop = watchWidgetLaunch(navigate, vi.fn());
    deliver({ ...launch, account: 'gone' });
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledTimes(1));
    deliver({ ...launch, id: 'tap-2', server: 'https://elsewhere.example' });
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledTimes(2));
    expect(navigate).not.toHaveBeenCalled();
    stop();
  });
});

describe('direct widget opening', () => {
  const noteLaunch: WidgetLaunch = { ...launch, action: 'note', noteId: 'note-2' };
  it('sets the initial note address before the router mounts without consuming the tap', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    mocks.pending.mockResolvedValue(noteLaunch);
    expect(await prepareInitialWidgetLaunch()).toBe(false);
    expect(replace).toHaveBeenCalledWith(window.history.state, '', '/?note=note-2');
    expect(widgetNoteOpening.get()).toBe('note-2');
    expect(mocks.ack).not.toHaveBeenCalled();
    replace.mockRestore();
    window.history.replaceState(null, '', '/');
  });
  it('passes the note through the cold account reload and keeps the wrong account from rendering', async () => {
    mocks.pending.mockResolvedValue({ ...noteLaunch, account: 'bob' });
    expect(await prepareInitialWidgetLaunch()).toBe(true);
    expect(mocks.switch).toHaveBeenCalledWith('bob', 'note-2');
    expect(mocks.ack).not.toHaveBeenCalled();
  });
  it('flushes the current editor and replaces it without closing to the page first', async () => {
    // Only the id is consulted by the launcher; real editor saving is covered by E2E.
    editorNote.set({ id: 'note-1' } as Note);
    const flush = vi.fn();
    beforeWidgetOpen.add(flush);
    const close = vi.fn();
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate, close);
    deliver(noteLaunch);
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(flush).toHaveBeenCalledOnce();
    expect(Math.min(...flush.mock.invocationCallOrder)).toBeLessThan(
      Math.min(...mocks.leave.mock.invocationCallOrder),
    );
    expect(close).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(noteLaunch);
    expect(widgetNoteOpening.get()).toBe('note-2');
    expect(mocks.toast).not.toHaveBeenCalled();
    stop();
  });
  it('waits for durable local edits before reloading into another account’s note', async () => {
    let stored = () => {};
    mocks.stored.mockReturnValue(
      new Promise<void>((resolve) => {
        stored = resolve;
      }),
    );
    const stop = watchWidgetLaunch(
      vi.fn(async () => {}),
      vi.fn(),
    );
    deliver({ ...noteLaunch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.stored).toHaveBeenCalledOnce());
    expect(mocks.switch).not.toHaveBeenCalled();
    stored();
    await vi.waitFor(() => expect(mocks.switch).toHaveBeenCalledWith('bob', 'note-2'));
    expect(mocks.ack).not.toHaveBeenCalled();
    stop();
  });
  it('keeps the latest tap while an earlier account switch waits for storage', async () => {
    let stored = () => {};
    mocks.stored.mockReturnValue(
      new Promise<void>((resolve) => {
        stored = resolve;
      }),
    );
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate, vi.fn());
    deliver({ ...noteLaunch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.stored).toHaveBeenCalledOnce());
    deliver({ ...noteLaunch, id: 'tap-2', noteId: 'note-3' });
    stored();
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-2'));
    expect(mocks.switch).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledOnce();
    expect(widgetNoteOpening.get()).toBe('note-3');
    stop();
  });
  it('closes an editor automatically before composing instead of asking the user', async () => {
    editorNote.set({ id: 'note-1' } as Note);
    const close = vi.fn(() => editorNote.set(null));
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate, close);
    deliver();
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(close).toHaveBeenCalledOnce();
    expect(quickNote.get()).toBe('open');
    expect(mocks.toast).not.toHaveBeenCalled();
    stop();
  });
  it('closes the editor only once when Search is redelivered during its exit', async () => {
    editorNote.set({ id: 'note-1' } as Note);
    const close = vi.fn();
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate, close);
    const search = { ...launch, action: 'search' as const };
    deliver(search);
    deliver(search);
    await vi.waitFor(() => expect(close).toHaveBeenCalled());
    editorNote.set({ id: 'note-1' } as Note);
    deliver(search);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(close).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    editorNote.set(null);
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(navigate).toHaveBeenCalledExactlyOnceWith(search);
    stop();
  });
  it('saves a valid link capture once and waits until it is closed', async () => {
    const save = vi.fn();
    linkCaptureOpen.set(true);
    linkCaptureControls.set({ canSave: true, busy: false, saving: false, save, cancel: vi.fn() });
    const navigate = vi.fn(async () => {});
    const stop = watchWidgetLaunch(navigate, vi.fn());
    deliver(noteLaunch);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    deliver(noteLaunch);
    expect(navigate).not.toHaveBeenCalled();
    linkCaptureControls.set(null);
    linkCaptureOpen.set(false);
    await vi.waitFor(() => expect(mocks.ack).toHaveBeenCalledWith('tap-1'));
    expect(save).toHaveBeenCalledOnce();
    stop();
  });
  it('does not reload or acknowledge a tap if edits cannot reach local storage', async () => {
    mocks.stored.mockRejectedValue(new Error('Device storage failed'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const stop = watchWidgetLaunch(
      vi.fn(async () => {}),
      vi.fn(),
    );
    deliver({ ...noteLaunch, account: 'bob' });
    await vi.waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.switch).not.toHaveBeenCalled();
    expect(mocks.ack).not.toHaveBeenCalled();
    stop();
    error.mockRestore();
  });
});
