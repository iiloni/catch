import type { BoardColumn, Note } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { editorControls, editorNote } from '@/lib/dockState';
import { HOLD_MS } from '@/lib/longPress';
import { moveNoteToDeck, restoreNote, setNoteColor, setNotePinned } from '@/lib/notes';
import { NoteDock } from './NoteDock';

vi.mock('@/lib/notes');
vi.mock('@/components/AttachmentPicker/AttachmentPicker', () => ({
  AttachmentPicker: () => <section aria-label="Add attachment">Attachment picker</section>,
}));
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
  act(() => {
    editorNote.set(null);
    editorControls.set(null);
  });
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe('NoteDock', () => {
  it("shows the open note's actions", () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(setNotePinned).toHaveBeenCalledWith(note.id, true);
    expect(screen.getByRole('button', { name: 'Add to deck' })).toBeInTheDocument();
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

  it('adds a tapped note to the default column', () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Add to deck' }));
    expect(moveNoteToDeck).toHaveBeenCalledWith(note.id);
    expect(screen.queryByRole('region', { name: 'Deck columns' })).toBeNull();
  });

  it('opens the columns when the deck button is held', () => {
    vi.useFakeTimers();
    renderDock();
    const deck = screen.getByRole('button', { name: 'Add to deck' });
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

  it('orders attachments second and pin last, with archive in the header', () => {
    renderDock();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeDisabled();
    act(() => editorControls.set({} as EditorControls));
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Background color', 'Attach files', 'Add to deck', 'Pin']);
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Attach files' }));
    expect(screen.getByRole('region', { name: 'Add attachment' })).toBeInTheDocument();
  });

  it('only offers restoring a trashed note', () => {
    renderDock({ deletedAt: new Date() });
    expect(screen.queryByRole('button', { name: 'Background color' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(restoreNote).toHaveBeenCalledWith(note.id);
  });
});
