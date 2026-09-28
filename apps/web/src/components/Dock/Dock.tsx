import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, Columns3, LayoutGrid, Plus, Search, X } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useIsPresent, useTransform } from 'motion/react';
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { GallerySwitcher, galleryPageAt } from '@/components/GallerySwitcher/GallerySwitcher';
import { NoteDock } from '@/components/NoteDock/NoteDock';
import { useBackHandler } from '@/lib/backButton';
import { lastBrowsingTab, quickNote, searchQuery, type TabPath, tabFor } from '@/lib/dockState';
import { GALLERY_PAGES, type GalleryPage, useGalleryPages } from '@/lib/galleryPages';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { editorProgress } from '@/lib/noteTransition';
import { cn } from '@/lib/utils';

const TABS = [
  { path: '/deck', label: 'Deck', icon: Columns3 },
  { path: '/', label: 'Gallery', icon: LayoutGrid },
  { path: '/search', label: 'Search', icon: Search },
] as const satisfies ReadonlyArray<{ path: TabPath; label: string; icon: unknown }>;

/** Holding the Gallery tab this long opens the Gallery switcher under the finger. */
const HOLD_MS = 380;

function asGalleryPage(pathname: string): GalleryPage | null {
  return GALLERY_PAGES.find((page) => page === pathname) ?? null;
}

/**
 * Floating glass tab bar with a detached compose button. On the Search tab the tabs
 * give way to a search field that fills the whole dock; while a note is open they give way
 * to the note's toolbar (NoteDock).
 */
export function Dock() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const noteOpen = useRouterState({
    select: (state) => Boolean((state.location.search as { note?: string }).note),
  });
  const tab = tabFor(pathname);
  const mode = noteOpen ? 'note' : tab === '/search' ? 'search' : 'tabs';
  const inputRef = useRef<HTMLInputElement>(null);
  // Above the editor while it is open or animating, below sheets and menus otherwise.
  const zIndex = useTransform(editorProgress, (progress) => (progress > 0 ? 60 : 40));
  const dockRef = useRef<HTMLDivElement>(null);

  // The Gallery switcher belongs to the page it was opened on, so navigating closes it.
  const [switcherOn, setSwitcherOn] = useState<string | null>(null);
  const [switcherHover, setSwitcherHover] = useState<GalleryPage | null>(null);
  const switcherOpen = switcherOn === pathname && mode === 'tabs';
  const goToGalleryPage = useGalleryPages();
  const setSwitcher = (open: boolean) => setSwitcherOn(open ? pathname : null);

  function selectGalleryPage(page: GalleryPage) {
    haptics.selection();
    setSwitcherOn(null);
    goToGalleryPage(page);
  }

  useBackHandler(switcherOpen, () => setSwitcherOn(null));

  // A tap anywhere outside the dock folds the switcher away.
  useEffect(() => {
    if (!switcherOpen) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!dockRef.current?.contains(event.target as Node)) setSwitcherOn(null);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [switcherOpen]);

  useEffect(() => {
    if (tab !== '/search') lastBrowsingTab.set(tab);
    else quickNote.set('closed');
  }, [tab]);

  return (
    <motion.div
      ref={dockRef}
      data-dock
      style={{ zIndex }}
      className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] flex justify-center px-3"
    >
      <LayoutGroup id="dock">
        {/* Bottom-aligned: the dock grows upward (switcher, palette), the compose button stays. */}
        <div className="pointer-events-auto flex w-full max-w-md items-end">
          <div className="glass relative min-h-[var(--dock-height)] min-w-0 flex-1 rounded-[var(--dock-radius)]">
            <GallerySwitcher
              open={switcherOpen}
              current={asGalleryPage(pathname)}
              hovered={switcherHover}
              onSelect={selectGalleryPage}
            />
            <SearchField inputRef={inputRef} active={mode === 'search'} />
            <AnimatePresence initial={false}>
              {mode === 'tabs' && (
                <Tabs
                  key="tabs"
                  active={tab}
                  // Focusing inside the tap keeps Android willing to raise the keyboard.
                  onSearch={() => inputRef.current?.focus()}
                  switcherOpen={switcherOpen}
                  onSwitcher={setSwitcher}
                  onSwitcherHover={setSwitcherHover}
                  onSwitcherSelect={selectGalleryPage}
                />
              )}
              {mode === 'note' && <NoteDock key="note" />}
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {mode === 'tabs' && <ComposeButton key="compose" />}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </motion.div>
  );
}

