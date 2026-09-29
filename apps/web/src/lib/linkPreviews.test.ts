import { describe, expect, it } from 'vitest';
import { link, makePreview, paragraph } from '@/test/links';
import { linkTitle, noteLinks } from './linkPreviews';

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
