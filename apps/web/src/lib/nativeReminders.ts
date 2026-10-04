import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { API_PROTOCOL_VERSION, type ReminderAlarm } from '@catch/shared';
import { z } from 'zod';
import { getAuthToken } from './auth';
import { setSystemHour12 } from './clock';
import { hasReminder, watchReminderAlarms } from './collections';
import { snoozeReminder } from './reminders';
import { getServerUrl } from './serverUrl';
import { onSnoozeChange, snoozeMinutes } from './snooze';

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
  }): Promise<void>;
  configure(options: { snoozeMinutes: number }): Promise<void>;
  takeSnoozes(): Promise<unknown>;
  test(): Promise<void>;
  clear(): Promise<void>;
  addListener(event: 'open', listener: (event: unknown) => void): Promise<PluginListenerHandle>;
}>('Reminders');

const available = Capacitor.getPlatform() === 'android';

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
  async clear() {
    if (available) await Reminders.clear();
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

/**
 * A snooze taken from a notification is the phone's alone until the web app hears of it
 * here and writes it, which is how the server and the user's other devices learn of it.
 */
async function takeSnoozes() {
  const { snoozes } = snoozesSchema.parse(await Reminders.takeSnoozes());
  for (const { noteId, until } of snoozes) {
    if (until > Date.now() && hasReminder(noteId)) snoozeReminder(noteId, new Date(until));
  }
}

/** Keeps the phone's alarms in step with the reminders while the app runs. */
export function watchNativeReminders() {
  if (!available) return () => {};
  let stopped = false;
  let stopWatching = () => {};
  const failed = (error: unknown) => console.error('Reminders did not reach the phone', error);
  const returned = () => {
    void status().catch(failed);
    void takeSnoozes().catch(failed);
  };
  // Snoozes first: alarms told before them would be told without them.
  void takeSnoozes()
    .catch(failed)
    .then(() => {
      if (stopped) return;
      stopWatching = watchReminderAlarms((alarms) => {
        const token = getAuthToken();
        if (!token) return;
        void Reminders.sync({
          alarms,
          server: getServerUrl(),
          token,
          protocol: String(API_PROTOCOL_VERSION),
        }).catch(failed);
      });
    });
  void status().catch(failed);
  // A notification's Snooze works with the app closed, so the phone keeps the length itself.
  const configure = (minutes: number) =>
    void Reminders.configure({ snoozeMinutes: minutes }).catch(failed);
  configure(snoozeMinutes());
  const stopFollowing = onSnoozeChange(configure);
  const resumed = App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) returned();
  });
  return () => {
    stopped = true;
    stopWatching();
    stopFollowing();
    void resumed.then((listener) => listener.remove());
  };
}
