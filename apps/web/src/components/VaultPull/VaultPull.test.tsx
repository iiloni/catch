import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createStore } from '@/lib/store';
import { VaultPull } from './VaultPull';

type Origin = { from: DOMRect; shown: () => void } | null;

const vault = vi.hoisted(() => ({
  mode: null as ReturnType<typeof createStore<boolean>> | null,
  prompt: null as ReturnType<typeof createStore<boolean>> | null,
  origin: null as ReturnType<typeof createStore<Origin>> | null,
  /** Whether entering asks for the password, as a locked vault does. */
  locked: false,
  toggle: vi.fn(),
}));

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));
vi.mock('@/lib/vault', async () => {
  const { createStore } = await import('@/lib/store');
  vault.mode = createStore(false);
  vault.prompt = createStore(false);
  vault.origin = createStore<Origin>(null);
  vault.toggle.mockImplementation(() => {
    if (vault.mode?.get()) vault.mode.set(false);
    else if (vault.locked) vault.prompt?.set(true);
    else vault.mode?.set(true);
  });
  return {
    vaultMode: vault.mode,
    vaultPrompt: vault.prompt,
    vaultPromptOrigin: vault.origin,
    toggleVault: vault.toggle,
  };
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vault.locked = false;
  act(() => {
    vault.mode?.set(false);
    vault.prompt?.set(false);
    vault.origin?.set(null);
  });
});

function touch(target: Element, type: 'start' | 'move' | 'end', y: number, time: number) {
  const factory = {
    start: createEvent.touchStart,
    move: createEvent.touchMove,
    end: createEvent.touchEnd,
  }[type];
  const touches = type === 'end' ? [] : [{ clientX: 100, clientY: y, identifier: 0 }];
  const event = factory(target, { touches, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'timeStamp', { value: time });
  fireEvent(target, event);
}

function pull(target: Element) {
  touch(target, 'start', 100, 0);
  touch(target, 'move', 220, 50);
  touch(target, 'end', 220, 80);
}

function setup(disabled = false) {
  render(
    <div data-page-pager>
      <VaultPull disabled={disabled}>
        <p>Gallery</p>
      </VaultPull>
    </div>,
  );
  return screen.getByText('Gallery');
}

describe('vault pull', () => {
  it('does nothing until Settings turns it on', () => {
    pull(setup());
    expect(vault.toggle).not.toHaveBeenCalled();
  });

  it('enters the vault', () => {
    localStorage.setItem('catch-pull-for-vault', 'true');
    const page = setup();
    expect(screen.getByText('Pull to open the vault')).toBeInTheDocument();
    pull(page);
    expect(vault.toggle).toHaveBeenCalledOnce();
  });

  it('leaves it from inside', () => {
    localStorage.setItem('catch-pull-for-vault', 'true');
    act(() => vault.mode?.set(true));
    const page = setup();
    expect(screen.getByText('Pull to leave the vault')).toBeInTheDocument();
    pull(page);
    expect(vault.toggle).toHaveBeenCalledOnce();
  });

  it('stays out of the way of selecting notes', () => {
    localStorage.setItem('catch-pull-for-vault', 'true');
    pull(setup(true));
    expect(vault.toggle).not.toHaveBeenCalled();
  });

  it('hands its pill to the form a locked vault asks for, until the form is on screen', async () => {
    localStorage.setItem('catch-pull-for-vault', 'true');
    vault.locked = true;
    const page = setup();
    pull(page);
    expect(vault.prompt?.get()).toBe(true);
    const origin = vault.origin?.get();
    expect(origin?.from).toBeDefined();
    // The pill holds where it was, still saying what letting go did.
    expect(screen.getByText('Release to open the vault')).toBeInTheDocument();
    await act(async () => origin?.shown());
    expect(screen.getByText('Pull to open the vault')).toBeInTheDocument();
  });

  it('asks nothing of the form when the vault opens without one', () => {
    localStorage.setItem('catch-pull-for-vault', 'true');
    pull(setup());
    expect(vault.mode?.get()).toBe(true);
    expect(vault.origin?.get()).toBeNull();
  });
});
