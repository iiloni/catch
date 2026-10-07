import {
  extractLinks,
  isLinkOnly,
  type LinkPreview,
  MAX_NOTE_LINKS,
  type Note,
  type NoteLink,
  normalizeUrl,
} from '@catch/shared';
import { useMemo } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from './api';
import { useLinkPreviews } from './collections';
import { getServerUrl } from './serverUrl';
import { usePersistentState } from './storage';
import { createStore } from './store';
import { isVaultNote } from './vault';

/**
 * A link in a note with what the server found there. `preview` is undefined until the
 * server has a row for it, which offline notes wait for; cards then show the URL alone.
 */
export type ResolvedLink = NoteLink & { preview: LinkPreview | undefined };

/** A note's links that show previews, in reading order, without the ones the user removed. */
export function noteLinks(
  note: Pick<Note, 'content' | 'hiddenLinks'>,
  previews: ReadonlyMap<string, LinkPreview>,
): ResolvedLink[] {
  const hidden = new Set(note.hiddenLinks);
  return extractLinks(note.content)
    .filter((link) => !hidden.has(link.url))
    .slice(0, MAX_NOTE_LINKS)
    .map((link) => ({ ...link, preview: previews.get(link.url) }));
}

/**
 * The note's previewed links, or none while link previews are turned off. A vault note has
 * none either: the server would have to be told the link to fetch its preview (ADR 0020).
 */
export function useNoteLinks(
  note: Pick<Note, 'content' | 'hiddenLinks'> & Partial<Pick<Note, 'id'>>,
): ResolvedLink[] {
  const previews = useLinkPreviews();
  const [enabled] = useShowLinkPreviews();
  const { content, hiddenLinks } = note;
  const shown = enabled && !(note.id !== undefined && isVaultNote(note.id));
  return useMemo(
    () => (shown ? noteLinks({ content, hiddenLinks }, previews) : []),
    [shown, content, hiddenLinks, previews],
  );
}

/**
 * Whether a note is nothing but one link, so its card is that link's preview. Hidden
 * previews and the setting turn it back into a plain card.
 */
export function useIsLinkNote(note: Pick<Note, 'content' | 'hiddenLinks'>, links: ResolvedLink[]) {
  const { content } = note;
  const linkOnly = useMemo(() => isLinkOnly(content), [content]);
  return linkOnly && links.length === 1;
}

/** A thumbnail or icon stored by the server. */
export function assetUrl(hash: string) {
  return `${getServerUrl()}/api/link-previews/assets/${hash}`;
}

/** The title a link goes by: its page's title, or where it points while there is none. */
export function linkTitle(link: ResolvedLink) {
  if (link.preview?.title) return link.preview.title;
  try {
    const url = new URL(link.url);
    const path = url.pathname === '/' ? '' : decodeURI(url.pathname);
    return `${url.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return link.url;
  }
}

/** Asks the server to fetch a link again, as when a page has changed or failed to load. */
export async function refreshLinkPreview(url: string) {
  try {
    await api.refreshLinkPreview({ url });
  } catch {
    toast('Could not refresh the preview');
  }
}

export async function copyLink(href: string) {
  try {
    await navigator.clipboard.writeText(href);
    toast('Link copied');
  } catch {
    toast('Could not copy the link');
  }
}

export const canShare = () => typeof navigator !== 'undefined' && 'share' in navigator;

export function shareLink(link: ResolvedLink) {
  navigator.share({ url: link.href, title: link.preview?.title ?? undefined }).catch(() => {
    // Dismissing the share sheet rejects; there is nothing to report.
  });
}

/** The overlay listing a note's links. */
export const linkOverlay = createStore<{
  noteId: string;
  /** Opened from the open note, which the overlay then need not offer to open. */
  fromEditor: boolean;
} | null>(null);

export function openLinkOverlay(noteId: string, fromEditor = false) {
  linkOverlay.set({ noteId, fromEditor });
}

/**
 * Scrolls the open note to where it links to `url` and flashes the link, so a card can be
 * traced back to its place in the text.
 */
export function showLinkInNote(url: string) {
  const anchors = document.querySelectorAll<HTMLAnchorElement>('[data-note-scroll] a[href]');
  const anchor = [...anchors].find((element) => normalizeUrl(element.href) === url);
  if (!anchor) return;
  anchor.scrollIntoView({ block: 'center', behavior: 'smooth' });
  anchor.animate(
    [
      { backgroundColor: 'color-mix(in oklch, var(--brand) 55%, transparent)' },
      { backgroundColor: 'transparent' },
    ],
    { duration: 1400, delay: 250, easing: 'ease-out' },
  );
}

/**
 * The note whose own list of links is on screen: beside it, or scrolled into view under its
 * text. While the open note's is not, the dock shows a tray that opens the overlay. Keyed by
 * note, since a note fading out of the pane reports after the one replacing it.
 */
export const editorLinksInView = createStore<string | null>(null);

export function setEditorLinksInView(noteId: string, inView: boolean) {
  if (inView) editorLinksInView.set(noteId);
  else if (editorLinksInView.get() === noteId) editorLinksInView.set(null);
}

export function useShowLinkPreviews() {
  return usePersistentState('catch-link-previews', z.boolean(), true);
}
