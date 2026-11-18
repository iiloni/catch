import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useBackFallback, useBackHandler } from './backButton';

const native = vi.hoisted(() => ({
  listener: null as ((event: { canGoBack: boolean }) => void) | null,
  minimize: vi.fn(),
}));

vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: (_event: string, listener: (event: { canGoBack: boolean }) => void) => {
      native.listener = listener;
      return Promise.resolve({ remove: () => {} });
    },
    minimizeApp: native.minimize,
  },
}));

const back = (canGoBack = false) => native.listener?.({ canGoBack });

describe('the Android back gesture', () => {
  it('closes overlays first, then steps out of a mode, before history or leaving the app', () => {
    const history = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const leave = vi.fn();
    const close = vi.fn();
    const mode = renderHook(({ active }) => useBackFallback(active, leave), {
      initialProps: { active: true },
    });
    // Opened before the mode, as a menu can be: it still closes first.
    const overlay = renderHook(({ active }) => useBackHandler(active, close), {
      initialProps: { active: true },
    });

    back(true);
    expect(close).toHaveBeenCalledOnce();
    expect(leave).not.toHaveBeenCalled();

    overlay.rerender({ active: false });
    back(true);
    expect(leave).toHaveBeenCalledOnce();
    expect(history).not.toHaveBeenCalled();

    mode.rerender({ active: false });
    back(true);
    expect(history).toHaveBeenCalledOnce();
    back(false);
    expect(native.minimize).toHaveBeenCalledOnce();
    history.mockRestore();
  });
});
