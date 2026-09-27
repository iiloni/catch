import type { Note } from '@catch/shared';
import { Columns3, LayoutDashboard } from 'lucide-react';
import { z } from 'zod';
import { NoteBoard } from '@/components/NoteBoard/NoteBoard';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { sortNotes } from '@/lib/sortNotes';
import { usePersistentState } from '@/lib/storage';

const deckViewSchema = z.enum(['grid', 'board']);

type Props = {
  notes: Note[];
  onOpen: (note: Note) => void;
};

/** Notes being actively worked on: the ones with a board status. */
export function DeckSection({ notes, onOpen }: Props) {
  const [view, setView] = usePersistentState('catch-deck-view', deckViewSchema, 'grid');

  return (
    <section aria-labelledby="deck-heading" className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 id="deck-heading" className="font-semibold text-lg">
          Deck
        </h2>
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => value && setView(value as typeof view)}
          aria-label="Deck view"
        >
          <ToggleGroupItem value="grid" aria-label="Grid view">
            <LayoutDashboard />
          </ToggleGroupItem>
          <ToggleGroupItem value="board" aria-label="Board view">
            <Columns3 />
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {view === 'board' ? (
        <NoteBoard notes={sortNotes(notes)} onOpen={onOpen} />
      ) : notes.length > 0 ? (
        <NoteGrid notes={sortNotes(notes)} onOpen={onOpen} />
      ) : (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
          Nothing in the deck. Use “Add to deck” on a note to start working on it.
        </p>
      )}
    </section>
  );
}
