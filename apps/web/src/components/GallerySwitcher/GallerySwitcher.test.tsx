import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { GallerySwitcher } from './GallerySwitcher';

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
});
