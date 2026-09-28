import { and, eq, isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute } from '@tanstack/react-router';
import { ArrowDownUp, Lightbulb } from 'lucide-react';
import { z } from 'zod';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { TabPageHeader } from '@/components/PageHeader/PageHeader';
import { selectionHeader } from '@/components/SelectionToolbar/SelectionToolbar';
import { SettingsButton } from '@/components/SettingsButton/SettingsButton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { notesCollection } from '@/lib/collections';
import { useNoteSelection } from '@/lib/noteSelection';
import { moveNote, setNoteArchived } from '@/lib/notes';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';
import { usePersistentState } from '@/lib/storage';

export const Route = createFileRoute('/_app/')({
  component: GalleryPage,
});

const sortSchema = z.object({
  field: z.enum(['position', 'updatedAt', 'createdAt']),
  direction: z.enum(['desc', 'asc']),
});

type Sort = z.infer<typeof sortSchema>;

/** Every note that is not in the deck, archived or trashed. */
function GalleryPage() {
  const { open } = useOpenNote();
  // A new key, so galleries saved with the old "last edited" default start arranged by hand.
  const [sort, setSort] = usePersistentState('catch-gallery-order', sortSchema, {
    field: 'position',
    direction: 'desc',
  });
  const { data: notes = [], isLoading } = useLiveQuery({
    query: (q) =>
      q
        .from({ note: notesCollection })
        .where(({ note }) =>
          and(isNull(note.deletedAt), eq(note.isArchived, false), isNull(note.status)),
        ),
  });

  const sorted = sortNotes(notes, sort.field, sort.direction);
  const pinned = sorted.filter((note) => note.isPinned);
  const others = sorted.filter((note) => !note.isPinned);
  // Notes can only be dragged into place while they are shown in that order.
  const onMove = sort.field === 'position' ? moveNote : undefined;

  const selection = useNoteSelection(sorted);

  return (
    <>
      <TabPageHeader
        title="Gallery"
        selection={selectionHeader(selection, 'gallery')}
        trailing={
          <>
            <ViewOptions sort={sort} onChange={setSort} />
            <SettingsButton />
          </>
        }
      />
      <section
        aria-label="Gallery"
        className="mx-auto flex max-w-7xl flex-col gap-5 px-3 pt-5 sm:px-6"
      >
        {isLoading ? null : notes.length === 0 ? (
          <EmptyState icon={Lightbulb} title="Catch your first note">
            Tap + to write something down. It lands here.
          </EmptyState>
        ) : (
          <>
            {pinned.length > 0 && (
              <NoteSection label="Pinned">
                <NoteGrid
                  notes={pinned}
                  onOpen={(note, card) => open(note.id, card)}
                  onArchive={(note) => setNoteArchived(note.id, true)}
                  onMove={onMove}
                  selected={selection.ids}
                  onSelect={selection.select}
                />
              </NoteSection>
            )}
            {others.length > 0 && (
              <NoteSection label={pinned.length > 0 ? 'Others' : undefined}>
                <NoteGrid
                  notes={others}
                  onOpen={(note, card) => open(note.id, card)}
                  onArchive={(note) => setNoteArchived(note.id, true)}
                  onMove={onMove}
                  selected={selection.ids}
                  onSelect={selection.select}
                />
              </NoteSection>
            )}
          </>
        )}
      </section>
    </>
  );
}

function NoteSection({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {label && <h2 className="px-1 font-medium text-muted-foreground text-sm">{label}</h2>}
      {children}
    </div>
  );
}

function ViewOptions({ sort, onChange }: { sort: Sort; onChange: (sort: Sort) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sort"
        className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <ArrowDownUp className="size-5" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={8}>
        <DropdownMenuLabel>Sort by</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={sort.field}
          onValueChange={(field) => onChange({ ...sort, field: field as Sort['field'] })}
        >
          <DropdownMenuRadioItem value="position">Custom</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="updatedAt">Last edited</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="createdAt">Date created</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        {sort.field !== 'position' && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup
              value={sort.direction}
              onValueChange={(direction) =>
                onChange({ ...sort, direction: direction as Sort['direction'] })
              }
            >
              <DropdownMenuRadioItem value="desc">Newest first</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="asc">Oldest first</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
