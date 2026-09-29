import type { LinkPreview } from '@catch/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { editorNote, noteDockPanelOpen } from '@/lib/dockState';
import { editorLinksInView, linkOverlay } from '@/lib/linkPreviews';
import { link, makeNote, paragraph } from '@/test/links';
import { NoteLinkTray } from './NoteLinkTray';

vi.mock('@/lib/notes');
const previews = new Map<string, LinkPreview>();
vi.mock('@/lib/collections', () => ({ useLinkPreviews: () => previews }));

const note = makeNote({ content: [paragraph(link('https://a.example/'))] });

afterEach(() => {
  act(() => {
    editorNote.set(null);
    editorLinksInView.set(null);
    noteDockPanelOpen.set(false);
    linkOverlay.set(null);
  });
});

describe('NoteLinkTray', () => {
  it('offers the open note’s links while they are out of view', () => {
    act(() => editorNote.set(note));
    render(<NoteLinkTray />);
    fireEvent.click(screen.getByRole('button', { name: 'Link: a.example' }));
    expect(linkOverlay.get()).toMatchObject({ noteId: note.id, fromEditor: true });
  });

  it('steps aside while the links are on screen or the dock has grown', () => {
    act(() => {
      editorNote.set(note);
      editorLinksInView.set(note.id);
    });
    render(<NoteLinkTray />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    act(() => {
      editorLinksInView.set(null);
      noteDockPanelOpen.set(true);
    });
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing for a note without links', () => {
    act(() => editorNote.set(makeNote()));
    render(<NoteLinkTray />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
