import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteShares } from '@/lib/collections';
import { isSharedNote, useSharedNoteOwner } from '@/lib/sharing';
import { NoteShareBadge } from './NoteShareBadge';

vi.mock('@/lib/collections', () => ({ useNoteShares: vi.fn() }));
vi.mock('@/lib/sharing', () => ({ isSharedNote: vi.fn(), useSharedNoteOwner: vi.fn() }));

const note = { id: '0199a0a0-0000-7000-8000-000000000001', userId: 'me' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useNoteShares).mockReturnValue(new Map());
  vi.mocked(isSharedNote).mockReturnValue(false);
});

describe('NoteShareBadge', () => {
  it('shows nothing on a note that is not shared', () => {
    const { container } = render(<NoteShareBadge note={note} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('marks a note of the user that has a link', () => {
    vi.mocked(useNoteShares).mockReturnValue(
      new Map([
        [note.id, { noteId: note.id, userId: 'me', token: 'a'.repeat(43), createdAt: new Date() }],
      ]),
    );
    render(<NoteShareBadge note={note} />);
    expect(screen.getByRole('img', { name: 'Shared with a link' })).toBeInTheDocument();
  });

  it("says whose note someone else's is", () => {
    vi.mocked(isSharedNote).mockReturnValue(true);
    vi.mocked(useSharedNoteOwner).mockReturnValue('Ada');
    render(<NoteShareBadge note={{ ...note, userId: 'ada' }} />);
    expect(screen.getByRole('img', { name: 'Shared by Ada' })).toHaveTextContent('Ada');
  });
});
