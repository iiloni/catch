import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import {
  Check,
  ChevronLeft,
  Columns3,
  LayoutDashboard,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
  SquarePen,
  X,
} from 'lucide-react';
import {
  AnimatePresence,
  animate,
  LayoutGroup,
  type MotionValue,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { GallerySwitcher, galleryPageAt } from '@/components/GallerySwitcher/GallerySwitcher';
import { HistoryToolbar } from '@/components/HistoryToolbar/HistoryToolbar';
import { NoteDock } from '@/components/NoteDock/NoteDock';
import { NoteLinkTray, useNoteLinkTrayShown } from '@/components/NoteLinkTray/NoteLinkTray';
import { ScrollToBottom } from '@/components/ScrollToBottom/ScrollToBottom';
import {
  SettingsTabPicker,
  SettingsTabSelector,
} from '@/components/SettingsTabPicker/SettingsTabPicker';
import { useAdminAccess } from '@/lib/admin';
import { useBackHandler } from '@/lib/backButton';
import {
  editorControls,
  editorNote,
  lastBrowsingTab,
  quickNote,
  quickNoteCanSave,
  searchFilterCount,
  searchFiltersOpen,
  searchQuery,
  type TabPath,
  tabFor,
} from '@/lib/dockState';
import { useEntryMotion } from '@/lib/entryMotion';
import { GALLERY_PAGES, type GalleryPage, useGalleryPages } from '@/lib/galleryPages';
import { haptics } from '@/lib/haptics';
import { useKeyboardOpen } from '@/lib/keyboard';
import { linkCaptureControls } from '@/lib/linkCapture';
import { linkOverlay } from '@/lib/linkPreviews';
import { HOLD_MS } from '@/lib/longPress';
import { curves, springs } from '@/lib/motion';
import { editorProgress } from '@/lib/noteTransition';
import {
  isSettingsPath,
  type SettingsPath,
  settingsTabFor,
  useSettingsNavigation,
  useWideSettings,
} from '@/lib/settings';
import { useSettingsSwipeY } from '@/lib/settingsSwipe';
import { isSharedNote } from '@/lib/sharing';
import { GUTTER, useNotePane } from '@/lib/splitView';
import { cn } from '@/lib/utils';

const TABS = [
  { path: '/deck', label: 'Deck', icon: Columns3 },
  { path: '/', label: 'Gallery', icon: LayoutDashboard },
  { path: '/search', label: 'Search', icon: Search },
] as const satisfies ReadonlyArray<{ path: TabPath; label: string; icon: unknown }>;

function asGalleryPage(pathname: string): GalleryPage | null {
  return GALLERY_PAGES.find((page) => page === pathname) ?? null;
}

/**
 * Floating glass tab bar with a detached compose button. On the Search tab the tabs
 * give way to a search field that fills the whole dock; while a note is open they give way
 * to the note's toolbar (NoteDock). With the note in a pane beside the page, the page keeps
 * its dock and the note gets one of its own. In Settings the tabs become a picker for its
 * pages and the compose button a back button; wide Settings lists its pages itself, so the
 * dock steps aside.
 */
export function Dock() {
  const navigate = useNavigate();
  const isAdmin = useAdminAccess();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const noteOpen = useRouterState({
    select: (state) => Boolean((state.location.search as { note?: string }).note),
  });
  const keyboardOpen = useKeyboardOpen();
  const pane = useNotePane();
  const tab = tabFor(pathname);
  const inSettings = isSettingsPath(pathname);
  const noteState = quickNote.use();
  const capture = linkCaptureControls.use();
  const quickNoteOpen = noteState === 'open' || noteState === 'capture' || Boolean(capture);
  const hidden = useWideSettings() && inSettings && !quickNoteOpen;
  const entry = useEntryMotion('dock', !hidden, 120);
  // A tap changes the dock before the router mounts the page, alongside the keyboard.
  const [searchIntent, setSearchIntent] = useState<{ pathname: string; active: boolean } | null>(
    null,
  );
  // Once navigation arrives, the route owns the dock again, including on a later Back.
  useEffect(() => {
    setSearchIntent((intent) => (intent?.pathname === pathname ? intent : null));
  }, [pathname]);
  const wantsSearch = searchIntent?.pathname === pathname ? searchIntent.active : tab === '/search';
  const mode = quickNoteOpen
    ? 'tabs'
    : noteOpen && !pane.shown
      ? 'note'
      : inSettings
        ? 'settings'
        : wantsSearch
          ? 'search'
          : 'tabs';
  const settingsY = useSettingsSwipeY();
  const dockY = useTransform(() => entry.y.get() + (mode === 'settings' ? settingsY.get() : 0));
  const inputRef = useRef<HTMLInputElement>(null);
  const searchProgress = useMotionValue(mode === 'search' ? 1 : 0);
  const reducedMotion = useReducedMotion();
  const searchActive = mode === 'search';
  useLayoutEffect(() => {
    if (searchProgress.get() === (searchActive ? 1 : 0)) return;
    if (reducedMotion) {
      searchProgress.set(searchActive ? 1 : 0);
      return;
    }
    // The controls are already mounted. Keep time with the keyboard instead of waiting
    // for the destination page to paint or stretching the animation across busy frames.
    const animation = animate(searchProgress, searchActive ? 1 : 0, {
      ...(searchActive ? curves.expand : curves.collapse),
      duration: 0.35,
    });
    return () => animation.stop();
  }, [searchActive, reducedMotion, searchProgress]);

  function openSearch() {
    flushSync(() => setSearchIntent({ pathname, active: true }));
    inputRef.current?.focus();
  }

  function closeSearch() {
    inputRef.current?.blur();
    flushSync(() => setSearchIntent({ pathname, active: false }));
    haptics.toggle();
    void navigate({ to: lastBrowsingTab.get(), replace: true });
  }
  // Above the editor while it is open or animating. Motion keeps writing this value inline,
  // so the quick note overrides it in CSS to keep its close button above the scrim.
  const zIndex = useTransform(editorProgress, (progress) => (progress > 0 ? 60 : 40));
  const dockRef = useRef<HTMLDivElement>(null);

  // The Gallery switcher (or, in Settings, the page picker) belongs to the page it was opened
  // on, so navigating closes it.
  const [switcherOn, setSwitcherOn] = useState<string | null>(null);
  const [switcherHover, setSwitcherHover] = useState<GalleryPage | null>(null);
  const [settingsHover, setSettingsHover] = useState<SettingsPath | null>(null);
  const switcherOpen = switcherOn === pathname && (mode === 'tabs' || mode === 'settings');
  const goToGalleryPage = useGalleryPages();
  const setSwitcher = (open: boolean) => setSwitcherOn(open ? pathname : null);

  function selectGalleryPage(page: GalleryPage) {
    haptics.selection();
    setSwitcherOn(null);
    goToGalleryPage(page);
  }

  const settings = useSettingsNavigation();
  const settingsTab = settingsTabFor(pathname);

  function selectSettingsTab(path: SettingsPath) {
    haptics.selection();
    setSwitcherOn(null);
    settings.select(path);
  }

  useBackHandler(switcherOpen, () => setSwitcherOn(null));

  // The quick note opens where the switcher floats, so it folds the switcher away.
  useEffect(() => {
    if (quickNoteOpen) setSwitcherOn(null);
  }, [quickNoteOpen]);

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
    else if (quickNote.get() !== 'capture') quickNote.set('closed');
  }, [tab]);

  return (
    <>
      <motion.div
        ref={dockRef}
        data-dock
        // Translate the dock without fading its glass's ancestor.
        style={{ zIndex, y: dockY }}
        // Spans the whole width and pads the pane away rather than ending at it: a page
        // transition sizes the dock's snapshot once, as it starts, while a pane closing with
        // the navigation (to Search, say) goes on widening the dock, which would squash it.
        className={cn(
          'pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] flex justify-center overflow-x-clip',
          quickNoteOpen && 'z-[75]!',
          mode === 'note' && keyboardOpen
            ? 'pr-[calc(var(--note-pane)+0.25rem)] pl-1'
            : 'pr-[calc(var(--note-pane)+0.75rem)] pl-3',
        )}
      >
        <LayoutGroup id="dock">
          <AnimatePresence initial={false}>
            {!hidden && (
              // Bottom-aligned: the palette grows the dock upward; the switcher floats above it.
              <motion.div
                key="dock"
                className="pointer-events-auto relative flex w-full max-w-md items-end"
                initial={{ opacity: 0, y: 24 }}
                // The page dock keeps its width and slides as one piece under the
                // viewport-centered quick note, so its controls never reflow separately.
                animate={{
                  opacity: 1,
                  y: 0,
                  x: quickNoteOpen && pane.shown ? pane.noteWidth / 2 : 0,
                }}
                exit={{ opacity: 0, y: 24 }}
                transition={{ ...springs.smooth, bounce: 0 }}
              >
                <GallerySwitcher
                  open={switcherOpen && mode === 'tabs'}
                  current={asGalleryPage(pathname)}
                  hovered={switcherHover}
                  onSelect={selectGalleryPage}
                />
                <SettingsTabPicker
                  isAdmin={isAdmin}
                  open={switcherOpen && mode === 'settings'}
                  current={settingsTab}
                  hovered={settingsHover}
                  onSelect={selectSettingsTab}
                />
                {/* Isolated so the link tray can tuck behind the dock's glass. */}
                <div className="relative isolate min-w-0 flex-1">
                  {mode === 'note' && <NoteLinkTray />}
                  {mode === 'note' && <FloatingNoteToolbars />}
                  <div className="glass relative min-h-[var(--dock-height)] rounded-[var(--dock-radius)]">
                    <SearchField
                      inputRef={inputRef}
                      active={searchActive}
                      visible={mode === 'tabs' || mode === 'search'}
                      progress={searchProgress}
                      onClose={closeSearch}
                    />
                    <AnimatePresence initial={false}>
                      {(mode === 'tabs' || mode === 'search') && (
                        <Tabs
                          key="tabs"
                          active={tab}
                          searchProgress={searchProgress}
                          searchActive={searchActive}
                          // Focusing inside the tap keeps Android willing to raise the keyboard.
                          onSearch={openSearch}
                          switcherOpen={switcherOpen}
                          onSwitcher={setSwitcher}
                          onSwitcherHover={setSwitcherHover}
                          onSwitcherSelect={selectGalleryPage}
                        />
                      )}
                      {mode === 'settings' && (
                        <SettingsTabSelector
                          key="settings"
                          current={settingsTab}
                          open={switcherOpen}
                          onOpenChange={setSwitcher}
                          onHover={setSettingsHover}
                          onSelect={selectSettingsTab}
                          pickerRoot={() => dockRef.current}
                        />
                      )}
                      {mode === 'note' && <NoteDock key="note" />}
                    </AnimatePresence>
                  </div>
                </div>
                <AnimatePresence initial={false}>
                  {(mode === 'tabs' || mode === 'settings' || mode === 'search') && (
                    <DockActionButton
                      key="action"
                      search={searchActive}
                      searchProgress={searchProgress}
                      onCloseSearch={closeSearch}
                      onBack={mode === 'settings' ? settings.leave : undefined}
                    />
                  )}
                </AnimatePresence>
              </motion.div>
            )}
          </AnimatePresence>
        </LayoutGroup>
      </motion.div>
      <AnimatePresence>
        {pane.shown && noteOpen && !quickNoteOpen && (
          <PaneDock key="pane" width={pane.noteWidth} compact={keyboardOpen} />
        )}
      </AnimatePresence>
    </>
  );
}

