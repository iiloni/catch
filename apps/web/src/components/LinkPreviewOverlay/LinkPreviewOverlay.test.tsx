import type { Attachment, LinkPreview, Note } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { linkOverlay } from '@/lib/linkPreviews';
import { link, makeNote, makePreview, paragraph } from '@/test/links';
import { LinkPreviewOverlay } from './LinkPreviewOverlay';

vi.mock('@/lib/notes');
const previews = new Map<string, LinkPreview>([
  ['https://a.example/', makePreview('https://a.example/', { title: 'Page A' })],
]);
let notes: Note[] = [];
let files: Attachment[] = [];
vi.mock('@/lib/attachments', () => ({
  useNoteAttachments: () => files,
  downloadAttachment: vi.fn(),
  removeAttachment: vi.fn(),
  renameAttachment: vi.fn(),
}));
vi.mock('@/lib/attachmentFiles', () => ({
  useAttachmentUrl: () => ({ source: 'blob:preview', error: false }),
  keepAttachmentOffline: vi.fn(),
}));
vi.mock('@/lib/collections', () => ({
  useLinkPreviews: () => previews,
  useSharedNotes: () => ({ notes: [], byId: new Map() }),
  notesCollection: {},
}));
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

const image: Attachment = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  noteId: note.id,
  userId: note.userId,
  name: 'photo.png',
  mimeType: 'image/png',
  size: 123,
  kind: 'image',
  status: 'ready',
  sourceId: null,
  createdAt: new Date(),
  deletedAt: null,
};

beforeEach(() =>
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  ),
);

afterEach(() => {
  act(() => linkOverlay.set(null));
  vi.clearAllMocks();
  files = [];
  vi.unstubAllGlobals();
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

function scrollArea() {
  const area = screen.getByRole('dialog').querySelector<HTMLElement>('[data-link-overlay-scroll]');
  if (!area) throw new Error('Missing preview scroll area');
  return area;
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

  it('places the media catalog before links and returns to it after viewing an image', async () => {
    files = [image];
    show();
    const media = screen.getByRole('region', { name: 'Media' });
    const links = screen.getByRole('region', { name: 'Links' });
    expect(media.compareDocumentPosition(links) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View photo.png' }));
    expect(screen.getByRole('dialog', { name: 'photo.png' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close media viewer' }));
    expect(linkOverlay.get()).not.toBeNull();
    expect(await screen.findByRole('dialog', { name: 'Media · 1' })).toHaveTextContent('photo.png');
  });

  it('keeps attachments available when the last link is removed, and closes when empty', () => {
    files = [image];
    const { rerender } = show();
    notes = [{ ...note, hiddenLinks: ['https://a.example/', 'https://b.example/'] }];
    rerender(<LinkPreviewOverlay />);
    expect(linkOverlay.get()).not.toBeNull();
    expect(screen.queryByRole('region', { name: 'Links' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Media' })).toHaveTextContent('photo.png');
    files = [];
    rerender(<LinkPreviewOverlay />);
    expect(linkOverlay.get()).toBeNull();
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
    const area = scrollArea();
    Object.defineProperties(area, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
    });
    area.scrollTop = scrollTop;

    swipe(list, delta);

    expect(linkOverlay.get()).toBeNull();
  });

  it('lets the list scroll before treating a swipe as dismissal', () => {
    show();
    const list = screen.getByRole('list');
    const area = scrollArea();
    Object.defineProperties(area, {
      clientHeight: { value: 100 },
      scrollHeight: { value: 300 },
    });
    area.scrollTop = 100;

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
