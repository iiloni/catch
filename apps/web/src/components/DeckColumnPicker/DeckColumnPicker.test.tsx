import type { BoardColumn } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeckColumnPicker, deckColumnAt } from './DeckColumnPicker';

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

describe('DeckColumnPicker', () => {
  it('marks the default column and picks one', () => {
    const onSelect = vi.fn();
    render(<DeckColumnPicker columns={columns} hovered={null} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /New/ })).toHaveTextContent('Default');
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(onSelect).toHaveBeenCalledWith('done');
  });

  it('maps a point over the list to the nearest row', () => {
    const { container } = render(
      <DeckColumnPicker columns={columns} hovered={null} onSelect={vi.fn()} />,
    );
    mockLayout();
    expect(deckColumnAt(container, 150, 110)).toBe('new');
    expect(deckColumnAt(container, 150, 170)).toBe('doing');
    expect(deckColumnAt(container, 320, 240)).toBe('done');
    // Just above the list still reaches the first row.
    expect(deckColumnAt(container, 150, 80)).toBe('new');
    // Back down on the dock's buttons, or off to the side, is no column.
    expect(deckColumnAt(container, 150, 300)).toBeNull();
    expect(deckColumnAt(container, 400, 170)).toBeNull();
  });

  it('skips rows scrolled out of the list', () => {
    const { container } = render(
      <DeckColumnPicker columns={columns} hovered={null} onSelect={vi.fn()} />,
    );
    mockLayout(50);
    expect(deckColumnAt(container, 150, 90)).toBe('doing');
  });
});