type TabsProps = {
  active: TabPath;
  onSearch: () => void;
  switcherOpen: boolean;
  onSwitcher: (open: boolean) => void;
  onSwitcherHover: (page: GalleryPage | null) => void;
  onSwitcherSelect: (page: GalleryPage) => void;
};

function Tabs({
  active,
  onSearch,
  switcherOpen,
  onSwitcher,
  onSwitcherHover,
  onSwitcherSelect,
}: TabsProps) {
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);
  // The tabs linger while they fade out; they must not catch taps meant for the search field.
  const isPresent = useIsPresent();
  // While a finger is down the indicator follows it (scrubbing); `pending` holds the
  // indicator on Search while the dock morphs.
  const [pressed, setPressed] = useState<TabPath | null>(null);
  const [pending, setPending] = useState<TabPath | null>(null);
  const shown = pressed ?? pending ?? active;

  // AnimatePresence brings the same instance back if search closes before the tabs finish
  // leaving, so drop the hold on Search when they return.
  useEffect(() => {
    if (isPresent) setPending(null);
  }, [isPresent]);
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  function tabAt(clientX: number): TabPath {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return active;
    const index = Math.floor(((clientX - box.left) / box.width) * TABS.length);
    return TABS[Math.min(TABS.length - 1, Math.max(0, index))]?.path ?? active;
  }

  // Holding the Gallery tab opens the switcher; the same finger then slides onto a segment
  // and lets go to pick it.
  const hold = useRef<{ timer: number; holding: boolean; page: GalleryPage | null }>({
    timer: 0,
    holding: false,
    page: null,
  });
  useEffect(() => () => window.clearTimeout(hold.current.timer), []);

  function endHold() {
    window.clearTimeout(hold.current.timer);
    hold.current = { timer: 0, holding: false, page: null };
    onSwitcherHover(null);
  }

  function go(path: TabPath) {
    // On a Gallery page, the Gallery tab opens (or folds) the switcher instead.
    if (path === '/' && active === '/') {
      haptics.toggle();
      onSwitcher(!switcherOpen);
      return;
    }
    if (path === '/search') {
      onSearch();
      haptics.toggle();
      setPending(path);
      // Let the indicator land on Search before the tabs give way to the field.
      window.setTimeout(() => void navigate({ to: '/search', replace: true }), 140);
      return;
    }
    if (path !== active) haptics.selection();
    // Tabs replace history, so the back gesture leaves the app instead of cycling tabs.
    if (path !== pathname) void navigate({ to: path, replace: true });
  }

  function onPointerDown(event: PointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    // Suppresses the follow-up mousedown, which would move focus onto the tapped link and
    // take it away from the search field (closing the keyboard it just opened).
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const tab = tabAt(event.clientX);
    setPressed(tab);
    if (tab === '/') {
      hold.current.timer = window.setTimeout(() => {
        hold.current.holding = true;
        haptics.longPress();
        onSwitcher(true);
      }, HOLD_MS);
    }
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!pressed) return;
    if (hold.current.holding) {
      const page = galleryPageAt(event.clientX, event.clientY);
      if (page !== hold.current.page) {
        hold.current.page = page;
        if (page) haptics.selection();
        onSwitcherHover(page);
      }
      return;
    }
    const next = tabAt(event.clientX);
    if (next !== pressed) {
      window.clearTimeout(hold.current.timer);
      haptics.selection();
      setPressed(next);
    }
  }

  function onPointerUp() {
    if (!pressed) return;
    const target = pressed;
    setPressed(null);
    if (hold.current.holding) {
      // Letting go on a segment picks it; anywhere else leaves the switcher open to tap.
      const page = hold.current.page;
      endHold();
      if (page) onSwitcherSelect(page);
      return;
    }
    endHold();
    go(target);
  }

  return (
    <motion.nav
      ref={ref}
      aria-label="Main"
      className="absolute inset-x-0 bottom-0 grid h-[var(--dock-height)] touch-none select-none grid-cols-3 p-1"
      style={{ pointerEvents: isPresent ? undefined : 'none' }}
      initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.92, filter: 'blur(6px)', transition: { duration: 0.16 } }}
      transition={springs.smooth}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => {
        endHold();
        setPressed(null);
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const current = shown === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            aria-label={tab.label}
            aria-current={active === tab.path ? 'page' : undefined}
            // Pointer taps are handled by the nav's pointer events (so scrubbing works);
            // this path is for keyboard activation.
            onClick={(event) => {
              event.preventDefault();
              if (event.detail === 0) go(tab.path);
            }}
            className={cn(
              'relative z-0 flex items-center justify-center rounded-[calc(var(--dock-radius)-0.25rem)] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
              current ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {current && (
              <motion.span
                layoutId="dock-indicator"
                aria-hidden
                className="-z-10 absolute inset-0 rounded-[calc(var(--dock-radius)-0.25rem)] bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                animate={{ scale: pressed ? 1.06 : 1 }}
                transition={springs.snappy}
              />
            )}
            {tab.path === '/search' ? (
              <motion.span layoutId="dock-search-icon" transition={springs.smooth}>
                <Icon className="size-6" aria-hidden />
              </motion.span>
            ) : (
              <motion.span
                animate={{ scale: pressed === tab.path ? 1.12 : 1 }}
                transition={springs.snappy}
              >
                <Icon className="size-6" aria-hidden />
              </motion.span>
            )}
          </Link>
        );
      })}
    </motion.nav>
  );
}

