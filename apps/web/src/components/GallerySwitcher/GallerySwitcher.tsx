import { Archive, Bell, LayoutGrid, LockKeyhole, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { GalleryPage } from '@/lib/galleryPages';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const PAGES = [
  { path: '/', label: 'Gallery', icon: LayoutGrid },
  { path: '/reminders', label: 'Reminders', icon: Bell },
  { path: '/archive', label: 'Archive', icon: Archive },
  { path: '/trash', label: 'Trash', icon: Trash2 },
  { path: '/vault', label: 'Vault', icon: LockKeyhole },
] as const satisfies ReadonlyArray<{ path: GalleryPage; label: string; icon: unknown }>;

/** The Gallery page under a point on screen, for a finger sliding up from the dock. */
export function galleryPageAt(x: number, y: number): GalleryPage | null {
  // Map the finger to the nearest segment while it is anywhere near the bar, so the
  // gesture does not need fingertip precision (the finger itself covers the bar).
  // Pointer capture sits on the tab bar and native overlays come and go, so this is a
  // geometric hit test rather than elementFromPoint.
  const bar = document.querySelector<HTMLElement>('[data-gallery-switcher]');
  if (bar) {
    const rect = bar.getBoundingClientRect();
    if (
      x >= rect.left - 16 &&
      x <= rect.right + 16 &&
      y >= rect.top - 56 &&
      y <= rect.bottom + 16
    ) {
      const index = Math.floor(((x - rect.left) / rect.width) * PAGES.length);
      return PAGES[Math.min(PAGES.length - 1, Math.max(0, index))]?.path ?? null;
    }
    return null;
  }
  // Fallback while the bar itself is not in the DOM: the buttons, with tolerance.
  const tolerance = 12;
  const elements = document.querySelectorAll<HTMLElement>('[data-gallery-page]');
  for (const element of elements) {
    const page = element.dataset.galleryPage;
    if (!PAGES.some((item) => item.path === page)) continue;
    const rect = element.getBoundingClientRect();
    if (
      x >= rect.left - tolerance &&
      x <= rect.right + tolerance &&
      y >= rect.top - tolerance &&
      y <= rect.bottom + tolerance
    ) {
      return page as GalleryPage;
    }
  }
  return null;
}

type Props = {
  open: boolean;
  /** The Gallery page being shown, if any. */
  current: GalleryPage | null;
  /** The segment under a finger held on the Gallery tab; the indicator follows it. */
  hovered: GalleryPage | null;
  onSelect: (page: GalleryPage) => void;
};

/**
 * A segmented control for the Gallery, Reminders, Archive, Trash and the Vault. It floats as its own glass
 * bar above the dock with a gap, rather than growing the dock itself.
 */
export function GallerySwitcher({ open, current, hovered, onSelect }: Props) {
  const shown = hovered ?? current;

  return (
    <AnimatePresence initial={false}>
      {open && (
        // No `filter` in this animation, and the glass on the animated element itself: a
        // filter on an ancestor makes a backdrop root, so the glass would stop blurring the
        // page behind it and look flatter than the dock.
        <motion.nav
          key="switcher"
          aria-label="Gallery pages"
          data-gallery-switcher
          className="glass absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-10 grid touch-none select-none grid-cols-5 rounded-[var(--dock-radius)] p-1 [-webkit-touch-callout:none]"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.16 } }}
          transition={springs.snappy}
        >
          {PAGES.map((page) => {
            const Icon = page.icon;
            const selected = shown === page.path;
            return (
              <button
                key={page.path}
                type="button"
                data-gallery-page={page.path}
                aria-current={current === page.path ? 'page' : undefined}
                onClick={() => onSelect(page.path)}
                className={cn(
                  'relative z-0 flex h-14 flex-col items-center justify-center gap-0.5 rounded-[calc(var(--dock-radius)-0.25rem)] font-medium text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                  selected ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="gallery-page"
                    aria-hidden
                    className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.25rem)] bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                    transition={springs.snappy}
                  />
                )}
                <Icon className="size-4" aria-hidden />
                {page.label}
              </button>
            );
          })}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
