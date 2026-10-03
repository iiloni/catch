import type { Note } from '@catch/shared';
import { isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { Bell } from 'lucide-react';
import type { ReactNode } from 'react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { BackToGallery, PageHeader } from '@/components/PageHeader/PageHeader';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { notesCollection, useReminders } from '@/lib/collections';
import { useNoteSelection } from '@/lib/noteSelection';
import { useOpenNote } from '@/lib/openNote';
import { isReminderPast, reminderTime } from '@/lib/reminders';
import { useAwaitingSync } from '@/lib/syncStatus';

export const Route = createFileRoute('/_app/reminders')({
  component: RemindersPage,
});

function RemindersPage() {
  const { open } = useOpenNote();
  const reminders = useReminders();
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) => q.from({ note: notesCollection }).where(({ note }) => isNull(note.deletedAt)),
  });
  const reminded = notes.filter((note) => reminders.has(note.id));
  const awaitingSync = useAwaitingSync(isLoading, reminded.length);

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

  return (
    <>
      <PageHeader
        title="Reminders"
        leading={<BackToGallery />}
        selection={selectionHeader(selection, 'gallery')}
      />
      <section
        aria-label="Reminders"
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
      </section>
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
