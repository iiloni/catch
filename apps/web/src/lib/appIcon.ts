import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { getServerUrl } from './serverUrl';
import { usePersistentState } from './storage';
import { useUpdates } from './updates';

export const APP_ICON_KEY = 'catch-app-icon';
const iconSchema = z.enum(['stable', 'preview', 'dev']);
export type AppIcon = z.infer<typeof iconSchema>;
const preferenceSchema = z.object({ icon: iconSchema, server: z.string() });
const AppIcons = registerPlugin<{
  setIcon(options: { icon: AppIcon }): Promise<void>;
  getPreview(options: { icon: AppIcon }): Promise<unknown>;
}>('AppIcons');
const previewSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/),
});

export async function getNativeAppIconPreview(icon: AppIcon): Promise<string> {
  return previewSchema.parse(await AppIcons.getPreview({ icon })).dataUrl;
}

export function useAppIconOptions() {
  const { android, app, server } = useUpdates();
  return {
    devBuild: import.meta.env.CATCH_CHANNEL === 'dev' || Boolean(android && app?.channel === 'dev'),
    serverChannel: server?.channel ?? null,
  };
}

export function useAppIconPreference() {
  const { devBuild, serverChannel } = useAppIconOptions();
  const fallback = devBuild ? 'dev' : 'stable';
  const server = getServerUrl();
  const [preference, setPreference] = usePersistentState(APP_ICON_KEY, preferenceSchema, {
    icon: fallback,
    server: '',
  });
  const chosen = preference.server === server ? preference.icon : fallback;
  // An offline released build keeps a previous preview choice, but never a dev choice.
  const icon =
    !devBuild && (chosen === 'dev' || (serverChannel !== null && serverChannel !== 'preview'))
      ? 'stable'
      : chosen;
  return [icon, (icon: AppIcon) => setPreference({ icon, server })] as const;
}

// Component settings belong to the whole APK; keep changes ordered across startup and taps.
let nativeChange = Promise.resolve();
export function setNativeAppIcon(icon: AppIcon): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve();
  nativeChange = nativeChange.catch(() => {}).then(() => AppIcons.setIcon({ icon }));
  return nativeChange;
}

export function applyBrowserIcon(icon: AppIcon) {
  const base = icon === 'stable' ? '' : `/${icon}`;
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="apple-touch-icon"]',
  )) {
    const filename = new URL(link.href).pathname.split('/').pop();
    if (filename) link.setAttribute('href', `${base}/${filename}`);
  }
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute('href', `/manifest-${icon}.webmanifest`);
}

export function useApplyAppIcon() {
  const [icon] = useAppIconPreference();
  useEffect(() => {
    applyBrowserIcon(icon);
    let stopped = false;
    void setNativeAppIcon(icon).catch(() => {
      if (!stopped) toast.error('Could not change the app icon. Try again.');
    });
    return () => {
      stopped = true;
    };
  }, [icon]);
}
