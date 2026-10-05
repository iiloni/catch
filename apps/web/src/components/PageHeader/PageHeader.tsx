import { useRouterState } from '@tanstack/react-router';
import { ChevronLeft, X } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  type MotionStyle,
  type MotionValue,
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
import { useEntryMotion } from '@/lib/entryMotion';
import { useGalleryPages } from '@/lib/galleryPages';
import { springs } from '@/lib/motion';
import { CARD_FACE_FADE_END, editorProgress } from '@/lib/noteTransition';
import { PAGE_MAX, useHeaderGutterShift, useNotePane, usePageGutterShift } from '@/lib/splitView';
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
  /** Moves both the fixed bar and the scrolling title with a dismissible page. */
  offsetY?: MotionValue<number>;
};

type HeaderLayerStyle = MotionStyle & { '--header-layer-opacity': MotionValue<number> };

function useHeaderEntry(
  key: string,
  delayMs = 0,
): MotionStyle & { '--header-entry-opacity': MotionValue<number> } {
  const entry = useEntryMotion(key, true, delayMs);
  // Keep startup's fade multiplied by the editor and toolbar transitions.
  return { '--header-entry-opacity': entry.opacity, y: entry.y };
}

/** Bring the page's glass above the returning card as its face replaces the editor. */
function useHeaderTransition() {
  const { split } = useNotePane();
  const noteOpen = useRouterState({
    select: (state) =>
      Boolean((state.matches.at(-1)?.search as { note?: string } | undefined)?.note),
  });
  const opacity = useTransform(() => {
    const progress = editorProgress.get();
    return split ? 1 : Math.max(0, 1 - progress / CARD_FACE_FADE_END);
  });
  const zIndex = useTransform(() => {
    const progress = editorProgress.get();
    return !split && (noteOpen || progress > 0) ? 60 : 30;
  });
  const visibility = useTransform(() => (opacity.get() === 0 ? 'hidden' : 'visible'));
  // Opacity on the header would isolate every descendant blur until the fade reaches 1.
  return { '--header-opacity': opacity, zIndex, visibility };
}

/**
 * iOS-style large title. The bar above it starts transparent and turns to frosted glass,
 * with a small centered title, once the large title scrolls under it.
 */
export function PageHeader({ title, leading, trailing, selection, offsetY }: Props) {
  const entry = useEntryMotion('header:title', true, 20);
  const transition = useHeaderTransition();
  const gutterShift = usePageGutterShift(PAGE_MAX);
  const { scrollY } = useScroll();
  const barOpacity = useTransform(scrollY, [8, 40], [0, 1]);
  const smallTitleOpacity = useTransform(scrollY, [36, 56], [0, 1]);
  const smallTitleY = useTransform(scrollY, [36, 56], [6, 0]);
  const largeTitleOpacity = useTransform(scrollY, [0, 40], [1, 0]);
  const barStyle: HeaderLayerStyle = { '--header-layer-opacity': barOpacity };
  const smallTitleStyle: HeaderLayerStyle = {
    '--header-layer-opacity': smallTitleOpacity,
    y: smallTitleY,
  };

  return (
    <>
      <motion.header
        data-page-header
        className="fixed top-0 right-[var(--note-pane)] left-0 z-30 pt-[var(--safe-top)]"
        style={{ ...transition, y: offsetY }}
      >
        <motion.div
          aria-hidden
          className="glass-bar header-fade absolute inset-0"
          style={barStyle}
        />
        <div className="relative mx-auto flex h-[var(--header-height)] max-w-7xl items-center px-2 sm:px-4">
          <motion.span
            aria-hidden
            className="header-fade flex-1 truncate px-32 text-center font-semibold text-[1.0625rem]"
            style={smallTitleStyle}
          >
            {title}
          </motion.span>
          <HeaderToolbars leading={leading} trailing={trailing} selection={selection} />
        </div>
      </motion.header>
      <motion.div
        className="mx-auto max-w-7xl px-4 pt-[calc(var(--safe-top)+var(--header-height)+0.75rem)] sm:px-6"
        style={{ opacity: largeTitleOpacity, x: gutterShift, y: offsetY }}
      >
        <motion.h1
          style={entry}
          className="truncate font-display font-extrabold text-[2.25rem] leading-tight tracking-[-0.03em]"
        >
          {title}
        </motion.h1>
      </motion.div>
    </>
  );
}

