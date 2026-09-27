import '@blocknote/shadcn/style.css';
import type { PartialBlock } from '@blocknote/core';
import { en } from '@blocknote/core/locales';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { Note } from '@catch/shared';
import { useEffect } from 'react';
import { useResolvedTheme } from '@/lib/theme';
import { cn } from '@/lib/utils';

/** New notes start with an empty heading that acts as the title. */
const EMPTY_NOTE: PartialBlock[] = [{ type: 'heading', props: { level: 3 }, content: [] }];

type Props = {
  initialContent?: Note['content'];
  onChange?: (content: Note['content']) => void;
  editable?: boolean;
  autoFocus?: boolean;
  className?: string;
};

/**
 * BlockNote editor for a note. Content is read once on mount; remount with a
 * `key` to load a different note.
 */
export function NoteEditor({
  initialContent,
  onChange,
  editable = true,
  autoFocus = false,
  className,
}: Props) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    // Stored content is BlockNote JSON validated as plain records by the schema.
    initialContent: initialContent?.length ? (initialContent as PartialBlock[]) : EMPTY_NOTE,
    trailingBlock: false,
    dictionary: {
      ...en,
      placeholders: { ...en.placeholders, heading: 'Title', default: 'Take a note…' },
    },
  });

  useEffect(() => {
    if (autoFocus) editor.focus();
  }, [autoFocus, editor]);

  return (
    <BlockNoteView
      editor={editor}
      editable={editable}
      theme={theme}
      className={cn('note-editor', className)}
      onChange={() => onChange?.(editor.document as unknown as Note['content'])}
    />
  );
}
