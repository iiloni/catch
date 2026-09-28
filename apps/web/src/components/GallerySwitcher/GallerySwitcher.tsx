import { Archive, LayoutGrid, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { GalleryPage } from '@/lib/galleryPages';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const PAGES = [
  { path: '/', label: 'Gallery', icon: LayoutGrid },
  { path: '/archive', label: 'Archive', icon: Archive },
  { path: '/trash', label: 'Trash', icon: Trash2 },
] as const satisfies ReadonlyArray<{ path: GalleryPage; label: string; icon: unknown }>;

/** The Gallery page under a point on screen, for a finger sliding up from the dock. */
export function galleryPageAt(x: number, y: number): GalleryPage | null {
  const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-gallery-page]');
  const page = element?.dataset.galleryPage;
  return PAGES.find((item) => item.path === page)?.path ?? null;
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
 * A segmented control for the Gallery, Archive and Trash that grows the dock upward. It sits
 * above the tabs row, so its bottom margin leaves that row room.
 */
export function GallerySwitcher({ open, current, hovered, onSelect }: Props) {
  const shown = hovered ?? current;

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          key="switcher"
          className="mb-[var(--dock-height)] overflow-hidden"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={springs.smooth}
        >
          <nav
            aria-label="Gallery pages"
            className="mx-1.5 mt-1.5 grid grid-cols-3 rounded-[calc(var(--dock-radius)-0.375rem)] bg-foreground/[0.06] p-1"
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
                    'relative z-0 flex h-10 items-center justify-center gap-1.5 rounded-[calc(var(--dock-radius)-0.625rem)] font-medium text-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                    selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="gallery-page"
                      aria-hidden
                      className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.625rem)] bg-card shadow-[0_1px_3px_oklch(0_0_0/0.18),inset_0_1px_0_var(--glass-highlight)]"
                      transition={springs.snappy}
                    />
                  )}
                  <Icon className="size-4" aria-hidden />
                  {page.label}
                </button>
              );
            })}
          </nav>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
