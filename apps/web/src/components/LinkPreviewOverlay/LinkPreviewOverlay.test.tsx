import type { LinkPreview, Note } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { linkOverlay } from '@/lib/linkPreviews';
import { link, makeNote, makePreview, paragraph } from '@/test/links';
import { LinkPreviewOverlay } from './LinkPreviewOverlay';

vi.mock('@/lib/notes');
const previews = new Map<string, LinkPreview>([
  ['https://a.example/', makePreview('https://a.example/', { title: 'Page A' })],
]);
let notes: Note[] = [];
vi.mock('@/lib/collections', () => ({ useLinkPreviews: () => previews, notesCollection: {} }));
vi.mock('@tanstack/react-db', () => ({ eq: vi.fn(), useLiveQuery: () => ({ data: notes }) }));
let href = '/';
vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { href }, matches: [] }),
}));
const open = vi.fn();
vi.mock('@/lib/openNote', () => ({ useOpenNote: () => ({ open, close: vi.fn() }) }));

const note = makeNote({
  content: [paragraph(link('https://a.example/')), paragraph(link('https://b.example/'))],
});

afterEach(() => {
  act(() => linkOverlay.set(null));
  vi.clearAllMocks();
});

function show(fromEditor = false) {
  notes = [note];
  const view = render(<LinkPreviewOverlay />, { wrapper: TooltipProvider });
  act(() => linkOverlay.set({ noteId: note.id, fromEditor }));
  return view;
}

function swipe(target: Element, delta: number, canceled = false) {
  const start = { clientX: 100, clientY: 200 };
  const finish = { clientX: 100, clientY: 200 + delta };
  fireEvent.touchStart(target, { touches: [start], changedTouches: [start] });
  fireEvent.touchMove(target, { touches: [finish], changedTouches: [finish] });
  fireEvent.touchMove(target, { touches: [finish], changedTouches: [finish] });
  fireEvent[canceled ? 'touchCancel' : 'touchEnd'](target, {
    touches: [],
    changedTouches: [finish],
  });
}

describe('LinkPreviewOverlay', () => {
  it("lists the note's links and opens the note", () => {
    show();
    const dialog = screen.getByRole('dialog', { name: '2 links' });
    expect(dialog).toHaveTextContent('Page A');
    expect(dialog).toHaveTextContent('b.example');
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }));
    expect(linkOverlay.get()).toBeNull();
    expect(open).toHaveBeenCalledWith(note.id, undefined);
  });

  it('does not offer to open a note that is already open', () => {
    show(true);
    expect(screen.queryByRole('button', { name: 'Open note' })).not.toBeInTheDocument();
  });

  it('closes on navigation', () => {
    const { rerender } = show();
    href = '/archive';
    rerender(<LinkPreviewOverlay />);
    expect(linkOverlay.get()).toBeNull();
    href = '/';
  });

  it.each([
    ['down', 140, 0],
    ['up', -140, 200],
  ])('dismisses when swiped %s from the list edge', (_, delta, scrollTop) => {
    show();
    const list = screen.getByRole('list');
    Object.defineProperties(list, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
    });
    list.scrollTop = scrollTop;

    swipe(list, delta);

    expect(linkOverlay.get()).toBeNull();
  });

  it('lets the list scroll before treating a swipe as dismissal', () => {
    show();
    const list = screen.getByRole('list');
    Object.defineProperties(list, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
    });
    list.scrollTop = 100;

    swipe(list, 140);
    swipe(list, -140);

    expect(linkOverlay.get()).not.toBeNull();
  });

  it('keeps a short or canceled swipe open', () => {
    show();
    const dialog = screen.getByRole('dialog');

    swipe(dialog, 40);
    swipe(dialog, -140, true);

    expect(linkOverlay.get()).not.toBeNull();
  });
});
