import type { Note } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setNotePinned, trashNote } from '@/lib/notes';
import { NoteCard } from './NoteCard';

vi.mock('@/lib/notes');

const note: Note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'user-1',
  content: [
    { type: 'heading', content: [{ type: 'text', text: 'Groceries' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Oat milk' }] },
  ],
  color: 'yellow',
  status: null,
  isPinned: false,
  isArchived: false,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function renderCard(props: Partial<React.ComponentProps<typeof NoteCard>> = {}) {
  return render(
    <TooltipProvider>
      <NoteCard note={note} {...props} />
    </TooltipProvider>,
  );
}

describe('NoteCard', () => {
  it('renders the title and applies the note color', () => {
    renderCard();
    const title = screen.getByRole('heading', { name: 'Groceries' });
    expect(screen.getByText('Oat milk')).toBeInTheDocument();
    expect(title.closest('article')).toHaveAttribute('data-note-color', 'yellow');
  });

  it('opens the note when clicked', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }));
    expect(onOpen).toHaveBeenCalledWith(note, expect.any(HTMLElement));
  });

  it('pins and trashes without opening the note', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(setNotePinned).toHaveBeenCalledWith(note.id, true);
    expect(trashNote).toHaveBeenCalledWith(note.id);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers restore instead of editing actions for trashed notes', () => {
    renderCard({ note: { ...note, deletedAt: new Date() } });
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
  });
});
