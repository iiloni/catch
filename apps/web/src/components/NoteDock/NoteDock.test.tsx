import type { BoardColumn, Note } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorControls, editorNote } from '@/lib/dockState';
import { HOLD_MS } from '@/lib/longPress';
import {
  moveNoteToDeck,
  restoreNote,
  sendNoteToGallery,
  setNoteColor,
  setNotePinned,
} from '@/lib/notes';
import { NoteDock } from './NoteDock';

vi.mock('@/lib/notes');
vi.mock('@/components/AttachmentPicker/AttachmentPicker', () => ({
  AttachmentPicker: () => <section aria-label="Add attachment">Attachment picker</section>,
}));
const columns: BoardColumn[] = [
  { id: 'in_progress', userId: 'user-1', name: 'In progress', color: 'blue', position: 'a1' },
  { id: 'new', userId: 'user-1', name: 'New', color: 'amber', position: 'a0' },
];
vi.mock('@/lib/collections', () => ({
  useTagReadiness: () => ({ awaitingTags: false, awaitingAssignments: false }),
  useTags: () => [],
  useNoteTagAssignments: () => new Map(),
  useBoardColumns: () => columns,
}));
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

  it('opens the secondary tag tree and folds it before leaving the note', () => {
    renderDock();
    const tags = screen.getByRole('button', { name: 'Tags' });
    fireEvent.click(tags);
    expect(tags).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Secondary tags' })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(tags).toHaveAttribute('aria-expanded', 'false');
    expect(close).not.toHaveBeenCalled();
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

  it('orders tags second and pin last, with archive in the header', () => {
    renderDock();
    expect(screen.getByRole('button', { name: 'Attach files' })).toBeEnabled();
    expect(
      screen.getAllByRole('button').map((button) => button.getAttribute('aria-label')),
    ).toEqual(['Background color', 'Tags', 'Attach files', 'Move note', 'Pin']);
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
