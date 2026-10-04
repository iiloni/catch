import { DEFAULT_SNOOZE_MINUTES, type SnoozeMinutes, snoozeMinutesSchema } from '@catch/shared';
import { createStore } from './store';

export type { SnoozeMinutes };

export const SNOOZE_KEY = 'catch-snooze';

function cached(): SnoozeMinutes {
  try {
    const parsed = snoozeMinutesSchema.safeParse(
      JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? ''),
    );
    return parsed.success ? parsed.data : DEFAULT_SNOOZE_MINUTES;
  } catch {
    return DEFAULT_SNOOZE_MINUTES;
  }
}

/**
 * How long Snooze puts a reminder off. It belongs to the user and follows them to every
 * device (`syncReminderSettings`); it is cached here so Snooze works offline.
 */
const store = createStore<SnoozeMinutes>(cached());

export const snoozeMinutes = () => store.get();

/** When a reminder snoozed now rings again. */
export const snoozeUntil = (now = Date.now()) => new Date(now + snoozeMinutes() * 60_000);

/** Where a change came from: chosen on this device, or brought from the server. */
type Source = 'device' | 'server';
type Listener = (minutes: SnoozeMinutes, from: Source) => void;

// Followed by what sends a change to the server, and by the Android app, whose
// notifications snooze without the web app and so are told the length.
const listeners = new Set<Listener>();
export function onSnoozeChange(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function set(minutes: SnoozeMinutes, from: Source) {
  if (minutes === store.get()) return;
  store.set(minutes);
  localStorage.setItem(SNOOZE_KEY, JSON.stringify(minutes));
  for (const listener of listeners) listener(minutes, from);
}

export const setSnoozeMinutes = (minutes: SnoozeMinutes) => set(minutes, 'device');

/** Takes the length the server holds, which is not a change to send back to it. */
export const applySnoozeMinutes = (minutes: SnoozeMinutes) => set(minutes, 'server');

export function useSnoozeMinutes(): [SnoozeMinutes, (minutes: SnoozeMinutes) => void] {
  return [store.use(), setSnoozeMinutes];
}
