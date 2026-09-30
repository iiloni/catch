import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { getSignedInUser } from './auth';
import { type ImportedNote, importNotes } from './notes';
import { isPendingWrite, subscribeToSyncStatus } from './syncStatus';

/**
 * The import the server is taking, or last took, for the signed-in user. It is kept in
 * localStorage so Settings can show its progress after the user leaves the page, and after
 * the app restarts: the outbox keeps sending an import's batches either way.
 */
const storedImportSchema = z.object({
  /** Where the notes came from, such as "Google Keep". */
  source: z.string(),
  batches: z.array(
    z.object({
      /** The batch's outbox transaction. */
      id: z.string(),
      count: z.number().int(),
      /** How its write settled, once this page saw it settle. */
      outcome: z.enum(['saved', 'failed']).nullable(),
    }),
  ),
});

type StoredImport = z.infer<typeof storedImportSchema>;

export type ImportState = {
  source: string;
  /** Notes being imported, leaving out those already here. */
  total: number;
  /** Notes the server has. */
  saved: number;
  /** Notes the server refused; each refusal is also reported with a toast. */
  failed: number;
  finished: boolean;
};

const user = getSignedInUser();
const storageKey = user ? `catch-import-${user.id}` : null;

function load(): StoredImport | null {
  if (!storageKey) return null;
  try {
    const parsed = storedImportSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? ''));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

let stored = load();
let state: ImportState | null = null;
const listeners = new Set<() => void>();
/** Batches written by this page, whose outcome it will hear; see `summarize`. */
const following = new Set<string>();

function summarize(current: StoredImport): ImportState {
  const result = { source: current.source, total: 0, saved: 0, failed: 0, finished: true };
  for (const batch of current.batches) {
    result.total += batch.count;
    if (batch.outcome === 'failed') result.failed += batch.count;
    else if (batch.outcome === 'saved') result.saved += batch.count;
    // A batch from an earlier visit may have settled without this page seeing how. Refusals
    // were reported when they happened, so counting it as saved is right far more often.
    // Batches this page wrote wait for their outcome: a write stops pending a moment before
    // the server's answer is final.
    else if (!following.has(batch.id) && !isPendingWrite(batch.id)) result.saved += batch.count;
    else result.finished = false;
  }
  return result;
}

function isSame(a: ImportState | null, b: ImportState | null) {
  return (
    a === b ||
    (a !== null &&
      b !== null &&
      a.source === b.source &&
      a.total === b.total &&
      a.saved === b.saved &&
      a.failed === b.failed &&
      a.finished === b.finished)
  );
}

function refresh() {
  const next = stored ? summarize(stored) : null;
  if (isSame(state, next)) return;
  const justFinished = state !== null && !state.finished && next?.finished === true;
  state = next;
  for (const listener of listeners) listener();
  // Nobody is on the page that shows imports, so say it here.
  if (justFinished && listeners.size === 0 && next.saved > 0) {
    toast.success(`${countNotes(next.saved)} imported from ${next.source}`);
  }
}

function save(next: StoredImport | null) {
  stored = next;
  if (storageKey) {
    if (next) localStorage.setItem(storageKey, JSON.stringify(next));
    else localStorage.removeItem(storageKey);
  }
  refresh();
}

state = stored ? summarize(stored) : null;
subscribeToSyncStatus(refresh);

export const countNotes = (count: number) =>
  `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'note' : 'notes'}`;

/**
 * Adds imported notes (see `importNotes`) and follows the server taking them. It replaces
 * a finished import; while one is running, start no other. Returns how many notes it adds.
 */
export function startImport(source: string, userId: string, notes: readonly ImportedNote[]) {
  const batches = importNotes(userId, notes);
  for (const batch of batches) following.add(batch.id);
  save({
    source,
    batches: batches.map(({ id, count }) => ({ id, count, outcome: null })),
  });
  for (const batch of batches) {
    const settle = (outcome: 'saved' | 'failed') => {
      following.delete(batch.id);
      if (!stored) return;
      save({
        ...stored,
        batches: stored.batches.map((entry) =>
          entry.id === batch.id ? { ...entry, outcome } : entry,
        ),
      });
    };
    batch.persisted.then(
      () => settle('saved'),
      () => settle('failed'),
    );
  }
  return batches.reduce((sum, batch) => sum + batch.count, 0);
}

/** Forgets a finished import, once its summary has been read. */
export function dismissImport() {
  if (state?.finished) save(null);
}

/** Forgets the import on signing out, when the device drops the writes it had queued. */
export function forgetImport() {
  save(null);
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The import the server is taking or last took, or null. */
export function useImport(): ImportState | null {
  return useSyncExternalStore(subscribe, () => state);
}
