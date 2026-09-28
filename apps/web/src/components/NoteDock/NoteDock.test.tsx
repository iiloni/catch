import type { Note } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorNote } from '@/lib/dockState';
import { restoreNote, setNoteArchived, setNoteColor, setNotePinned } from '@/lib/notes';
import { NoteDock } from './NoteDock';

vi.mock('@/lib/notes');
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

  it('closes the editor after archiving', () => {
    renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(setNoteArchived).toHaveBeenCalledWith(note.id, true);
    expect(close).toHaveBeenCalled();
  });

  it('only offers restoring a trashed note', () => {
    renderDock({ deletedAt: new Date() });
    expect(screen.queryByRole('button', { name: 'Background color' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(restoreNote).toHaveBeenCalledWith(note.id);
  });
});
