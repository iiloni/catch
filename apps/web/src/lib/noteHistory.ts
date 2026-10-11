import {
  canonicalHistory,
  HISTORY_CONTINUOUS_MS,
  HISTORY_IDLE_MS,
  type HistoryCapture,
  type HistoryKind,
  type HistoryList,
  type HistoryRestoreContext,
  type HistoryState,
  type HistoryVersion,
  historyArchiveSchema,
  historyClearResultSchema,
  historyListSchema,
  historyRestoreContextSchema,
  historyRestoreResultSchema,
  type Note,
} from '@catch/shared';
import { sha256 } from '@noble/hashes/sha2.js';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { ApiError, api } from './api';
import {
  noteHistoryCollection,
  queuedHistoryCaptureIds,
  waitForNoteWritesSynced,
  waitForWriteStored,
  write,
} from './collections';
import {
  historyChanges,
  historyOriginId,
  historyUploaded,
  historyVaultLocked,
} from './historyEvents';
import {
  allHistoryRecords,
  cachedHistoryList,
  cacheHistoryList,
  cacheHistoryVersion,
  deleteHistoryDraft,
  deletePendingRestore,
  forgetClearedHistory,
  historyDrafts,
  historyRecordsForNote,
  pendingRestore,
  type StoredHistory,
  stageFrozenHistory,
  storeHistoryDraft,
  storePendingRestore,
  trimHistoryCache,
} from './historyStorage';
import { decodeHistoryInWorker, encodeHistoryInWorker } from './historyWorker';
import {
  beforeVaultLock,
  getSealedFiles,
  isVaultNote,
  openVaultHistoryNote,
  sealVaultHistoryRestore,
  vaultHistoryContentIdentity,
  vaultHistoryOpen,
  vaultHistorySeal,
} from './vault';
import { fromBase64, toBase64 } from './vaultCrypto';

