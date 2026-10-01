// @vitest-environment node
import { MAX_ATTACHMENT_BYTES, noteSchema } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import { makeZip } from '@/test/zip';
import {
  importedNoteId,
  KeepImportError,
  type KeepNote,
  keepNoteContent,
  readKeepExport,
} from './keepImport';

const USER = 'user-1';

const text = (value: string) => ({ type: 'text', text: value, styles: {} });
const link = (href: string) => ({ type: 'link', href, content: [text(href)] });

function keepNote(overrides: Partial<KeepNote> = {}): KeepNote {
  return {
    color: 'DEFAULT',
    isTrashed: false,
    isPinned: false,
    isArchived: false,
    textContent: '',
    title: '',
    userEditedTimestampUsec: 1_700_000_000_000_000,
    createdTimestampUsec: 1_600_000_000_000_000,
    ...overrides,
  };
}

const json = (name: string, note: KeepNote) =>
  new File([JSON.stringify(note)], name, { type: 'application/json' });

describe('keepNoteContent', () => {
  it('makes the title a heading and each line of text a paragraph, with links', () => {
    const content = keepNoteContent(
      keepNote({ title: 'Trip', textContent: '\nPack light\n\nSee https://example.com/map.\n\n' }),
    );
    expect(content).toEqual([
      { type: 'heading', props: { level: 3 }, content: [text('Trip')] },
      { type: 'paragraph', content: [text('Pack light')] },
      { type: 'paragraph', content: [] },
      {
        type: 'paragraph',
        content: [text('See '), link('https://example.com/map'), text('.')],
      },
    ]);
  });

  it('turns a list into checklist items', () => {
    const content = keepNoteContent(
      keepNote({
        listContent: [
          { text: 'Eggs', isChecked: true },
          { text: 'Milk', isChecked: false },
        ],
      }),
    );
    expect(content).toEqual([
      { type: 'checkListItem', props: { checked: true }, content: [text('Eggs')] },
      { type: 'checkListItem', props: { checked: false }, content: [text('Milk')] },
    ]);
  });

  it('adds the links Keep found outside the text, once each', () => {
    const content = keepNoteContent(
      keepNote({
        textContent: 'https://a.example',
        annotations: [
          { url: 'https://a.example' },
          { url: 'https://b.example/page' },
          { url: 'https://b.example/page#top' },
        ],
      }),
    );
    expect(content).toEqual([
      { type: 'paragraph', content: [link('https://a.example')] },
      { type: 'paragraph', content: [link('https://b.example/page')] },
    ]);
  });
});

