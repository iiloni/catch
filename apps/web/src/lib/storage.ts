import { useCallback, useSyncExternalStore } from 'react';
import type { z } from 'zod';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

/**
 * A UI preference persisted in localStorage and shared by every component that
 * reads the same key. Stored values that fail the schema fall back to the default.
 */
export function usePersistentState<T extends z.ZodType>(
  key: string,
  schema: T,
  fallback: z.infer<T>,
): [z.infer<T>, (value: z.infer<T>) => void] {
  const raw = useSyncExternalStore(subscribe, () => localStorage.getItem(key));

  let value: z.infer<T> = fallback;
  if (raw !== null) {
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      if (parsed.success) value = parsed.data;
    } catch {
      // Unparseable values fall back to the default.
    }
  }

  const setValue = useCallback(
    (next: z.infer<T>) => {
      localStorage.setItem(key, JSON.stringify(next));
      for (const listener of listeners) listener();
    },
    [key],
  );

  return [value, setValue];
}
