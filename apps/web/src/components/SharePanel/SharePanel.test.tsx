import type { NoteShare } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteShares } from '@/lib/collections';
import { shareNote, stopSharingNote } from '@/lib/sharing';
import { SharePanel } from './SharePanel';

vi.mock('@/lib/collections', () => ({ useNoteShares: vi.fn() }));
vi.mock('@/lib/sharing', () => ({
  noteShareLink: (token: string) => `https://catch.example/s/${token}`,
  shareNote: vi.fn(),
  stopSharingNote: vi.fn(),
}));

const note = { id: '0199a0a0-0000-7000-8000-000000000001', userId: 'me' };
const token = 'aB3_-'.repeat(8) + 'xyz';
const share: NoteShare = { noteId: note.id, userId: 'me', token, createdAt: new Date() };
const writeText = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  vi.mocked(useNoteShares).mockReturnValue(new Map());
});

describe('SharePanel', () => {
  it('makes a link for a note that has none and copies it', async () => {
    vi.mocked(shareNote).mockReturnValue(`https://catch.example/s/${token}`);
    render(<SharePanel note={note} />);
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(shareNote).toHaveBeenCalledWith(note);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`https://catch.example/s/${token}`));
  });

  it('shows a shared note its link, to copy again or to end', async () => {
    vi.mocked(useNoteShares).mockReturnValue(new Map([[note.id, share]]));
    render(<SharePanel note={note} />);
    expect(screen.getByLabelText('Share link')).toHaveValue(`https://catch.example/s/${token}`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Stop sharing' }));
    expect(stopSharingNote).toHaveBeenCalledWith(note.id);
  });

  it('says so when the link cannot be copied', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    vi.mocked(useNoteShares).mockReturnValue(new Map([[note.id, share]]));
    render(<SharePanel note={note} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
  });
});
