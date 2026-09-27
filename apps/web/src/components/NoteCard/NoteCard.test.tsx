import type { Note } from '@catch/shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NoteCard } from './NoteCard';

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

describe('NoteCard', () => {
  it('renders the first line as the title and applies the note color', () => {
    render(<NoteCard note={note} />);
    const title = screen.getByRole('heading', { name: 'Groceries' });
    expect(title).toBeInTheDocument();
    expect(screen.getByText('Oat milk')).toBeInTheDocument();
    expect(title.closest('article')).toHaveAttribute('data-note-color', 'yellow');
  });

  it('calls onTrash with the note', () => {
    const onTrash = vi.fn();
    render(<NoteCard note={note} onTrash={onTrash} />);
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(onTrash).toHaveBeenCalledWith(note);
  });
});
