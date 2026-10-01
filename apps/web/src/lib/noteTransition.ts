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
 * Where the editor should shrink back to: the note's card. Null when there is no card on
 * screen, such as after archiving from the editor, or when editing re-sorted the note out
 * of view (the grid may not even render it). The editor then fades out where it is, which
 * keeps the reader's place instead of jumping the page to the card.
 */
export function measureCard(noteId: string): Rect | null {
  const card = findCard(noteId);
  if (!card) return null;
  const box = card.getBoundingClientRect();
  if (box.bottom < 0 || box.top > window.innerHeight) return null;
  return rectOf(card);
}

// Cards hidden while their note is "lifted" into the editor or quick-note window.
const hidden = new Set<string>();
// Hidden cards whose note is about to land back in them.
const landing = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function hideCard(noteId: string) {
  hidden.add(noteId);
  landing.delete(noteId);
  emit();
}

/**
 * Marks a hidden card as moments from being shown, so what hangs under it (its link
 * underlay) can start moving while the note settles into it.
 */
export function landCard(noteId: string) {
  if (!hidden.has(noteId)) return;
  landing.add(noteId);
  emit();
}

export function showCard(noteId: string) {
  hidden.delete(noteId);
  landing.delete(noteId);
  emit();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useIsCardHidden(noteId: string) {
  return useSyncExternalStore(subscribe, () => hidden.has(noteId));
}

export function useIsCardLanding(noteId: string) {
  return useSyncExternalStore(subscribe, () => landing.has(noteId));
}
