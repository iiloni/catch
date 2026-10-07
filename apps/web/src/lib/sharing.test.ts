import { type SharedNote, shareTokenSchema } from '@catch/shared';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api';
import { awaitSharedNote } from './collections';
import {
  acceptSharedNote,
  isSharedNote,
  newShareToken,
  noteShareLink,
  removeSharedNote,
} from './sharing';

const copies = vi.hoisted(() => new Map<string, SharedNote>());
vi.mock('./collections', () => ({
  awaitSharedNote: vi.fn(),
  noteSharesCollection: {},
  sharedNotesCollection: {
    get: (id: string) => copies.get(id),
    has: (id: string) => copies.has(id),
    delete: (id: string) => copies.delete(id),
    insert: (copy: SharedNote) => copies.set(copy.noteId, copy),
  },
  useSharedNotes: vi.fn(),
  write: (fn: () => void) => fn(),
}));
vi.mock('./api', () => ({ api: { acceptShare: vi.fn() } }));
vi.mock('sonner', () => ({ toast: vi.fn() }));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));

describe('removeSharedNote', () => {
  const copy: SharedNote = {
    noteId: '0199a0a0-0000-7000-8000-000000000001',
    userId: 'user-1',
    token: 'a'.repeat(43),
    ownerId: 'ada',
    ownerName: 'Ada',
    content: [],
    color: 'default',
    attachments: [],
    isAvailable: true,
    isPinned: true,
    isArchived: true,
    position: 'a3',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    copies.clear();
    vi.mocked(toast).mockClear();
  });

  function undo() {
    const action = vi.mocked(toast).mock.calls[0]?.[1]?.action;
    if (!action || typeof action !== 'object' || !('onClick' in action))
      throw new Error('Missing Undo action');
    expect(action.label).toBe('Undo');
    action.onClick({} as React.MouseEvent<HTMLButtonElement>);
  }

  it('restores the copy with its original link and arrangement', () => {
    copies.set(copy.noteId, copy);
    removeSharedNote(copy.noteId);
    expect(copies.has(copy.noteId)).toBe(false);
    undo();
    expect(copies.get(copy.noteId)).toEqual(copy);
  });

  it('leaves a copy already added again alone', () => {
    copies.set(copy.noteId, copy);
    removeSharedNote(copy.noteId);
    const current = { ...copy, isPinned: false, position: 'a0' };
    copies.set(copy.noteId, current);
    undo();
    expect(copies.get(copy.noteId)).toEqual(current);
  });

  it('does nothing if the copy has already gone', () => {
    removeSharedNote(copy.noteId);
    expect(toast).not.toHaveBeenCalled();
  });
});

describe('share links', () => {
  it('makes tokens the server accepts, a new one each time', () => {
    const first = newShareToken();
    expect(shareTokenSchema.safeParse(first).success).toBe(true);
    expect(newShareToken()).not.toBe(first);
  });

  it('points at the server the app talks to', () => {
    const token = newShareToken();
    expect(noteShareLink(token)).toBe(`https://catch.example/s/${token}`);
  });
});

describe('isSharedNote', () => {
  it("tells someone else's note from the user's own", () => {
    expect(isSharedNote({ userId: 'user-1' })).toBe(false);
    expect(isSharedNote({ userId: 'ada' })).toBe(true);
  });
});

describe('acceptSharedNote', () => {
  it('waits for the accepted copy before returning the note to open', async () => {
    vi.mocked(api.acceptShare).mockResolvedValue({ noteId: 'shared', txid: 42 });
    let synced = () => {};
    vi.mocked(awaitSharedNote).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          synced = resolve;
        }),
    );
    let opened = false;
    const acceptance = acceptSharedNote('token').then(() => {
      opened = true;
    });
    await vi.waitFor(() => expect(awaitSharedNote).toHaveBeenCalledWith('shared', 42));
    expect(opened).toBe(false);
    synced();
    await acceptance;
    expect(opened).toBe(true);
  });

  it('keeps a failed sync from opening a missing editor', async () => {
    vi.mocked(api.acceptShare).mockResolvedValue({ noteId: 'shared', txid: 42 });
    vi.mocked(awaitSharedNote).mockRejectedValue(new Error('Sync timed out'));
    await expect(acceptSharedNote('token')).rejects.toThrow('Sync timed out');
  });
});
