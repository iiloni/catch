import { useRouter, useRouterState } from '@tanstack/react-router';
import {
  animate,
  type MotionValue,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from 'motion/react';
import {
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { pageSwipePosition, TAB_PATHS, type TabPath } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { PageSurface } from '@/lib/pageSurface';
import { swipeDestination, usePageSwipe } from '@/lib/pageSwipe';

const loadPages = {
  '/deck': () => import('@/routes/_app/-pages/DeckPage'),
  '/': () => import('@/routes/_app/-pages/GalleryPage'),
  '/search': () => import('@/routes/_app/-pages/SearchPage'),
};
const loaded: Partial<Record<TabPath, ComponentType>> = {};
const loading = new Map<TabPath, Promise<{ default: ComponentType }>>();
function loadPage(page: TabPath) {
  let promise = loading.get(page);
  if (!promise) {
    promise = loadPages[page]().then((module) => {
      loaded[page] = module.default;
      return module;
    });
    loading.set(page, promise);
    void promise.catch(() => loading.delete(page));
  }
  return promise;
}
const pages = {
  '/deck': lazy(() => loadPage('/deck')),
  '/': lazy(() => loadPage('/')),
  '/search': lazy(() => loadPage('/search')),
};

function mainPage(path: string): TabPath | null {
  return TAB_PATHS.find((page) => page === path) ?? null;
}

/** The pages besides `active` that some part of the screen shows at this position. */
function visiblePages(position: number, active: TabPath) {
  return TAB_PATHS.filter((page, index) => page !== active && Math.abs(index - position) < 1);
}

/**
 * Live pages track the finger. A released swipe changes the URL at once and the spring
 * finishes on the new route, so the next touch already belongs to the page it is heading to.
 */
export function MainPagePager({ enabled, children }: { enabled: boolean; children: ReactNode }) {
  const router = useRouter();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const active = mainPage(pathname);
  const surface = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const index = active ? TAB_PATHS.indexOf(active) : 1;
  const position = useMotionValue(index);
  const viewport = useMotionValue(window.innerWidth);
  const scrollY = useMotionValue(window.scrollY);
  const scrolls = useRef(new Map<TabPath, number>());
  const [incoming, setIncoming] = useState<readonly TabPath[]>([]);
  const neighbours = useRef<readonly TabPath[]>([]);
  const animation = useRef<ReturnType<typeof animate> | null>(null);
  const dragOrigin = useRef(index);
  const generation = useRef(0);
  // The route a released swipe asked for, until the router renders it.
  const committed = useRef<TabPath | null>(null);
  const moving = useRef(false);

  const showIncoming = useCallback((pages: readonly TabPath[]) => {
    neighbours.current = pages;
    setIncoming(pages);
  }, []);
  const clearIncoming = useCallback(() => showIncoming([]), [showIncoming]);

  const releaseDock = useCallback(() => {
    if (pageSwipePosition.get() === position) pageSwipePosition.set(null);
  }, [position]);

  // Fetch and parse the small page chunks ahead of the first touch without mounting
  // hidden subscriptions, grids or headers. Only the incoming page mounts during a drag.
  useEffect(() => {
    if (!active) return;
    for (const page of TAB_PATHS) void loadPage(page).catch(() => {});
  }, [active]);

  useEffect(() => {
    const update = () => scrollY.set(window.scrollY);
    const resize = () => {
      generation.current++;
      moving.current = false;
      animation.current?.stop();
      position.set(index);
      releaseDock();
      viewport.set(window.innerWidth);
      clearIncoming();
    };
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('scroll', update);
      window.removeEventListener('resize', resize);
    };
  }, [index, position, viewport, scrollY, clearIncoming, releaseDock]);

  useEffect(() => {
    const stopSaving = router.subscribe('onBeforeLoad', ({ fromLocation, pathChanged }) => {
      const from = fromLocation && mainPage(fromLocation.pathname);
      if (pathChanged && from) scrolls.current.set(from, window.scrollY);
    });
    const stopRestoring = router.subscribe('onRendered', ({ toLocation, pathChanged }) => {
      const to = mainPage(toLocation.pathname);
      if (!pathChanged || !to) return;
      // Follow the router's scroll reset before paint, including Back from another page.
      queueMicrotask(() => {
        window.scrollTo({ top: scrolls.current.get(to) ?? 0, behavior: 'instant' });
        scrollY.set(window.scrollY);
      });
    });
    return () => {
      stopSaving();
      stopRestoring();
    };
  }, [router, scrollY]);

  useLayoutEffect(() => {
    const swiped = active !== null && committed.current === active;
    committed.current = null;
    if (swiped && moving.current) {
      // The page left by the swipe stays mounted, inert, until the spring carries it away.
      showIncoming(visiblePages(position.get(), active));
    } else {
      generation.current++;
      moving.current = false;
      animation.current?.stop();
      position.set(index);
      releaseDock();
      clearIncoming();
    }
    if (active) {
      window.scrollTo({ top: scrolls.current.get(active) ?? 0, behavior: 'instant' });
      scrollY.set(window.scrollY);
    }
  }, [active, index, position, scrollY, clearIncoming, showIncoming, releaseDock]);

  useLayoutEffect(() => {
    if (enabled) return;
    generation.current++;
    moving.current = false;
    animation.current?.stop();
    position.set(index);
    releaseDock();
    clearIncoming();
  }, [enabled, index, position, clearIncoming, releaseDock]);

  useEffect(
    () => () => {
      generation.current++;
      animation.current?.stop();
      releaseDock();
    },
    [releaseDock],
  );

  function move(delta: number) {
    const next = Math.max(
      Math.max(0, index - 1),
      Math.min(TAB_PATHS.length - 1, index + 1, dragOrigin.current - delta / viewport.get()),
    );
    position.set(reducedMotion ? index : next);
    if (reducedMotion || !active) return;
    // Keep what is mounted while the finger rests over the current page alone.
    const visible = visiblePages(next, active);
    if (visible.length > 0 && visible.join() !== neighbours.current.join()) showIncoming(visible);
  }

  function settle(cancelled: boolean, velocity: number, delta: number) {
    if (!active) return;
    const width = viewport.get();
    // Judge this touch by its own travel: one that catches a settling page moves on from
    // the page it was heading to, and one that barely moves lets it arrive.
    const to = cancelled ? null : swipeDestination(active, delta, width, velocity);
    const target = to ? TAB_PATHS.indexOf(to) : index;
    const token = ++generation.current;
    const finish = () => {
      if (token !== generation.current) return;
      moving.current = false;
      // A route still on its way tidies up as it renders.
      if (committed.current) return;
      clearIncoming();
      releaseDock();
    };
    animation.current?.stop();
    moving.current = true;
    if (to) {
      (document.activeElement as HTMLElement | null)?.blur();
      haptics.selection();
      committed.current = to;
      // Mount both pages across the route change, whichever one the router calls active.
      showIncoming([to, ...visiblePages(position.get(), to)]);
      void router.navigate({ to, replace: true, resetScroll: false, viewTransition: false });
    }
    if (reducedMotion) {
      position.set(target);
      finish();
    } else {
      animation.current = animate(position, target, {
        ...springs.pane,
        velocity: (-velocity * 1000) / width,
        onComplete: finish,
      });
    }
  }

  usePageSwipe(surface, enabled ? active : null, {
    onStart: () => {
      generation.current++;
      moving.current = true;
      animation.current?.stop();
      dragOrigin.current = position.get();
      if (!reducedMotion) pageSwipePosition.set(position);
    },
    onMove: move,
    onEnd: settle,
  });

  if (!active) return children;
  return (
    <div ref={surface} data-page-pager className="relative min-h-[calc(100dvh-var(--dock-space))]">
      {TAB_PATHS.filter((page) => page === active || incoming.includes(page)).map((page) => (
        <PagerPage
          key={page}
          page={page}
          active={page === active}
          position={position}
          viewport={viewport}
          liveScroll={scrollY}
          savedScroll={scrolls.current.get(page) ?? 0}
        />
      ))}
    </div>
  );
}

function PagerPage({
  page,
  active,
  position,
  viewport,
  liveScroll,
  savedScroll,
}: {
  page: TabPath;
  active: boolean;
  position: MotionValue<number>;
  viewport: MotionValue<number>;
  liveScroll: MotionValue<number>;
  savedScroll: number;
}) {
  const [headerHost, setHeaderHost] = useState<HTMLDivElement | null>(null);
  const index = TAB_PATHS.indexOf(page);
  const x = useTransform(() => (index - position.get()) * viewport.get());
  const y = useTransform(() => (active ? 0 : liveScroll.get() - savedScroll));
  const scrollY = useTransform(() => (active ? liveScroll.get() : savedScroll));
  // A prefetched module renders synchronously on the first drag. Keep the chosen
  // component identity when a preview becomes active, preserving its DOM and state.
  const Page = useRef(loaded[page] ?? pages[page]).current;
  return (
    <PageSurface value={{ active, x, scrollY, headerHost }}>
      <div
        data-pager-page={page}
        aria-hidden={!active}
        inert={!active}
        className={active ? 'relative' : 'absolute inset-0 overflow-clip'}
      >
        <div ref={setHeaderHost} />
        <motion.div data-page-content style={{ x, y }}>
          {headerHost && (
            <Suspense fallback={null}>
              <Page />
            </Suspense>
          )}
        </motion.div>
      </div>
    </PageSurface>
  );
}
