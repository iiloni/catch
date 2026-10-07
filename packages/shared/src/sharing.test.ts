import { describe, expect, it } from 'vitest';
import { attachmentUrl } from './attachments';
import {
  resolveAttachmentBlocks,
  type SharedNote,
  sharedAttachmentPath,
  sharedAttachments,
  sharedNoteAsNote,
  shareLink,
  shareTokenSchema,
} from './sharing';

const noteId = '0199a0a0-0000-7000-8000-000000000001';
const fileId = '0199a0a0-0000-7000-8000-000000000002';
const shared: SharedNote = {
  noteId,
  userId: 'reader',
  token: 'a'.repeat(43),
  ownerId: 'owner',
  ownerName: 'Ada',
  content: [{ type: 'paragraph', content: 'Hello' }],
  color: 'blue',
  attachments: [
    {
      id: fileId,
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      kind: 'image',
      createdAt: new Date('2026-10-01T00:00:00.000Z'),
    },
  ],
  isAvailable: true,
  isPinned: true,
  isArchived: false,
  position: 'a0',
  createdAt: new Date('2026-10-01T00:00:00.000Z'),
  updatedAt: new Date('2026-10-02T00:00:00.000Z'),
};

describe('share links', () => {
  it('takes a whole token and nothing else', () => {
    expect(shareTokenSchema.safeParse(`${'aB3_-'.repeat(8)}xyz`).success).toBe(true);
    for (const value of ['', 'short', `${'a'.repeat(42)}/`, 'a'.repeat(44)]) {
      expect(shareTokenSchema.safeParse(value).success).toBe(false);
    }
  });

  it('puts the token in the path of a page on the server', () => {
    const token = 'a'.repeat(43);
    expect(shareLink('https://catch.example/u/2/archive', token)).toBe(
      `https://catch.example/s/${token}`,
    );
    expect(sharedAttachmentPath(token, fileId)).toBe(
      `/api/shares/${token}/attachments/${fileId}/content`,
    );
  });
});

describe('shared notes', () => {
  it("keeps the owner as the note's user and the reader's own arrangement", () => {
    expect(sharedNoteAsNote(shared)).toMatchObject({
      id: noteId,
      userId: 'owner',
      color: 'blue',
      status: null,
      isPinned: true,
      isArchived: false,
      position: 'a0',
      deletedAt: null,
      updatedAt: shared.updatedAt,
    });
  });

  it("lists the note's files as ready attachments, with dates that synced as text", () => {
    const synced = {
      ...shared,
      attachments: shared.attachments.map((file) => ({
        ...file,
        createdAt: file.createdAt.toISOString() as unknown as Date,
      })),
    };
    expect(sharedAttachments(synced)).toEqual([
      {
        ...shared.attachments[0],
        userId: 'owner',
        noteId,
        status: 'ready',
        sourceId: null,
        deletedAt: null,
      },
    ]);
  });

  it('points file blocks, nested ones too, at addresses a reader can load', () => {
    const blocks = [
      { type: 'image', props: { url: attachmentUrl(fileId), caption: 'A' } },
      { type: 'image', props: { url: 'https://elsewhere.example/a.png' } },
      {
        type: 'bulletListItem',
        children: [{ type: 'file', props: { url: attachmentUrl(fileId) } }],
      },
    ];
    const resolved = resolveAttachmentBlocks(blocks, (id) => `/files/${id}`);
    expect(resolved[0]).toEqual({
      type: 'image',
      props: { url: `/files/${fileId}`, caption: 'A' },
    });
    expect(resolved[1]).toEqual(blocks[1]);
    expect(resolved[2]?.children).toEqual([{ type: 'file', props: { url: `/files/${fileId}` } }]);
    // The note itself is left as it was.
    expect(blocks[0]?.props?.url).toBe(attachmentUrl(fileId));
  });
});
