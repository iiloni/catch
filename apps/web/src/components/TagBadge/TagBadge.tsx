import { type Tag, tagPath } from '@catch/shared';
import { X } from 'lucide-react';
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { TagIcon } from '@/components/TagIcon/TagIcon';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function TagBadge({
  tag,
  tags,
  primary = false,
  interactive = true,
  morph = false,
  onRemove,
}: {
  tag: Tag;
  tags: readonly Tag[];
  primary?: boolean;
  interactive?: boolean;
  morph?: boolean;
  onRemove?: () => void;
}) {
  const path = tagPath(tags, tag.id);
  const root = path[0] ?? tag;
  const [open, setOpen] = useState(false);
  const reducedMotion = useReducedMotion();
  const width = useMotionValue<number | 'auto'>('auto');
  const measureRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const measurement = measureRef.current;
    const badge = measurement?.parentElement;
    if (!morph || !measurement || !badge) return;
    const measure = () => {
      const style = getComputedStyle(badge);
      // offsetWidth rounds away fractions that can make the label show an ellipsis.
      const contentWidth =
        Number.parseFloat(getComputedStyle(measurement).width) || measurement.offsetWidth;
      const next = Math.ceil(
        contentWidth +
          (Number.parseFloat(style.paddingLeft) || 0) +
          (Number.parseFloat(style.paddingRight) || 0) +
          (Number.parseFloat(style.borderLeftWidth) || 0) +
          (Number.parseFloat(style.borderRightWidth) || 0),
      );
      if (width.get() === 'auto' || reducedMotion) width.jump(next);
      else animate(width, next, springs.smooth);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(measurement);
    return () => observer.disconnect();
  }, [morph, reducedMotion, width]);
  const label = path.map((item) => item.name).join(' / ');
  const contents = (
    <>
      <TagIcon name={root.icon} className="size-3.5 shrink-0" />
      <span className="truncate">{tag.name}</span>
    </>
  );
  const className = cn(
    'glass-badge relative inline-flex max-w-full items-center gap-1 overflow-hidden rounded-md px-2.5 py-1 text-xs font-medium',
    root.color && '[--badge-glass:color-mix(in_oklab,var(--note-bg)_70%,transparent)]',
    primary && 'border-foreground/25 font-semibold',
    morph && !reducedMotion && 'transition-colors duration-300',
  );
  const badgeContents = morph ? (
    <>
      <span
        ref={measureRef}
        aria-hidden
        className="invisible absolute flex w-max items-center gap-1"
      >
        {contents}
      </span>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          key={`${tag.id}:${tag.name}:${root.icon}`}
          className="flex min-w-0 items-center gap-1"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.16 }}
        >
          {contents}
        </motion.span>
      </AnimatePresence>
    </>
  ) : (
    contents
  );
  if (!interactive)
    return (
      <motion.span
        data-note-color={root.color ?? 'default'}
        className={className}
        style={morph ? { width } : undefined}
        title={label}
      >
        {badgeContents}
      </motion.span>
    );
  const trigger = (
    <TooltipTrigger asChild>
      <motion.button
        type="button"
        data-note-color={root.color ?? 'default'}
        className={cn(
          onRemove
            ? 'flex min-w-0 items-center gap-1 self-stretch rounded-l-md py-1 pl-2.5'
            : className,
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          onRemove && 'focus-visible:ring-inset',
        )}
        style={morph ? { width } : undefined}
        aria-label={label}
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        {badgeContents}
      </motion.button>
    </TooltipTrigger>
  );
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      {onRemove ? (
        <span
          data-note-color={root.color ?? 'default'}
          className={cn(className, 'min-h-9 gap-0 p-0')}
        >
          {trigger}
          <button
            type="button"
            aria-label={`Remove ${tag.name} filter`}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.stopPropagation();
              onRemove();
            }}
            className="flex size-9 shrink-0 items-center justify-center rounded-r-md outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </span>
      ) : (
        trigger
      )}
      <TooltipContent
        variant="glass"
        data-note-color={root.color ?? 'default'}
        sideOffset={8}
        className={cn(
          'z-[70] max-w-[min(24rem,calc(100vw-2rem))] break-words',
          root.color ? 'border-note!' : 'border-foreground/20!',
        )}
        onEscapeKeyDown={(event) => event.stopPropagation()}
      >
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
