import { ArrowDown } from 'lucide-react';
import { AnimatePresence } from 'motion/react';
import { FloatingToolbar } from '@/components/FloatingToolbar/FloatingToolbar';
import { IconButton } from '@/components/IconButton/IconButton';
import { editorScrollToBottom } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';

/**
 * Jumps to the end of the open note, shown while its end is well out of view. `hidden` slides
 * it away for something that takes its place.
 */
export function ScrollToBottom({
  hidden = false,
  className,
}: {
  hidden?: boolean;
  className?: string;
}) {
  const scrollToBottom = editorScrollToBottom.use();

  return (
    <AnimatePresence>
      {scrollToBottom && !hidden && (
        <FloatingToolbar key="scroll" label="Scroll" from="right" className={className}>
          <IconButton
            label="Scroll to bottom"
            // Keep the selection and virtual keyboard while jumping down the note.
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              haptics.selection();
              scrollToBottom();
            }}
            className="size-11 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-5"
          >
            <ArrowDown />
          </IconButton>
        </FloatingToolbar>
      )}
    </AnimatePresence>
  );
}
