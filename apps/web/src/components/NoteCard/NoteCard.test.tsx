import type { BoardColumn, Note, Tag } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { linkOverlay } from '@/lib/linkPreviews';
import { moveNoteToDeck, sendNoteToGallery, setNotePinned, trashNote } from '@/lib/notes';
import { link, makePreview, paragraph } from '@/test/links';
import { NoteCard, NoteCardFace } from './NoteCard';

vi.mock('@/lib/notes');
const previews = new Map([
  ['https://a.example/', makePreview('https://a.example/', { title: 'Page A', siteName: 'A' })],
]);
const tags: Tag[] = [];
const assignments = new Map<string, { primaryTagId: string | null; secondaryTagIds: string[] }>();
const files: { id: string; name: string; kind: 'image' }[] = [];
vi.mock('@/lib/attachments', () => ({ useNoteAttachments: () => files }));
afterEach(() => {
  tags.length = 0;
  assignments.clear();
  files.length = 0;
});
const columns: BoardColumn[] = [
  { id: 'new', userId: 'user-1', name: 'New', color: 'amber', position: 'a0' },
  { id: 'doing', userId: 'user-1', name: 'Doing', color: 'blue', position: 'a1' },
];
vi.mock('@/lib/collections', () => ({
  useTagReadiness: () => ({ awaitingTags: false, awaitingAssignments: false }),
  useTags: () => tags,
  useNoteTagAssignments: () => assignments,
  useLinkPreviews: () => previews,
  useBoardColumns: () => columns,
}));

