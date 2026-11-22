import { Capacitor, registerPlugin } from '@capacitor/core';

const AppSwitcher = registerPlugin<{
  setHidden(options: { hidden: boolean }): Promise<void>;
}>('AppSwitcher');

/**
 * Leaves the app's picture out of the phone's recent apps screen (`AppSwitcherPlugin.java`),
 * so its contents cannot be read there. Android only: a browser gives a page no say in it.
 */
export function hideFromAppSwitcher(hidden: boolean) {
  if (Capacitor.getPlatform() !== 'android') return;
  void AppSwitcher.setHidden({ hidden }).catch(() => {});
}
