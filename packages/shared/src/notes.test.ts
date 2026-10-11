import { describe, expect, it } from 'vitest';
import {
  createNoteSchema,
  createNotesSchema,
  MAX_NOTES_PER_REQUEST,
  noteSchema,
  updateNoteSchema,
} from './notes';

const id = '0199a0a0-0000-7000-8000-000000000000';

describe('createNoteSchema', () => {
  it('accepts a minimal note', () => {
    expect(createNoteSchema.parse({ id, content: [] })).toEqual({ id, content: [] });
  });

  it('rejects non-v7 ids', () => {
    expect(() =>
      createNoteSchema.parse({ id: '9b2f7c1e-0000-4000-8000-000000000000', content: [] }),
    ).toThrow();
  });

  it('keeps the dates and place a note was made with', () => {
    const createdAt = new Date('2020-01-02T03:04:05Z');
    expect(
      createNoteSchema.parse({
        id,
        content: [],
        isArchived: true,
        createdAt,
        updatedAt: createdAt,
      }),
    ).toEqual({ id, content: [], isArchived: true, createdAt, updatedAt: createdAt });
  });

  it('rejects unknown colors', () => {
    expect(() => createNoteSchema.parse({ id, content: [], color: 'chartreuse' })).toThrow();
  });
});

describe('createNotesSchema', () => {
  it('takes between one note and a request’s worth', () => {
    const notes = (count: number) => Array.from({ length: count }, () => ({ id, content: [] }));
    expect(createNotesSchema.safeParse({ notes: notes(1) }).success).toBe(true);
    expect(createNotesSchema.safeParse({ notes: notes(0) }).success).toBe(false);
    expect(createNotesSchema.safeParse({ notes: notes(MAX_NOTES_PER_REQUEST + 1) }).success).toBe(
      false,
    );
  });
});

describe('updateNoteSchema', () => {
  it('allows clearing status to send a note to the gallery', () => {
    expect(updateNoteSchema.parse({ status: null })).toEqual({ status: null });
  });

  it('keeps old queued writes from resetting a chosen preview', () => {
    expect(updateNoteSchema.parse({ content: [] })).toEqual({ content: [] });
    expect(updateNoteSchema.parse({ galleryPreviewUrl: null })).toEqual({
      galleryPreviewUrl: null,
    });
    expect(updateNoteSchema.parse({ galleryPreviewUrl: 'https://example.com/' })).toEqual({
      galleryPreviewUrl: 'https://example.com/',
    });
  });

  it('keeps a history envelope without resetting an omitted preview choice', () => {
    const history = { operationId: id, originId: id };
    expect(updateNoteSchema.parse({ content: [], history })).toEqual({ content: [], history });
    expect(
      updateNoteSchema.parse({ content: [], galleryPreviewUrl: 'https://example.com/', history }),
    ).toEqual({ content: [], galleryPreviewUrl: 'https://example.com/', history });
  });

  it.each(['javascript:alert(1)', 'https://example.com/#part', 'not a url'])(
    'rejects invalid or unnormalized preview choices: %s',
    (galleryPreviewUrl) => {
      expect(updateNoteSchema.safeParse({ galleryPreviewUrl }).success).toBe(false);
    },
  );

  it('defaults pre-existing note payloads to text without changing content', () => {
    const old = {
      id,
      userId: 'user',
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
    };
    expect(noteSchema.parse(old)).toEqual({ ...old, galleryPreviewUrl: null });
  });
});
