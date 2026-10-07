import { and, eq, isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Archive } from 'lucide-react';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { BackToGallery, TabPageHeader } from '@/components/PageHeader/PageHeader';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { notesCollection, useSharedNotes } from '@/lib/collections';
import { useNoteSelection } from '@/lib/noteSelection';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';
import { PAGE_MAX, usePageGutterShift } from '@/lib/splitView';
import { useAwaitingSync } from '@/lib/syncStatus';

export const Route = createFileRoute('/_app/archive')({
  component: ArchivePage,
});

function ArchivePage() {
  const { open } = useOpenNote();
  const { data: own = [], isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) => and(isNull(note.deletedAt), eq(note.isArchived, true))),
  });
  const shared = useSharedNotes().notes;
  const notes = useMemo(() => [...own, ...shared.filter((note) => note.isArchived)], [own, shared]);
  const awaitingSync = useAwaitingSync(isLoading, notes.length);
  const sorted = sortNotes(notes);
  const selection = useNoteSelection(sorted);
  const gutterShift = usePageGutterShift(PAGE_MAX);

  return (
    <>
      <TabPageHeader
        title="Archive"
        leading={<BackToGallery />}
        selection={selectionHeader(selection, 'archive')}
      />
      <motion.section
        aria-label="Archive"
        style={{ x: gutterShift }}
        className="mx-auto max-w-7xl px-3 pt-3 sm:px-6"
      >
        {awaitingSync ? null : notes.length > 0 ? (
          <NoteGrid
            notes={sorted}
            onOpen={(note, card) => open(note.id, card)}
            selected={selection.ids}
            onSelect={selection.select}
          />
        ) : (
          <EmptyState icon={Archive} title="No archived notes">
            Archive a note to keep it out of the gallery without deleting it.
          </EmptyState>
        )}
      </motion.section>
    </>
  );
}
