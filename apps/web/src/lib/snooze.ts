import { useCallback } from 'react';
import { z } from 'zod';
import { usePersistentState } from './storage';

export const SNOOZE_KEY = 'catch-snooze';

const snoozeMinutesSchema = z.union([z.literal(15), z.literal(30), z.literal(60)]);
export type SnoozeMinutes = z.infer<typeof snoozeMinutesSchema>;

const DEFAULT_SNOOZE: SnoozeMinutes = 30;

/** How long Snooze puts a reminder off on this device, in minutes. */
export function snoozeMinutes(): SnoozeMinutes {
  try {
    const parsed = snoozeMinutesSchema.safeParse(
      JSON.parse(localStorage.getItem(SNOOZE_KEY) ?? ''),
    );
    return parsed.success ? parsed.data : DEFAULT_SNOOZE;
  } catch {
    return DEFAULT_SNOOZE;
  }
}

/** When a reminder snoozed now rings again. */
export const snoozeUntil = (now = Date.now()) => new Date(now + snoozeMinutes() * 60_000);

// The Android app's notifications snooze without the web app, so the phone is told the length.
const listeners = new Set<(minutes: SnoozeMinutes) => void>();
export function onSnoozeChange(listener: (minutes: SnoozeMinutes) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSnoozeMinutes(): [SnoozeMinutes, (minutes: SnoozeMinutes) => void] {
  const [minutes, store] = usePersistentState(SNOOZE_KEY, snoozeMinutesSchema, DEFAULT_SNOOZE);
  const set = useCallback(
    (next: SnoozeMinutes) => {
      store(next);
      for (const listener of listeners) listener(next);
    },
    [store],
  );
  return [minutes, set];
}
