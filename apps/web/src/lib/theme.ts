import { useEffect, useSyncExternalStore } from 'react';
import { z } from 'zod';
import { usePersistentState } from './storage';

export const THEME_KEY = 'catch-theme';

const themePreferenceSchema = z.enum(['system', 'light', 'dark']);
export type ThemePreference = z.infer<typeof themePreferenceSchema>;

export function useThemePreference() {
  return usePersistentState(THEME_KEY, themePreferenceSchema, 'system');
}

const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function subscribeToSystemTheme(listener: () => void) {
  const query = darkQuery();
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** The theme actually shown: the stored preference, or the OS setting for `system`. */
export function useResolvedTheme(): 'light' | 'dark' {
  const [preference] = useThemePreference();
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, () => darkQuery().matches);
  if (preference === 'system') return systemDark ? 'dark' : 'light';
  return preference;
}

/**
 * Mirrors the preference onto <html data-theme>, which the CSS tokens read.
 * index.html applies the stored value before first paint to avoid a flash.
 */
export function useApplyTheme() {
  const [preference] = useThemePreference();
  useEffect(() => {
    if (preference === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = preference;
  }, [preference]);
}
