import { ChevronLeft, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useTransform,
} from 'motion/react';
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { SyncIndicator, showsSyncIndicator } from '@/components/SyncIndicator/SyncIndicator';
import { useGalleryPages } from '@/lib/galleryPages';
import { springs } from '@/lib/motion';
import { useSyncStatus } from '@/lib/syncStatus';
import { cn } from '@/lib/utils';

/**
 * While notes are selected: a close button and the count take the top left, and the top
 * right toolbar reshapes itself around the selection's actions.
 */
export type HeaderSelection = { count: number; onClose: () => void; actions: ReactNode };

type Props = {
  title: string;
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
export function PageHeader({ title, leading, trailing, selection }: Props) {
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
        className="mx-auto max-w-7xl px-4 pt-[calc(var(--safe-top)+var(--header-height)+0.75rem)] sm:px-6"
        style={{ opacity: largeTitleOpacity }}
      >
        <h1 className="truncate font-display font-extrabold text-[2.25rem] leading-tight tracking-[-0.03em]">
          {title}
        </h1>
      </motion.div>
    </>
  );
}

type TabPageHeaderProps = {
  title: string;
  /** Controls at the top right, which turn into a glass toolbar along with the title. */
  trailing?: ReactNode;
  selection?: HeaderSelection | null;
};

/** How far below the header's row the large title rests. */
const TITLE_REST_Y = 66;
/**
 * The scroll at which the title leaves for its corner: while it is still below the row. A
 * centered title on a phone is wider than the gap between the corners, so riding the page
 * any further would run it into the controls on the right.
 */
const TITLE_COLLAPSE_AT = 16;

/**
 * The header of the pages in the dock. The large title moves into the top left corner as a
 * glass pill once the page starts to scroll, taking the place of the brand there.
 */
