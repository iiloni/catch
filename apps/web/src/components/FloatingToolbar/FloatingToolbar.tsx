import { animate, motion, useIsPresent, useMotionValue, useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const instant = { duration: 0 };

/**
 * A small glass toolbar that slides in from an edge of the screen and back out to it. Render
 * it inside `AnimatePresence`. From a side it floats over the note, above the dock.
 */
export function FloatingToolbar({
  label,
  from,
  className,
  children,
}: {
  label: string;
  from: 'top' | 'left' | 'right';
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const isPresent = useIsPresent();
  const offset = useRef(0);
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const transition = reducedMotion ? instant : springs.smooth;
  const sideways = from !== 'top';

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || reducedMotion) return;
    if (from === 'right') offset.current = window.innerWidth - rect.left + 12;
    else if (from === 'left') offset.current = -rect.right - 12;
    else offset.current = -rect.bottom - 12;
    (sideways ? x : y).jump(offset.current);
  }, [from, sideways, reducedMotion, x, y]);

  useEffect(() => {
    // Presence can return before exit finishes; restart the slide in that case too.
    if (!isPresent) return;
    const slide = animate(sideways ? x : y, 0, transition);
    return () => slide.stop();
  }, [isPresent, sideways, x, y, transition]);

  return (
    <div
      ref={ref}
      inert={!isPresent}
      role="toolbar"
      aria-label={label}
      // Reserve the final footprint for caret scrolling throughout the entrance animation.
      data-note-toolbar={sideways ? '' : undefined}
      className={cn('shrink-0', className)}
    >
      <motion.div
        className="glass flex rounded-[var(--dock-radius)] p-1"
        style={{ x, y }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        variants={{
          hidden: () => ({
            opacity: 0,
            x: reducedMotion || !sideways ? 0 : offset.current,
            y: reducedMotion || sideways ? 0 : offset.current,
          }),
        }}
        exit="hidden"
        transition={transition}
      >
        {children}
      </motion.div>
    </div>
  );
}
