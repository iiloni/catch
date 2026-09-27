import { describe, expect, it } from 'vitest';
import { createNoteSchema, updateNoteSchema } from './notes';

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

  it('rejects unknown colors', () => {
    expect(() => createNoteSchema.parse({ id, content: [], color: 'magenta' })).toThrow();
  });
});

describe('updateNoteSchema', () => {
  it('allows clearing status to send a note to the gallery', () => {
    expect(updateNoteSchema.parse({ status: null })).toEqual({ status: null });
  });
});
