import type { NoteShare } from '@catch/shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useNoteShares } from '@/lib/collections';
import { shareOrCopy, usesSystemShare } from '@/lib/outgoingShares';
import { shareNote, stopSharingNote } from '@/lib/sharing';
import { SharePanel } from './SharePanel';

vi.mock('@/lib/collections', () => ({ useNoteShares: vi.fn() }));
vi.mock('@/lib/outgoingShares', () => ({ shareOrCopy: vi.fn(), usesSystemShare: vi.fn() }));
vi.mock('@/lib/sharing', () => ({
  noteShareLink: (token: string) => `https://catch.example/s/${token}`,
  shareNote: vi.fn(),
  stopSharingNote: vi.fn(),
}));

const note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'me',
  content: [{ type: 'paragraph', content: 'Pack the tent' }],
};
const token = `${'aB3_-'.repeat(8)}xyz`;
const share: NoteShare = { noteId: note.id, userId: 'me', token, createdAt: new Date() };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(shareOrCopy).mockResolvedValue('copied');
  vi.mocked(usesSystemShare).mockReturnValue(false);
  vi.mocked(useNoteShares).mockReturnValue(new Map());
});

describe('SharePanel', () => {
  it('makes a link for a note that has none and copies it', async () => {
    vi.mocked(shareNote).mockReturnValue(`https://catch.example/s/${token}`);
    render(<SharePanel note={note} />);
    expect(screen.queryByLabelText('Share link')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }));
    expect(shareNote).toHaveBeenCalledWith(note);
    await waitFor(() =>
      expect(shareOrCopy).toHaveBeenCalledWith({ url: `https://catch.example/s/${token}` }),
    );
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
    vi.mocked(shareOrCopy).mockRejectedValue(new Error('denied'));
    vi.mocked(useNoteShares).mockReturnValue(new Map([[note.id, share]]));
    render(<SharePanel note={note} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not copy');
  });

  it('copies Markdown content without creating a share link', async () => {
    render(<SharePanel note={note} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Note content' }));
    const button = screen.getByRole('button', { name: 'Copy content' });
    await waitFor(() => expect(button).toBeEnabled());
    expect(await screen.findByRole('textbox', { name: 'Note content' })).toHaveValue(
      'Pack the tent',
    );
    fireEvent.click(button);
    await waitFor(() => expect(shareOrCopy).toHaveBeenCalledWith({ text: 'Pack the tent' }));
    expect(shareNote).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText('A Markdown copy, without files or future updates.')).toBeVisible(),
    );
  });

  it('shares the current editor content before autosave updates the note', async () => {
    render(
      <SharePanel note={note} getContent={() => [{ type: 'paragraph', content: 'Just typed' }]} />,
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Note content' }));
    const button = screen.getByRole('button', { name: 'Copy content' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    expect(shareOrCopy).toHaveBeenCalledWith({ text: 'Just typed' });
  });

  it('opens the mobile share menu for a newly created link', async () => {
    vi.mocked(usesSystemShare).mockReturnValue(true);
    vi.mocked(shareOrCopy).mockResolvedValue('shared');
    vi.mocked(shareNote).mockReturnValue(`https://catch.example/s/${token}`);
    render(<SharePanel note={note} />);
    fireEvent.click(screen.getByRole('button', { name: 'Share link' }));
    expect(shareOrCopy).toHaveBeenCalledWith({ url: `https://catch.example/s/${token}` });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Share link' })).toBeEnabled());
    expect(screen.queryByText('Copied')).not.toBeInTheDocument();
  });

  it('switches back to the link without keeping the content warning or copied state', async () => {
    vi.mocked(useNoteShares).mockReturnValue(new Map([[note.id, share]]));
    render(<SharePanel note={note} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Note content' }));
    const button = screen.getByRole('button', { name: 'Copy content' });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Copied' });
    fireEvent.click(screen.getByRole('tab', { name: 'Catch link' }));
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeEnabled();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Stop sharing' })).toBeVisible());
    await waitFor(() =>
      expect(screen.queryByRole('textbox', { name: 'Note content' })).not.toBeInTheDocument(),
    );
  });
});
