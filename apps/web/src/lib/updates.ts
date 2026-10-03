import { App } from '@capacitor/app';
import { Capacitor, registerPlugin } from '@capacitor/core';
import { androidUpdateAvailable, type VersionInfo, versionInfoSchema } from '@catch/shared';
import { api } from './api';
import { checkCompatibility } from './compatibility';
import { createStore } from './store';
import { checkForWebUpdates } from './webUpdates';

const NativeUpdates = registerPlugin<{
  getVersion(): Promise<unknown>;
  install(options: { version: string; channel: VersionInfo['channel'] }): Promise<void>;
}>('AppUpdates');

type UpdateState = {
  android: boolean;
  app: VersionInfo | null;
  server: VersionInfo | null;
  checking: boolean;
  error: string | null;
  installing: boolean;
  installError: string | null;
};

const updates = createStore<UpdateState>({
  android: Capacitor.getPlatform() === 'android',
  app: null,
  server: null,
  checking: true,
  error: null,
  installing: false,
  installError: null,
});
export const useUpdates = updates.use;
export function useAndroidUpdateAvailable() {
  const { android, app, server } = useUpdates();
  return android && androidUpdateAvailable(app, server);
}

let checking: Promise<void> | null = null;
export function checkForUpdates() {
  checking ??= (async () => {
    updates.set({ ...updates.get(), checking: true, error: null });
    const [server, app] = await Promise.allSettled([
      api.versionInfo().then((result) => versionInfoSchema.parse(result)),
      updates.get().android
        ? NativeUpdates.getVersion().then((result) => versionInfoSchema.parse(result))
        : Promise.resolve(null),
      checkCompatibility(true),
      checkForWebUpdates(),
    ]);
    updates.set({
      ...updates.get(),
      server: server.status === 'fulfilled' ? server.value : updates.get().server,
      app: app.status === 'fulfilled' ? app.value : updates.get().app,
      checking: false,
      error:
        server.status === 'rejected'
          ? 'Could not check the server version. Connect to your server and try again.'
          : app.status === 'rejected'
            ? 'Could not read the installed app version.'
            : null,
    });
  })().finally(() => {
    checking = null;
  });
  return checking;
}

/** Refresh on launch and resume so a running server upgrade reaches every settings entry. */
export function watchUpdates() {
  const refresh = () => {
    if (document.visibilityState !== 'hidden') void checkForUpdates();
  };
  refresh();
  const interval = window.setInterval(refresh, 5 * 60_000);
  window.addEventListener('online', refresh);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  const nativeListener = updates.get().android
    ? App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) refresh();
      })
    : null;
  return () => {
    window.clearInterval(interval);
    window.removeEventListener('online', refresh);
    window.removeEventListener('focus', refresh);
    document.removeEventListener('visibilitychange', refresh);
    void nativeListener?.then((listener) => listener.remove());
  };
}

export async function installServerVersion() {
  if (updates.get().installing) return;
  updates.set({ ...updates.get(), installing: true, installError: null });
  try {
    // The server may have changed since the page opened; never install a stale target.
    await checkForUpdates();
    const { android, app, server, error } = updates.get();
    if (error) throw new Error(error);
    if (!android || !androidUpdateAvailable(app, server) || !server?.version) {
      throw new Error('No app update is available for this server.');
    }
    await NativeUpdates.install({ version: server.version, channel: server.channel });
  } catch (error) {
    updates.set({
      ...updates.get(),
      installError: error instanceof Error ? error.message : 'Could not update the app. Try again.',
    });
  } finally {
    updates.set({ ...updates.get(), installing: false });
  }
}
