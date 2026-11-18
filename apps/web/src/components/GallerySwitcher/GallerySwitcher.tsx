import {
  Archive,
  Bell,
  LayoutDashboard,
  LockKeyhole,
  LockKeyholeOpen,
  type LucideIcon,
  Trash2,
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { GalleryPage } from '@/lib/galleryPages';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const PAGES = [
  { path: '/', label: 'Gallery', icon: LayoutDashboard },
  { path: '/reminders', label: 'Reminders', icon: Bell },
  { path: '/archive', label: 'Archive', icon: Archive },
  { path: '/trash', label: 'Trash', icon: Trash2 },
] as const satisfies ReadonlyArray<{ path: GalleryPage; label: string; icon: unknown }>;

/** A segment of the switcher: one of the pages, or the vault's toggle. */
export type SwitcherItem = GalleryPage | 'vault';

const isItem = (value: string | undefined): value is SwitcherItem =>
  value === 'vault' || PAGES.some((page) => page.path === value);

/** How far a point lies outside a box, 0 inside it. */
function distance(x: number, y: number, rect: DOMRect) {
  const dx = Math.max(rect.left - x, 0, x - rect.right);
  const dy = Math.max(rect.top - y, 0, y - rect.bottom);
  return Math.hypot(dx, dy);
}

/** The segment under a point on screen, for a finger sliding up from the dock. */
export function switcherItemAt(x: number, y: number): SwitcherItem | null {
  // Map the finger to the nearest segment while it is anywhere near the card, so the
  // gesture does not need fingertip precision (the finger itself covers the card), and the
  // gaps and the top row's empty corners still pick something. Pointer capture sits on the
  // tab bar and native overlays come and go, so this is a geometric hit test rather than
  // elementFromPoint.
  let nearest: { item: SwitcherItem; distance: number } | null = null;
  for (const element of document.querySelectorAll<HTMLElement>('[data-gallery-page]')) {
    const item = element.dataset.galleryPage;
    if (!isItem(item)) continue;
    const away = distance(x, y, element.getBoundingClientRect());
    if (!nearest || away < nearest.distance) nearest = { item, distance: away };
  }
  if (!nearest) return null;
  const card = document.querySelector<HTMLElement>('[data-gallery-switcher]');
  if (!card) return nearest.distance <= 12 ? nearest.item : null;
  const rect = card.getBoundingClientRect();
  const near =
    x >= rect.left - 16 && x <= rect.right + 16 && y >= rect.top - 56 && y <= rect.bottom + 16;
  return near ? nearest.item : null;
}

type Item = { path: SwitcherItem; label: string; name?: string; icon: LucideIcon };

type Props = {
  open: boolean;
  /** The Gallery page being shown, if any. */
  current: GalleryPage | null;
  /** The segment under a finger held on the Gallery tab; the indicator follows it. */
  hovered: SwitcherItem | null;
  /** The vault's toggle, or null where it is hidden. */
  vault: { inside: boolean } | null;
  onSelect: (item: SwitcherItem) => void;
};

/**
 * A card of the Gallery's pages above the dock: Reminders and the vault's toggle centered on
 * top, where a thumb holding the Gallery tab reaches up to them, and the Gallery, Archive and
 * Trash below. It floats as its own glass card with a gap, rather than growing the dock itself.
 */
export function GallerySwitcher({ open, current, hovered, vault, onSelect }: Props) {
  const shown = hovered ?? current;
  const [gallery, reminders, archive, trash] = PAGES;
  const toggle: Item | null = !vault
    ? null
    : vault.inside
      ? { path: 'vault', label: 'Leave vault', name: 'Leave the vault', icon: LockKeyholeOpen }
      : { path: 'vault', label: 'Vault', name: 'Open the vault', icon: LockKeyhole };
  // Six columns, each segment two wide, so the top row's two (or one) sit centered over the
  // three below at the same width.
  const rows: ReadonlyArray<ReadonlyArray<Item>> = [
    toggle ? [reminders, toggle] : [reminders],
    [gallery, archive, trash],
  ];

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
          className="glass absolute inset-x-0 bottom-[calc(100%+0.5rem)] z-10 grid touch-none select-none grid-cols-6 gap-1 rounded-[var(--dock-radius)] p-1.5 [-webkit-touch-callout:none]"
          initial={{ opacity: 0, y: 16, scale: 0.94 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: 0.16 } }}
          transition={springs.snappy}
        >
          {rows.map((row) =>
            row.map((page, index) => {
              const Icon = page.icon;
              const isToggle = page.path === 'vault';
              const selected = shown === page.path;
              // The first segment of a row starts where centering the row puts it.
              const start = index === 0 ? START[row.length] : undefined;
              return (
                <button
                  key={page.path}
                  type="button"
                  data-gallery-page={page.path}
                  aria-label={page.name}
                  aria-current={current === page.path ? 'page' : undefined}
                  aria-pressed={isToggle ? vault?.inside : undefined}
                  onClick={() => onSelect(page.path)}
                  className={cn(
                    'relative z-0 col-span-2 flex h-16 min-w-0 flex-col items-center justify-center gap-1 whitespace-nowrap rounded-[calc(var(--dock-radius)-0.375rem)] font-medium text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                    start,
                    selected || (isToggle && vault?.inside)
                      ? 'text-foreground'
                      : 'text-muted-foreground',
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="gallery-page"
                      aria-hidden
                      className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.375rem)] bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                      transition={springs.snappy}
                    />
                  )}
                  <Icon className="size-5" aria-hidden />
                  {page.label}
                </button>
              );
            }),
          )}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}

/** Where a row of one, two or three two-column segments starts, centered in six columns. */
const START: Record<number, string> = { 1: 'col-start-3', 2: 'col-start-2', 3: 'col-start-1' };
