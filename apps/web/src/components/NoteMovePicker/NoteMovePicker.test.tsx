import type { BoardColumn } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteMovePicker, noteDestinationAt } from './NoteMovePicker';

const columns: BoardColumn[] = [
  { id: 'new', userId: 'user-1', name: 'New', color: 'amber', position: 'a0' },
  { id: 'doing', userId: 'user-1', name: 'Doing', color: 'blue', position: 'a1' },
  { id: 'done', userId: 'user-1', name: 'Done', color: 'green', position: 'a2' },
];

afterEach(() => vi.restoreAllMocks());

/** Lays the list out at x 0..300, y 100..250, with 50px rows starting at `firstRowTop`. */
function mockLayout(firstRowTop = 100) {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const index = columns.findIndex(
      (column) => column.id === (this as HTMLElement).dataset.deckColumn,
    );
    if ((this as HTMLElement).hasAttribute('data-move-gallery')) {
      return {
        left: 330,
        right: 450,
        top: 100,
        bottom: 250,
        width: 120,
        height: 150,
        x: 330,
        y: 100,
        toJSON: () => {},
      };
    }
    const top = index < 0 ? 100 : firstRowTop + index * 50;
    const bottom = index < 0 ? 250 : top + 50;
    return {
      left: 0,
      right: 300,
      top,
      bottom,
      width: 300,
      height: bottom - top,
      x: 0,
      y: top,
      toJSON: () => {},
    };
  });
}

describe('NoteMovePicker', () => {
  it('marks the default column and picks one', () => {
    const onSelect = vi.fn();
    render(
      <NoteMovePicker columns={columns} current={null} hovered={undefined} onSelect={onSelect} />,
    );
    expect(screen.getByRole('button', { name: /New/ })).toHaveTextContent('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSelect).toHaveBeenCalledWith('done');
  });

  it('marks Gallery as the current destination and selects it', () => {
    const onSelect = vi.fn();
    render(
      <NoteMovePicker columns={columns} current={null} hovered={undefined} onSelect={onSelect} />,
    );
    const gallery = screen.getByRole('button', { name: 'Send to gallery' });
    expect(gallery).toHaveAttribute('aria-current', 'location');
    expect(screen.getByRole('button', { name: 'Doing' })).not.toHaveAttribute('aria-current');
    fireEvent.click(gallery);
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('marks the current deck column', () => {
    render(
      <NoteMovePicker columns={columns} current="doing" hovered={undefined} onSelect={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Doing' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    expect(screen.getByRole('button', { name: 'Send to gallery' })).not.toHaveAttribute(
      'aria-current',
    );
  });

  it('maps a point over the list to the nearest row', () => {
    const { container } = render(
      <NoteMovePicker columns={columns} current={null} hovered={undefined} onSelect={vi.fn()} />,
    );
    mockLayout();
    expect(noteDestinationAt(container, 150, 110)).toBe('new');
    expect(noteDestinationAt(container, 150, 170)).toBe('doing');
    expect(noteDestinationAt(container, 400, 170)).toBeNull();
    expect(noteDestinationAt(container, 320, 240)).toBe('done');
    // Just above the list still reaches the first row.
    expect(noteDestinationAt(container, 150, 80)).toBe('new');
    // Back down on the dock's buttons, or off to the side, is no column.
    expect(noteDestinationAt(container, 150, 300)).toBeUndefined();
    expect(noteDestinationAt(container, 500, 170)).toBeUndefined();
  });

  it('skips rows scrolled out of the list', () => {
    const { container } = render(
      <NoteMovePicker columns={columns} current={null} hovered={undefined} onSelect={vi.fn()} />,
    );
    mockLayout(50);
    expect(noteDestinationAt(container, 150, 90)).toBe('doing');
  });
});
