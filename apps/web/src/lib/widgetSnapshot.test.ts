import { type Note, type NoteTags, type Tag, widgetSnapshotSchema } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { widgetSnapshot, widgetText } from './widgetSnapshot';

const id = (n: number) => `0198f3a0-0000-7000-8000-${String(n).padStart(12, '0')}`;
const note = (n: number, changes: Partial<Note> = {}): Note => ({
  id: id(n),
  userId: 'alice',
  content: [{ type: 'paragraph', content: [{ text: `Note ${n}` }] }],
  color: 'default',
  status: null,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  galleryPreviewUrl: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  ...changes,
});

describe('widget projection', () => {
  it('excludes other owners, archive and trash and orders with code-unit positions', () => {
    const result = widgetSnapshot(
      'alice',
      [
        note(1, { position: 'aA' }),
        note(2, { position: 'a9' }),
        note(3, { isPinned: true, position: 'az' }),
        note(4, { userId: 'bob' }),
        note(5, { isArchived: true }),
        note(6, { deletedAt: new Date() }),
      ],
      [],
      [],
      [],
    );
    expect(result.notes.map((note) => note.id)).toEqual([id(3), id(2), id(1)]);
    expect(widgetSnapshotSchema.safeParse(result).success).toBe(true);
    expect(result.notes[0]).not.toHaveProperty('content');
  });
  it('inherits a primary tag color and includes ancestors for parent-tag filters', () => {
    const tags: Tag[] = [
      { id: id(10), userId: 'alice', name: 'Home', parentId: null, color: 'green', icon: null },
      { id: id(11), userId: 'alice', name: 'Garden', parentId: id(10), color: null, icon: null },
      { id: id(12), userId: 'bob', name: 'Private', parentId: null, color: 'red', icon: null },
    ];
    const assignment: NoteTags = {
      id: id(1),
      userId: 'alice',
      primaryTagId: id(11),
      secondaryTagIds: [],
    };
    const result = widgetSnapshot('alice', [note(1)], tags, [assignment], []);
    expect(result.notes[0]).toMatchObject({ color: 'green', tags: [id(10), id(11)] });
    expect(result.tags).toEqual([
      { id: id(10), name: 'Home' },
      { id: id(11), name: 'Home / Garden' },
    ]);
  });
  it('preserves nested checklist state without native editing data', () => {
    expect(
      widgetText([
        { type: 'heading', content: 'Shopping' },
        {
          type: 'checkListItem',
          props: { checked: false },
          content: 'Bread',
          children: [{ type: 'checkListItem', props: { checked: true }, content: 'Flour' }],
        },
      ]),
    ).toEqual({ title: 'Shopping', body: '☐ Bread\n☑ Flour' });
    expect(widgetText([{ type: 'checkListItem', content: 'Bread' }])).toEqual({
      title: 'Untitled note',
      body: '☐ Bread',
    });
  });
  it('bounds text sent across the bridge and handles attachment-only notes', () => {
    const text = widgetText([
      { content: 'A'.repeat(500) },
      { content: 'B'.repeat(5000) },
      { content: 'Final paragraph' },
    ]);
    expect(text).toMatchObject({
      title: 'A'.repeat(160),
      body: `${'A'.repeat(340)}\n${'B'.repeat(1259)}`,
    });
    expect(text.sections?.join('')).toBe(
      `${'A'.repeat(340)}\n${'B'.repeat(5000)}\nFinal paragraph`,
    );
    expect(text.sections?.every((section) => section.length <= 1600)).toBe(true);
    expect(widgetText([{ type: 'image', props: { url: 'secret-url' } }])).toEqual({
      title: 'Untitled note',
      body: '',
    });
  });
  it('does not split an emoji between launcher rows', () => {
    expect(widgetText([{ content: `${'a'.repeat(159)}📝tail` }])).toEqual({
      title: 'a'.repeat(159),
      body: '📝tail',
    });
    const text = widgetText([
      { content: 'Title' },
      { content: `${'a'.repeat(1599)}📝${'b'.repeat(2000)}` },
    ]);
    expect(text.sections?.[0]).toBe('a'.repeat(1599));
    expect(text.sections?.[1]?.startsWith('📝')).toBe(true);
  });
});
