// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const current = '00000000-0000-4000-8000-000000000001';
const next = '00000000-0000-4000-8000-000000000002';
const mocks = vi.hoisted(() => ({
  platform: 'web',
  blocked: false,
  stored: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { getPlatform: () => mocks.platform } }));
vi.mock('./useUpdateReloadBlocked', () => ({ isUpdateReloadBlocked: () => mocks.blocked }));
vi.mock('./collections', () => ({ waitForPendingWritesStored: mocks.stored }));
vi.mock('./store', () => ({
  createStore: (initial: unknown) => {
    let state = initial;
    return {
      get: () => state,
      set: (next: unknown) => {
        state = next;
      },
      use: () => state,
    };
  },
}));

class Worker extends EventTarget {
  state: ServiceWorkerState = 'installed';
  postMessage = vi.fn();
  transition(state: ServiceWorkerState) {
    this.state = state;
    this.dispatchEvent(new Event('statechange'));
  }
}

let container: EventTarget & { controller: Worker | null; register: ReturnType<typeof vi.fn> };
let worker: { update: ReturnType<typeof vi.fn>; waiting: Worker | null; installing: Worker | null };
let fetchBuild: ReturnType<typeof vi.fn>;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  mocks.platform = 'web';
  mocks.blocked = false;
  mocks.stored.mockReset().mockResolvedValue(undefined);
  vi.stubEnv('CATCH_WEB_BUILD', 'true');
  vi.stubEnv('CATCH_BUILD_ID', current);
  worker = { update: vi.fn().mockResolvedValue(undefined), waiting: null, installing: null };
  container = Object.assign(new EventTarget(), {
    controller: new Worker(),
    register: vi.fn().mockResolvedValue(worker),
  });
  vi.stubGlobal('navigator', { serviceWorker: container });
  fetchBuild = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: next })));
  vi.stubGlobal('fetch', fetchBuild);
  reload = vi.fn();
  vi.stubGlobal('window', { location: { reload }, setTimeout, clearTimeout });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('web updates', () => {
  it('checks the deployed build even when another tab already activated its worker', async () => {
    const updates = await import('./webUpdates');
    const result = {
      get current() {
        return updates.useWebUpdates();
      },
    };
    await updates.checkForWebUpdates();
    expect(result.current.target).toBe(next);
    expect(fetchBuild).toHaveBeenCalledWith(
      expect.stringMatching(/^\/build.json\?check=/),
      expect.objectContaining({ cache: 'no-store' }),
    );
    expect(container.register).toHaveBeenCalledWith('/sw.js', { updateViaCache: 'none' });
    expect(reload).not.toHaveBeenCalled();
    fetchBuild.mockResolvedValue(new Response(JSON.stringify({ id: current })));
    await updates.checkForWebUpdates();
    expect(result.current.target).toBeNull();
  });

  it.each(['offline', 'missing', 'malformed'])(
    'ignores %s metadata and preserves a known update',
    async (failure) => {
      const updates = await import('./webUpdates');
      const result = {
        get current() {
          return updates.useWebUpdates();
        },
      };
      const fail = () => {
        if (failure === 'offline') fetchBuild.mockRejectedValue(new Error('offline'));
        else
          fetchBuild.mockResolvedValue(
            new Response(failure === 'missing' ? 'missing' : '{}', {
              status: failure === 'missing' ? 404 : 200,
            }),
          );
      };
      fail();
      await updates.checkForWebUpdates();
      expect(result.current.target).toBeNull();
      fetchBuild.mockResolvedValue(new Response(JSON.stringify({ id: next })));
      await updates.checkForWebUpdates();
      fail();
      await updates.checkForWebUpdates();
      expect(result.current.target).toBe(next);
      expect(reload).not.toHaveBeenCalled();
    },
  );

  it('waits for installation, durable writes and control by the new worker before reloading once', async () => {
    const updates = await import('./webUpdates');
    updates.initializeWebUpdates();
    const installing = new Worker();
    installing.state = 'installing';
    worker.installing = installing;
    let stored = () => {};
    mocks.stored.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          stored = resolve;
        }),
    );
    const approved = updates.reloadForWebUpdate();
    await vi.waitFor(() => expect(mocks.stored).toHaveBeenCalledOnce());
    await updates.reloadForWebUpdate();
    expect(worker.update).not.toHaveBeenCalled();
    stored();
    await vi.waitFor(() => expect(worker.update).toHaveBeenCalledOnce());
    worker.waiting = installing;
    worker.installing = null;
    installing.transition('installed');
    await vi.waitFor(() =>
      expect(installing.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' }),
    );
    installing.transition('activated');
    expect(reload).not.toHaveBeenCalled();
    container.controller = installing;
    container.dispatchEvent(new Event('controllerchange'));
    await approved;
    expect(reload).toHaveBeenCalledOnce();
  });

  it('reloads an ordinary browser without service worker support', async () => {
    vi.stubGlobal('navigator', {});
    const updates = await import('./webUpdates');
    await updates.checkForWebUpdates();
    fetchBuild.mockResolvedValue(new Response(JSON.stringify({ id: next })));
    await updates.reloadForWebUpdate();
    expect(reload).toHaveBeenCalledOnce();
  });

  it.each(['offline', 'unsaved', 'draft', 'install failed'])(
    'keeps the page on %s and lets the user retry',
    async (failure) => {
      const updates = await import('./webUpdates');
      updates.initializeWebUpdates();
      const result = {
        get current() {
          return updates.useWebUpdates();
        },
      };
      if (failure === 'offline') fetchBuild.mockRejectedValueOnce(new Error('offline'));
      if (failure === 'unsaved') mocks.stored.mockRejectedValueOnce(new Error('still saving'));
      if (failure === 'draft') mocks.blocked = true;
      if (failure === 'install failed') {
        const installing = new Worker();
        installing.state = 'redundant';
        worker.installing = installing;
      }
      await updates.reloadForWebUpdate();
      expect(reload).not.toHaveBeenCalled();
      expect(result.current.error).toBeTruthy();
      expect(result.current.reloading).toBe(false);
      mocks.blocked = false;
      worker.installing = null;
      fetchBuild.mockResolvedValue(new Response(JSON.stringify({ id: next })));
      await updates.reloadForWebUpdate();
      expect(reload).toHaveBeenCalledOnce();
    },
  );

  it('times out activation instead of reloading into the old cache', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { location: { reload }, setTimeout, clearTimeout });
    const updates = await import('./webUpdates');
    updates.initializeWebUpdates();
    worker.waiting = new Worker();
    const result = {
      get current() {
        return updates.useWebUpdates();
      },
    };
    await (async () => {
      const approved = updates.reloadForWebUpdate();
      await vi.waitFor(() => expect(worker.waiting?.postMessage).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(20_001);
      await approved;
    })();
    expect(result.current.error).toMatch(/too long/);
    expect(reload).not.toHaveBeenCalled();
  });

  it.each(['android', 'development'])('does not register or fetch for %s', async (scenario) => {
    if (scenario === 'android') mocks.platform = 'android';
    else vi.stubEnv('CATCH_WEB_BUILD', 'false');
    const updates = await import('./webUpdates');
    updates.initializeWebUpdates();
    await updates.checkForWebUpdates();
    await updates.reloadForWebUpdate();
    expect(container.register).not.toHaveBeenCalled();
    expect(fetchBuild).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('updates a signed-out page without asking, once for a build', async () => {
    const tried = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => tried.get(key) ?? null,
      setItem: (key: string, value: string) => tried.set(key, value),
    });
    fetchBuild.mockImplementation(async () => new Response(JSON.stringify({ id: next })));
    const updates = await import('./webUpdates');
    await updates.updateSignedOutPage();
    expect(reload).toHaveBeenCalledTimes(1);
    // The page that loads next still has the old build: it is left alone.
    vi.resetModules();
    const again = await import('./webUpdates');
    await again.updateSignedOutPage();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves a signed-out page that is up to date alone', async () => {
    fetchBuild.mockResolvedValue(new Response(JSON.stringify({ id: current })));
    const updates = await import('./webUpdates');
    await updates.updateSignedOutPage();
    expect(reload).not.toHaveBeenCalled();
  });
});
