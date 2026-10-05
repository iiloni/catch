import type { ReminderAlarm } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NOTE = '0198f3a0-0000-7000-8000-000000000001';
const GONE = '0198f3a0-0000-7000-8000-000000000002';

const native = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(async () => ({})),
  disable: vi.fn(async () => ({})),
  sync: vi.fn(async () => {}),
  pendingSnoozes: vi.fn(),
  ackSnoozes: vi.fn(async () => {}),
  snoozedUntil: vi.fn((): Date | null | undefined => undefined),
  pending: vi.fn((): string[] => []),
  statusChanged: vi.fn(),
  configure: vi.fn(async () => {}),
  snoozeChanged: vi.fn(),
  test: vi.fn(async () => {}),
  clear: vi.fn(async () => {}),
  listen: vi.fn(),
  remove: vi.fn(async () => {}),
  resume: vi.fn(),
  snooze: vi.fn(),
  hour12: vi.fn(),
  token: vi.fn((): string | null => 'signed-token'),
  watch: vi.fn(),
  stopWatching: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: { getPlatform: () => 'android' },
  registerPlugin: () => ({
    status: native.status,
    enable: native.enable,
    disable: native.disable,
    sync: native.sync,
    pendingSnoozes: native.pendingSnoozes,
    ackSnoozes: native.ackSnoozes,
    configure: native.configure,
    test: native.test,
    clear: native.clear,
    addListener: native.listen,
  }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.resume } }));
vi.mock('./auth', () => ({
  getAuthToken: native.token,
  getSignedInUser: () => ({ id: 'ada', name: 'Ada', email: 'ada@example.com' }),
}));
vi.mock('./clock', () => ({ setSystemHour12: native.hour12 }));
vi.mock('./collections', () => ({
  reminderSnooze: (noteId: string) => (noteId === NOTE ? native.snoozedUntil() : undefined),
  watchReminderAlarms: native.watch,
}));
vi.mock('./syncStatus', () => ({
  getPendingWriteIds: native.pending,
  subscribeToSyncStatus: native.statusChanged,
}));
vi.mock('./reminders', () => ({ snoozeReminder: native.snooze }));
vi.mock('./snooze', () => ({ snoozeMinutes: () => 30, onSnoozeChange: native.snoozeChanged }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));

import { API_PROTOCOL_VERSION } from '@catch/shared';
import { nativeReminders, watchNativeReminders } from './nativeReminders';

const alarm: ReminderAlarm = {
  noteId: NOTE,
  title: 'Water the plants',
  body: '',
  times: ['2026-10-05T08:00'],
  timeZone: null,
  snoozedUntil: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  native.token.mockReturnValue('signed-token');
  native.status.mockResolvedValue({ enabled: true, permission: 'granted', hour24: true });
  native.pendingSnoozes.mockResolvedValue({ snoozes: [] });
  native.snoozedUntil.mockReturnValue(null);
  native.pending.mockReturnValue([]);
  native.statusChanged.mockReturnValue(() => {});
  native.listen.mockResolvedValue({ remove: native.remove });
  native.resume.mockResolvedValue({ remove: native.remove });
  native.watch.mockReturnValue(native.stopWatching);
  native.snoozeChanged.mockReturnValue(() => {});
});

