import { blocksToPlainText, extractLinks } from '@catch/shared';
import { describe, expect, it, vi } from 'vitest';
import { link, makeNote, paragraph } from '@/test/links';
import {
  captureBookmarklet,
  capturedLinkContent,
  enqueueLinkCapture,
  incomingLinkCaptures,
  incomingLinkDraft,
  matchingLinkNotes,
  removeLinkCapture,
} from './linkCapture';
import type { IncomingShare } from './shareInbox';

describe('incoming links', () => {
  const share: IncomingShare = {
    id: 'share',
    title: 'Page title',
    text: 'https://example.com/a#section',
    url: '',
    files: [],
    userId: null,
    complete: false,
  };
  it('recognizes native URLs in text and keeps their original fragment', () => {
    expect(incomingLinkDraft(share)).toEqual({
      url: share.text,
      title: share.title,
      description: '',
      notes: '',
    });
    expect(incomingLinkDraft({ ...share, text: `My context\n${share.text}` })?.notes).toBe(
      'My context',
    );
    expect(incomingLinkDraft({ ...share, text: `${share.title}\n${share.text}` })?.notes).toBe('');
  });
  it('recognizes a PWA URL field and preserves selected text', () => {
    expect(incomingLinkDraft({ ...share, url: share.text, text: 'Selected passage' })).toEqual({
      url: share.text,
      title: share.title,
      description: '',
      notes: 'Selected passage',
    });
  });
  it('keeps files, multiple links, unsupported schemes and oversized URLs on the existing flow', () => {
    expect(
      incomingLinkDraft({
        ...share,
        files: [{ id: 'file', name: 'photo.png', blob: new Blob(['data']) }],
      }),
    ).toBeNull();
    expect(
      incomingLinkDraft({ ...share, text: `${share.text}\nhttps://other.example/` }),
    ).toBeNull();
    expect(incomingLinkDraft({ ...share, text: 'javascript:alert(1)' })).toBeNull();
    expect(
      incomingLinkDraft({ ...share, text: `https://example.com/#${'a'.repeat(2048)}` }),
    ).toBeNull();
  });
  it('queues distinct shares and ignores duplicate delivery without replacing edits', () => {
    incomingLinkCaptures.set([]);
    const draft = incomingLinkDraft(share);
    if (!draft) throw new Error('Missing draft');
    enqueueLinkCapture({ id: 'first', draft });
    enqueueLinkCapture({ id: 'second', draft });
    enqueueLinkCapture({ id: 'first', draft: { ...draft, title: 'Replacement' } });
    expect(incomingLinkCaptures.get().map((item) => item.id)).toEqual(['first', 'second']);
    expect(incomingLinkCaptures.get()[0]?.draft.title).toBe('Page title');
    removeLinkCapture('first');
    expect(incomingLinkCaptures.get().map((item) => item.id)).toEqual(['second']);
    incomingLinkCaptures.set([]);
  });
});

describe('captured links', () => {
  it('keeps metadata and comments searchable as literal, editable note content', () => {
    const content = capturedLinkContent({
      url: 'https://example.com/#read',
      title: '<b>A title</b>',
      description: 'Page context',
      notes: 'Read later\nhttps://other.example/',
    });
    expect(blocksToPlainText(content)).toContain('<b>A title</b>');
    expect(blocksToPlainText(content)).toContain('Page context');
    expect(blocksToPlainText(content)).toContain('Read later');
    expect(extractLinks(content).map((link) => link.url)).toEqual([
      'https://example.com/',
      'https://other.example/',
    ]);
    expect(content[0]).toMatchObject({ type: 'heading', props: { level: 3 } });
  });
  it('checks live and archived notes across placements, ignoring fragments and trash', () => {
    const content = [paragraph(link('https://example.com/#first'))];
    const notes = [
      makeNote({ content }),
      makeNote({ content, isArchived: true }),
      makeNote({ content, status: 'later' }),
      makeNote({ content, deletedAt: new Date() }),
    ];
    expect(matchingLinkNotes(notes, 'https://example.com/#second')).toHaveLength(3);
    expect(matchingLinkNotes(notes, 'https://example.com/?different')).toHaveLength(0);
    expect(matchingLinkNotes(notes, 'invalid')).toHaveLength(0);
  });
});

describe('capture bookmarklet', () => {
  it('refuses oversized URLs rather than silently changing the saved address', () => {
    const open = vi.fn();
    const alert = vi.fn();
    const code = captureBookmarklet('https://catch.example/').slice('javascript:'.length);
    new Function('location', 'window', 'alert', code)(
      { protocol: 'https:', href: `https://example.com/${'a'.repeat(2048)}` },
      { open },
      alert,
    );
    expect(open).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('This URL is too long for Catch.');
  });
  it('opens a popup on the instance with a URL, title and selection safely encoded in the fragment', () => {
    const open = vi.fn();
    const pageUrl = 'https://example.com/a?q=one&b=two#part';
    const title = `Quotes " ' & ☀`;
    const text = 'Selected text\nAnother line';
    const bookmarklet = captureBookmarklet('https://catch.example/');
    const run = new Function(
      'location',
      'document',
      'window',
      'URLSearchParams',
      bookmarklet.slice('javascript:'.length),
    );
    run(
      { protocol: 'https:', href: pageUrl },
      { title },
      { open, getSelection: () => text },
      URLSearchParams,
    );
    const target = new URL(open.mock.calls[0]?.[0]);
    expect(target.origin).toBe('https://catch.example');
    expect(target.pathname).toBe('/capture');
    expect(target.search).toBe('');
    expect(Object.fromEntries(new URLSearchParams(target.hash.slice(1)))).toEqual({
      url: pageUrl,
      title,
      text,
      popup: 'true',
    });
    expect(open.mock.calls[0]?.[2]).toContain('noopener');
    expect(bookmarklet).not.toContain('localStorage');
  });
});
