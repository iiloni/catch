import { motionValue } from 'motion/react';
import { useSyncExternalStore } from 'react';

/**
 * Shared state for the card ⇄ editor transition (a "container transform"). The card
 * that opened a note records its rectangle; the editor grows from it and, on close,
 * shrinks back into wherever that card is by then.
 */

export type Rect = { x: number; y: number; width: number; height: number; radius: number };

/** 0 while the editor is closed, 1 while it covers the screen. The dock and page follow it. */
export const editorProgress = motionValue(0);

const origins = new Map<string, Rect>();

function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  const radius = Number.parseFloat(getComputedStyle(element).borderTopLeftRadius) || 0;
  return { x: box.left, y: box.top, width: box.width, height: box.height, radius };
}

/** Records where a note is opening from. Read once by the editor with `takeOrigin`. */
export function setOrigin(noteId: string, source: Element | Rect) {
  origins.set(noteId, source instanceof Element ? rectOf(source) : source);
}

export function takeOrigin(noteId: string): Rect | null {
  const rect = origins.get(noteId) ?? null;
  origins.delete(noteId);
  return rect;
}

/** The on-screen card for a note, if one is rendered. */
export function findCard(noteId: string): HTMLElement | null {
  const cards = document.querySelectorAll<HTMLElement>(`[data-note-card="${noteId}"]`);
  for (const card of cards) {
    if (card.getClientRects().length > 0) return card;
  }
  return null;
}

/**
 * Where the editor should shrink back to: the note's card, scrolled into view if it
 * moved off screen (e.g. editing re-sorted it to the top). Null when there is no card,
 * such as after archiving from the editor.
 */
export function measureCard(noteId: string): Rect | null {
  const card = findCard(noteId);
  if (!card) return null;
  const box = card.getBoundingClientRect();
  if (box.bottom < 0 || box.top > window.innerHeight) {
    card.scrollIntoView({ block: 'center', behavior: 'instant' });
  }
  return rectOf(card);
}

// Cards hidden while their note is "lifted" into the editor or quick-note window.
const hidden = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function hideCard(noteId: string) {
  hidden.add(noteId);
  emit();
}

export function showCard(noteId: string) {
  hidden.delete(noteId);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsCardHidden(noteId: string) {
  return useSyncExternalStore(subscribe, () => hidden.has(noteId));
}
