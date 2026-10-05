import { AnimatePresence, motion } from 'motion/react';
import { LinkUnderlay } from '@/components/LinkUnderlay/LinkUnderlay';
import { editorNote, noteDockPanelOpen } from '@/lib/dockState';
import { useKeyboardOpen } from '@/lib/keyboard';
import { editorLinksInView, linkOverlay, openLinkOverlay, useNoteLinks } from '@/lib/linkPreviews';
import { springs } from '@/lib/motion';

const NO_NOTE = { content: [], hiddenLinks: [] };

function useNoteLinkTray() {
  const note = editorNote.use();
  const inView = editorLinksInView.use() === note?.id;
  const grown = noteDockPanelOpen.use();
  const keyboardOpen = useKeyboardOpen();
  // The list it opens slides up from behind the dock in its place.
  const listOpen = linkOverlay.use() !== null;
  const links = useNoteLinks(note ?? NO_NOTE);
  const shown =
    note !== null && links.length > 0 && !inView && !grown && !keyboardOpen && !listOpen;
  return { note, links, shown };
}

/** Whether the tray is peeking above the dock, so what floats there can sit above it. */
export function useNoteLinkTrayShown() {
  return useNoteLinkTray().shown;
}

/**
 * A tray tucked behind the open note's dock that names its links while the cards under the
 * note are out of view, and opens them as an overlay. It stays out of the way while typing
 * while the dock has grown into its palette or columns, and while its list is open.
 */
export function NoteLinkTray() {
  const { note, links, shown } = useNoteLinkTray();

  return (
    <AnimatePresence initial={false}>
      {note && shown && (
        // Fade the glass button itself; opacity on this wrapper would cut off its backdrop.
        <motion.div
          key="tray"
          className="-z-10 absolute inset-x-0 bottom-[calc(100%-0.75rem)] flex flex-col"
          initial={{ y: 56 }}
          animate={{ y: 0 }}
          exit={{ y: 56 }}
          transition={springs.smooth}
        >
          <LinkUnderlay
            variant="dock"
            links={links}
            onOpen={() => openLinkOverlay(note.id, true)}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
