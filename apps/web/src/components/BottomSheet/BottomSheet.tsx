import { AnimatePresence, motion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import type { ReactNode } from 'react';
import { useBackHandler } from '@/lib/backButton';
import { springs } from '@/lib/motion';

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
};

/** A frosted sheet that slides up from the bottom and is swiped down to dismiss. */
export function BottomSheet({ open, onOpenChange, title, children }: Props) {
  useBackHandler(open, () => onOpenChange(false));

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
                className="glass-thick fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] w-full max-w-md flex-col rounded-t-[28px] border-b-0 pb-[calc(var(--safe-bottom)+1rem)] outline-none sm:bottom-4 sm:rounded-[28px] sm:border-b"
                initial={{ y: '110%' }}
                animate={{ y: 0 }}
                exit={{ y: '110%' }}
                transition={springs.smooth}
                drag="y"
                dragConstraints={{ top: 0, bottom: 0 }}
                dragElastic={{ top: 0, bottom: 0.6 }}
                onDragEnd={(_, info) => {
                  if (info.offset.y > 100 || info.velocity.y > 500) onOpenChange(false);
                }}
              >
                <div aria-hidden className="flex justify-center pt-2.5 pb-1">
                  <span className="h-1 w-9 rounded-full bg-foreground/20" />
                </div>
                <DialogPrimitive.Title className="px-5 pt-1 pb-3 font-display font-semibold text-xl tracking-[-0.01em]">
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="sr-only">
                  {title}
                </DialogPrimitive.Description>
                <div className="min-h-0 overflow-y-auto px-4">{children}</div>
              </motion.div>
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        )}
      </AnimatePresence>
    </DialogPrimitive.Root>
  );
}