/** Undo and redo at the dock's left end and the jump to the note's end at its right. */
function FloatingNoteToolbars() {
  const note = editorNote.use();
  const controls = editorControls.use();
  // The link tray peeks 2.75rem above the dock; float above it rather than over its text.
  const place = cn(
    'absolute bottom-full mb-3 transition-transform duration-300 ease-out motion-reduce:transition-none sm:hidden',
    useNoteLinkTrayShown() && '-translate-y-11',
  );
  // The list of links slides up over where these float, so they slide out to their sides.
  const hidden = linkOverlay.use() !== null;

  return (
    <>
      {note && !note.deletedAt && !isSharedNote(note) && (
        <HistoryToolbar
          controls={controls}
          floating
          hidden={hidden}
          className={cn(place, 'left-0')}
        />
      )}
      <ScrollToBottom hidden={hidden} className={cn(place, 'right-0')} />
    </>
  );
}

/**
 * The note's dock under its pane, sliding in and out with it. Not `data-dock`: that name is
 * for the page's dock (the page transition names it), and the editor ignores every
 * interaction outside it in a pane.
 */
function PaneDock({ width, compact }: { width: number; compact: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none fixed bottom-[var(--dock-bottom)] left-[calc(100%-var(--note-pane))] z-[60] flex justify-center overflow-x-clip',
        compact ? 'pr-1' : 'pr-3',
      )}
      style={{ width, paddingLeft: GUTTER + (compact ? 4 : 12) }}
    >
      <div className="pointer-events-auto relative isolate w-full max-w-md">
        <NoteLinkTray />
        <motion.div
          className="glass relative min-h-[var(--dock-height)] rounded-[var(--dock-radius)]"
          initial={false}
          exit={{ opacity: 0 }}
          transition={springs.pane}
        >
          <NoteDock />
        </motion.div>
      </div>
    </div>
  );
}

