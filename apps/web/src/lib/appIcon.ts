import { Capacitor, registerPlugin } from '@capacitor/core';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { getServerUrl } from './serverUrl';
import { usePersistentState } from './storage';
import { useUpdates } from './updates';

export const APP_ICON_KEY = 'catch-app-icon';
const iconSchema = z.enum(['stable', 'preview']);
export type AppIcon = z.infer<typeof iconSchema>;
const preferenceSchema = z.object({ icon: iconSchema, server: z.string() });
const AppIcons = registerPlugin<{ setIcon(options: { icon: AppIcon }): Promise<void> }>('AppIcons');

export function useAppIconPreference() {
  const server = getServerUrl();
  const [preference, setPreference] = usePersistentState(APP_ICON_KEY, preferenceSchema, {
    icon: 'stable',
    server: '',
  });
  return [
    preference.server === server ? preference.icon : 'stable',
    (icon: AppIcon) => setPreference({ icon, server }),
  ] as const;
}

// Component settings belong to the whole APK; keep changes ordered across startup and taps.
let nativeChange = Promise.resolve();
export function setNativeAppIcon(icon: AppIcon): Promise<void> {
  if (Capacitor.getPlatform() !== 'android') return Promise.resolve();
  nativeChange = nativeChange.catch(() => {}).then(() => AppIcons.setIcon({ icon }));
  return nativeChange;
}

export function applyBrowserIcon(icon: AppIcon) {
  const base = icon === 'preview' ? '/preview' : '';
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    'link[rel="icon"], link[rel="apple-touch-icon"]',
  )) {
    const filename = new URL(link.href).pathname.split('/').pop();
    if (filename) link.setAttribute('href', `${base}/${filename}`);
  }
  document
    .querySelector('link[rel="manifest"]')
    ?.setAttribute(
      'href',
      icon === 'preview' ? '/manifest-preview.webmanifest' : '/manifest.webmanifest',
    );
}

export function useApplyAppIcon() {
  const [preference] = useAppIconPreference();
  const { server } = useUpdates();
  // Keep a previously chosen icon offline. A confirmed non-preview server uses stable.
  const icon = server && server.channel !== 'preview' ? 'stable' : preference;
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