function SearchField({
  inputRef,
  active,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  active: boolean;
}) {
  const navigate = useNavigate();
  const query = searchQuery.use();

  function exit() {
    inputRef.current?.blur();
    haptics.toggle();
    void navigate({ to: lastBrowsingTab.get(), replace: true });
  }

  useBackHandler(active, exit);

  // The input stays mounted (invisible) so tapping the Search tab can focus it at once.
  return (
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 flex h-[var(--dock-height)] items-center gap-2 pr-1.5 pl-4',
        !active && 'pointer-events-none',
      )}
    >
      {active ? (
        <motion.span layoutId="dock-search-icon" transition={springs.smooth}>
          <Search className="size-6 text-muted-foreground" aria-hidden />
        </motion.span>
      ) : (
        <span className="size-6" />
      )}
      <motion.input
        ref={inputRef}
        type="text"
        inputMode="search"
        enterKeyHint="search"
        aria-label="Search notes"
        aria-hidden={!active}
        tabIndex={active ? 0 : -1}
        placeholder="Search notes"
        value={query}
        onChange={(event) => searchQuery.set(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') exit();
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        animate={{ opacity: active ? 1 : 0, x: active ? 0 : 16 }}
        transition={{ ...springs.smooth, delay: active ? 0.08 : 0 }}
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
      <AnimatePresence>
        {active && (
          <motion.button
            key="close"
            type="button"
            aria-label="Close search"
            onClick={exit}
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            whileTap={{ scale: 0.88 }}
            transition={{ ...springs.snappy, delay: 0.1 }}
            className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-[calc(var(--dock-radius)-0.375rem)] bg-foreground/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
          >
            <X className="size-5" aria-hidden />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function ComposeButton() {
  const state = quickNote.use();
  const open = state === 'open';

  return (
    <motion.div
      className="shrink-0"
      initial={{ width: 0, marginLeft: 0, opacity: 0, scale: 0.4 }}
      animate={{ width: 64, marginLeft: 12, opacity: 1, scale: 1 }}
      exit={{ width: 0, marginLeft: 0, opacity: 0, scale: 0.4 }}
      transition={springs.smooth}
    >
      <motion.button
        type="button"
        aria-label={open ? 'Close new note' : 'New note'}
        aria-expanded={open}
        onClick={() => {
          haptics.toggle();
          quickNote.set(open ? 'closed' : 'open');
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(
          'relative flex size-[var(--dock-height)] items-center justify-center rounded-[var(--dock-radius)] outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring/70',
          open ? 'text-foreground' : 'text-brand-foreground',
        )}
      >
        <span aria-hidden className="glass absolute inset-0 rounded-[var(--dock-radius)]" />
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-[var(--dock-radius)] bg-brand shadow-[0_8px_24px_-6px_oklch(0.68_0.11_68/0.55),inset_0_1px_0_oklch(1_0_0/0.45)]"
          animate={{ opacity: open ? 0 : 1, scale: open ? 0.85 : 1 }}
          transition={springs.snappy}
        />
        <AnimatePresence initial={false} mode="popLayout">
          {state === 'saved' ? (
            <motion.span
              key="saved"
              className="relative"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={springs.bouncy}
            >
              <Check className="size-7" strokeWidth={2.5} aria-hidden />
            </motion.span>
          ) : (
            <motion.span
              key="plus"
              className="relative"
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1, rotate: open ? 45 : 0 }}
              exit={{ scale: 0.4, opacity: 0 }}
              transition={springs.bouncy}
            >
              <Plus className="size-7" strokeWidth={2.25} aria-hidden />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </motion.div>
  );
}