type TabsProps = {
  active: TabPath;
  searchProgress: MotionValue<number>;
  searchActive: boolean;
  onSearch: () => void;
  switcherOpen: boolean;
  onSwitcher: (open: boolean) => void;
  onSwitcherHover: (page: GalleryPage | null) => void;
  onSwitcherSelect: (page: GalleryPage) => void;
};

function Tabs({
  active,
  searchProgress,
  searchActive,
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
  const opacity = useTransform(searchProgress, [0, 0.35], [1, 0]);
  // While a finger is down the indicator follows it (scrubbing); `pending` holds the
  // indicator on Search while the dock morphs.
  const [pressed, setPressed] = useState<TabPath | null>(null);
  const [pending, setPending] = useState<TabPath | null>(null);
  const shown = pressed ?? pending ?? active;

  // The tabs stay behind the field during the morph, ready for an interrupted close.
  useEffect(() => {
    if (isPresent && !searchActive) setPending(null);
  }, [isPresent, searchActive]);
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
      void navigate({ to: '/search', replace: true });
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

  function onPointerUp(event: PointerEvent<HTMLElement>) {
    if (!pressed) return;
    const target = pressed;
    setPressed(null);
    if (hold.current.holding) {
      // Letting go on a segment picks it; anywhere else leaves the switcher open to tap.
      // Hit-test at release: the last move may have missed or been swallowed by a
      // native drag, so don't rely on it alone.
      const page = galleryPageAt(event.clientX, event.clientY) ?? hold.current.page;
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
      className="absolute inset-0 grid touch-none select-none grid-cols-3 p-1 [-webkit-touch-callout:none]"
      style={{ pointerEvents: isPresent && !searchActive ? undefined : 'none', opacity }}
      inert={!isPresent || searchActive}
      aria-hidden={!isPresent || searchActive}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
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
            draggable={false}
            // Native link dragging hijacks a hold-and-slide gesture (the URL preview
            // in the video) and swallows the pointer moves the switcher needs.
            onDragStart={(event) => event.preventDefault()}
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
              // The field owns one icon throughout the morph, including while it is a tab.
              <span className="size-6" aria-hidden />
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
  visible,
  progress,
  onClose,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  active: boolean;
  visible: boolean;
  progress: MotionValue<number>;
  onClose: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const query = searchQuery.use();
  const fieldRef = useRef<HTMLElement>(null);
  const width = useMotionValue(0);
  useEffect(() => {
    const field = fieldRef.current;
    if (!field) return;
    const measure = () => width.set(field.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(field);
    return () => observer.disconnect();
  }, [width]);
  // Reveal the full-size field from the Search tab's rounded bounds; text never scales.
  const clipPath = useTransform(() => {
    const remaining = 1 - progress.get();
    const left = (4 + ((width.get() - 8) * 2) / 3) * remaining;
    const inset = 4 * remaining;
    return `inset(${inset}px ${inset}px ${inset}px ${left}px round calc(var(--dock-radius) - ${inset}px))`;
  });
  const iconX = useTransform(() => (4 + ((width.get() - 8) * 5) / 6 - 28) * (1 - progress.get()));
  const contentOpacity = useTransform(progress, [0.35, 0.8], [0, 1]);
  const highlightOpacity = useTransform(progress, [0, 0.35, 1], [0, 0.65, 0]);
  useEffect(() => {
    if (!active) searchFiltersOpen.set(false);
  }, [active]);

  function exit(closePanel = true) {
    if (closePanel && searchFiltersOpen.get()) {
      searchFiltersOpen.set(false);
      document.querySelector<HTMLButtonElement>('[data-search-filter-trigger]')?.focus();
      return;
    }
    onClose();
  }

  useBackHandler(active, exit);

  // The input stays mounted (invisible) so tapping the Search tab can focus it at once.
  return (
    <motion.search
      ref={fieldRef}
      aria-hidden={!active}
      style={{ clipPath }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          exit();
        }
      }}
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 flex h-[var(--dock-height)] items-center gap-2 pr-1.5 pl-4',
        !active && 'pointer-events-none',
      )}
    >
      <motion.span
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
        style={{ opacity: highlightOpacity }}
      />
      <motion.span className="relative shrink-0" style={{ x: iconX, opacity: visible ? 1 : 0 }}>
        <Search className="size-6" aria-hidden />
      </motion.span>
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
          if (event.key === 'Enter') event.currentTarget.blur();
        }}
        animate={{ opacity: active ? 1 : 0, x: active ? 0 : 8 }}
        transition={reducedMotion ? { duration: 0 } : { duration: 0.25, delay: active ? 0.1 : 0 }}
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
      />
      <motion.button
        key="close"
        type="button"
        aria-label="Close search"
        onClick={() => exit(false)}
        aria-hidden={!active}
        tabIndex={active ? 0 : -1}
        style={{ opacity: contentOpacity }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-[calc(var(--dock-radius)-0.375rem)] bg-foreground/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
      >
        <X className="size-5" aria-hidden />
      </motion.button>
    </motion.search>
  );
}