type TabPageHeaderProps = {
  title: string;
  /** Controls at the top left; the collapsed title sits beside them. */
  leading?: ReactNode;
  /** Controls at the top right, which turn into a glass toolbar along with the title. */
  trailing?: ReactNode;
  selection?: HeaderSelection | null;
  /** Moves the fixed title, controls and edge blur with a dismissible page. */
  offsetY?: MotionValue<number>;
};

/** How far below the header's row the large title rests. */
const TITLE_REST_Y = 66;
/**
 * The scroll at which the title leaves for its corner: while it is still below the row. A
 * centered title on a phone is wider than the gap between the corners, so riding the page
 * any further would run it into the controls on the right.
 */
const TITLE_COLLAPSE_AT = 16;

/** Fit the complete title using its actual font metrics, including after fonts load. */
function useFittedTitle(title: string) {
  const area = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLSpanElement>(null);
  const [fontSize, setFontSize] = useState(42);

  // biome-ignore lint/correctness/useExhaustiveDependencies: Remeasure changed text before paint, as well as observing later width and font changes.
  useLayoutEffect(() => {
    const container = area.current;
    const text = measure.current;
    if (!container || !text) return;
    const update = () => {
      const available = container.clientWidth - 24;
      let size = 42;
      text.style.fontSize = `${size}px`;
      let width = text.getBoundingClientRect().width;
      if (available <= 1 || width <= 0) return;
      // Optical sizing changes the font's proportions, so verify each smaller size.
      for (let attempt = 0; width > available && attempt < 4; attempt++) {
        size *= (available - 1) / width;
        text.style.fontSize = `${size}px`;
        width = text.getBoundingClientRect().width;
      }
      setFontSize(size);
    };
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    observer.observe(text);
    return () => observer.disconnect();
  }, [title]);

  return { area, measure, fontSize };
}

/**
 * The header of the pages in the dock. The large title moves into the top left corner as a
 * glass pill once the page starts to scroll, taking the place of the brand there.
 */
