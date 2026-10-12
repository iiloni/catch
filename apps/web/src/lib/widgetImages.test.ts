import type { Attachment, LinkPreview, Note, WidgetSnapshot } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import { widgetImagePublisher, widgetImageSources } from './widgetImages';

vi.mock('./attachmentFiles', () => ({ resolveAttachmentUrl: vi.fn() }));
vi.mock('./serverUrl', () => ({ getServerUrl: () => 'https://catch.example' }));
const note = (changes: Partial<Note> = {}): Note => ({
  id: 'note',
  userId: 'alice',
  content: [{ type: 'paragraph', content: 'https://example.com/' }],
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
const file = (changes: Partial<Attachment> = {}): Attachment => ({
  id: 'photo',
  userId: 'alice',
  noteId: 'note',
  name: 'photo.jpg',
  mimeType: 'image/jpeg',
  size: 100,
  kind: 'image',
  status: 'ready',
  sourceId: null,
  createdAt: new Date(),
  deletedAt: null,
  ...changes,
});
const link = (changes: Partial<LinkPreview> = {}): LinkPreview => ({
  userId: 'alice',
  url: 'https://example.com/',
  status: 'ready',
  title: 'Example',
  description: null,
  siteName: null,
  imageHash: 'a'.repeat(64),
  imageWidth: 100,
  imageHeight: 100,
  iconHash: null,
  hue: null,
  fetchedAt: new Date(),
  ...changes,
});
const snapshot = (title = 'Title'): WidgetSnapshot => ({
  version: 1,
  notes: [
    { id: 'note', title, body: 'Text', color: 'default', pinned: false, column: null, tags: [] },
  ],
  tags: [],
  columns: [],
});
const sources = () => new Map([['note', { kind: 'attachment' as const, id: 'photo' }]]);

describe('widget image ownership and selection', () => {
  it('prioritizes the earliest owned image over link thumbnails and skips deleted/media files', () => {
    expect(
      widgetImageSources(
        'alice',
        [note()],
        [
          file({ id: 'foreign', userId: 'bob' }),
          file({ id: 'deleted', deletedAt: new Date() }),
          file({ id: 'video', kind: 'video' }),
          file(),
        ],
        [link()],
        true,
      ).get('note'),
    ).toEqual({ kind: 'attachment', id: 'photo' });
  });
  it('never exports another owner, archived or deleted notes, or files from an absent vault note', () => {
    const notes = [
      note({ userId: 'bob' }),
      note({ id: 'archived', isArchived: true }),
      note({ id: 'deleted', deletedAt: new Date() }),
    ];
    expect(
      widgetImageSources('alice', notes, [file(), file({ noteId: 'vault' })], [link()], true).size,
    ).toBe(0);
  });
  it('uses only visible cached link images from this account', () => {
    expect(widgetImageSources('alice', [note()], [], [link()], true).get('note')).toEqual({
      kind: 'link',
      id: 'a'.repeat(64),
    });
    for (const links of [
      [link({ userId: 'bob' })],
      [link({ imageHash: null })],
      [link({ imageHash: '../other' })],
    ])
      expect(widgetImageSources('alice', [note()], [], links, true).size).toBe(0);
    expect(widgetImageSources('alice', [note()], [], [link()], false).size).toBe(0);
    expect(
      widgetImageSources(
        'alice',
        [note({ hiddenLinks: ['https://example.com/'] })],
        [],
        [link()],
        true,
      ).size,
    ).toBe(0);
    expect(
      widgetImageSources(
        'alice',
        [note({ galleryPreviewUrl: 'https://elsewhere.com/' })],
        [],
        [link()],
        true,
      ).size,
    ).toBe(0);
  });
});

describe('widget image publication', () => {
  it('publishes text first and applies late pixels to the latest text, without leaking the URL', async () => {
    let resolve = (_image: string) => {};
    const load = vi.fn(
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    const publish = vi.fn();
    const images = widgetImagePublisher(publish, load);
    images.update(snapshot(), sources());
    expect(publish.mock.lastCall?.[0].notes[0]).toMatchObject({
      title: 'Title',
      imageKey: 'attachment:photo',
    });
    expect(publish.mock.lastCall?.[0].notes[0]).not.toHaveProperty('image');
    images.update(snapshot('Edited while loading'), sources());
    resolve('YWJj');
    await vi.waitFor(() =>
      expect(publish.mock.lastCall?.[0].notes[0]).toMatchObject({
        title: 'Edited while loading',
        image: 'YWJj',
      }),
    );
    expect(load).toHaveBeenCalledTimes(1);
    images.stop();
  });
  it('does not reinsert removed images or notes after a late load', async () => {
    let resolve = (_image: string) => {};
    const publish = vi.fn();
    const images = widgetImagePublisher(
      publish,
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    images.update(snapshot(), sources());
    images.update(snapshot('Photo removed'));
    resolve('YWJj');
    await Promise.resolve();
    expect(publish.mock.lastCall?.[0].notes[0]).not.toHaveProperty('imageKey');
    expect(publish.mock.lastCall?.[0].notes[0]).not.toHaveProperty('image');
    images.update({ ...snapshot(), notes: [] });
    expect(publish.mock.lastCall?.[0].notes).toEqual([]);
    images.stop();
  });
  it('does not publish late pixels after sign-out/unmount', async () => {
    let resolve = (_image: string) => {};
    const publish = vi.fn();
    const images = widgetImagePublisher(
      publish,
      () =>
        new Promise<string>((done) => {
          resolve = done;
        }),
    );
    images.update(snapshot(), sources());
    images.stop();
    resolve('YWJj');
    await Promise.resolve();
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('keeps text usable on image failures and retries when connectivity returns', async () => {
    const publish = vi.fn();
    const load = vi.fn().mockRejectedValueOnce(new Error('Offline')).mockResolvedValue('YWJj');
    const images = widgetImagePublisher(publish, load);
    images.update(snapshot(), sources());
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    images.update(snapshot('Offline edit'), sources());
    expect(load).toHaveBeenCalledTimes(1);
    images.retry();
    await vi.waitFor(() =>
      expect(publish.mock.lastCall?.[0].notes[0]).toMatchObject({
        title: 'Offline edit',
        image: 'YWJj',
      }),
    );
    images.stop();
  });
});
