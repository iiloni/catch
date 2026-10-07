import { type Note, type SharedNote, sharedNoteAsNote } from '@catch/shared';

type SharedNotesView = {
  notes: readonly Note[];
  byId: ReadonlyMap<string, SharedNote>;
};

/** One cached React snapshot, initialized before the first render can treat a note as gone. */
export function createSharedNotesView(
  read: () => Iterable<SharedNote>,
  subscribeChanges: (update: () => void) => void,
) {
  let snapshot: SharedNotesView = { notes: [], byId: new Map() };
  let started = false;
  const listeners = new Set<() => void>();

  function update() {
    const rows = [...read()];
    snapshot = {
      notes: rows.filter((row) => row.isAvailable).map(sharedNoteAsNote),
      byId: new Map(rows.map((row) => [row.noteId, row])),
    };
    for (const notify of listeners) notify();
  }

  function start() {
    if (started) return;
    started = true;
    subscribeChanges(update);
    update();
  }

  return {
    getSnapshot() {
      start();
      return snapshot;
    },
    subscribe(listener: () => void) {
      start();
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
