import { AnimatePresence, motion, useDragControls } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { type ReactNode, useEffect, useRef } from 'react';
import { useBackHandler } from '@/lib/backButton';
import { keyboardHeight } from '@/lib/keyboard';
import { springs } from '@/lib/motion';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  dragHandleOnly?: boolean;
};

/** A frosted sheet that slides up from the bottom and is swiped down to dismiss. */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  children,
  dragHandleOnly = false,
}: Props) {
  useBackHandler(open, () => onOpenChange(false));
  const dragControls = useDragControls();
  const scrollArea = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let frame = 0;
    const off = keyboardHeight.on('change', () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const area = scrollArea.current;
        const focused = document.activeElement;
        if (!area || !(focused instanceof HTMLElement) || !area.contains(focused)) return;
        const bounds = area.getBoundingClientRect();
        const field = focused.getBoundingClientRect();
        if (field.bottom > bounds.bottom - 8) area.scrollTop += field.bottom - bounds.bottom + 8;
        else if (field.top < bounds.top + 8) area.scrollTop -= bounds.top + 8 - field.top;
      });
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <AnimatePresence>
        {open && (
          <DialogPrimitive.Portal forceMount>
            <DialogPrimitive.Overlay asChild forceMount>
              <motion.div
                className="fixed inset-0 z-50 bg-black/30"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              />
            </DialogPrimitive.Overlay>
            <DialogPrimitive.Content
              asChild
              forceMount
              onOpenAutoFocus={(event) => event.preventDefault()}
            >
              <motion.div
                className="glass-thick fixed inset-x-3 bottom-[calc(var(--keyboard)+max(var(--safe-bottom),0.75rem))] z-50 mx-auto flex max-h-[min(85dvh,calc(100dvh-var(--keyboard)-var(--safe-top)-max(var(--safe-bottom),0.75rem)-1rem))] w-auto max-w-md flex-col rounded-[28px] pb-4 outline-none sm:inset-x-4 sm:bottom-[calc(var(--keyboard)+1rem)]"
                initial={{ y: '110%' }}
                animate={{ y: 0 }}
                exit={{ y: '110%' }}
                transition={springs.smooth}
                drag="y"
                dragControls={dragControls}
                dragListener={!dragHandleOnly}
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 100 || info.velocity.y > 500) onOpenChange(false);
                }}
              >
                <div
                  aria-hidden
                  data-sheet-grip
                  className="flex cursor-grab touch-none justify-center pt-2.5 pb-1 active:cursor-grabbing"
                  onPointerDown={dragHandleOnly ? (event) => dragControls.start(event) : undefined}
                >
                  <span className="h-1 w-9 rounded-full bg-foreground/20" />
                </div>
                <DialogPrimitive.Title className="px-5 pt-1 pb-3 font-display font-semibold text-xl tracking-[-0.01em]">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
                <div ref={scrollArea} className="min-h-0 overflow-y-auto px-4">
                  {children}
                </div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
