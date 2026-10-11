import { App } from '@capacitor/app';
import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { type WidgetLaunch, type WidgetSnapshot, widgetLaunchSchema } from '@catch/shared';
import { z } from 'zod';
import { getAccounts, getSignedInUser } from './auth';
import { watchWidgetSnapshot } from './collections';
import { getServerUrl } from './serverUrl';

const Widgets = registerPlugin<{
  begin(input: {
    account: string;
    server: string;
    accounts: { id: string; label: string }[];
  }): Promise<unknown>;
  sync(input: { session: string; snapshot: WidgetSnapshot }): Promise<void>;
  clear(input: { account?: string }): Promise<void>;
  pending(): Promise<unknown>;
  acknowledge(input: { id: string }): Promise<void>;
  addListener(event: 'launch', callback: () => void): Promise<PluginListenerHandle>;
}>('Widgets');
const available = Capacitor.getPlatform() === 'android';
const clearedAccounts = new Set<string>();
let clearedAll = false;

export const nativeWidgets = {
  available,
  async clear(account?: string) {
    if (account) clearedAccounts.add(account);
    else clearedAll = true;
    if (available) await Widgets.clear({ account });
  },
  acknowledge: (id: string) => Widgets.acknowledge({ id }),
  watchLaunch(listener: (launch: WidgetLaunch) => void) {
    if (!available) return () => {};
    let stopped = false;
    const read = async () => {
      const parsed = widgetLaunchSchema.safeParse(await Widgets.pending());
      if (!stopped && parsed.success) listener(parsed.data);
    };
    const ask = () => {
      void read().catch((error: unknown) =>
        console.error('Widget launch could not be read', error),
      );
    };
    const listening = Widgets.addListener('launch', ask);
    void listening.then(ask);
    const resumed = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) ask();
    });
    return () => {
      stopped = true;
      void listening.then((handle) => handle.remove());
      void resumed.then((handle) => handle.remove());
    };
  },
};

/** Each page load gets a native generation, so late writes cannot resurrect signed-out data. */
export function watchNativeWidgets() {
  const user = getSignedInUser();
  if (!available || !user || clearedAll || clearedAccounts.has(user.id)) return () => {};
  let stopped = false;
  let stopWatching: (() => void) | undefined;
  const failed = (error: unknown) => console.error('Widgets could not be updated', error);
  void Widgets.begin({
    account: user.id,
    server: getServerUrl(),
    accounts: getAccounts().map(({ user }) => ({ id: user.id, label: user.name || user.email })),
  })
    .then((result) => {
      if (stopped || clearedAll || clearedAccounts.has(user.id)) return;
      const { session } = z.object({ session: z.string() }).parse(result);
      stopWatching = watchWidgetSnapshot((snapshot) => {
        if (!stopped && !clearedAll && !clearedAccounts.has(user.id))
          void Widgets.sync({ session, snapshot }).catch(failed);
      });
    })
    .catch(failed);
  return () => {
    stopped = true;
    stopWatching?.();
  };
}
