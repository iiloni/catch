import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from './auth';

const ada: Account = { user: { id: 'ada', name: 'Ada', email: 'ada@example.com' }, token: 'a' };
const bob: Account = { user: { id: 'bob', name: '', email: 'bob@example.com' }, token: 'b' };
// URL-safe base64 of three bytes, standing in for the server's key.
const KEY = 'AQID';

const mocks = vi.hoisted(() => ({
  accounts: [] as Account[],
  save: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => false } }));
vi.mock('./nativeReminders', () => ({ nativeReminders: { available: false } }));
vi.mock('./auth', () => ({
  getAccounts: () => mocks.accounts,
  getSignedInUser: () => mocks.accounts[0]?.user ?? null,
}));
vi.mock('./api', () => ({
  api: {
    pushKey: async () => ({ publicKey: KEY }),
    savePushSubscription: mocks.save,
    deletePushSubscription: mocks.remove,
  },
}));

import { leavePush, syncPush } from './push';

/** A browser's push manager, holding at most one subscription as a real one does. */
function browser() {
  let made = 0;
  let current: ReturnType<typeof subscription> | null = null;
  function subscription() {
    const endpoint = `https://push.example/${++made}`;
    const self = {
      endpoint,
      options: { applicationServerKey: new Uint8Array([1, 2, 3]).buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: vi.fn(async () => {
        if (current === self) current = null;
        return true;
      }),
    };
    return self;
  }
  const pushManager = {
    getSubscription: async () => current,
    subscribe: vi.fn(async () => {
      current = subscription();
      return current;
    }),
  };
  vi.stubGlobal('navigator', {
    ...navigator,
    serviceWorker: { getRegistration: async () => ({ pushManager }) },
  });
  vi.stubGlobal('PushManager', class {});
  vi.stubGlobal('Notification', { permission: 'granted' });
  return { pushManager, endpoint: () => current?.endpoint ?? null };
}

const savedFor = () => mocks.save.mock.calls.map(([, token]) => token);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.accounts = [ada, bob];
  mocks.save.mockResolvedValue({ ok: true });
  mocks.remove.mockResolvedValue({ ok: true });
});

describe('notifications for every account on the device', () => {
  it('registers the browser for each signed-in account, the one in use last', async () => {
    const { endpoint } = browser();
    localStorage.setItem('catch-push:ada', 'true');
    await syncPush();
    expect(endpoint()).toBe('https://push.example/1');
    expect(savedFor()).toEqual(['b', 'a']);
    // An account added while notifications are on rings without being turned on itself.
    expect(localStorage.getItem('catch-push:bob')).toBe('true');
  });

  it('keeps the subscription across launches', async () => {
    const { pushManager, endpoint } = browser();
    localStorage.setItem('catch-push:ada', 'true');
    await syncPush();
    await syncPush();
    expect(pushManager.subscribe).toHaveBeenCalledTimes(1);
    expect(endpoint()).toBe('https://push.example/1');
  });

  it('replaces a subscription that may still ring for someone no longer signed in', async () => {
    const { endpoint } = browser();
    localStorage.setItem('catch-push:ada', 'true');
    await syncPush();
    // Bob's session ended without the server being told to stop.
    mocks.accounts = [ada];
    mocks.save.mockClear();
    await syncPush();
    expect(endpoint()).toBe('https://push.example/2');
    expect(savedFor()).toEqual(['a']);
  });

  it('replaces a subscription from before the device recorded whose it was', async () => {
    const { pushManager, endpoint } = browser();
    await pushManager.subscribe();
    localStorage.setItem('catch-push:ada', 'true');
    await syncPush();
    expect(endpoint()).toBe('https://push.example/2');
  });

  it('carries on when another account cannot be saved', async () => {
    browser();
    localStorage.setItem('catch-push:ada', 'true');
    mocks.save.mockImplementation(async (_body: unknown, token: string) => {
      if (token === 'b') throw new Error('401');
      return { ok: true };
    });
    await syncPush();
    expect(savedFor()).toEqual(['b', 'a']);
    expect(localStorage.getItem('catch-push:bob')).toBeNull();
  });

  it('drops a subscription nobody signed in here turned on', async () => {
    const { pushManager, endpoint } = browser();
    await pushManager.subscribe();
    await syncPush();
    expect(endpoint()).toBeNull();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('takes one account off the subscription and leaves the rest ringing', async () => {
    const { endpoint } = browser();
    localStorage.setItem('catch-push:ada', 'true');
    await syncPush();
    await leavePush(bob);
    expect(mocks.remove).toHaveBeenCalledWith('https://push.example/1', 'b', expect.anything());
    expect(endpoint()).toBe('https://push.example/1');
    expect(localStorage.getItem('catch-push:bob')).toBeNull();
    // Bob is gone from the device and from the subscription, so it need not be replaced.
    mocks.accounts = [ada];
    await syncPush();
    expect(endpoint()).toBe('https://push.example/1');
  });

  it('drops the subscription when the server cannot be told an account left', async () => {
    const { endpoint } = browser();
    localStorage.setItem('catch-push:ada', 'true');
    await syncPush();
    mocks.remove.mockRejectedValue(new Error('offline'));
    await leavePush(bob);
    expect(endpoint()).toBeNull();
    // The account that stays subscribes again.
    mocks.accounts = [ada];
    await syncPush();
    expect(endpoint()).toBe('https://push.example/2');
  });
});
