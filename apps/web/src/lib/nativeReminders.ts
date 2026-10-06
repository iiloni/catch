import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { API_PROTOCOL_VERSION, type ReminderAlarm } from '@catch/shared';
import { z } from 'zod';
import { getAuthToken, getSignedInUser } from './auth';
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
  // `account` is whose reminder it is; a snooze from before the phone kept several has none.
  snoozes: z.array(
    z.object({ noteId: z.uuid(), until: z.number(), account: z.string().optional() }),
  ),
});
const openSchema = z.object({ noteId: z.uuid(), userId: z.string().optional() });

const Reminders = registerPlugin<{
  status(): Promise<unknown>;
  enable(): Promise<unknown>;
  disable(): Promise<unknown>;
  sync(options: {
    account: string;
    label: string;
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
  clear(options: { account?: string }): Promise<void>;
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
 * on other devices while the app stays closed. It keeps these for every account signed in
 * on the device, so each one's reminders ring whichever is in use.
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
  /**
   * An account signing out: the phone forgets its alarms and its token, and goes on ringing
   * for the others. For the account in use, nothing more is told to the phone until the
   * page next loads.
   */
  async clear(userId?: string) {
    if (!userId || userId === getSignedInUser()?.id) cleared = true;
    if (available) await Reminders.clear({ account: userId });
  },
  /** A tapped notification opens its note, including the one that launched the app. */
  onOpen(open: (noteId: string, userId?: string) => void) {
    const listening = Reminders.addListener('open', (event) => {
      const parsed = openSchema.safeParse(event);
      if (parsed.success) open(parsed.data.noteId, parsed.data.userId || undefined);
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
  const userId = getSignedInUser()?.id;
  for (const { noteId, until, account } of snoozes) {
    // Another account's, to be written when that account is next in use.
    if (account && account !== userId) continue;
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
    const user = getSignedInUser();
    if (alarms === null || !token || !user || cleared) return;
    wasUnsent = unsent();
    void Reminders.sync({
      // The phone keeps a list and a token for each account signed in on it (ADR 0019).
      account: user.id,
      label: user.name || user.email,
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
