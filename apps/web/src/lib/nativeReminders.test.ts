import type { ReminderAlarm } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NOTE = '0198f3a0-0000-7000-8000-000000000001';
const GONE = '0198f3a0-0000-7000-8000-000000000002';

const native = vi.hoisted(() => ({
  status: vi.fn(),
  enable: vi.fn(async () => ({})),
  disable: vi.fn(async () => ({})),
  sync: vi.fn(async () => {}),
  takeSnoozes: vi.fn(),
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
    takeSnoozes: native.takeSnoozes,
    test: native.test,
    clear: native.clear,
    addListener: native.listen,
  }),
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: native.resume } }));
vi.mock('./auth', () => ({ getAuthToken: native.token }));
vi.mock('./clock', () => ({ setSystemHour12: native.hour12 }));
vi.mock('./collections', () => ({
  hasReminder: (noteId: string) => noteId === NOTE,
  watchReminderAlarms: native.watch,
}));
vi.mock('./reminders', () => ({ snoozeReminder: native.snooze }));
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
  native.takeSnoozes.mockResolvedValue({ snoozes: [] });
  native.listen.mockResolvedValue({ remove: native.remove });
  native.resume.mockResolvedValue({ remove: native.remove });
  native.watch.mockReturnValue(native.stopWatching);
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

  it('hands the phone the alarms with what it needs to ask the server for more', async () => {
    const stop = watchNativeReminders();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).toHaveBeenCalledWith({
      alarms: [alarm],
      server: 'https://catch.example',
      token: 'signed-token',
      protocol: String(API_PROTOCOL_VERSION),
    });
    stop();
    expect(native.stopWatching).toHaveBeenCalled();
  });

  it('tells the phone nothing once signed out', async () => {
    native.token.mockReturnValue(null);
    watchNativeReminders();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    native.watch.mock.calls[0]?.[0]([alarm]);
    expect(native.sync).not.toHaveBeenCalled();
  });

  it('writes snoozes taken from notifications before telling the phone its alarms', async () => {
    const until = Date.now() + 60 * 60 * 1000;
    native.takeSnoozes.mockResolvedValue({
      snoozes: [
        { noteId: NOTE, until },
        // Over already, and one whose reminder was removed since.
        { noteId: NOTE, until: Date.now() - 1000 },
        { noteId: GONE, until },
      ],
    });
    native.watch.mockImplementation(() => {
      expect(native.snooze).toHaveBeenCalledTimes(1);
      return native.stopWatching;
    });
    watchNativeReminders();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    expect(native.snooze).toHaveBeenCalledWith(NOTE, new Date(until));
  });

  it('takes snoozes again when the app comes back', async () => {
    watchNativeReminders();
    await vi.waitFor(() => expect(native.watch).toHaveBeenCalled());
    expect(native.takeSnoozes).toHaveBeenCalledTimes(1);
    native.resume.mock.calls[0]?.[1]({ isActive: true });
    await vi.waitFor(() => expect(native.takeSnoozes).toHaveBeenCalledTimes(2));
  });

  it('opens the note of a tapped notification', async () => {
    const open = vi.fn();
    const stop = nativeReminders.onOpen(open);
    native.listen.mock.calls[0]?.[1]({ noteId: NOTE });
    native.listen.mock.calls[0]?.[1]({ noteId: 'not-a-note' });
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith(NOTE);
    stop();
    await vi.waitFor(() => expect(native.remove).toHaveBeenCalled());
  });
});
