import type { Note } from '@catch/shared';
import { useEffect, useRef } from 'react';
import { LinkPreviewCard } from '@/components/LinkPreviewCard/LinkPreviewCard';
import {
  type ResolvedLink,
  setEditorLinksInView,
  showLinkInNote,
  useNoteLinks,
} from '@/lib/linkPreviews';
import { isSharedNote } from '@/lib/sharing';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  /**
   * `below` follows the note's text in its scroll area; `side` is a column of its own beside
   * the note, for editors wide enough to hold one.
   */
  variant: 'below' | 'side';
  className?: string;
};

/**
 * The open note's links as preview cards. They are not part of the note's text, so they sit
 * after it (or beside it) rather than in it. Reports whether they are on screen, so the dock
 * can offer them when they are not.
 */
export function NoteLinks({ note, variant, className }: Props) {
  const links = useNoteLinks(note);
  if (links.length === 0) return null;
  return <LinkList note={note} links={links} variant={variant} className={className} />;
}

function LinkList({ note, links, variant, className }: Props & { links: ResolvedLink[] }) {
  const ref = useRef<HTMLElement>(null);
  const noteId = note.id;

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (variant === 'side') {
      setEditorLinksInView(noteId, true);
      return () => setEditorLinksInView(noteId, false);
    }
    // The dock covers the bottom of the screen, so cards behind it are not in view.
    const observer = new IntersectionObserver(
      ([entry]) => setEditorLinksInView(noteId, Boolean(entry?.isIntersecting)),
      { rootMargin: '0px 0px -120px 0px' },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setEditorLinksInView(noteId, false);
    };
  }, [variant, noteId]);

  return (
    <section
      ref={ref}
      aria-label="Links"
      data-note-links={variant}
      className={cn('flex flex-col gap-2', className)}
    >
      <h2 className="px-1 font-medium text-muted-foreground text-xs">
        {links.length === 1 ? 'Link' : `Links · ${links.length}`}
      </h2>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.url}>
            <LinkPreviewCard
              link={link}
              noteId={note.id}
              readOnly={Boolean(note.deletedAt) || isSharedNote(note)}
              galleryPreviewUrl={note.galleryPreviewUrl}
              canChooseGalleryPreview={!note.deletedAt}
              onShowInNote={() => showLinkInNote(link.url)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
