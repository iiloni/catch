import type { Note } from '@catch/shared';
import { isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { BackToGallery, TabPageHeader } from '@/components/PageHeader/PageHeader';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { notesCollection, useReminders, useRemindersReady } from '@/lib/collections';
import { useNoteSelection } from '@/lib/noteSelection';
import { useOpenNote } from '@/lib/openNote';
import { isReminderPast, reminderTime } from '@/lib/reminders';
import { PAGE_MAX, usePageGutterShift } from '@/lib/splitView';
import { useAwaitingSync } from '@/lib/syncStatus';
import { useVaultView } from '@/lib/vault';

export const Route = createFileRoute('/_app/reminders')({
  component: RemindersPage,
});

function RemindersPage() {
  const { open } = useOpenNote();
  const reminders = useReminders();
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) => q.from({ note: notesCollection }).where(({ note }) => isNull(note.deletedAt)),
  });
  const vault = useVaultView();
  const reminded = (vault ? vault.filter((note) => !note.deletedAt) : notes).filter((note) =>
    reminders.has(note.id),
  );
  const remindersReady = useRemindersReady();
  const awaitingSync = useAwaitingSync((isLoading && !vault) || !remindersReady, reminded.length);

  const upcoming: { note: Note; at: number }[] = [];
  const past: { note: Note; at: number }[] = [];
  for (const note of reminded) {
    const reminder = reminders.get(note.id);
    if (!reminder) continue;
    if (isReminderPast(reminder)) {
      past.push({ note, at: reminder.firedAt?.getTime() ?? 0 });
    } else {
      upcoming.push({ note, at: reminderTime(reminder)?.getTime() ?? 0 });
    }
  }
  // Soonest first, then the ones that rang most recently.
  const soonest = upcoming.sort((a, b) => a.at - b.at).map((item) => item.note);
  const rang = past.sort((a, b) => b.at - a.at).map((item) => item.note);
  const selection = useNoteSelection([...soonest, ...rang]);
  // Reminders are on notes wherever they are kept. Only when every chosen note is archived
  // is taking them out of the archive the thing to offer.
  const place = selection.notes.every((note) => note.isArchived) ? 'archive' : 'gallery';
  const gutterShift = usePageGutterShift(PAGE_MAX);

  return (
    <>
      <TabPageHeader
        title={vault ? 'Vault reminders' : 'Reminders'}
        leading={<BackToGallery />}
        selection={selectionHeader(selection, place)}
      />
      <motion.section
        aria-label="Reminders"
        style={{ x: gutterShift }}
        className="mx-auto flex max-w-7xl flex-col gap-6 px-3 pt-3 sm:px-6"
      >
        {awaitingSync ? null : reminded.length > 0 ? (
          <>
            {soonest.length > 0 && (
              <Section label={rang.length > 0 ? 'Upcoming' : undefined}>
                <NoteGrid
                  notes={soonest}
                  onOpen={(note, card) => open(note.id, card)}
                  selected={selection.ids}
                  onSelect={selection.select}
                />
              </Section>
            )}
            {rang.length > 0 && (
              <Section label="Past">
                <NoteGrid
                  notes={rang}
                  onOpen={(note, card) => open(note.id, card)}
                  selected={selection.ids}
                  onSelect={selection.select}
                />
              </Section>
            )}
          </>
        ) : (
          <EmptyState icon={Bell} title="No reminders">
            Open a note and tap the bell to be reminded of it.
          </EmptyState>
        )}
      </motion.section>
    </>
  );
}

function Section({ label, children }: { label?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label && <h2 className="px-1 font-medium text-muted-foreground text-sm">{label}</h2>}
      {children}
    </div>
  );
}
