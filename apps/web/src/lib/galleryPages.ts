import { useRouter } from '@tanstack/react-router';
import { useCallback } from 'react';

/** The Gallery and its quieter corners, switched between from the dock. */
export const GALLERY_PAGES = ['/', '/archive', '/trash'] as const;
export type GalleryPage = (typeof GALLERY_PAGES)[number];

/** Whether Archive or Trash was opened by pushing a history entry on top of the Gallery. */
let pushedFromGallery = false;

/**
 * Moves between the Gallery, Archive and Trash. Leaving the Gallery pushes a history entry,
 * so the back gesture returns to it; returning goes back rather than pushing again, and
 * switching between Archive and Trash replaces.
 */
export function useGalleryPages() {
  const router = useRouter();

  return useCallback(
    (to: GalleryPage) => {
      const from = router.state.location.pathname;
      if (to === from) return;
      const fromCorner = from === '/archive' || from === '/trash';
      if (to === '/') {
        if (pushedFromGallery && fromCorner) router.history.back();
        else void router.navigate({ to: '/', replace: true });
        pushedFromGallery = false;
      } else if (from === '/') {
        pushedFromGallery = true;
        void router.navigate({ to });
      } else {
        // Between Archive and Trash the Gallery stays underneath; from another tab it is not.
        if (!fromCorner) pushedFromGallery = false;
        void router.navigate({ to, replace: true });
      }
    },
    [router],
  );
}
