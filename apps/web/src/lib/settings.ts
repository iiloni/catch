import { useRouter } from '@tanstack/react-router';
import { CircleUser, type LucideIcon, SlidersHorizontal } from 'lucide-react';
import { useCallback } from 'react';
import { useViewport } from './splitView';

/**
 * The pages of Settings, in the order they are listed. Each has a route file under
 * `routes/_app/settings/`.
 */
export const SETTINGS_TABS = [
  { path: '/settings/general', label: 'General', icon: SlidersHorizontal },
  { path: '/settings/account', label: 'Account', icon: CircleUser },
] as const satisfies ReadonlyArray<{ path: string; label: string; icon: LucideIcon }>;

export type SettingsTab = (typeof SETTINGS_TABS)[number];
export type SettingsPath = SettingsTab['path'];

export function isSettingsPath(pathname: string) {
  return pathname === '/settings' || pathname.startsWith('/settings/');
}

export function settingsTabFor(pathname: string): SettingsTab | null {
  return SETTINGS_TABS.find((tab) => tab.path === pathname) ?? null;
}

/**
 * From this width Settings lists its pages in a column beside the open one. Narrower, it
 * shows one page at a time and the dock picks between them.
 */
export const SETTINGS_WIDE_MIN = 768;

export function isWideSettings(width: number) {
  return width >= SETTINGS_WIDE_MIN;
}

export function useWideSettings() {
  return isWideSettings(useViewport().width);
}

/** Whether Settings was opened by pushing a history entry on top of another page. */
let pushedFromApp = false;

/**
 * Opens, switches and leaves Settings. Opening pushes a history entry so the back gesture
 * returns to the page it came from; switching pages replaces it, so back leaves Settings in
 * one step.
 */
export function useSettingsNavigation() {
  const router = useRouter();

  const open = useCallback(() => {
    if (isSettingsPath(router.state.location.pathname)) return;
    pushedFromApp = true;
    void router.navigate({ to: SETTINGS_TABS[0].path });
  }, [router]);

  const select = useCallback(
    (to: SettingsPath) => {
      if (router.state.location.pathname === to) return;
      void router.navigate({ to, replace: true });
    },
    [router],
  );

  const leave = useCallback(() => {
    if (pushedFromApp) router.history.back();
    else void router.navigate({ to: '/', replace: true });
    pushedFromApp = false;
  }, [router]);

  return { open, select, leave };
}
