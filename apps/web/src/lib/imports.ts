import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { z } from 'zod';
import { hasAttachment, type ImportedAttachment, importAttachment } from './attachments';
import { getSignedInUser } from './auth';
import { type ImportBatch, type ImportedNote, importNotes } from './notes';
import { isPendingWrite, subscribeToSyncStatus } from './syncStatus';

/**
 * The import the server is taking, or last took, for the signed-in user. It is kept in
 * localStorage so Settings can show its progress after the user leaves the page, and after
 * the app restarts: the outbox keeps sending an import's batches either way.
 */
const storedImportSchema = z.object({
  /** Where the notes came from, such as "Google Keep". */
  source: z.string(),
  preparing: z.number().int().nonnegative().default(0),
  preparationFailed: z.number().int().nonnegative().default(0),
  batches: z.array(
    z.object({
      /** The batch's outbox transaction. */
      id: z.string(),
      count: z.number().int(),
      kind: z.enum(['notes', 'attachments']).default('notes'),
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
  attachmentTotal: number;
  attachmentSaved: number;
  attachmentFailed: number;
  preparing: number;
  finished: boolean;
};

const user = getSignedInUser();
const storageKey = user ? `catch-import-${user.id}` : null;

function load(): StoredImport | null {
  if (!storageKey) return null;
  try {
    const parsed = storedImportSchema.safeParse(JSON.parse(localStorage.getItem(storageKey) ?? ''));
    if (!parsed.success) return null;
    // File handles cannot survive a restart. Bytes already staged still upload through
    // the outbox; the remainder can be recovered by selecting the same export again.
    return {
      ...parsed.data,
      preparationFailed: parsed.data.preparationFailed + parsed.data.preparing,
      preparing: 0,
    };
  } catch {
    return null;
  }
}

let stored = load();
let state: ImportState | null = null;
const listeners = new Set<() => void>();
/** Batches written by this page, whose outcome it will hear; see `summarize`. */
const following = new Set<string>();
let controller: AbortController | null = null;

function summarize(current: StoredImport): ImportState {
  const result: ImportState = {
    source: current.source,
    total: 0,
    saved: 0,
    failed: 0,
    attachmentTotal: current.preparing + current.preparationFailed,
    attachmentSaved: 0,
    attachmentFailed: current.preparationFailed,
    preparing: current.preparing,
    finished: current.preparing === 0,
  };
  for (const batch of current.batches) {
    const attachment = batch.kind === 'attachments';
    result[attachment ? 'attachmentTotal' : 'total'] += batch.count;
    if (batch.outcome === 'failed')
      result[attachment ? 'attachmentFailed' : 'failed'] += batch.count;
    else if (batch.outcome === 'saved' || (!following.has(batch.id) && !isPendingWrite(batch.id))) {
      result[attachment ? 'attachmentSaved' : 'saved'] += batch.count;
    } else result.finished = false;
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
      a.attachmentTotal === b.attachmentTotal &&
      a.attachmentSaved === b.attachmentSaved &&
      a.attachmentFailed === b.attachmentFailed &&
      a.preparing === b.preparing &&
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
  if (justFinished && listeners.size === 0 && next.saved + next.attachmentSaved > 0) {
    toast.success(`${importSummary(next)} imported from ${next.source}`);
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

export const countAttachments = (count: number) =>
  `${new Intl.NumberFormat().format(count)} ${count === 1 ? 'attachment' : 'attachments'}`;

export function importSummary(current: Pick<ImportState, 'saved' | 'attachmentSaved'>) {
  return [
    current.saved > 0 ? countNotes(current.saved) : null,
    current.attachmentSaved > 0 ? countAttachments(current.attachmentSaved) : null,
  ]
    .filter(Boolean)
    .join(' and ');
}

/**
 * Adds imported notes (see `importNotes`) and follows the server taking them. It replaces
 * a finished import; while one is running, start no other. Returns how many notes it adds.
 */
export function startImport(
  source: string,
  userId: string,
  notes: readonly ImportedNote[],
  attachments: readonly ImportedAttachment[] = [],
) {
  if (state && !state.finished) throw new Error('An import is already running');
  controller?.abort();
  const reader = new AbortController();
  controller = reader;
  const batches = importNotes(userId, notes);
  const fresh = attachments.filter((file) => !hasAttachment(file.id));
  for (const batch of batches) following.add(batch.id);
  save({
    source,
    preparing: fresh.length,
    preparationFailed: 0,
    batches: batches.map(({ id, count }) => ({ id, count, kind: 'notes', outcome: null })),
  });
  const follow = (batch: ImportBatch) => {
    const settle = (outcome: 'saved' | 'failed') => {
      following.delete(batch.id);
      if (!stored || reader.signal.aborted) return;
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
  };
  for (const batch of batches) follow(batch);

  // Extract and stage one file at a time. This task belongs to the import store, so it
  // continues after Settings unmounts; every queued upload already has durable bytes.
  void (async () => {
    for (const attachment of fresh) {
      if (reader.signal.aborted) return;
      let batch: ImportBatch | null = null;
      let failed = false;
      try {
        const file = await attachment.read();
        reader.signal.throwIfAborted();
        batch = await importAttachment(attachment, file, reader.signal);
      } catch (error) {
        if (reader.signal.aborted) return;
        failed = true;
        toast.error('Could not import an attachment', {
          description: error instanceof Error ? error.message : 'The file could not be read.',
        });
      }
      if (!stored || reader.signal.aborted) return;
      if (batch) following.add(batch.id);
      save({
        ...stored,
        preparing: stored.preparing - 1,
        preparationFailed: stored.preparationFailed + Number(failed),
        batches: batch
          ? [...stored.batches, { id: batch.id, count: 1, kind: 'attachments', outcome: null }]
          : stored.batches,
      });
      if (batch) follow(batch);
    }
  })();
  return batches.reduce((sum, batch) => sum + batch.count, 0);
}

/** Forgets a finished import, once its summary has been read. */
export function dismissImport() {
  if (state?.finished) save(null);
}

/** Forgets the import on signing out, when the device drops the writes it had queued. */
export function forgetImport() {
  controller?.abort();
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
