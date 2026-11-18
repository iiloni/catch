import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GallerySwitcher, switcherItemAt } from './GallerySwitcher';

afterEach(() => vi.restoreAllMocks());

type Box = { left: number; right: number; top: number; bottom: number };

/**
 * Lays the card out as a phone would: Reminders and the vault centered on top, the Gallery,
 * Archive and Trash below. The card spans x 0..300, y 100..240.
 */
function mockLayout() {
  const boxes: Record<string, Box> = {
    '/reminders': { left: 50, right: 150, top: 100, bottom: 164 },
    vault: { left: 150, right: 250, top: 100, bottom: 164 },
    '/': { left: 0, right: 100, top: 170, bottom: 234 },
    '/archive': { left: 100, right: 200, top: 170, bottom: 234 },
    '/trash': { left: 200, right: 300, top: 170, bottom: 234 },
  };
  const card = { left: 0, right: 300, top: 100, bottom: 240 };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const page = this instanceof HTMLElement ? this.dataset.galleryPage : undefined;
    const box = (page && boxes[page]) || card;
    return DOMRect.fromRect({
      x: box.left,
      y: box.top,
      width: box.right - box.left,
      height: box.bottom - box.top,
    });
  });
}

describe('GallerySwitcher', () => {
  it('marks the current page and picks another', () => {
    const onSelect = vi.fn();
    render(
      <GallerySwitcher open current="/archive" hovered={null} vault={null} onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(onSelect).toHaveBeenCalledWith('/trash');
  });

  it('renders nothing while closed', () => {
    render(
      <GallerySwitcher open={false} current="/" hovered={null} vault={null} onSelect={vi.fn()} />,
    );
    expect(screen.queryByRole('navigation', { name: 'Gallery pages' })).toBeNull();
  });

  it('maps a point near the card to the nearest segment', () => {
    render(
      <GallerySwitcher
        open
        current="/"
        hovered={null}
        vault={{ inside: false }}
        onSelect={vi.fn()}
      />,
    );
    mockLayout();
    // Inside each segment.
    expect(switcherItemAt(120, 130)).toBe('/reminders');
    expect(switcherItemAt(200, 130)).toBe('vault');
    expect(switcherItemAt(50, 200)).toBe('/');
    expect(switcherItemAt(150, 200)).toBe('/archive');
    expect(switcherItemAt(250, 200)).toBe('/trash');
    // The top row's empty corners belong to its nearer segment.
    expect(switcherItemAt(20, 130)).toBe('/reminders');
    expect(switcherItemAt(290, 130)).toBe('vault');
    // Forgiving: above the card and just below it still count.
    expect(switcherItemAt(200, 60)).toBe('vault');
    expect(switcherItemAt(50, 250)).toBe('/');
    // Far away: no segment, so releasing leaves the card open to tap.
    expect(switcherItemAt(150, 400)).toBeNull();
    expect(switcherItemAt(-100, 130)).toBeNull();
  });

  it('puts the vault toggle beside Reminders, and leaves Reminders alone where it is hidden', () => {
    const onSelect = vi.fn();
    const { rerender } = render(
      <GallerySwitcher
        open
        current="/"
        hovered={null}
        vault={{ inside: false }}
        onSelect={onSelect}
      />,
    );
    const buttons = () => screen.getAllByRole('button').map((button) => button.dataset.galleryPage);
    // The order a screen reader and the keyboard follow: the top row, then the bottom.
    expect(buttons()).toEqual(['/reminders', 'vault', '/', '/archive', '/trash']);
    const enter = screen.getByRole('button', { name: 'Open the vault' });
    expect(enter).toHaveAttribute('aria-pressed', 'false');
    expect(enter).toHaveTextContent('Vault');
    fireEvent.click(enter);
    expect(onSelect).toHaveBeenCalledWith('vault');

    rerender(
      <GallerySwitcher
        open
        current="/"
        hovered={null}
        vault={{ inside: true }}
        onSelect={onSelect}
      />,
    );
    expect(screen.getByRole('button', { name: 'Leave the vault' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    rerender(<GallerySwitcher open current="/" hovered={null} vault={null} onSelect={onSelect} />);
    expect(buttons()).toEqual(['/reminders', '/', '/archive', '/trash']);
    expect(screen.getByRole('button', { name: 'Reminders' })).toHaveClass('col-start-3');
  });
});
