import { Redo2, Undo2 } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { useSyncExternalStore } from 'react';
import { FloatingToolbar } from '@/components/FloatingToolbar/FloatingToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import type { EditorControls } from '@/components/NoteEditor/editorControls';
import { haptics } from '@/lib/haptics';

const noSubscribe = () => () => {};
const noState = () => null;

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
        <FloatingToolbar
          key="history"
          label="Undo and redo"
          from={floating ? 'right' : 'top'}
          className={className}
        >
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
        </FloatingToolbar>
      )}
    </AnimatePresence>
  );
}
