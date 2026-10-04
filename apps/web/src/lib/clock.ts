import { z } from 'zod';
import { usePersistentState } from './storage';
import { createStore } from './store';

export const CLOCK_KEY = 'catch-clock';

const clockPreferenceSchema = z.enum(['auto', '12', '24']);
export type ClockPreference = z.infer<typeof clockPreferenceSchema>;

const SYSTEM_KEY = 'catch-system-clock';

/**
 * How this device writes times of day. A page cannot read the system's 12 or 24 hour
 * switch, only what the browser's language defaults to, so the choice is the user's.
 * The Android app can read it, and Automatic follows it there.
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

function storedSystem(): boolean | null {
  try {
    const stored = localStorage.getItem(SYSTEM_KEY);
    return stored === '12' ? true : stored === '24' ? false : null;
  } catch {
    return null;
  }
}

// Remembered, so times are written right from the first frame of the next launch.
const systemHour12 = createStore<boolean | null>(storedSystem());

/** The Android app reports the system's switch at launch and whenever it comes back. */
export function setSystemHour12(hour12: boolean) {
  try {
    localStorage.setItem(SYSTEM_KEY, hour12 ? '12' : '24');
  } catch {
    // Storage is full or unavailable; the value still holds for this launch.
  }
  systemHour12.set(hour12);
}

const resolve = (preference: ClockPreference, system: boolean | null) =>
  preference === 'auto' ? (system ?? localeHour12()) : preference === '12';

/** Whether hours run 1 to 12 with AM and PM. A component that shows a time calls this to redraw when the setting changes. */
export function useHour12() {
  const [preference] = useClockPreference();
  return resolve(preference, systemHour12.use());
}

const formats = new Map<string, Intl.DateTimeFormat>();

function format(date: Date, dateStyle?: 'medium') {
  const stored = storedPreference();
  const system = systemHour12.get();
  const preference = stored === 'auto' && system !== null ? (system ? '12' : '24') : stored;
  // The zone is part of a formatter, and a phone can change zone while the app stays open.
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const key = `${preference}:${dateStyle ?? ''}:${zone}`;
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