describe('native reminders', () => {
  it.each([
    [{ enabled: true, permission: 'granted' }, 'on'],
    [{ enabled: false, permission: 'granted' }, 'off'],
    [{ enabled: false, permission: 'prompt' }, 'off'],
    // Turned on, then notifications were taken away in Android's settings.
    [{ enabled: true, permission: 'denied' }, 'blocked'],
  ])('reads %o as %s', async (status, state) => {
    native.status.mockResolvedValue(status);
    expect(await nativeReminders.state()).toBe(state);
  });

  it("passes on the system's 12 or 24 hour switch", async () => {
    await nativeReminders.state();
    expect(native.hour12).toHaveBeenCalledWith(false);
  });

  it('hands the phone the alarms with what it needs to ask the server for more', () => {
    const stop = watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).toHaveBeenCalledWith({
      account: 'ada',
      label: 'Ada',
      alarms: [alarm],
      server: 'https://catch.example',
      token: 'signed-token',
      protocol: String(API_PROTOCOL_VERSION),
      unsent: false,
    });
    stop();
    expect(native.stopWatching).toHaveBeenCalled();
  });

  it('says when changes made here are still waiting, and again once they are sent', () => {
    native.pending.mockReturnValue(['write-1']);
    watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).toHaveBeenLastCalledWith(expect.objectContaining({ unsent: true }));

    // Sync status changes for many reasons; only the writes draining is news to the phone.
    native.statusChanged.mock.calls[0]?.[0]();
    expect(native.sync).toHaveBeenCalledTimes(1);
    native.pending.mockReturnValue([]);
    native.statusChanged.mock.calls[0]?.[0]();
    expect(native.sync).toHaveBeenCalledTimes(2);
    expect(native.sync).toHaveBeenLastCalledWith(
      expect.objectContaining({ alarms: [alarm], unsent: false }),
    );
  });

  it('tells the phone nothing once signed out', () => {
    native.token.mockReturnValue(null);
    watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).not.toHaveBeenCalled();
  });

  it('writes a snooze taken from a notification, and only then lets the phone forget it', async () => {
    const until = Date.now() + 60 * 60 * 1000;
    native.pendingSnoozes.mockResolvedValue({
      snoozes: [
        { noteId: NOTE, until },
        // One whose reminder is not loaded yet, or was removed since: the phone keeps it.
        { noteId: GONE, until },
      ],
    });
    watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([alarm]);
    await vi.waitFor(() => expect(native.snooze).toHaveBeenCalledWith(NOTE, new Date(until)));
    expect(native.ackSnoozes).not.toHaveBeenCalled();

    // The write shows in the reminder, which tells the alarms again.
    native.snoozedUntil.mockReturnValue(new Date(until));
    native.watch.mock.calls[0]?.[0]([{ ...alarm, snoozedUntil: until }]);
    await vi.waitFor(() => expect(native.ackSnoozes).toHaveBeenCalledWith({ noteIds: [NOTE] }));
    expect(native.snooze).toHaveBeenCalledTimes(1);
  });

  it('leaves a snooze with the phone while the reminders have not loaded', async () => {
    const until = Date.now() + 60 * 60 * 1000;
    native.pendingSnoozes.mockResolvedValue({ snoozes: [{ noteId: NOTE, until }] });
    native.snoozedUntil.mockReturnValue(undefined);
    watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([]);
    await vi.waitFor(() => expect(native.pendingSnoozes).toHaveBeenCalled());
    await Promise.resolve();
    expect(native.snooze).not.toHaveBeenCalled();
    expect(native.ackSnoozes).not.toHaveBeenCalled();
  });

  it('lets the phone forget a snooze that has passed', async () => {
    native.pendingSnoozes.mockResolvedValue({
      snoozes: [{ noteId: NOTE, until: Date.now() - 1000 }],
    });
    watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([alarm]);
    await vi.waitFor(() => expect(native.ackSnoozes).toHaveBeenCalledWith({ noteIds: [NOTE] }));
    expect(native.snooze).not.toHaveBeenCalled();
  });

  it('leaves another account’s snooze for when that account is in use', async () => {
    native.pendingSnoozes.mockResolvedValue({
      snoozes: [{ noteId: NOTE, until: Date.now() - 1000, account: 'bob' }],
    });
    watchNativeReminders();
    native.watch.mock.calls[0]?.[0]([alarm]);
    await vi.waitFor(() => expect(native.pendingSnoozes).toHaveBeenCalled());
    await Promise.resolve();
    expect(native.ackSnoozes).not.toHaveBeenCalled();
    expect(native.snooze).not.toHaveBeenCalled();
  });

  it('keeps handing the phone its reminders after another account signs out', async () => {
    watchNativeReminders();
    await nativeReminders.clear('bob');
    expect(native.clear).toHaveBeenCalledWith({ account: 'bob' });
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).toHaveBeenCalledTimes(1);
  });

  it('settles snoozes again when the app comes back', async () => {
    watchNativeReminders();
    expect(native.pendingSnoozes).not.toHaveBeenCalled();
    native.resume.mock.calls[0]?.[1]({ isActive: true });
    await vi.waitFor(() => expect(native.pendingSnoozes).toHaveBeenCalledTimes(1));
  });

  it('tells the phone how long its notifications snooze for, and again when that changes', () => {
    watchNativeReminders();
    expect(native.configure).toHaveBeenCalledWith({ snoozeMinutes: 30 });
    native.snoozeChanged.mock.calls[0]?.[0](15);
    expect(native.configure).toHaveBeenLastCalledWith({ snoozeMinutes: 15 });
  });

  it('opens the note of a tapped notification', async () => {
    const open = vi.fn();
    const stop = nativeReminders.onOpen(open);
    native.listen.mock.calls[0]?.[1]({ noteId: NOTE });
    native.listen.mock.calls[0]?.[1]({ noteId: 'not-a-note' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(NOTE, undefined);
    // The phone rings for every account on it, and says whose note was tapped.
    native.listen.mock.calls[0]?.[1]({ noteId: NOTE, userId: 'bob' });
    expect(open).toHaveBeenLastCalledWith(NOTE, 'bob');
    stop();
    await vi.waitFor(() => expect(native.remove).toHaveBeenCalled());
  });

  // Last: the flag holds until the page next loads.
  it('hands nothing more to the phone after signing out clears it', async () => {
    watchNativeReminders();
    await nativeReminders.clear('ada');
    expect(native.clear).toHaveBeenCalledWith({ account: 'ada' });
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).not.toHaveBeenCalled();
  });
});