const note: Note = {
  id: '0199a0a0-0000-7000-8000-000000000001',
  userId: 'user-1',
  content: [
    { type: 'heading', content: [{ type: 'text', text: 'Groceries' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'Oat milk' }] },
  ],
  color: 'yellow',
  status: null,
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

function renderCard(props: Partial<React.ComponentProps<typeof NoteCard>> = {}) {
  return render(
    <TooltipProvider>
      <NoteCard note={note} {...props} />
    </TooltipProvider>,
  );
}

describe('NoteCard', () => {
  it('renders the title and applies the note color', () => {
    renderCard();
    const title = screen.getByRole('heading', { name: 'Groceries' });
    expect(screen.getByText('Oat milk')).toBeInTheDocument();
    expect(title.closest('article')).toHaveAttribute('data-note-color', 'yellow');
  });

  it('opens the note when clicked', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    fireEvent.click(screen.getByRole('button', { name: 'Open note' }));
    expect(onOpen).toHaveBeenCalledWith(note, expect.any(HTMLElement));
  });

  it('builds its actions once focus enters the card', () => {
    renderCard();
    expect(screen.queryByRole('button', { name: 'Move to trash' })).not.toBeInTheDocument();
    act(() => screen.getByRole('button', { name: 'Open note' }).focus());
    expect(screen.getByRole('button', { name: 'Move to trash' })).toBeInTheDocument();
  });

  it('leaves its actions unbuilt on a touch screen, which hides them', () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(pointer: coarse)' }));
    renderCard();
    act(() => screen.getByRole('button', { name: 'Open note' }).focus());
    expect(screen.queryByRole('button', { name: 'Move to trash' })).not.toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('pins and trashes without opening the note', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    act(() => screen.getByRole('button', { name: 'Open note' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move to trash' }));
    expect(setNotePinned).toHaveBeenCalledWith(note.id, true);
    expect(trashNote).toHaveBeenCalledWith(note.id);
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('opens destinations in a popover and moves the card without opening the editor', () => {
    const onOpen = vi.fn();
    renderCard({ onOpen });
    act(() => screen.getByRole('button', { name: 'Open note' }).focus());
    const move = screen.getByRole('button', { name: 'Move note' });
    fireEvent.click(move);
    expect(move).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Send to gallery' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Doing' }));
    expect(moveNoteToDeck).toHaveBeenCalledWith(note.id, 'doing');
    expect(move).toHaveAttribute('aria-expanded', 'false');
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('offers Gallery from a deck card and keeps its move button consistent', () => {
    renderCard({ note: { ...note, status: 'doing' } });
    act(() => screen.getByRole('button', { name: 'Open note' }).focus());
    fireEvent.click(screen.getByRole('button', { name: 'Move note' }));
    expect(screen.getByRole('button', { name: 'Doing' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send to gallery' }));
    expect(sendNoteToGallery).toHaveBeenCalledWith(note.id);
    expect(screen.getByRole('button', { name: 'Move note' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('toggles selection instead of opening while notes are selected', () => {
    const onOpen = vi.fn();
    const onSelect = vi.fn();
    renderCard({ onOpen, onSelect, selected: false });
    const card = screen.getByRole('button', { name: 'Select note' });
    expect(card).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(card);
    expect(onSelect).toHaveBeenCalledWith(note);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
  });

  it('offers restore instead of editing actions for trashed notes', () => {
    renderCard({ note: { ...note, deletedAt: new Date() } });
    act(() => screen.getByRole('button', { name: 'Open note' }).focus());
    expect(screen.getByRole('button', { name: 'Restore' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pin' })).not.toBeInTheDocument();
  });

  it('tucks a note’s links under the card and opens them', () => {
    renderCard({
      note: {
        ...note,
        content: [
          ...note.content,
          paragraph(link('https://a.example/')),
          paragraph(link('https://b.example/')),
        ],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '2 links, first Page A' }));
    expect(linkOverlay.get()).toMatchObject({ noteId: note.id, fromEditor: false });
    linkOverlay.set(null);
  });

  it('selects rather than opening links while notes are selected', () => {
    const onSelect = vi.fn();
    renderCard({
      note: { ...note, content: [...note.content, paragraph(link('https://a.example/'))] },
      selected: false,
      onSelect,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Link: Page A' }));
    expect(onSelect).toHaveBeenCalled();
    expect(linkOverlay.get()).toBeNull();
  });

  it('shows a note that is only a link as that link', () => {
    renderCard({ note: { ...note, content: [paragraph(link('https://a.example/'))] } });
    expect(screen.getByRole('heading', { name: 'Page A' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Link/ })).not.toBeInTheDocument();
  });
  it('opens and selects tagged card surroundings and attachment faces', () => {
    const tag: Tag = {
      id: 'work',
      userId: note.userId,
      name: 'Work',
      parentId: null,
      color: 'blue',
      icon: null,
    };
    tags.push(tag);
    assignments.set(note.id, { primaryTagId: tag.id, secondaryTagIds: [] });
    files.push({ id: 'file', name: 'photo.png', kind: 'image' });
    const mediaNote = { ...note, content: [] };
    const onOpen = vi.fn(),
      onSelect = vi.fn();
    const { rerender } = render(
      <TooltipProvider>
        {/* biome-ignore lint/a11y/useSemanticElements: Matches the gallery's draggable wrapper. */}
        <div role="button" tabIndex={0} aria-label="Move note">
          <NoteCard note={mediaNote} onOpen={onOpen} />
        </div>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('heading', { name: 'Tags' }));
    fireEvent.click(screen.getByText('photo.png'));
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onOpen).toHaveBeenLastCalledWith(mediaNote, expect.any(HTMLElement));
    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect(onOpen).toHaveBeenCalledTimes(2);
    rerender(
      <TooltipProvider>
        {/* biome-ignore lint/a11y/useSemanticElements: Matches the gallery's draggable wrapper. */}
        <div role="button" tabIndex={0} aria-label="Move note">
          <NoteCard note={mediaNote} selected={false} onSelect={onSelect} onOpen={onOpen} />
        </div>
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole('heading', { name: 'Tags' }));
    fireEvent.click(screen.getByText('photo.png'));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });
  it('includes resolved tags and media in the noninteractive transition face', () => {
    const tag: Tag = {
      id: 'work',
      userId: note.userId,
      name: 'Work',
      parentId: null,
      color: 'blue',
      icon: null,
    };
    tags.push(tag);
    assignments.set(note.id, { primaryTagId: tag.id, secondaryTagIds: [] });
    files.push({ id: 'file', name: 'photo.png', kind: 'image' });
    render(<NoteCardFace note={{ ...note, content: [] }} />);
    expect(screen.getByRole('heading', { name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByText('photo.png')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
