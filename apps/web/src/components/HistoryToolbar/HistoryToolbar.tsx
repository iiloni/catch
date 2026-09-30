import { Redo2, Undo2 } from 'lucide-react';
import {
  AnimatePresence,
  animate,
  motion,
  useIsPresent,
  useMotionValue,
  useReducedMotion,
} from 'motion/react';
import { type ReactNode, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { IconButton } from '@/components/IconButton/IconButton';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { cn } from '@/lib/utils';

const noSubscribe = () => () => {};
const noState = () => null;
const instant = { duration: 0 };

/** Keep the centered sync pill clear of the back, history and trash controls. */
export const HISTORY_HEADER_MIN_WIDTH = 480;

export function HistoryToolbar({
  controls,
  floating = false,
  className,
}: {
  controls: EditorControls | null;
  floating?: boolean;
  className?: string;
}) {
  const state = useSyncExternalStore(
    controls?.subscribe ?? noSubscribe,
    controls?.getState ?? noState,
  );

  return (
    <AnimatePresence>
      {state && (state.canUndo || state.canRedo) && (
        <ToolbarSurface key="history" floating={floating} className={className}>
          {[
            { label: 'Undo', icon: Undo2, enabled: state.canUndo, run: controls?.undo },
            { label: 'Redo', icon: Redo2, enabled: state.canRedo, run: controls?.redo },
          ].map(({ label, icon: Icon, enabled, run }) => (
            <IconButton
              key={label}
              label={label}
              disabled={!enabled}
              // Keep the selection and virtual keyboard while tapping history controls.
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => {
                haptics.selection();
                run?.();
              }}
              className="size-11 rounded-[calc(var(--dock-radius)-0.25rem)] sm:size-10 [&_svg]:size-5"
            >
              <Icon />
            </IconButton>
          ))}
        </ToolbarSurface>
      )}
    </AnimatePresence>
  );
}

function ToolbarSurface({
  floating,
  className,
  children,
}: {
  floating: boolean;
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

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || reducedMotion) return;
    offset.current = floating ? window.innerWidth - rect.left + 12 : -rect.bottom - 12;
    (floating ? x : y).jump(offset.current);
  }, [floating, reducedMotion, x, y]);

  useEffect(() => {
    const slide = animate(floating ? x : y, 0, transition);
    return () => slide.stop();
  }, [floating, x, y, transition]);

  return (
    <div
      ref={ref}
      inert={!isPresent}
      role="toolbar"
      aria-label="Undo and redo"
      // Reserve the final footprint for caret scrolling throughout the entrance animation.
      data-note-toolbar={floating ? '' : undefined}
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
            x: reducedMotion || !floating ? 0 : offset.current,
            y: reducedMotion || floating ? 0 : offset.current,
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
