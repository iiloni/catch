import type { AnyRouter, ParsedLocation } from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keepScrollAcrossNotes } from './openNote';

type Listener = (event: {
  fromLocation?: ParsedLocation;
  toLocation: ParsedLocation;
  pathChanged: boolean;
}) => void;

const at = (pathname: string, note?: string) =>
  ({ pathname, search: { note } }) as unknown as ParsedLocation;

/** Navigates as the router does: it scrolls to the top once the new location has rendered. */
function setup() {
  const listeners: Record<string, Listener[]> = {};
  const router = {
    subscribe: (type: string, listener: Listener) => {
      listeners[type] = [...(listeners[type] ?? []), listener];
    },
  } as unknown as AnyRouter;
  keepScrollAcrossNotes(router);
  return async (fromLocation: ParsedLocation, toLocation: ParsedLocation) => {
    const event = {
      fromLocation,
      toLocation,
      pathChanged: fromLocation.pathname !== toLocation.pathname,
    };
    for (const listener of listeners.onBeforeLoad ?? []) listener(event);
    window.scrollTo({ top: 0, left: 0 });
    for (const listener of listeners.onRendered ?? []) listener(event);
    await Promise.resolve();
  };
}

describe('keepScrollAcrossNotes', () => {
  beforeEach(() => {
    window.scrollY = 376;
    vi.spyOn(window, 'scrollTo').mockImplementation((options) => {
      window.scrollY = (options as ScrollToOptions).top ?? 0;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('holds the page still while a note opens, is swapped and closes', async () => {
    const navigate = setup();
    await navigate(at('/'), at('/', 'a'));
    expect(window.scrollY).toBe(376);
    await navigate(at('/', 'a'), at('/', 'b'));
    expect(window.scrollY).toBe(376);
    await navigate(at('/', 'b'), at('/'));
    expect(window.scrollY).toBe(376);
  });

  it('lets other navigations start at the top', async () => {
    const navigate = setup();
    await navigate(at('/'), at('/archive'));
    expect(window.scrollY).toBe(0);
    window.scrollY = 120;
    await navigate(at('/', 'a'), at('/deck'));
    expect(window.scrollY).toBe(0);
  });
});
