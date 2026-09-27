import { blocksHaveContent, type Note, type NoteColor } from '@catch/shared';
import { useState } from 'react';
import { ColorPicker } from '@/components/ColorPicker/ColorPicker';
import { LazyNoteEditor } from '@/components/NoteEditor/LazyNoteEditor';
import { Button } from '@/components/ui/button';
import { createNote } from '@/lib/notes';

type Props = {
  userId: string;
};

/** "Take a note…" box. The note is created when the composer closes with content. */
export function NoteComposer({ userId }: Props) {
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<Note['content']>([]);
  const [color, setColor] = useState<NoteColor>('default');

  function close() {
    if (blocksHaveContent(content)) createNote({ userId, content, color });
    setOpen(false);
    setContent([]);
    setColor('default');
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mx-auto flex h-12 w-full max-w-xl items-center rounded-lg border bg-card px-4 text-left text-muted-foreground shadow-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        Take a note…
      </button>
    );
  }

  return (
    <section
      aria-label="New note"
      data-note-color={color}
      className="mx-auto w-full max-w-xl rounded-lg border bg-note shadow-md"
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) close();
      }}
    >
      <div className="pt-3">
        <LazyNoteEditor onChange={setContent} autoFocus />
      </div>
      <footer className="flex items-center gap-2 px-3 py-2">
        <ColorPicker value={color} onChange={setColor} />
        <Button variant="ghost" className="ml-auto" onClick={close}>
          Close
        </Button>
      </footer>
    </section>
  );
}
