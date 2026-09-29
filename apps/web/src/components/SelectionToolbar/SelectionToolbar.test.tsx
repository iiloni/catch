import type { Note } from '@catch/shared';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveNotes,
  deleteNotesForever,
  duplicateNotes,
  restoreNotes,
  sendNotesToGallery,
  setNotesColor,
  trashNotes,
  unarchiveNotes,
} from '@/lib/notes';
import { SelectionToolbar } from './SelectionToolbar';

vi.mock('@/lib/notes');

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

afterEach(() => vi.clearAllMocks());

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
    expect(screen.getByRole('button', { name: 'Default' })).toHaveAttribute(
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
});
