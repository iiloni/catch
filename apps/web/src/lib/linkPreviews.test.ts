import { MAX_NOTE_LINKS } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import { link, makeNote, makePreview, paragraph } from '@/test/links';
import { galleryPreviewLink, linkTitle, noteLinks } from './linkPreviews';

describe('noteLinks', () => {
  const content = [paragraph(link('https://a.example/one')), paragraph(link('https://b.example/'))];

  it('pairs links with their previews and skips hidden ones', () => {
    const preview = makePreview('https://b.example/', { title: 'B' });
    const links = noteLinks(
      { content, hiddenLinks: ['https://a.example/one'] },
      new Map([[preview.url, preview]]),
    );
    expect(links).toEqual([{ url: 'https://b.example/', href: 'https://b.example/', preview }]);
  });

  it('keeps the chosen link available when editing moves it beyond the preview limit', () => {
    const content = Array.from({ length: MAX_NOTE_LINKS + 2 }, (_, i) =>
      paragraph(link(`https://example.com/${i}`)),
    );
    const note = makeNote({
      content,
      galleryPreviewUrl: `https://example.com/${MAX_NOTE_LINKS + 1}`,
    });
    const links = noteLinks(note, new Map());
    expect(links).toHaveLength(MAX_NOTE_LINKS);
    expect(galleryPreviewLink(note, links)?.url).toBe(note.galleryPreviewUrl);
    expect(links[0]?.url).toBe('https://example.com/0');
  });
});

describe('linkTitle', () => {
  it("uses the page's title, else where the link points", () => {
    const url = 'https://www.example.com/a/b%20c';
    expect(linkTitle({ url, href: url, preview: makePreview(url, { title: 'Title' }) })).toBe(
      'Title',
    );
    expect(linkTitle({ url, href: url, preview: undefined })).toBe('example.com/a/b c');
    expect(linkTitle({ url: 'https://x.example/', href: '', preview: undefined })).toBe(
      'x.example',
    );
  });
});
