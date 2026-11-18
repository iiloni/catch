import { act, createEvent, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { createStore } from '@/lib/store';
import { VaultPull } from './VaultPull';

const vault = vi.hoisted(() => ({
  mode: null as ReturnType<typeof createStore<boolean>> | null,
  toggle: vi.fn(),
}));

vi.mock('@/lib/haptics', () => ({ haptics: { threshold: vi.fn() } }));
vi.mock('@/lib/vault', async () => {
  const { createStore } = await import('@/lib/store');
  vault.mode = createStore(false);
  return { vaultMode: vault.mode, toggleVault: vault.toggle };
});

afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  act(() => vault.mode?.set(false));
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
});