export function TabPageHeader({ title, trailing, selection }: TabPageHeaderProps) {
  const { scrollY } = useScroll();
  const reducedMotion = useReducedMotion();
  const scrollAnimation = useRef<ReturnType<typeof animate> | null>(null);
  const [trailingWidth, setTrailingWidth] = useState(0);
  // Not `window.scrollY`: on mount it still holds the previous page's scroll until the router
  // resets it, and `scrollY` would never report a change to correct it.
  const [collapsed, setCollapsed] = useState(() => scrollY.get() >= TITLE_COLLAPSE_AT);
  useMotionValueEvent(scrollY, 'change', (latest) => setCollapsed(latest >= TITLE_COLLAPSE_AT));
  // The expanded title follows the page; only the move into the corner is animated.
  const titleScrollY = useTransform(
    scrollY,
    [0, TITLE_COLLAPSE_AT],
    [TITLE_REST_Y, TITLE_REST_Y - TITLE_COLLAPSE_AT],
  );
  const slide = { ...springs.smooth, visualDuration: 0.3 };
  const branded = !collapsed && !selection;

  useEffect(() => {
    const stop = () => scrollAnimation.current?.stop();
    const events = ['wheel', 'touchstart', 'pointerdown', 'keydown'] as const;
    for (const event of events) window.addEventListener(event, stop, { passive: true });
    return () => {
      stop();
      for (const event of events) window.removeEventListener(event, stop);
    };
  }, []);

  function scrollToTop() {
    scrollAnimation.current?.stop();
    if (reducedMotion) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      return;
    }
    // Native smooth scrolling takes longer for notes further down the page.
    scrollAnimation.current = animate(window.scrollY, 0, {
      duration: 0.18,
      ease: 'easeOut',
      onUpdate: (top) => window.scrollTo({ top, behavior: 'instant' }),
    });
  }

  return (
    <>
      <header className="fixed top-0 right-[var(--note-pane)] left-0 z-30 pt-[var(--safe-top)]">
        {/* The controls stay in the page pane; the blur spans the viewport so no split seam shows. */}
        <motion.div
          aria-hidden
          className="page-top-blur pointer-events-none absolute top-0 right-[calc(-1*var(--note-pane))] left-0 h-[calc(var(--safe-top)+8rem)]"
          initial={false}
          animate={{ opacity: collapsed ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        />
        <div className="relative mx-auto h-[var(--header-height)] max-w-7xl px-2 sm:px-4">
          {/* Fixed, not in the page: scrolling would carry it under the system status bar. */}
          <div className="pointer-events-none absolute inset-x-3 top-1 sm:inset-x-4">
            <motion.div
              className="origin-left"
              initial={false}
              animate={{ opacity: branded ? 1 : 0, scale: branded ? 1 : 0.85 }}
              transition={branded ? slide : { duration: 0.16 }}
              aria-hidden={!branded}
              style={{ maxWidth: `calc(100% - ${trailingWidth + 8}px)` }}
            >
              <BrandLockup orientation="horizontal" iconSize={28} />
            </motion.div>
          </div>
          <motion.div
            className="pointer-events-none absolute inset-x-0 top-1 h-[50px]"
            style={{ y: titleScrollY }}
          >
            <motion.div
              className="absolute flex h-full items-center rounded-[var(--dock-radius)]"
              initial={false}
              animate={{
                left: collapsed ? '0%' : '50%',
                x: collapsed ? '0%' : '-50%',
                marginLeft: collapsed ? 12 : 0,
                y: collapsed ? TITLE_COLLAPSE_AT - TITLE_REST_Y : 0,
                fontSize: collapsed ? 17 : 42,
                paddingInline: collapsed ? 14 : 0,
                opacity: selection ? 0 : 1,
              }}
              transition={slide}
            >
              <motion.span
                aria-hidden
                className="glass absolute inset-0 rounded-[var(--dock-radius)]"
                initial={false}
                animate={{ opacity: collapsed ? 1 : 0 }}
                transition={slide}
              />
              <h1 className="relative whitespace-nowrap font-display font-extrabold leading-none tracking-[-0.03em]">
                {title}
              </h1>
              <button
                type="button"
                aria-label="Scroll to top"
                disabled={!collapsed || Boolean(selection)}
                className="pointer-events-auto absolute inset-0 rounded-[var(--dock-radius)] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none"
                onClick={scrollToTop}
              />
            </motion.div>
          </motion.div>
          <HeaderToolbars
            trailing={trailing}
            selection={selection}
            flat={!collapsed}
            onTrailingWidthChange={setTrailingWidth}
          />
        </div>
      </header>
      <div className="h-[calc(var(--safe-top)+var(--header-height)+4rem)]" />
    </>
  );
}

/**
 * The toolbars in the header's top corners, and what selecting turns them into. While `flat`,
 * the page's own controls sit on the page without glass; selecting always shows the glass.
 */
function HeaderToolbars({
  leading,
  trailing,
  selection,
  flat = false,
  onTrailingWidthChange,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  selection?: HeaderSelection | null;
  flat?: boolean;
  onTrailingWidthChange?: (width: number) => void;
}) {
  const mode = selection ? 'selection' : 'page';
  const glass = !flat || Boolean(selection);
  const status = useSyncStatus();
  const pageTrailing = showsSyncIndicator(status) ? (
    <>
      <SyncIndicator status={status} />
      {trailing}
    </>
  ) : (
    trailing
  );
  return (
    <>
      <HeaderToolbar side="left" mode={mode} glass={glass}>
        {selection ? (
          <SelectionCount count={selection.count} onClose={selection.onClose} />
        ) : (
          leading
        )}
      </HeaderToolbar>
      <HeaderToolbar side="right" mode={mode} glass={glass} onWidthChange={onTrailingWidthChange}>
        {selection ? selection.actions : pageTrailing}
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
  glass,
  children,
  onWidthChange,
}: {
  side: Side;
  mode: string;
  glass: boolean;
  children: ReactNode;
  onWidthChange?: (width: number) => void;
}) {
  const present = children !== null && children !== undefined && children !== false;
  useLayoutEffect(() => {
    if (!present) onWidthChange?.(0);
  }, [present, onWidthChange]);
  return (
    <AnimatePresence initial={false}>
      {present && (
        <MorphingPill
          key="pill"
          side={side}
          mode={mode}
          glass={glass}
          onWidthChange={onWidthChange}
        >
          {children}
        </MorphingPill>
      )}
    </AnimatePresence>
  );
}

function MorphingPill({
  side,
  mode,
  glass,
  children,
  onWidthChange,
}: {
  side: Side;
  mode: string;
  glass: boolean;
  children: ReactNode;
  onWidthChange?: (width: number) => void;
}) {
  // Unset until the first controls are measured, which the pill then takes on at once.
  const width = useMotionValue<number | 'auto'>('auto');
  const measure = useCallback(
    (element: HTMLDivElement | null) => {
      if (!element) return;
      const update = () => {
        const next = element.offsetWidth;
        onWidthChange?.(next);
        if (width.get() === 'auto') width.jump(next);
        else animate(width, next, springs.smooth);
      };
      update();
      if (typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver(update);
      observer.observe(element);
      return () => observer.disconnect();
    },
    [width, onWidthChange],
  );

  return (
    <motion.div
      className={cn(
        'absolute top-1 h-[50px] overflow-hidden rounded-[var(--dock-radius)]',
        side === 'left' ? 'left-3 origin-left sm:left-4' : 'right-3 origin-right sm:right-4',
      )}
      style={{ width }}
      // No filter here: it would stop the glass from blurring the page behind it.
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.16 } }}
      transition={springs.smooth}
    >
      <motion.span
        aria-hidden
        className="glass absolute inset-0 rounded-[var(--dock-radius)]"
        initial={false}
        animate={{ opacity: glass ? 1 : 0 }}
        transition={{ ...springs.smooth, visualDuration: 0.3 }}
      />
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
