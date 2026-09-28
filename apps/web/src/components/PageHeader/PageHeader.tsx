import { ChevronLeft, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from 'motion/react';
import { type ReactNode, useCallback, useState } from 'react';
import { useGalleryPages } from '@/lib/galleryPages';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

/**
 * While notes are selected: a close button and the count take the top left, and the top
 * right toolbar reshapes itself around the selection's actions.
 */
export type HeaderSelection = { count: number; onClose: () => void; actions: ReactNode };

type Props = {
  title: string;
  /** Controls on the large title's line, at its right edge (such as sorting). */
  titleAccessory?: ReactNode;
  /** Controls in a glass toolbar at the top left, such as a back button. */
  leading?: ReactNode;
  /** Controls in a glass toolbar at the top right. */
  trailing?: ReactNode;
  selection?: HeaderSelection | null;
};

/**
 * iOS-style large title. The bar above it starts transparent and turns to frosted glass,
 * with a small centered title, once the large title scrolls under it.
 */
export function PageHeader({ title, titleAccessory, leading, trailing, selection }: Props) {
  const { scrollY } = useScroll();
  const barOpacity = useTransform(scrollY, [8, 40], [0, 1]);
  const smallTitleOpacity = useTransform(scrollY, [36, 56], [0, 1]);
  const smallTitleY = useTransform(scrollY, [36, 56], [6, 0]);
  const largeTitleOpacity = useTransform(scrollY, [0, 40], [1, 0]);

  return (
    <>
      <header className="fixed top-0 right-[var(--note-pane)] left-0 z-30 pt-[var(--safe-top)]">
        <motion.div
          aria-hidden
          className="glass-bar absolute inset-0"
          style={{ opacity: barOpacity }}
        />
        <div className="relative mx-auto flex h-[var(--header-height)] max-w-7xl items-center px-2 sm:px-4">
          <motion.span
            aria-hidden
            className="flex-1 truncate px-32 text-center font-semibold text-[1.0625rem]"
            style={{ opacity: smallTitleOpacity, y: smallTitleY }}
          >
            {title}
          </motion.span>
          <HeaderToolbars leading={leading} trailing={trailing} selection={selection} />
        </div>
      </header>
      <motion.div
        className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 pt-[calc(var(--safe-top)+var(--header-height))] sm:px-6"
        style={{ opacity: largeTitleOpacity }}
      >
        <h1 className="min-w-0 truncate font-display font-extrabold text-[2.25rem] leading-tight tracking-[-0.03em]">
          {title}
        </h1>
        {titleAccessory && <div className="-mr-2 flex items-center gap-1">{titleAccessory}</div>}
      </motion.div>
    </>
  );
}

type GalleryHeaderProps = {
  /** The controls in the top right toolbar. */
  trailing: ReactNode;
  selection?: HeaderSelection | null;
};

/** Gallery's large title gives way to a compact title as it scrolls past the header. */
export function GalleryHeader({ trailing, selection }: GalleryHeaderProps) {
  const { scrollY } = useScroll();
  const collapseAt = 64;
  const [collapsed, setCollapsed] = useState(() =>
    typeof window === 'undefined' ? false : window.scrollY >= collapseAt,
  );
  useMotionValueEvent(scrollY, 'change', (latest) => setCollapsed(latest >= collapseAt));
  const fade = { duration: 0.22, ease: 'easeInOut' } as const;

  return (
    <>
      <header className="fixed top-0 right-[var(--note-pane)] left-0 z-30 pt-[var(--safe-top)]">
        <div className="relative mx-auto h-[var(--header-height)] max-w-7xl px-2 sm:px-4">
          <motion.div
            aria-hidden
            className="glass pointer-events-none absolute top-1 left-3 flex h-[50px] items-center rounded-[var(--dock-radius)] px-[14px] sm:left-4"
            initial={false}
            animate={{ opacity: collapsed && !selection ? 1 : 0 }}
            transition={fade}
          >
            <span className="whitespace-nowrap font-display font-extrabold text-[17px] leading-none tracking-[-0.03em]">
              Gallery
            </span>
          </motion.div>
          <HeaderToolbars trailing={trailing} selection={selection} />
        </div>
      </header>
      <div className="mx-auto flex h-[calc(var(--safe-top)+var(--header-height)+4rem)] max-w-7xl items-end justify-center">
        <motion.h1
          className="whitespace-nowrap font-display font-extrabold text-[42px] leading-none tracking-[-0.03em]"
          initial={false}
          animate={{ opacity: collapsed || selection ? 0 : 1 }}
          transition={fade}
        >
          Gallery
        </motion.h1>
      </div>
    </>
  );
}

/** The glass toolbars in the header's top corners, and what selecting turns them into. */
function HeaderToolbars({
  leading,
  trailing,
  selection,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  selection?: HeaderSelection | null;
}) {
  const mode = selection ? 'selection' : 'page';
  return (
    <>
      <HeaderToolbar side="left" mode={mode}>
        {selection ? (
          <SelectionCount count={selection.count} onClose={selection.onClose} />
        ) : (
          leading
        )}
      </HeaderToolbar>
      <HeaderToolbar side="right" mode={mode}>
        {selection ? selection.actions : trailing}
      </HeaderToolbar>
    </>
  );
}

function SelectionCount({ count, onClose }: { count: number; onClose: () => void }) {
  return (
    <>
      <motion.button
        type="button"
        aria-label="Clear selection"
        onClick={onClose}
        whileTap={{ scale: 0.9 }}
        transition={springs.snappy}
        className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <X className="size-[22px]" aria-hidden />
      </motion.button>
      <span className="relative flex overflow-hidden pr-3 pl-1 font-semibold text-[1.0625rem] tabular-nums">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.span
            key={count}
            aria-live="polite"
            aria-label={`${count} selected`}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={springs.snappy}
          >
            {count}
          </motion.span>
        </AnimatePresence>
      </span>
    </>
  );
}

type Side = 'left' | 'right';

/**
 * A glass toolbar in one of the header's top corners, shown while it has controls. It grows
 * out of its corner when controls arrive and shrinks back into it when they go. When they
 * change (`mode`), the old ones fade out while the pill stretches or shrinks to fit the new
 * ones, which fade in. The width animates rather than scaling the pill, so the glass and
 * icons stay crisp.
 */
function HeaderToolbar({
  side,
  mode,
  children,
}: {
  side: Side;
  mode: string;
  children: ReactNode;
}) {
  const present = children !== null && children !== undefined && children !== false;
  return (
    <AnimatePresence initial={false}>
      {present && (
        <MorphingPill key="pill" side={side} mode={mode}>
          {children}
        </MorphingPill>
      )}
    </AnimatePresence>
  );
}

function MorphingPill({ side, mode, children }: { side: Side; mode: string; children: ReactNode }) {
  // Unset until the first controls are measured, which the pill then takes on at once.
  const width = useMotionValue<number | 'auto'>('auto');
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const update = () => {
        const pill = element.parentElement;
        const border = pill ? pill.offsetWidth - pill.clientWidth : 0;
        const next = element.offsetWidth + border;
        if (width.get() === 'auto') width.jump(next);
        else animate(width, next, springs.smooth);
      };
      update();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [width],
  );

  return (
    <motion.div
      className={cn(
        'glass absolute top-1 h-[50px] overflow-hidden rounded-[var(--dock-radius)]',
        side === 'left' ? 'left-3 origin-left sm:left-4' : 'right-3 origin-right sm:right-4',
      )}
      style={{ width }}
      // No filter here: it would stop the glass from blurring the page behind it.
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.16 } }}
      transition={springs.smooth}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={mode}
          ref={measure}
          className={cn(
            'absolute inset-y-0 flex items-center p-1',
            side === 'left' ? 'left-0 origin-left' : 'right-0 origin-right',
          )}
          initial={{ opacity: 0, scale: 0.85, filter: 'blur(4px)' }}
          animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
          exit={{ opacity: 0, scale: 0.85, filter: 'blur(4px)', transition: { duration: 0.14 } }}
          transition={springs.smooth}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

/** Returns to the Gallery, the parent of every page that shows one. */
export function BackToGallery() {
  const goToGalleryPage = useGalleryPages();
  return (
    <motion.button
      type="button"
      aria-label="Back to Gallery"
      whileTap={{ scale: 0.9 }}
      onClick={() => goToGalleryPage('/')}
      className="flex h-10 items-center gap-0.5 rounded-full pr-3 pl-0.5 font-medium text-[1.0625rem] outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-7" aria-hidden />
      Gallery
    </motion.button>
  );
}
