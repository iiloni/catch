import { ScrollArea as ScrollAreaPrimitive } from 'radix-ui';
import type * as React from 'react';
import { cn } from '@/lib/utils';

function ScrollArea({
  className,
  type = 'auto',
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Root>) {
  return (
    <ScrollAreaPrimitive.Root
      data-slot="scroll-area"
      type={type}
      className={cn('relative min-h-0 min-w-0', className)}
      {...props}
    />
  );
}

function ScrollAreaViewport({
  className,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.Viewport>) {
  return (
    <ScrollAreaPrimitive.Viewport
      data-slot="scroll-area-viewport"
      // Replace Radix's table wrapper so text wraps and short notes can fill the card.
      className={cn(
        'size-full rounded-[inherit] overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring [&>div]:min-h-full [&>div]:flex-col [&>div]:!flex',
        className,
      )}
      {...props}
    />
  );
}

function ScrollBar({
  className,
  orientation = 'vertical',
  style,
  onMouseDown,
  ...props
}: React.ComponentProps<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>) {
  return (
    <ScrollAreaPrimitive.ScrollAreaScrollbar
      data-slot="scroll-area-scrollbar"
      orientation={orientation}
      className={cn(
        'group flex touch-none select-none p-[3px]',
        orientation === 'vertical' ? 'w-3' : 'h-3 flex-col',
        className,
      )}
      style={{
        ...(orientation === 'vertical'
          ? {
              top: 'var(--scrollbar-inset, 0px)',
              bottom: 'var(--scrollbar-inset, 0px)',
              right: 'var(--scrollbar-edge, 0px)',
            }
          : {
              left: 'var(--scrollbar-inset, 0px)',
              right: 'var(--scrollbar-inset, 0px)',
              bottom: 'var(--scrollbar-edge, 0px)',
            }),
        ...style,
      }}
      onMouseDown={(event) => {
        // Keep the editor's caret while Radix handles pointer dragging.
        event.preventDefault();
        onMouseDown?.(event);
      }}
      {...props}
    >
      <ScrollAreaPrimitive.ScrollAreaThumb
        data-slot="scroll-area-thumb"
        className="relative flex-1 rounded-full bg-muted-foreground/45 transition-colors group-hover:bg-muted-foreground/65 group-active:bg-muted-foreground/80"
      />
    </ScrollAreaPrimitive.ScrollAreaScrollbar>
  );
}

export { ScrollArea, ScrollAreaViewport, ScrollBar };
