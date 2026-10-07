import { shareTokenSchema } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import { isSharedNote, newShareToken, noteShareLink } from './sharing';

vi.mock('./collections', () => ({
  noteSharesCollection: {},
  sharedNotesCollection: {},
  useSharedNotes: vi.fn(),
  write: vi.fn(),
}));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));

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
