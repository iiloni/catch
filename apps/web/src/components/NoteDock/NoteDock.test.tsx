import type { BoardColumn, Note } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorNote } from '@/lib/dockState';
import { HOLD_MS } from '@/lib/longPress';
import {
  moveNoteToDeck,
  restoreNote,
  sendNoteToGallery,
  setNoteArchived,
  setNoteColor,
  setNotePinned,
} from '@/lib/notes';
import { NoteDock } from './NoteDock';

vi.mock('@/lib/notes');
const columns: BoardColumn[] = [
  { id: 'in_progress', userId: 'user-1', name: 'In progress', color: 'blue', position: 'a1' },
  { id: 'new', userId: 'user-1', name: 'New', color: 'amber', position: 'a0' },
];
vi.mock('@/lib/collections', () => ({ useBoardColumns: () => columns }));
const close = vi.fn();
vi.mock('@/lib/openNote', () => ({ useOpenNote: () => ({ open: vi.fn(), close }) }));

const note: Note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'user-1',
  content: [],
  color: 'default',
  status: null,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function renderDock(overrides: Partial<Note> = {}) {
  act(() => editorNote.set({ ...note, ...overrides }));
  return render(<NoteDock />);
}

afterEach(() => {
  act(() => editorNote.set(null));
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('NoteDock', () => {
  it("shows the open note's actions", () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(setNotePinned).toHaveBeenCalledWith(note.id, true);
    expect(screen.getByRole('button', { name: 'Move note' })).toBeInTheDocument();
  });

  it('grows a palette out of the dock', () => {
    renderDock();
    const colors = screen.getByRole('button', { name: 'Background color' });
    expect(colors).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(colors);
    expect(colors).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }));
    expect(setNoteColor).toHaveBeenCalledWith(note.id, 'teal');
  });

  it.each([null, 'new'])('opens the same move picker from %s without moving the note', (status) => {
    renderDock({ status });
    const move = screen.getByRole('button', { name: 'Move note' });
    expect(move).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(move);
    expect(move).toHaveAttribute('aria-expanded', 'true');
    expect(moveNoteToDeck).not.toHaveBeenCalled();
    expect(sendNoteToGallery).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Deck columns' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to gallery' })).toBeInTheDocument();
  });

  it('moves a deck note to another column without closing the editor', () => {
    renderDock({ status: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
    fireEvent.click(screen.getByRole('button', { name: 'In progress' }));
    expect(moveNoteToDeck).toHaveBeenCalledWith(note.id, 'in_progress');
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Move note' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('sends a deck note to Gallery without closing the editor', () => {
    renderDock({ status: 'new' });
    fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to gallery' }));
    expect(sendNoteToGallery).toHaveBeenCalledWith(note.id);
    expect(close).not.toHaveBeenCalled();
  });

  it('closes the picker without writing when choosing the current location', () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
    fireEvent.click(screen.getByRole('button', { name: 'Send to gallery' }));
    expect(moveNoteToDeck).not.toHaveBeenCalled();
    expect(sendNoteToGallery).not.toHaveBeenCalled();
  });

  it('opens the columns when the move button is held', () => {
    vi.useFakeTimers();
    renderDock();
    const deck = screen.getByRole('button', { name: 'Move note' });
    fireEvent.pointerDown(deck, { button: 0, pointerId: 1 });
    act(() => vi.advanceTimersByTime(HOLD_MS));
    fireEvent.pointerUp(deck, { button: 0, pointerId: 1 });
    fireEvent.click(deck);
    expect(moveNoteToDeck).not.toHaveBeenCalled();

    const names = screen
      .getAllByRole('button')
      .filter((button) => button.dataset.deckColumn)
      .map((button) => button.textContent);
    expect(names).toEqual(['NewDefault', 'In progress']);
    fireEvent.click(screen.getByRole('button', { name: 'In progress' }));
    expect(moveNoteToDeck).toHaveBeenCalledWith(note.id, 'in_progress');
    expect(close).not.toHaveBeenCalled();
  });

  it('closes the editor after archiving', () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(setNoteArchived).toHaveBeenCalledWith(note.id, true);
    expect(close).toHaveBeenCalled();
  });

  it('keeps the editor open after unarchiving', () => {
    renderDock({ isArchived: true });
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(setNoteArchived).toHaveBeenCalledWith(note.id, false);
    expect(close).not.toHaveBeenCalled();
  });

  it('only offers restoring a trashed note', () => {
    renderDock({ deletedAt: new Date() });
    expect(screen.queryByRole('button', { name: 'Background color' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(restoreNote).toHaveBeenCalledWith(note.id);
  });
});
