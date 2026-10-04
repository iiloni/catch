import { motion, useReducedMotion } from 'motion/react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

export function AnimatedHeight({
  children,
  anchor = 'bottom',
  follow = false,
}: {
  children: ReactNode;
  anchor?: 'top' | 'bottom';
  /**
   * Takes the content's height as it is rather than springing to it, for while something
   * inside is animating its own height: two springs chasing each other fall out of step.
   */
  follow?: boolean;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  const reducedMotion = useReducedMotion();
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || typeof ResizeObserver === 'undefined') return;
    const measure = () => setHeight(content.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={cn(
        'flex flex-col overflow-hidden',
        anchor === 'bottom' ? 'justify-end' : 'justify-start',
      )}
      initial={false}
      animate={{ height: follow ? 'auto' : (height ?? 'auto') }}
      transition={reducedMotion || follow ? { duration: 0 } : springs.smooth}
    >
      <div ref={contentRef} className="shrink-0">
        {children}
      </div>
    </motion.div>
  );
}
