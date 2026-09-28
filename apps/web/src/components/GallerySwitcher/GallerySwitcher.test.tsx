import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GallerySwitcher, galleryPageAt } from './GallerySwitcher';

afterEach(() => vi.restoreAllMocks());

function mockBarRect(rect: { left: number; right: number; top: number; bottom: number }) {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
    ...rect,
    width,
    height,
    x: rect.left,
    y: rect.top,
    toJSON: () => {},
  });
}

describe('GallerySwitcher', () => {
  it('marks the current page and picks another', () => {
    const onSelect = vi.fn();
    render(<GallerySwitcher open current="/archive" hovered={null} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: 'Archive' })).toHaveAttribute('aria-current', 'page');
    fireEvent.click(screen.getByRole('button', { name: 'Trash' }));
    expect(onSelect).toHaveBeenCalledWith('/trash');
  });

  it('renders nothing while closed', () => {
    render(<GallerySwitcher open={false} current="/" hovered={null} onSelect={vi.fn()} />);
    expect(screen.queryByRole('navigation', { name: 'Gallery pages' })).toBeNull();
  });

  it('maps a point near the bar to the nearest segment', () => {
    render(<GallerySwitcher open current="/" hovered={null} onSelect={vi.fn()} />);
    // Bar spans x 0..300, y 100..150.
    mockBarRect({ left: 0, right: 300, top: 100, bottom: 150 });
    // Centers and the gaps between segments.
    expect(galleryPageAt(50, 125)).toBe('/');
    expect(galleryPageAt(100, 125)).toBe('/archive');
    expect(galleryPageAt(250, 125)).toBe('/trash');
    // Forgiving vertically: above the bar and just below it still count.
    expect(galleryPageAt(250, 60)).toBe('/trash');
    expect(galleryPageAt(50, 160)).toBe('/');
    // Far away: no segment, so releasing leaves the bar open to tap.
    expect(galleryPageAt(150, 400)).toBeNull();
    expect(galleryPageAt(-100, 125)).toBeNull();
  });
});
