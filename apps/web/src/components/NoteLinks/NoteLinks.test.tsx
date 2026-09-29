import type { LinkPreview } from '@catch/shared';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { editorLinksInView } from '@/lib/linkPreviews';
import { heading, link, makeNote, paragraph } from '@/test/links';
import { NoteLinks } from './NoteLinks';

vi.mock('@/lib/notes');
const previews = new Map<string, LinkPreview>();
vi.mock('@/lib/collections', () => ({ useLinkPreviews: () => previews }));

let observed: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
beforeEach(() => {
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof observed) {
        observed = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

const note = makeNote({
  content: [
    heading('Reading'),
    paragraph(link('https://a.example/', 'A')),
    paragraph(link('https://b.example/', 'B')),
  ],
});

describe('NoteLinks', () => {
  it('lists the note’s links and reports when they scroll into view', () => {
    render(<NoteLinks note={note} variant="below" />);
    expect(screen.getByRole('region', { name: 'Links' })).toHaveTextContent('Links · 2');
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(editorLinksInView.get()).toBeNull();
    act(() => observed?.([{ isIntersecting: true }]));
    expect(editorLinksInView.get()).toBe(note.id);
    act(() => observed?.([{ isIntersecting: false }]));
    expect(editorLinksInView.get()).toBeNull();
  });

  it('is always in view beside the note', () => {
    const { unmount } = render(<NoteLinks note={note} variant="side" />);
    expect(editorLinksInView.get()).toBe(note.id);
    unmount();
    expect(editorLinksInView.get()).toBeNull();
  });

  it('leaves out removed previews, and everything while previews are off', () => {
    const { rerender } = render(
      <NoteLinks note={{ ...note, hiddenLinks: ['https://a.example/'] }} variant="below" />,
    );
    expect(screen.getAllByRole('article')).toHaveLength(1);
    act(() => localStorage.setItem('catch-link-previews', 'false'));
    act(() => window.dispatchEvent(new StorageEvent('storage')));
    rerender(<NoteLinks note={note} variant="below" />);
    expect(screen.queryByRole('region', { name: 'Links' })).not.toBeInTheDocument();
  });
});
