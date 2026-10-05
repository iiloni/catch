import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { API_PROTOCOL_VERSION, type ReminderAlarm } from '@catch/shared';
import { z } from 'zod';
import { getAuthToken } from './auth';
import { setSystemHour12 } from './clock';
import { reminderSnooze, watchReminderAlarms } from './collections';
import { snoozeReminder } from './reminders';
import { getServerUrl } from './serverUrl';
import { onSnoozeChange, snoozeMinutes } from './snooze';
import { getPendingWriteIds, subscribeToSyncStatus } from './syncStatus';

const statusSchema = z.object({
  enabled: z.boolean(),
  permission: z.enum(['granted', 'prompt', 'denied']),
  hour24: z.boolean().optional(),
});
const snoozesSchema = z.object({
  snoozes: z.array(z.object({ noteId: z.uuid(), until: z.number() })),
});
const openSchema = z.object({ noteId: z.uuid() });

const Reminders = registerPlugin<{
  status(): Promise<unknown>;
  enable(): Promise<unknown>;
  disable(): Promise<unknown>;
  sync(options: {
    alarms: ReminderAlarm[];
    server: string;
    token: string;
    protocol: string;
    unsent: boolean;
  }): Promise<void>;
  configure(options: { snoozeMinutes: number }): Promise<void>;
  pendingSnoozes(): Promise<unknown>;
  ackSnoozes(options: { noteIds: string[] }): Promise<void>;
  test(): Promise<void>;
  clear(): Promise<void>;
  addListener(event: 'open', listener: (event: unknown) => void): Promise<PluginListenerHandle>;
}>('Reminders');

const available = Capacitor.getPlatform() === 'android';

// The watcher outlives the sign-out that clears the phone, and would hand the token back.
let cleared = false;

async function status() {
  const status = statusSchema.parse(await Reminders.status());
  if (status.hour24 !== undefined) setSystemHour12(!status.hour24);
  return status;
}

/**
 * The Android app rings reminders itself (ADR 0018): the web app hands the phone each
 * reminder's coming times, and the phone sets alarms for them, so they ring offline and
 * with the app closed. It is also given the server and a token, to ask for reminders set
 * on other devices while the app stays closed.
 */
export const nativeReminders = {
  available,
  async state() {
    const { enabled, permission } = await status();
    if (permission === 'denied') return 'blocked' as const;
    return enabled && permission === 'granted' ? ('on' as const) : ('off' as const);
  },
  async enable() {
    await Reminders.enable();
  },
  async disable() {
    await Reminders.disable();
  },
  test: () => Reminders.test(),
  /** Signing out. Nothing more is told to the phone until the page next loads. */
  async clear() {
    cleared = true;
    if (available) await Reminders.clear();
  },
  /**
   * Switching accounts. The phone forgets the alarms and snoozes of the account being left
   * and checks for the next one's with its token, without notifications being turned off as
   * `clear` would. Nothing more is told to the phone until the page next loads.
   */
  async handOver(token: string) {
    if (!available) return;
    cleared = true;
    const { snoozes } = snoozesSchema.parse(await Reminders.pendingSnoozes());
    if (snoozes.length > 0) {
      await Reminders.ackSnoozes({ noteIds: snoozes.map(({ noteId }) => noteId) });
    }
    await Reminders.sync({
      alarms: [],
      server: getServerUrl(),
      token,
      protocol: String(API_PROTOCOL_VERSION),
      unsent: false,
    });
  },
  /** A tapped notification opens its note, including the one that launched the app. */
  onOpen(open: (noteId: string) => void) {
    const listening = Reminders.addListener('open', (event) => {
      const parsed = openSchema.safeParse(event);
      if (parsed.success) open(parsed.data.noteId);
    });
    return () => {
      void listening.then((listener) => listener.remove());
    };
  },
};

// Written this session, so one the server turned down is not written round and round.
const written = new Set<string>();

/**
 * A snooze taken from a notification is the phone's alone until the web app writes it here,
 * which is how the server and the user's other devices learn of it. The phone keeps it
 * until told it has been written: at launch the reminders may not be loaded yet, and a
 * snooze taken from the phone then would be lost.
 */
async function settleSnoozes() {
  const { snoozes } = snoozesSchema.parse(await Reminders.pendingSnoozes());
  const settled: string[] = [];
  for (const { noteId, until } of snoozes) {
    const snoozed = reminderSnooze(noteId);
    if (until <= Date.now() || snoozed?.getTime() === until) {
      settled.push(noteId);
    } else if (snoozed !== undefined && !written.has(`${noteId}:${until}`)) {
      // Left with the phone until the reminder is seen to hold it.
      written.add(`${noteId}:${until}`);
      snoozeReminder(noteId, new Date(until));
    }
  }
  if (settled.length > 0) await Reminders.ackSnoozes({ noteIds: settled });
}

/** Keeps the phone's alarms in step with the reminders while the app runs. */
export function watchNativeReminders() {
  if (!available) return () => {};
  const failed = (error: unknown) => console.error('Reminders did not reach the phone', error);
  let alarms: ReminderAlarm[] | null = null;
  const unsent = () => getPendingWriteIds().length > 0;
  let wasUnsent = unsent();
  const tell = () => {
    const token = getAuthToken();
    if (alarms === null || !token || cleared) return;
    wasUnsent = unsent();
    void Reminders.sync({
      alarms,
      server: getServerUrl(),
      token,
      protocol: String(API_PROTOCOL_VERSION),
      // The phone's background check must not replace this list with the server's while
      // changes made here are still waiting to be sent.
      unsent: wasUnsent,
    }).catch(failed);
  };
  const stopWatching = watchReminderAlarms((next) => {
    alarms = next;
    void settleSnoozes().catch(failed);
    tell();
  });
  const stopFollowingWrites = subscribeToSyncStatus(() => {
    if (unsent() !== wasUnsent) tell();
  });
  void status().catch(failed);
  // A notification's Snooze works with the app closed, so the phone keeps the length itself.
  const configure = (minutes: number) =>
    void Reminders.configure({ snoozeMinutes: minutes }).catch(failed);
  configure(snoozeMinutes());
  const stopFollowing = onSnoozeChange(configure);
  const resumed = App.addListener('appStateChange', ({ isActive }) => {
    if (!isActive) return;
    void status().catch(failed);
    void settleSnoozes().catch(failed);
  });
  return () => {
    stopWatching();
    stopFollowingWrites();
    stopFollowing();
    void resumed.then((listener) => listener.remove());
  };
}
