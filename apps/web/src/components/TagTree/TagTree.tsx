import { type Tag, tagPath, tagTree } from '@catch/shared';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function TagTree({
  tags,
  renderTag,
  className,
  searchPosition = 'top',
}: {
  tags: readonly Tag[];
  renderTag: (tag: Tag, path: readonly Tag[]) => ReactNode;
  className?: string;
  searchPosition?: 'top' | 'bottom';
}) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [search, setSearch] = useState('');
  const reducedMotion = useReducedMotion();
  const query = search.trim().toLowerCase();
  const rows = tagTree(tags).filter(({ tag }) =>
    query
      ? tagPath(tags, tag.id).some((ancestor) => ancestor.name.toLowerCase().includes(query))
      : !tagPath(tags, tag.id)
          .slice(0, -1)
          .some((ancestor) => collapsed.has(ancestor.id)),
  );
  const visibleIds = new Set(rows.map(({ tag }) => tag.id));
  const searchInput = (
    <input
      aria-label="Find tags"
      placeholder="Find tags"
      value={search}
      onChange={(event) => setSearch(event.target.value)}
      className={cn(
        'h-10 w-full shrink-0 rounded-xl border border-border bg-background/40 px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring',
        searchPosition === 'bottom' ? 'mt-2' : 'mb-2',
      )}
    />
  );
  return (
    <>
      {searchPosition === 'top' && searchInput}
      <div className={cn('overflow-auto overscroll-contain', className)}>
        <AnimatePresence initial={false}>
          {rows.map(({ tag, depth }) => {
            const path = tagPath(tags, tag.id);
            const hasChildren = tags.some((child) => child.parentId === tag.id);
            const expanded = !collapsed.has(tag.id);
            return (
              <AnimatedTagRow key={tag.id} reducedMotion={!!reducedMotion}>
                <div
                  className="relative flex min-h-11 items-center gap-1"
                  style={{ paddingLeft: `${Math.min(depth, 8) * 12}px` }}
                >
                  <span aria-hidden className="pointer-events-none absolute inset-0">
                    {path
                      .slice(0, -1)
                      .slice(0, 8)
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
              </AnimatedTagRow>
            );
          })}
          {!rows.length && (
            <AnimatedTagRow key="empty" reducedMotion={!!reducedMotion}>
              <p className="px-2 py-3 text-sm text-muted-foreground">No matching tags</p>
            </AnimatedTagRow>
          )}
        </AnimatePresence>
      </div>
      {searchPosition === 'bottom' && searchInput}
    </>
  );
}

function AnimatedTagRow({
  children,
  reducedMotion,
}: {
  children: ReactNode;
  reducedMotion: boolean;
}) {
  const isPresent = useIsPresent();
  return (
    <motion.div
      className="overflow-hidden"
      inert={!isPresent}
      aria-hidden={!isPresent}
      initial={{ height: 0, opacity: 0 }}
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