describe('importedNoteId', () => {
  it('is a UUIDv7 of the creation time that stays the same for the same note', () => {
    const created = new Date('2021-05-06T07:08:09.010Z');
    const id = importedNoteId(USER, created, 'keep:1');
    expect(noteSchema.shape.id.safeParse(id).success).toBe(true);
    expect(Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(created.getTime());
    expect(importedNoteId(USER, created, 'keep:1')).toBe(id);
    expect(importedNoteId(USER, created, 'keep:2')).not.toBe(id);
    expect(importedNoteId('user-2', created, 'keep:1')).not.toBe(id);
  });
});

describe('readKeepExport', () => {
  it('works without Web Crypto, as on a server reached over plain HTTP', async () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });
    try {
      const found = await readKeepExport([json('a.json', keepNote({ title: 'A' }))], USER);
      expect(found.notes).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('reads the notes in a Takeout archive, newest first, with their dates and places', async () => {
    const zip = await makeZip([
      {
        name: 'Takeout/Keep/Old.json',
        text: JSON.stringify(
          keepNote({ title: 'Old', color: 'CERULEAN', isArchived: true, isPinned: true }),
        ),
      },
      {
        name: 'Takeout/Keep/New.json',
        text: JSON.stringify(
          keepNote({
            title: 'New',
            isPinned: true,
            createdTimestampUsec: 1_650_000_000_000_000,
            userEditedTimestampUsec: 1_750_000_000_000_000,
          }),
        ),
      },
      { name: 'Takeout/Keep/Labels.txt', text: 'Work' },
      { name: 'Takeout/Keep/New.html', text: '<html></html>' },
    ]);
    const found = await readKeepExport([new File([zip], 'takeout.zip')], USER);
    expect(found.notes.map((note) => note.content[0])).toEqual([
      { type: 'heading', props: { level: 3 }, content: [text('New')] },
      { type: 'heading', props: { level: 3 }, content: [text('Old')] },
    ]);
    expect(found.notes[0]).toMatchObject({
      color: 'default',
      isPinned: true,
      isArchived: false,
      createdAt: new Date(1_650_000_000_000),
      updatedAt: new Date(1_750_000_000_000),
    });
    expect(found.notes[1]).toMatchObject({ color: 'dark-blue', isArchived: true });
  });

  it('counts what it leaves out', async () => {
    const found = await readKeepExport(
      [
        json('a.json', keepNote({ title: 'Trashed', isTrashed: true })),
        json('b.json', keepNote({ attachments: [{ filePath: 'b.png' }] })),
        json(
          'c.json',
          keepNote({
            title: 'Photo and words',
            createdTimestampUsec: 1,
            attachments: [{ filePath: 'c.png' }, { filePath: 'c.m4a' }],
            labels: [{ name: 'Work' }],
          }),
        ),
      ],
      USER,
    );
    expect(found).toMatchObject({
      trashed: 1,
      mediaOnly: 1,
      attachments: 0,
      missing: 3,
      labelled: 1,
    });
    expect(found.notes).toHaveLength(1);
  });

  it('gives each note the same id every time, even notes made in the same microsecond', async () => {
    const files = [
      json('a.json', keepNote({ title: 'A' })),
      json('b.json', keepNote({ title: 'B' })),
    ];
    const first = await readKeepExport(files, USER);
    const again = await readKeepExport([...files].reverse(), USER);
    expect(new Set(first.notes.map((note) => note.id)).size).toBe(2);
    expect(again.notes.map((note) => note.id)).toEqual(first.notes.map((note) => note.id));
  });

  it('reads a file chosen twice as one note', async () => {
    const note = keepNote({ title: 'Once' });
    const zip = await makeZip([{ name: 'Takeout/Keep/Once.json', text: JSON.stringify(note) }]);
    const found = await readKeepExport(
      [new File([zip], 'takeout.zip'), json('Once.json', note)],
      USER,
    );
    expect(found.notes).toHaveLength(1);
  });

  it('matches binary attachments across ZIP parts without inline blocks, including media-only notes', async () => {
    const bytes = new Uint8Array([0, 255, 128, 42]);
    const notes = await makeZip([
      {
        name: 'Takeout/Keep/Words.json',
        text: JSON.stringify(
          keepNote({
            title: 'Words',
            attachments: [{ filePath: 'photo.png', mimetype: 'image/png' }],
          }),
        ),
      },
      {
        name: 'Takeout/Keep/Audio.json',
        text: JSON.stringify(
          keepNote({
            createdTimestampUsec: 1234,
            attachments: [{ filePath: 'recording.m4a', mimetype: 'audio/mp4' }],
          }),
        ),
      },
    ]);
    const media = await makeZip(
      [
        { name: 'Takeout/Keep/photo.png', bytes },
        { name: 'Takeout/Keep/recording.m4a', bytes, stored: true },
      ],
      { zip64: true },
    );
    const files = [new File([notes], 'part1.zip'), new File([media], 'part2.zip')];
    const found = await readKeepExport(files, USER);
    expect(found).toMatchObject({ attachments: 2, missing: 0, mediaOnly: 0 });
    expect(found.notes).toHaveLength(2);
    expect(found.notes.flatMap((note) => note.content.map((block) => block.type))).toEqual([
      'heading',
    ]);
    for (const source of found.files) {
      const file = await source.read();
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
      expect(file.type).toMatch(/^(image|audio)\//);
      expect(found.notes.some((note) => note.id === source.noteId)).toBe(true);
    }
    const again = await readKeepExport([...files].reverse(), USER);
    expect(again.files.map((file) => file.id)).toEqual(found.files.map((file) => file.id));
  });

  it('matches unpacked files and deduplicates repeated attachment references', async () => {
    const note = json(
      'Words.json',
      keepNote({
        title: 'Words',
        attachments: [{ filePath: 'media/photo.png' }, { filePath: 'media/photo.png' }],
      }),
    );
    const found = await readKeepExport([note, new File(['binary'], 'photo.png')], USER);
    expect(found.attachments).toBe(1);
    expect((await found.files[0]?.read())?.type).toBe('image/png');
    expect(
      (await readKeepExport([note, new File(['binary'], 'photo.png')], USER)).files[0]?.id,
    ).toBe(found.files[0]?.id);
  });

  it('matches relative paths before basenames and never guesses between ambiguous files', async () => {
    const zip = await makeZip([
      {
        name: 'Keep/A/a.json',
        text: JSON.stringify(keepNote({ title: 'A', attachments: [{ filePath: 'photo.png' }] })),
      },
      {
        name: 'Keep/B/b.json',
        text: JSON.stringify(keepNote({ title: 'B', attachments: [{ filePath: 'photo.png' }] })),
      },
      {
        name: 'Keep/c.json',
        text: JSON.stringify(keepNote({ title: 'C', attachments: [{ filePath: 'photo.png' }] })),
      },
      { name: 'Keep/A/photo.png', text: 'A' },
      { name: 'Keep/B/photo.png', text: 'B' },
    ]);
    const found = await readKeepExport([new File([zip], 'takeout.zip')], USER);
    expect(found).toMatchObject({ attachments: 2, missing: 1 });
    expect(await (await found.files[0]?.read())?.text()).toBe('A');
    expect(await (await found.files[1]?.read())?.text()).toBe('B');
  });

  it('retains old text-note ids when media-only notes share their timestamp', async () => {
    const words = json('b.json', keepNote({ title: 'Words' }));
    const old = await readKeepExport([words], USER);
    const next = await readKeepExport(
      [
        words,
        json('a.json', keepNote({ attachments: [{ filePath: 'a.png' }] })),
        new File(['binary'], 'a.png'),
      ],
      USER,
    );
    expect(next.notes.find((note) => note.content.length)?.id).toBe(old.notes[0]?.id);
    expect(next.notes).toHaveLength(2);
  });

  it('reports empty and oversized files before reading their bytes', async () => {
    const huge = new File([], 'huge.mp4');
    Object.defineProperty(huge, 'size', { value: MAX_ATTACHMENT_BYTES + 1 });
    const read = vi.spyOn(huge, 'arrayBuffer');
    const found = await readKeepExport(
      [
        json(
          'words.json',
          keepNote({
            title: 'Words',
            attachments: [{ filePath: 'huge.mp4' }, { filePath: 'empty.png' }],
          }),
        ),
        huge,
        new File([], 'empty.png'),
      ],
      USER,
    );
    expect(found).toMatchObject({ oversized: 1, missing: 1, attachments: 0 });
    expect(read).not.toHaveBeenCalled();
  });

  it('explains files it cannot use', async () => {
    await expect(
      readKeepExport([new File(['{"hello":"world"}'], 'other.json')], USER),
    ).rejects.toThrow(KeepImportError);
    await expect(readKeepExport([new File(['x'], 'takeout.tgz')], USER)).rejects.toThrow(
      /choose \.zip/,
    );
    await expect(readKeepExport([new File(['x'], 'takeout.zip')], USER)).rejects.toThrow(
      /takeout\.zip could not be read/,
    );
  });
});
