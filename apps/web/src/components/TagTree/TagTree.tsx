import type { Tag } from '@catch/shared';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { springs } from '@/lib/motion';
import { indexTagTree } from '@/lib/tagTreeIndex';
import { cn } from '@/lib/utils';

export function TagTree({
  tags,
  renderTag,
  className,
  searchPosition = 'top',
  searchAccessory,
}: {
  tags: readonly Tag[];
  renderTag: (tag: Tag, path: readonly Tag[]) => ReactNode;
  className?: string;
  searchPosition?: 'top' | 'bottom';
  searchAccessory?: (focused: boolean) => ReactNode;
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const reducedMotion = useReducedMotion();
  const query = search.trim().toLowerCase();
  const index = useMemo(() => indexTagTree(tags), [tags]);
  const largeTree = tags.length > 200;
  const observer = useMemo(
    () => (largeTree && typeof IntersectionObserver !== 'undefined' ? rowObserver() : null),
    [largeTree],
  );
  useEffect(() => () => observer?.disconnect(), [observer]);
  const rows = index.visibleRows(query, collapsed);
  const visibleIds = new Set(rows.map(({ tag }) => tag.id));
  const searchInput = (
    <div
      className={cn(
        'flex h-11 shrink-0 items-center',
        searchPosition === 'bottom' ? 'mt-2' : 'mb-2',
      )}
    >
      <input
        aria-label="Find tags"
        placeholder="Find tags"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onFocus={() => setSearchFocused(true)}
        onBlur={() => setSearchFocused(false)}
        className="h-10 min-w-0 flex-1 rounded-xl border border-border bg-background/40 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
      {searchAccessory?.(searchFocused)}
    </div>
  );
  return (
    <>
      {searchPosition === 'top' && searchInput}
      <ScrollArea className={cn('flex flex-col [--scrollbar-inset:0.25rem]', className)}>
        <ScrollAreaViewport className="h-auto max-h-[inherit] pr-3">
          <AnimatePresence initial={false}>
            {rows.map(({ tag, depth }, rowIndex) => {
              const renderRow = () => {
                const path = index.pathFor(tag.id);
                const hasChildren = index.hasChildren(tag.id);
                const expanded = !collapsed.has(tag.id);
                return (
                  <div
                    className="relative flex min-h-11 items-center gap-1"
                    style={{ paddingLeft: `${Math.min(depth, 8) * 12}px` }}
                  >
                    <span aria-hidden className="pointer-events-none absolute inset-0">
                      {path
                        .slice(0, Math.min(path.length - 1, 8))
                        .map((ancestor, level) =>
                          visibleIds.has(ancestor.id) ? (
                            <span
                              key={ancestor.id}
                              className="absolute inset-y-0 border-l border-foreground/15"
                              style={{ left: `${18 + level * 12}px` }}
                            />
                          ) : null,
                        )}
                    </span>
                    {hasChildren ? (
                      <button
                        type="button"
                        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${tag.name}`}
                        aria-expanded={expanded}
                        onClick={() =>
                          setCollapsed((current) => {
                            const next = new Set(current);
                            if (next.has(tag.id)) next.delete(tag.id);
                            else next.add(tag.id);
                            return next;
                          })
                        }
                        className="flex h-11 w-9 shrink-0 items-center justify-center rounded-lg outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <motion.span
                          className="flex size-4 items-center justify-center"
                          initial={false}
                          animate={{ rotate: expanded ? 90 : 0 }}
                          transition={reducedMotion ? { duration: 0 } : springs.snappy}
                        >
                          <ChevronRight className="size-4" />
                        </motion.span>
                      </button>
                    ) : (
                      <span className="w-9 shrink-0" />
                    )}
                    {renderTag(tag, path)}
                  </div>
                );
              };
              return observer ? (
                <DeferredTagRow
                  key={tag.id}
                  observer={observer}
                  initiallyVisible={rowIndex < 40}
                  reducedMotion={!!reducedMotion}
                  renderRow={renderRow}
                />
              ) : (
                <AnimatedTagRow key={tag.id} reducedMotion={!!reducedMotion}>
                  {renderRow()}
                </AnimatedTagRow>
              );
            })}
            {!rows.length && (
              <AnimatedTagRow key="empty" reducedMotion={!!reducedMotion}>
                <p className="px-2 py-3 text-sm text-muted-foreground">No matching tags</p>
              </AnimatedTagRow>
            )}
          </AnimatePresence>
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
      {searchPosition === 'bottom' && searchInput}
    </>
  );
}

function AnimatedTagRow({
  children,
  reducedMotion,
  animateEntry = true,
}: {
  children: ReactNode;
  reducedMotion: boolean;
  animateEntry?: boolean;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      className="overflow-hidden"
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={animateEntry ? { height: 0, opacity: 0 } : false}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={
        reducedMotion ? { duration: 0 } : { height: springs.smooth, opacity: { duration: 0.16 } }
      }
    >
      {children}
    </motion.div>
  );
}

function rowObserver() {
  const listeners = new Map<Element, (visible: boolean) => void>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: '200px' },
  );
  return {
    subscribe(element: Element, listener: (visible: boolean) => void) {
      listeners.set(element, listener);
      observer.observe(element);
      return () => {
        listeners.delete(element);
        observer.unobserve(element);
      };
    },
    disconnect: () => observer.disconnect(),
  };
}

/** Keep offscreen row height without building its full path, controls or tooltips. */
function DeferredTagRow({
  observer,
  initiallyVisible,
  reducedMotion,
  renderRow,
}: {
  observer: ReturnType<typeof rowObserver>;
  initiallyVisible: boolean;
  reducedMotion: boolean;
  renderRow: () => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const height = useRef(44);
  const [visible, setVisible] = useState(initiallyVisible);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    return observer.subscribe(element, (visible) => {
      // Keep a focused row mounted even if its controls scroll out of view.
      setVisible(visible || element.contains(document.activeElement));
    });
  }, [observer]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!visible || !element) return;
    const measure = () => {
      height.current = element.getBoundingClientRect().height || height.current;
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(element);
    return () => resize.disconnect();
  }, [visible]);
  return (
    <div ref={ref} style={visible ? undefined : { height: height.current }}>
      {visible && (
        <AnimatedTagRow reducedMotion={reducedMotion} animateEntry={initiallyVisible}>
          {renderRow()}
        </AnimatedTagRow>
      )}
    </div>
  );
}