export function TabPageHeader({
  title,
  leading,
  trailing,
  selection,
  offsetY,
}: TabPageHeaderProps) {
  const entry = useHeaderEntry('header:title', 20);
  const brandEntry = useEntryMotion('header:brand');
  const transition = useHeaderTransition();
  const { scrollY } = useScroll();
  const reducedMotion = useReducedMotion();
  const scrollAnimation = useRef<ReturnType<typeof animate> | null>(null);
  const [trailingWidth, setTrailingWidth] = useState(0);
  const [leadingWidth, setLeadingWidth] = useState(0);
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
  const branded = !leading && !collapsed && !selection;
  // What sits in the left corner stays over the page's edge while a note pane slides.
  const cornerShift = useHeaderGutterShift(PAGE_MAX);
  const titleShift = useTransform(() => (collapsed ? cornerShift.get() : 0));
  const fittedTitle = useFittedTitle(title);

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
      <motion.header
        data-page-header
        className="fixed top-0 right-[var(--note-pane)] left-0 z-30 pt-[var(--safe-top)]"
        style={{ ...transition, y: offsetY }}
      >
        {/* The controls stay in the page pane; the blur spans the viewport so no split seam shows. */}
        <motion.div
          aria-hidden
          className="page-top-blur header-fade pointer-events-none absolute top-0 right-[calc(-1*var(--note-pane))] left-0 h-[calc(var(--safe-top)+8rem)]"
          initial={false}
          animate={{ '--header-layer-opacity': collapsed ? 1 : 0 }}
          transition={{ duration: 0.2 }}
        />
        <div className="relative mx-auto h-[var(--header-height)] max-w-7xl px-2 sm:px-4">
          {/* Fixed, not in the page: scrolling would carry it under the system status bar. */}
          <motion.div
            className="header-fade pointer-events-none absolute inset-x-3 top-1 sm:inset-x-4"
            style={{ x: cornerShift }}
          >
            <motion.div
              className="origin-left"
              initial={false}
              animate={{ opacity: branded ? 1 : 0, scale: branded ? 1 : 0.85 }}
              transition={branded ? slide : { duration: 0.16 }}
              aria-hidden={!branded}
              style={{ maxWidth: `calc(100% - ${trailingWidth + 8}px)` }}
            >
              <motion.div style={brandEntry}>
                <BrandLockup orientation="horizontal" iconSize={28} />
              </motion.div>
            </motion.div>
          </motion.div>
          <motion.div
            ref={fittedTitle.area}
            className="pointer-events-none absolute inset-x-0 top-1 h-[50px]"
            style={{ x: titleShift, y: titleScrollY }}
          >
            <span
              ref={fittedTitle.measure}
              aria-hidden
              className="invisible absolute w-max whitespace-nowrap font-display font-extrabold text-[42px] leading-none tracking-[-0.03em]"
            >
              {title}
            </span>
            <motion.div
              className="absolute flex h-full max-w-[calc(100%-1.5rem)] items-center rounded-[var(--dock-radius)]"
              initial={false}
              animate={{
                left: collapsed ? '0%' : '50%',
                x: collapsed ? '0%' : '-50%',
                marginLeft: collapsed ? 12 + (leadingWidth > 0 ? leadingWidth + 8 : 0) : 0,
                y: collapsed ? TITLE_COLLAPSE_AT - TITLE_REST_Y : 0,
                fontSize: collapsed ? 17 : fittedTitle.fontSize,
                paddingInline: collapsed ? 14 : 0,
                opacity: selection ? 0 : 1,
              }}
              transition={slide}
            >
              <motion.span
                aria-hidden
                className="glass header-fade absolute inset-0 rounded-[var(--dock-radius)]"
                initial={false}
                animate={{ '--header-layer-opacity': collapsed ? 1 : 0 }}
                transition={slide}
              />
              <motion.h1
                style={entry}
                className="header-fade relative min-w-0 overflow-hidden whitespace-nowrap font-display font-extrabold leading-none tracking-[-0.03em]"
              >
                {title}
              </motion.h1>
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
            leading={leading}
            trailing={trailing}
            selection={selection}
            flat={!collapsed}
            onLeadingWidthChange={setLeadingWidth}
            onTrailingWidthChange={setTrailingWidth}
          />
        </div>
      </motion.header>
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
  onLeadingWidthChange,
  onTrailingWidthChange,
}: {
  leading?: ReactNode;
  trailing?: ReactNode;
  selection?: HeaderSelection | null;
  flat?: boolean;
  onLeadingWidthChange?: (width: number) => void;
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
      <HeaderToolbar side="left" mode={mode} glass={glass} onWidthChange={onLeadingWidthChange}>
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
  const entry = useHeaderEntry(`header:controls:${side}`);
  const cornerShift = useHeaderGutterShift(PAGE_MAX);
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
        'absolute top-1 h-[50px] rounded-[var(--dock-radius)]',
        side === 'left' ? 'left-3 origin-left sm:left-4' : 'right-3 origin-right sm:right-4',
      )}
      style={{ width, x: side === 'left' ? cornerShift : 0 }}
      // No filter here: it would stop the glass from blurring the page behind it.
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.85, transition: { duration: 0.16 } }}
      transition={springs.smooth}
    >
      <motion.span
        aria-hidden
        className="glass header-fade absolute inset-0 rounded-[var(--dock-radius)]"
        initial={false}
        animate={{ '--header-layer-opacity': glass ? 1 : 0 }}
        transition={{ ...springs.smooth, visualDuration: 0.3 }}
      />
      {/* Clip changing controls separately so the glass surface keeps its outer shadow. */}
      <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
        <AnimatePresence initial={false}>
          <motion.div
            key={mode}
            ref={measure}
            style={entry}
            className={cn(
              'header-fade absolute inset-y-0 flex items-center p-1',
              side === 'left' ? 'left-0 origin-left' : 'right-0 origin-right',
            )}
            initial={{ '--header-layer-opacity': 0, scale: 0.85, filter: 'blur(4px)' }}
            animate={{ '--header-layer-opacity': 1, scale: 1, filter: 'blur(0px)' }}
            exit={{
              '--header-layer-opacity': 0,
              scale: 0.85,
              filter: 'blur(4px)',
              transition: { duration: 0.14 },
            }}
            transition={springs.smooth}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
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