const hash = (bytes: Uint8Array) =>
  Array.from(sha256(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
const textBytes = (value: unknown) => new TextEncoder().encode(canonicalHistory(value));
type Session = {
  note: Note;
  kind: HistoryKind;
  epoch: string;
  current: HistoryState;
  previous?: { id: string; state: HistoryState; depth: number; key: string };
  serial: Promise<void>;
  idle?: number;
  continuous?: number;
};
const epochs = new Map<string, { epoch: string; updatedAt: Date }>();
const sessions = new Map<string, Session>();
let started = false;

export function hasHistorySession(id: string) {
  return sessions.has(id);
}
function enqueue(capture: HistoryCapture) {
  const transaction = write(() => {
    if (noteHistoryCollection.has(capture.noteId))
      noteHistoryCollection.update(capture.noteId, (draft) => {
        draft.latestCaptureId = capture.id;
      });
    else
      noteHistoryCollection.insert({
        id: capture.noteId,
        userId: captureUser(capture),
        kind: capture.kind,
        epoch: capture.epoch,
        contentToken: capture.noteId,
        latestCaptureId: capture.id,
        versionCount: 0,
        updatedAt: new Date(),
      });
  });
  return waitForWriteStored(transaction);
}

// The collection is account scoped; a job never decides which account is active on the device.
import { getSignedInUser } from './auth';

const captureUser = (_capture: HistoryCapture) => {
  const id = getSignedInUser()?.id;
  if (!id) throw new Error('Sign in to save history.');
  return id;
};
function identity(session: Session, state: HistoryState) {
  return session.kind === 'vault'
    ? vaultHistoryContentIdentity(session.note.id, session.epoch, state)
    : hash(textBytes(state));
}
function payload(session: Session, representation: 'snapshot' | 'delta', bytes: Uint8Array) {
  return session.kind === 'vault'
    ? vaultHistorySeal(session.note.id, session.epoch, representation, bytes)
    : { payloadKey: hash(bytes), data: toBase64(bytes) };
}
async function encodedCapture(
  session: Session,
  state: HistoryState,
  reason: HistoryCapture['reason'],
  full = false,
) {
  const previous = full ? undefined : session.previous;
  const { encoded, snapshot } = await encodeHistoryInWorker(
    state,
    previous ? { state: previous.state, depth: previous.depth } : undefined,
  );
  const contentKey = identity(session, state);
  const common = {
    id: uuidv7(),
    noteId: session.note.id,
    kind: session.kind,
    epoch: session.epoch,
    originId: historyOriginId,
    capturedAt: new Date(),
    reason,
    contentKey,
    sourceKey: null,
    format: 1 as const,
  };
  const capture: HistoryCapture = {
    ...common,
    representation: encoded.representation,
    parentId: encoded.representation === 'delta' ? (previous?.id ?? null) : null,
    depth: encoded.depth,
    ...payload(session, encoded.representation, encoded.data),
  };
  const fallback: HistoryCapture =
    encoded.representation === 'snapshot'
      ? capture
      : {
          ...common,
          representation: 'snapshot',
          parentId: null,
          depth: 0,
          ...payload(session, 'snapshot', snapshot),
        };
  return { capture, fallback };
}
function serialize(session: Session, run: () => Promise<void>) {
  const result = session.serial.then(run);
  session.serial = result.catch(() => {
    toast.error('A version could not be saved on this device', {
      description: 'Your working note is still saved separately. Free some storage and try again.',
    });
  });
  return result;
}
async function freezeState(
  session: Session,
  state: HistoryState,
  reason: HistoryCapture['reason'],
) {
  const key = identity(session, state);
  if (session.previous?.key === key) {
    await deleteHistoryDraft(session.note.id);
    return;
  }
  if (!session.previous) {
    const known = (await historyRecordsForNote(session.note.id)).find(
      (row) => row.epoch === session.epoch && row.version?.contentKey === key,
    );
    if (known?.version) {
      session.previous = { id: known.version.id, depth: known.version.depth, state, key };
      await deleteHistoryDraft(session.note.id);
      return;
    }
  }
  const { capture, fallback } = await encodedCapture(session, state, reason);
  await stageFrozenHistory(capture, fallback);
  session.previous = { id: capture.id, state, depth: capture.depth, key };
  await enqueue(capture);
}
function changed({
  note,
  before,
  after,
}: {
  note: Note;
  before: Note['content'];
  after: Note['content'];
}) {
  let session = sessions.get(note.id);
  const kind = isVaultNote(note.id) ? 'vault' : 'note';
  if (!session) {
    session = {
      note,
      kind,
      epoch: note.id,
      current: { content: before, files: kind === 'vault' ? [...getSealedFiles(note.id)] : [] },
      serial: Promise.resolve(),
    };
    sessions.set(note.id, session);
    const initial = session.current;
    const currentSession = session;
    void serialize(session, async () => {
      // A locally completed clear may still be waiting for Electric after a reload.
      const cached = await cachedHistoryList(note.id);
      const candidates = [epochs.get(note.id), cached?.summary, noteHistoryCollection.get(note.id)]
        .filter((row): row is { epoch: string; updatedAt: Date } => !!row)
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      currentSession.epoch = candidates[0]?.epoch ?? note.id;
      await freezeState(currentSession, initial, 'baseline');
    }).catch(() => {});
  }
  session.current = {
    content: structuredClone(after),
    files: kind === 'vault' ? [...getSealedFiles(note.id)] : [],
  };
  const state = session.current;
  const currentSession = session;
  void serialize(session, async () => {
    const { fallback } = await encodedCapture(currentSession, state, 'edit', true);
    await storeHistoryDraft(fallback);
  }).catch(() => {});
  window.clearTimeout(session.idle);
  session.idle = window.setTimeout(
    () => void freezeHistory(note.id).catch(() => {}),
    HISTORY_IDLE_MS,
  );
  session.continuous ??= window.setTimeout(
    () => void freezeHistory(note.id).catch(() => {}),
    HISTORY_CONTINUOUS_MS,
  );
}
export async function freezeHistory(noteId: string) {
  const session = sessions.get(noteId);
  if (!session) return;
  window.clearTimeout(session.idle);
  window.clearTimeout(session.continuous);
  session.idle = undefined;
  session.continuous = undefined;
  const state = session.current;
  await serialize(session, () => freezeState(session, state, 'edit'));
}
export async function startHistory() {
  if (started) return;
  started = true;
  historyUploaded.add((noteId, captureId, version) => {
    const previous = sessions.get(noteId)?.previous;
    if (previous?.id === captureId) {
      previous.id = version.id;
      previous.depth = version.depth;
    }
  });
  historyChanges.add(changed);
  historyVaultLocked.add(() => {
    for (const [id, session] of sessions)
      if (session.kind === 'vault') {
        window.clearTimeout(session.idle);
        window.clearTimeout(session.continuous);
        sessions.delete(id);
      }
  });
  beforeVaultLock.add(async () => {
    for (const session of sessions.values())
      if (session.kind === 'vault') await freezeHistory(session.note.id);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden')
      for (const id of sessions.keys()) void freezeHistory(id).catch(() => {});
  });
  // A draft is recovered once the tab that wrote it is gone. Each tab holds a lock named
  // for its origin for as long as it lives, so a second tab leaves the first one's draft be.
  const alive = (originId: string) => `catch-history-${originId}`;
  if (navigator.locks)
    void navigator.locks.request(alive(historyOriginId), () => new Promise(() => {}));
  const held = new Set((await navigator.locks?.query())?.held?.map((lock) => lock.name));
  for (const draft of await historyDrafts()) {
    if (held.has(alive(draft.originId))) continue;
    const capture = { ...draft, reason: 'recovered' as const };
    await stageFrozenHistory(capture, capture);
  }
  const queued = await queuedHistoryCaptureIds();
  for (const record of (await allHistoryRecords()).sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (record.pending && record.capture && !queued.has(record.id)) await enqueue(record.capture);
  }
}
export async function historyList(noteId: string): Promise<HistoryList | null> {
  try {
    let list = historyListSchema.parse(await api.history(noteId));
    while (list.nextCursor) {
      const next = historyListSchema.parse(await api.history(noteId, list.nextCursor));
      if (next.summary.epoch !== list.summary.epoch)
        throw new Error('History changed while loading.');
      list = { ...next, versions: [...list.versions, ...next.versions] };
    }
    await cacheHistoryList(noteId, list);
    return list;
  } catch (error) {
    const cached = await cachedHistoryList(noteId);
    if (cached) return cached;
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
}
function localChain(records: StoredHistory[], noteId: string, id: string) {
  const chain: (HistoryVersion & { data: string; format: 1 })[] = [];
  const byId = new Map(records.filter((row) => row.noteId === noteId).map((row) => [row.id, row]));
  let row = byId.get(id);
  const epoch = row?.epoch;
  const seen = new Set<string>();
  while (row && row.epoch === epoch && !seen.has(row.id) && chain.length < 32) {
    seen.add(row.id);
    const version =
      row.version ??
      (row.capture ? { ...row.capture, sequence: 0, receivedAt: row.capture.capturedAt } : null);
    if (!version) return null;
    chain.unshift(version);
    if (version.representation !== 'delta') return chain;
    row = byId.get(version.parentId ?? '');
  }
  return null;
}
export async function readHistoryVersion(noteId: string, id: string): Promise<HistoryState> {
  const records = await historyRecordsForNote(noteId);
  let chain = localChain(records, noteId, id);
  const fallback = records.find((row) => row.id === id)?.fallback;
  if (!chain && fallback) chain = [{ ...fallback, sequence: 0, receivedAt: fallback.capturedAt }];
  if (!chain) {
    const archive = historyArchiveSchema.parse(await api.historyVersion(noteId, id));
    if (
      archive.versions.at(-1)?.id !== id ||
      archive.versions.some((row) => row.noteId !== noteId || row.epoch !== archive.epoch)
    )
      throw new Error('This version does not belong to this note.');
    for (const version of archive.versions) await cacheHistoryVersion(version);
    chain = archive.versions;
    void trimHistoryCache().catch(() => {});
  }
  const selected = chain.at(-1)!;
  if (selected.representation === 'vault-note') {
    if (hash(fromBase64(selected.data)) !== selected.payloadKey)
      throw new Error('This version failed its integrity check.');
    return openVaultHistoryNote(noteId, selected.data);
  }
  const kind = noteHistoryCollection.get(noteId)?.kind ?? (isVaultNote(noteId) ? 'vault' : 'note');
  const entries = chain.map((row) => {
    if (row.representation === 'vault-note') throw new Error('Invalid history dependency.');
    const bytes =
      kind === 'vault'
        ? vaultHistoryOpen(noteId, row.epoch, row.representation, row.payloadKey, row.data)
        : fromBase64(row.data);
    if (kind === 'note' && hash(bytes) !== row.payloadKey)
      throw new Error('This version failed its integrity check.');
    return { representation: row.representation, data: bytes };
  });
  const state = await decodeHistoryInWorker(entries);
  const contentKey =
    kind === 'vault'
      ? vaultHistoryContentIdentity(noteId, selected.epoch, state)
      : hash(textBytes(state));
  if (contentKey !== selected.contentKey) throw new Error('This version failed its content check.');
  return state;
}
export async function prepareHistoryRestore(noteId: string) {
  await freezeHistory(noteId);
  await waitForNoteWritesSynced(noteId);
  return historyRestoreContextSchema.parse(await api.historyRestoreContext(noteId));
}
export async function restoreHistoryVersion(
  noteId: string,
  version: HistoryVersion,
  state: HistoryState,
  context: Awaited<ReturnType<typeof prepareHistoryRestore>>,
) {
  const operationId = uuidv7();
  await storePendingRestore(noteId, operationId);
  try {
    const data = context.vaultNote
      ? sealVaultHistoryRestore(context.vaultNote, state.content)
      : undefined;
    const result = historyRestoreResultSchema.parse(
      await api.restoreHistory(noteId, {
        operationId,
        versionId: version.id,
        epoch: version.epoch,
        expectedToken: context.summary.contentToken,
        data,
      }),
    );
    await deletePendingRestore(noteId);
    sessions.delete(noteId);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) await deletePendingRestore(noteId);
    throw error;
  }
}
export async function resolveHistoryRestore(noteId: string) {
  const operationId = await pendingRestore(noteId);
  if (!operationId) return null;
  try {
    const result = historyRestoreResultSchema.parse(
      await api.historyRestoreReceipt(noteId, operationId),
    );
    await deletePendingRestore(noteId);
    return result;
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) {
      await deletePendingRestore(noteId);
      return null;
    }
    throw error;
  }
}

export async function clearNoteHistory(noteId: string, context: HistoryRestoreContext) {
  const result = historyClearResultSchema.parse(
    await api.clearHistory(noteId, {
      epoch: context.summary.epoch,
      expectedToken: context.summary.contentToken,
    }),
  );
  epochs.set(noteId, result.summary);
  await forgetClearedHistory(noteId, context.summary.epoch);
  sessions.delete(noteId);
  await cacheHistoryList(noteId, { summary: result.summary, versions: [], nextCursor: null });
  await noteHistoryCollection.utils.awaitTxId(result.txid, 15_000).catch(() => false);
  return result;
}

export async function finishHistorySession(noteId: string) {
  const session = sessions.get(noteId);
  await freezeHistory(noteId);
  if (sessions.get(noteId) === session) sessions.delete(noteId);
}
