import { describe, expect, it } from 'vitest';
import { extractLinks, findBareUrls, isLinkOnly, linkDomain, normalizeUrl } from './links';

const text = (value: string) => ({ type: 'text', text: value, styles: {} });
const link = (href: string, label = href) => ({ type: 'link', href, content: [text(label)] });
const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });

describe('normalizeUrl', () => {
  it('keeps web URLs and drops the fragment', () => {
    expect(normalizeUrl('https://Example.com/a?b=1#top')).toBe('https://example.com/a?b=1');
    expect(normalizeUrl(' http://example.com ')).toBe('http://example.com/');
  });

  it('rejects other schemes, bare hosts and junk', () => {
    expect(normalizeUrl('mailto:me@example.com')).toBeNull();
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('http://localhost:3000')).toBeNull();
    expect(normalizeUrl('not a url')).toBeNull();
  });
});

describe('extractLinks', () => {
  it('finds link marks and bare URLs in reading order, once each', () => {
    const links = extractLinks([
      { type: 'heading', content: [text('Reading')] },
      paragraph(link('https://a.example/one', 'first')),
      paragraph(text('see https://b.example/two, and (https://c.example/wiki/X_(y)).')),
      paragraph(link('https://a.example/one#later', 'again')),
      {
        type: 'bulletListItem',
        content: [],
        children: [paragraph(link('https://d.example'))],
      },
    ]);
    expect(links).toEqual([
      { url: 'https://a.example/one', href: 'https://a.example/one' },
      { url: 'https://b.example/two', href: 'https://b.example/two' },
      { url: 'https://c.example/wiki/X_(y)', href: 'https://c.example/wiki/X_(y)' },
      { url: 'https://d.example/', href: 'https://d.example' },
    ]);
  });

  it('reads table cells', () => {
    const table = {
      type: 'table',
      content: { type: 'tableContent', rows: [{ cells: [[link('https://t.example')]] }] },
    };
    expect(extractLinks([table]).map((l) => l.url)).toEqual(['https://t.example/']);
  });

  it('skips links that cannot have a preview', () => {
    expect(extractLinks([paragraph(link('mailto:me@example.com'))])).toEqual([]);
  });
});

describe('findBareUrls', () => {
  it('finds each web address and where it starts, without the punctuation after it', () => {
    expect(
      findBareUrls('See https://a.example/x. Or (http://b.example), not ftp://c.example'),
    ).toEqual([
      { index: 4, url: 'https://a.example/x' },
      { index: 29, url: 'http://b.example' },
    ]);
  });

  it('skips addresses that are not web links', () => {
    expect(findBareUrls('http://localhost:3000 and plain text')).toEqual([]);
  });
});

describe('isLinkOnly', () => {
  it('holds for one link and nothing else', () => {
    expect(isLinkOnly([paragraph(link('https://a.example'))])).toBe(true);
    expect(isLinkOnly([paragraph(text(' https://a.example ')), paragraph()])).toBe(true);
  });

  it('fails with text or several links', () => {
    expect(isLinkOnly([paragraph(text('look: '), link('https://a.example'))])).toBe(false);
    expect(
      isLinkOnly([paragraph(link('https://a.example')), paragraph(link('https://b.example'))]),
    ).toBe(false);
    expect(isLinkOnly([paragraph(text('no links'))])).toBe(false);
  });
});

describe('linkDomain', () => {
  it('drops www', () => {
    expect(linkDomain('https://www.theverge.com/x')).toBe('theverge.com');
    expect(linkDomain('https://news.ycombinator.com')).toBe('news.ycombinator.com');
  });
});
