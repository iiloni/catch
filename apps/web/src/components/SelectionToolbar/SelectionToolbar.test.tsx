import type { Note } from '@catch/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveNotes,
  deleteNotesForever,
  duplicateNotes,
  restoreNotes,
  sendNotesToGallery,
  setNotePinned,
  setNotesColor,
  trashNotes,
  unarchiveNotes,
} from '@/lib/notes';
import { SelectionToolbar } from './SelectionToolbar';

const readiness = { awaitingTags: false, awaitingAssignments: false };
vi.mock('@/lib/notes');
vi.mock('@/lib/collections', () => ({
  useTagReadiness: () => readiness,
  useTags: () => [],
  useNoteTagAssignments: () => new Map(),
}));

function makeNote(id: string, overrides: Partial<Note> = {}): Note {
  return {
    id,
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
    ...overrides,
  };
}

const notes = [makeNote('note-1', { color: 'teal' }), makeNote('note-2', { color: 'teal' })];

afterEach(() => {
  vi.clearAllMocks();
  readiness.awaitingAssignments = false;
});

describe('SelectionToolbar', () => {
  it.each([
    ['Archive', archiveNotes, notes],
    ['Move to trash', trashNotes, ['note-1', 'note-2']],
    ['Make a copy', duplicateNotes, notes],
  ] as const)('%s acts on every selected note and ends selecting', (label, action, argument) => {
    const onDone = vi.fn();
    render(<SelectionToolbar notes={notes} place="gallery" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(action).toHaveBeenCalledWith(argument);
    expect(onDone).toHaveBeenCalled();
  });

  it('pins a mixed selection, then unpins all, without ending selection', () => {
    const onDone = vi.fn();
    const mixed = [makeNote('one', { isPinned: true }), makeNote('two')];
    const { rerender } = render(<SelectionToolbar notes={mixed} place="gallery" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(setNotePinned).toHaveBeenCalledExactlyOnceWith('two', true);
    vi.clearAllMocks();
    rerender(
      <SelectionToolbar
        notes={mixed.map((note) => ({ ...note, isPinned: true }))}
        place="gallery"
        onDone={onDone}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(setNotePinned).toHaveBeenCalledWith('one', false);
    expect(setNotePinned).toHaveBeenCalledWith('two', false);
    expect(onDone).not.toHaveBeenCalled();
  });

  it.each(['archive', 'trash'] as const)('keeps pinning unavailable in %s', (place) => {
    render(<SelectionToolbar notes={notes} place={place} onDone={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
  });

  it('opens secondary tags without ending selection', () => {
    const onDone = vi.fn();
    render(<SelectionToolbar notes={notes} place="gallery" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tags' }));
    expect(screen.getByRole('region', { name: 'Secondary tags' })).toBeVisible();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('recolors the selection and keeps it', () => {
    const onDone = vi.fn();
    render(<SelectionToolbar notes={notes} place="gallery" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Background color' }));
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Red' }));
    expect(setNotesColor).toHaveBeenCalledWith(['note-1', 'note-2'], 'red');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('checks no color when the selected notes differ', () => {
    render(
      <SelectionToolbar
        notes={[notes[0] as Note, makeNote('note-3')]}
        place="gallery"
        onDone={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Background color' }));
    expect(screen.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: 'No color' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('sends deck notes back to the gallery', () => {
    const onDone = vi.fn();
    render(<SelectionToolbar notes={notes} place="deck" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send to gallery' }));
    expect(sendNotesToGallery).toHaveBeenCalledWith(notes);
    expect(onDone).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
  });

  it('unarchives in the archive', () => {
    const onDone = vi.fn();
    render(<SelectionToolbar notes={notes} place="archive" onDone={onDone} />);
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Unarchive' }));
    expect(unarchiveNotes).toHaveBeenCalledWith(notes);
    expect(onDone).toHaveBeenCalled();
  });

  it('restores, and deletes forever after confirming, in the trash', () => {
    const onDone = vi.fn();
    render(<SelectionToolbar notes={notes} place="trash" onDone={onDone} />);
    expect(screen.queryByRole('button', { name: 'Move to trash' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete forever' }));
    expect(deleteNotesForever).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete forever' }),
    );
    expect(deleteNotesForever).toHaveBeenCalledWith(['note-1', 'note-2']);
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(restoreNotes).toHaveBeenCalledWith(notes);
  });
  it('waits for assignments before copying without ending selection', () => {
    readiness.awaitingAssignments = true;
    const onDone = vi.fn();
    const { rerender } = render(
      <SelectionToolbar notes={[makeNote('one')]} place="gallery" onDone={onDone} />,
    );
    const copy = screen.getByRole('button', { name: 'Make a copy' });
    expect(copy).toBeDisabled();
    fireEvent.click(copy);
    expect(duplicateNotes).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    readiness.awaitingAssignments = false;
    rerender(<SelectionToolbar notes={[makeNote('one')]} place="gallery" onDone={onDone} />);
    expect(copy).toBeEnabled();
  });
});
