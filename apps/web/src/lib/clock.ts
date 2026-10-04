import { z } from 'zod';
import { usePersistentState } from './storage';

export const CLOCK_KEY = 'catch-clock';

const clockPreferenceSchema = z.enum(['auto', '12', '24']);
export type ClockPreference = z.infer<typeof clockPreferenceSchema>;

/**
 * How this device writes times of day. A page cannot read the system's 12 or 24 hour
 * switch, only what the browser's language defaults to, so the choice is the user's.
 */
export function useClockPreference() {
  return usePersistentState(CLOCK_KEY, clockPreferenceSchema, 'auto');
}

function storedPreference(): ClockPreference {
  try {
    const parsed = clockPreferenceSchema.safeParse(
      JSON.parse(localStorage.getItem(CLOCK_KEY) ?? ''),
    );
    return parsed.success ? parsed.data : 'auto';
  } catch {
    return 'auto';
  }
}

const localeHour12 = () =>
  new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hour12 === true;

const resolve = (preference: ClockPreference) =>
  preference === 'auto' ? localeHour12() : preference === '12';

/** Whether hours run 1 to 12 with AM and PM. A component that shows a time calls this to redraw when the setting changes. */
export function useHour12() {
  const [preference] = useClockPreference();
  return resolve(preference);
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(date: Date, dateStyle?: 'medium') {
  const preference = storedPreference();
  const key = `${preference}:${dateStyle ?? ''}`;
  let found = formats.get(key);
  if (!found) {
    found = new Intl.DateTimeFormat(undefined, {
      dateStyle,
      timeStyle: 'short',
      ...(preference === '12' && { hour12: true }),
      ...(preference === '24' && { hourCycle: 'h23' as const }),
    });
    formats.set(key, found);
  }
  return found.format(date);
}

/** A time of day as the clock setting writes it: "8:00 AM" or "08:00". */
export const formatTime = (date: Date) => format(date);

/** A date with its time of day: "Oct 5, 2026, 8:00 AM". */
export const formatDateTime = (date: Date) => format(date, 'medium');
