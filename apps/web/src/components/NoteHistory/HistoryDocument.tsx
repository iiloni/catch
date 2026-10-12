import '@blocknote/shadcn/style.css';
import type { PartialBlock } from '@blocknote/core';
import { useCreateBlockNote } from '@blocknote/react';
import { BlockNoteView } from '@blocknote/shadcn';
import type { Note } from '@catch/shared';
import { noteEditorSchema } from '@/components/NoteEditor/checkListItem';
import { resolveAttachmentUrl } from '@/lib/attachmentFiles';
import { useResolvedTheme } from '@/lib/theme';

/** No live-note hooks, controls or change handler belong in the historical reader. */
export default function HistoryDocument({ content }: { content: Note['content'] }) {
  const theme = useResolvedTheme();
  const editor = useCreateBlockNote({
    schema: noteEditorSchema,
    initialContent: content.length ? (content as PartialBlock[]) : [{ type: 'paragraph' }],
    trailingBlock: false,
    resolveFileUrl: resolveAttachmentUrl,
  });
  editor.isEditable = false;
  return (
    <BlockNoteView
      editor={editor}
      editable={false}
      theme={theme}
      formattingToolbar={false}
      sideMenu={false}
      slashMenu={false}
      filePanel={false}
      linkToolbar={false}
      tableHandles={false}
      className="note-editor"
    />
  );
}