/** One surface changes from compose to filters without changing the dock's width. */
function DockActionButton({
  onBack,
  search,
  searchProgress,
  onCloseSearch,
}: {
  onBack?: () => void;
  search: boolean;
  searchProgress: MotionValue<number>;
  onCloseSearch: () => void;
}) {
  const filtersOpen = searchFiltersOpen.use();
  const count = searchFilterCount.use();
  const composeOpacity = useTransform(searchProgress, [0, 1], [1, 0]);
  const composeRotate = useTransform(searchProgress, [0, 1], [0, 45]);
  const filterRotate = useTransform(searchProgress, [0, 1], [-45, 0]);
  const state = quickNote.use();
  const capture = linkCaptureControls.use();
  const hasContent = quickNoteCanSave.use();
  const open = state === 'open';
  const active = open || state === 'capture' || Boolean(capture);
  const canSave = capture ? capture.canSave : open && hasContent;
  const back = onBack !== undefined && !active;
  const gradient = canSave || (!active && !back);
  const label = search
    ? 'Filter notes'
    : back
      ? 'Back'
      : capture
        ? canSave
          ? 'Save link'
          : 'Close link capture'
        : open
          ? canSave
            ? 'Save note'
            : 'Close new note'
          : 'New note';

  const gradientOpacity = useTransform(() => (gradient ? 1 : 0) * (1 - searchProgress.get()));

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
        aria-label={label}
        title={search && count ? `Filter notes (${count} active)` : label}
        data-search-filter-trigger={search ? '' : undefined}
        aria-controls={search ? 'search-filter-panel' : undefined}
        aria-expanded={search ? filtersOpen : back ? undefined : active}
        disabled={!search && (capture?.busy || (state === 'capture' && !capture))}
        onPointerDown={(event) => {
          if (active || search) event.preventDefault();
        }}
        onClick={() => {
          haptics.toggle();
          if (search) {
            searchFiltersOpen.set(!filtersOpen);
          } else if (capture) {
            if (capture.canSave) capture.save();
            else capture.cancel();
          } else if (back) onBack();
          else quickNote.set(open ? 'closed' : 'open');
        }}
        onKeyDown={(event) => {
          if (search && event.key === 'Escape') {
            if (filtersOpen) searchFiltersOpen.set(false);
            else onCloseSearch();
          }
        }}
        whileTap={{ scale: 0.88 }}
        transition={springs.snappy}
        className={cn(
          'relative flex size-[var(--dock-height)] items-center justify-center rounded-[var(--dock-radius)] outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring/70',
          search
            ? filtersOpen || count > 0
              ? 'text-brand'
              : 'text-foreground'
            : gradient
              ? 'text-brand-foreground'
              : 'text-foreground',
          capture?.busy && 'opacity-60',
        )}
      >
        <span aria-hidden className="glass absolute inset-0 rounded-[var(--dock-radius)]" />
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-[var(--dock-radius)] bg-[image:var(--brand-gradient)] shadow-[0_8px_24px_-6px_rgb(213_123_20/0.4),inset_0_1px_0_rgb(255_255_255/0.45)]"
          style={{ opacity: gradientOpacity }}
        />
        <motion.span
          className="relative flex size-7 items-center justify-center"
          style={{ opacity: composeOpacity, rotate: composeRotate }}
          aria-hidden
        >
          <AnimatePresence initial={false} mode="popLayout">
            {capture?.saving ? (
              <motion.span
                key="busy"
                className="relative"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
              >
                <LoaderCircle className="size-7 animate-spin" aria-hidden />
              </motion.span>
            ) : canSave ? (
              <motion.span
                key="save"
                className="relative"
                initial={{ scale: 0.4, opacity: 0, rotate: -45 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.4, opacity: 0, rotate: 45 }}
                transition={springs.snappy}
              >
                <SquarePen className="size-7" strokeWidth={2.25} aria-hidden />
              </motion.span>
            ) : back ? (
              <motion.span
                key="back"
                className="relative"
                initial={{ scale: 0.4, opacity: 0, x: 8 }}
                animate={{ scale: 1, opacity: 1, x: 0 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={springs.bouncy}
              >
                <ChevronLeft className="size-7" strokeWidth={2.25} aria-hidden />
              </motion.span>
            ) : !active && state === 'saved' ? (
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
                animate={{ scale: 1, opacity: 1, rotate: active ? 45 : 0 }}
                exit={{ scale: 0.4, opacity: 0 }}
                transition={springs.bouncy}
              >
                <Plus className="size-7" strokeWidth={2.25} aria-hidden />
              </motion.span>
            )}
          </AnimatePresence>
        </motion.span>
        <motion.span
          aria-hidden
          className="absolute flex size-7 items-center justify-center"
          style={{ opacity: searchProgress, rotate: filterRotate }}
        >
          <SlidersHorizontal className="size-7" strokeWidth={2.25} />
        </motion.span>
        {search && count > 0 && (
          <span aria-hidden className="absolute top-3 right-3 size-1.5 rounded-full bg-brand" />
        )}
      </motion.button>
    </motion.div>
  );
}
