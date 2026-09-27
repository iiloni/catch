import { Link, useNavigate, useRouterState } from '@tanstack/react-router';
import { Check, Columns3, LayoutGrid, Plus, Search, X } from 'lucide-react';
import { AnimatePresence, LayoutGroup, motion, useTransform } from 'motion/react';
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from 'react';
import { useBackHandler } from '@/lib/backButton';
import { lastBrowsingTab, quickNote, searchQuery, type TabPath, tabFor } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { editorProgress } from '@/lib/noteTransition';
import { cn } from '@/lib/utils';

const TABS = [
  { path: '/', label: 'Gallery', icon: LayoutGrid },
  { path: '/deck', label: 'Deck', icon: Columns3 },
  { path: '/search', label: 'Search', icon: Search },
] as const satisfies ReadonlyArray<{ path: TabPath; label: string; icon: unknown }>;

/**
 * Floating glass tab bar with a detached compose button. On the Search tab the tabs
 * give way to a search field that fills the whole dock.
 */
export function Dock() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const tab = tabFor(pathname);
  const searching = tab === '/search';
  const inputRef = useRef<HTMLInputElement>(null);
  // The dock slides away while a note is open in the editor.
  const y = useTransform(editorProgress, [0, 1], [0, 160]);

  useEffect(() => {
    if (tab !== '/search') lastBrowsingTab.set(tab);
    else quickNote.set('closed');
  }, [tab]);

  return (
    <motion.div
      style={{ y }}
      className="pointer-events-none fixed inset-x-0 bottom-[var(--dock-bottom)] z-40 flex justify-center px-3"
    >
      <LayoutGroup id="dock">
        <div className="pointer-events-auto flex w-full max-w-md items-center">
          <div className="glass relative h-[var(--dock-height)] min-w-0 flex-1 rounded-full">
            <SearchField inputRef={inputRef} active={searching} />
            <AnimatePresence initial={false}>
              {!searching && (
                <Tabs
                  key="tabs"
                  active={tab}
                  // Focusing inside the tap keeps Android willing to raise the keyboard.
                  onSearch={() => inputRef.current?.focus()}
                />
              )}
            </AnimatePresence>
          </div>
          <AnimatePresence initial={false}>
            {!searching && <ComposeButton key="compose" />}
          </AnimatePresence>
        </div>
      </LayoutGroup>
    </motion.div>
  );
}

function Tabs({ active, onSearch }: { active: TabPath; onSearch: () => void }) {
  const navigate = useNavigate();
  const ref = useRef<HTMLElement>(null);
  // While a finger is down the indicator follows it (scrubbing); `pending` holds the
  // indicator on Search while the dock morphs.
  const [pressed, setPressed] = useState<TabPath | null>(null);
  const [pending, setPending] = useState<TabPath | null>(null);
  const shown = pressed ?? pending ?? active;
  const pathname = useRouterState({ select: (state) => state.location.pathname });

  function tabAt(clientX: number): TabPath {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return active;
    const index = Math.floor(((clientX - box.left) / box.width) * TABS.length);
    return TABS[Math.min(TABS.length - 1, Math.max(0, index))]?.path ?? active;
  }

  function go(path: TabPath) {
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
    event.currentTarget.setPointerCapture(event.pointerId);
    setPressed(tabAt(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLElement>) {
    if (!pressed) return;
    const next = tabAt(event.clientX);
    if (next !== pressed) {
      haptics.selection();
      setPressed(next);
    }
  }

  function onPointerUp() {
    if (!pressed) return;
    const target = pressed;
    setPressed(null);
    go(target);
  }

  return (
    <motion.nav
      ref={ref}
      aria-label="Main"
      className="absolute inset-0 grid touch-none select-none grid-cols-3 p-1"
      initial={{ opacity: 0, scale: 0.92, filter: 'blur(6px)' }}
      animate={{ opacity: 1, scale: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, scale: 0.92, filter: 'blur(6px)', transition: { duration: 0.16 } }}
      transition={springs.smooth}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => setPressed(null)}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const current = shown === tab.path;
        return (
          <Link
            key={tab.path}
            to={tab.path}
            aria-current={active === tab.path ? 'page' : undefined}
            // Pointer taps are handled by the nav's pointer events (so scrubbing works);
            // this path is for keyboard activation.
            onClick={(event) => {
              event.preventDefault();
              if (event.detail === 0) go(tab.path);
            }}
            className={cn(
              'relative z-0 flex flex-col items-center justify-center gap-0.5 rounded-full font-medium text-[11px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
              current ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            {current && (
              <motion.span
                layoutId="dock-indicator"
                aria-hidden
                className="-z-10 absolute inset-0 rounded-full bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]"
                animate={{ scale: pressed ? 1.06 : 1 }}
                transition={springs.snappy}
              />
            )}
            {tab.path === '/search' ? (
              <motion.span layoutId="dock-search-icon" transition={springs.smooth}>
                <Icon className="size-[22px]" aria-hidden />
              </motion.span>
            ) : (
              <motion.span
                animate={{ scale: pressed === tab.path ? 1.12 : 1 }}
                transition={springs.snappy}
              >
                <Icon className="size-[22px]" aria-hidden />
              </motion.span>
            )}
            {tab.label}
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
        'absolute inset-0 flex items-center gap-2 pr-1.5 pl-4',
        !active && 'pointer-events-none',
      )}
    >
      {active ? (
        <motion.span layoutId="dock-search-icon" transition={springs.smooth}>
          <Search className="size-[22px] text-muted-foreground" aria-hidden />
        </motion.span>
      ) : (
        <span className="size-[22px]" />
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
            className="flex size-[3.25rem] shrink-0 items-center justify-center rounded-full bg-foreground/[0.08] outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
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
          'relative flex size-[var(--dock-height)] items-center justify-center rounded-full outline-none transition-colors duration-300 focus-visible:ring-2 focus-visible:ring-ring/70',
          open ? 'text-foreground' : 'text-brand-foreground',
        )}
      >
        <span aria-hidden className="glass absolute inset-0 rounded-full" />
        <motion.span
          aria-hidden
          className="absolute inset-0 rounded-full bg-brand shadow-[0_8px_24px_-6px_oklch(0.7_0.15_84/0.6),inset_0_1px_0_oklch(1_0_0/0.45)]"
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
