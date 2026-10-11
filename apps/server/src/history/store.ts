import { createHash } from 'node:crypto';
import {
  HISTORY_ANCHOR_INTERVAL,
  HISTORY_CONTINUOUS_MS,
  HISTORY_MAX_BYTES,
  HISTORY_MAX_VERSIONS,
  type HistoryArchive,
  type HistoryCapture,
  type HistoryKind,
  type HistoryState,
  type HistorySummary,
  type HistoryVersion,
  type HistoryWrite,
} from '@catch/shared';
import {
  canonicalHistory,
  decodeHistory,
  encodeHistory,
  packHistory,
} from '@catch/shared/historyCodec';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import type { db } from '../db/client';
import {
  historyOrigins,
  historyPayloads,
  historyVersions,
  noteHistory,
  notes,
  vaultNotes,
} from '../db/schema';

export type HistoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const digest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export class HistoryFailure extends Error {
  constructor(
    public code:
      | 'HISTORY_RESTORE_STALE'
      | 'HISTORY_EPOCH_CHANGED'
      | 'HISTORY_PARENT_MISSING'
      | 'HISTORY_INTEGRITY'
      | 'HISTORY_OPERATION_REUSED',
    message: string,
  ) {
    super(message);
  }
}
const scope = (userId: string, noteId: string) =>
  and(eq(noteHistory.userId, userId), eq(noteHistory.id, noteId));
export const versionScope = (userId: string, noteId: string, epoch: string) =>
  and(
    eq(historyVersions.userId, userId),
    eq(historyVersions.noteId, noteId),
    eq(historyVersions.epoch, epoch),
  );
const payloadScope = (userId: string, noteId: string, epoch: string) =>
  and(
    eq(historyPayloads.userId, userId),
    eq(historyPayloads.noteId, noteId),
    eq(historyPayloads.epoch, epoch),
  );

/** Lock the live note first; every content write and restore uses the same lock order. */
export async function lockHistoryNote(tx: HistoryTx, userId: string, noteId: string) {
  const [note] = await tx
    .select()
    .from(notes)
    .where(and(eq(notes.userId, userId), eq(notes.id, noteId)))
    .for('update');
  if (note) return { kind: 'note' as const, note, vaultNote: null };
  const [vaultNote] = await tx
    .select()
    .from(vaultNotes)
    .where(and(eq(vaultNotes.userId, userId), eq(vaultNotes.id, noteId)))
    .for('update');
  return vaultNote ? { kind: 'vault' as const, note: null, vaultNote } : null;
}

export async function ensureHistory(
  tx: HistoryTx,
  userId: string,
  noteId: string,
  kind: HistoryKind,
) {
  await tx
    .insert(noteHistory)
    .values({ id: noteId, userId, kind, epoch: noteId, contentToken: noteId })
    .onConflictDoNothing();
  const [control] = await tx.select().from(noteHistory).where(scope(userId, noteId)).for('update');
  if (!control || control.kind !== kind)
    throw new HistoryFailure('HISTORY_INTEGRITY', 'History does not belong to this note.');
  return control;
}
export type HistoryControl = Awaited<ReturnType<typeof ensureHistory>>;

export function publicSummary(control: HistoryControl): HistorySummary {
  return {
    id: control.id,
    userId: control.userId,
    kind: control.kind,
    epoch: control.epoch,
    contentToken: control.contentToken,
    latestCaptureId: control.latestCaptureId,
    versionCount: control.versionCount,
    updatedAt: control.updatedAt,
  };
}
export function publicVersion(row: typeof historyVersions.$inferSelect): HistoryVersion {
  return {
    id: row.id,
    noteId: row.noteId,
    epoch: row.epoch,
    sequence: row.sequence,
    capturedAt: row.capturedAt,
    receivedAt: row.receivedAt,
    reason: row.reason,
    representation: row.representation,
    parentId: row.parentId,
    depth: row.depth,
    contentKey: row.contentKey,
    payloadKey: row.payloadKey,
  };
}

/** UUIDv7 operation order is durable across retries, even after its payload has expired. */
export async function claimOperation(
  tx: HistoryTx,
  control: HistoryControl,
  kind: 'write' | 'capture',
  originId: string,
  operationId: string,
  requestDigest: string,
) {
  const where = and(
    eq(historyOrigins.userId, control.userId),
    eq(historyOrigins.noteId, control.id),
    eq(historyOrigins.originId, originId),
    eq(historyOrigins.kind, kind),
  );
  const [previous] = await tx.select().from(historyOrigins).where(where);
  if (previous && operationId <= previous.lastOperationId) {
    if (operationId === previous.lastOperationId && requestDigest !== previous.digest)
      throw new HistoryFailure(
        'HISTORY_OPERATION_REUSED',
        'This operation was already used for different content.',
      );
    return false;
  }
  await tx
    .insert(historyOrigins)
    .values({
      userId: control.userId,
      noteId: control.id,
      originId,
      kind,
      lastOperationId: operationId,
      digest: requestDigest,
    })
    .onConflictDoUpdate({
      target: [
        historyOrigins.userId,
        historyOrigins.noteId,
        historyOrigins.originId,
        historyOrigins.kind,
      ],
      set: { lastOperationId: operationId, digest: requestDigest },
    });
  return true;
}

export async function historyArchive(
  tx: HistoryTx,
  control: HistoryControl,
  versionId: string,
): Promise<HistoryArchive> {
  const rows = await tx
    .select()
    .from(historyVersions)
    .where(versionScope(control.userId, control.id, control.epoch));
  const byId = new Map(rows.map((row) => [row.id, row]));
  let current = byId.get(versionId);
  if (!current)
    throw new HistoryFailure('HISTORY_PARENT_MISSING', 'This version is no longer available.');
  const chain: typeof rows = [];
  while (current) {
    if (chain.length >= HISTORY_ANCHOR_INTERVAL)
      throw new HistoryFailure('HISTORY_INTEGRITY', 'History has an invalid dependency chain.');
    chain.unshift(current);
    if (current.representation !== 'delta') {
      if (current.parentId !== null || current.depth !== 0)
        throw new HistoryFailure('HISTORY_INTEGRITY', 'History has an invalid snapshot.');
      break;
    }
    const parent: (typeof rows)[number] | undefined = current.parentId
      ? byId.get(current.parentId)
      : undefined;
    if (!parent || parent.depth !== current.depth - 1 || parent.sequence >= current.sequence)
      throw new HistoryFailure(
        'HISTORY_PARENT_MISSING',
        'A history dependency is no longer available.',
      );
    current = parent;
  }
  const payloads = await tx
    .select()
    .from(historyPayloads)
    .where(
      and(
        payloadScope(control.userId, control.id, control.epoch),
        inArray(
          historyPayloads.key,
          chain.map((row) => row.payloadKey),
        ),
      ),
    );
  const bytes = new Map(payloads.map((row) => [row.key, row.data]));
  return {
    epoch: control.epoch,
    versions: chain.map((row) => {
      const data = bytes.get(row.payloadKey);
      if (!data) throw new HistoryFailure('HISTORY_INTEGRITY', 'A history payload is missing.');
      return { ...publicVersion(row), format: 1, data: data.toString('base64') };
    }),
  };
}

export async function ordinaryHistoryState(
  tx: HistoryTx,
  control: HistoryControl,
  versionId: string,
): Promise<HistoryState> {
  const archive = await historyArchive(tx, control, versionId);
  let state: HistoryState | undefined;
  for (const row of archive.versions) {
    if (row.representation === 'vault-note')
      throw new HistoryFailure(
        'HISTORY_INTEGRITY',
        'This history encoding is not supported for an ordinary note.',
      );
    const bytes = Buffer.from(row.data, 'base64');
    if (digest(bytes) !== row.payloadKey)
      throw new HistoryFailure('HISTORY_INTEGRITY', 'History failed its integrity check.');
    try {
      state = decodeHistory(bytes, row.representation, state);
    } catch {
      throw new HistoryFailure('HISTORY_INTEGRITY', 'This version could not be decoded.');
    }
    if (digest(canonicalHistory(state)) !== row.contentKey)
      throw new HistoryFailure('HISTORY_INTEGRITY', 'History failed its content check.');
  }
  if (!state) throw new HistoryFailure('HISTORY_INTEGRITY', 'History has no content.');
  return state;
}

/** Retain dependencies for the newest 128 events; expired rows never become new checkpoints. */
async function pruneHistory(tx: HistoryTx, control: HistoryControl) {
  const rows = await tx
    .select()
    .from(historyVersions)
    .where(versionScope(control.userId, control.id, control.epoch))
    .orderBy(desc(historyVersions.sequence));
  const payloads = await tx
    .select({ key: historyPayloads.key, size: sql<number>`octet_length(${historyPayloads.data})` })
    .from(historyPayloads)
    .where(payloadScope(control.userId, control.id, control.epoch));
  const sizes = new Map(payloads.map((row) => [row.key, row.size]));
  const byId = new Map(rows.map((row) => [row.id, row]));
  const keep = new Set<string>();
  const keptPayloads = new Set<string>();
  let bytes = 0;
  let selectable = 0;
  for (const row of rows.slice(0, HISTORY_MAX_VERSIONS)) {
    const candidate: typeof rows = [];
    let current: typeof row | undefined = row;
    for (let depth = 0; current && depth < HISTORY_ANCHOR_INTERVAL; depth++) {
      candidate.push(current);
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
    const newKeys = new Set(
      candidate.map((entry) => entry.payloadKey).filter((key) => !keptPayloads.has(key)),
    );
    const extra = [...newKeys].reduce((sum, key) => sum + (sizes.get(key) ?? 0), 0);
    if (bytes + extra > HISTORY_MAX_BYTES) break;
    bytes += extra;
    for (const key of newKeys) keptPayloads.add(key);
    for (const entry of candidate) keep.add(entry.id);
    control.firstSequence = row.sequence;
    selectable++;
  }
  if (rows.length > keep.size) {
    await tx
      .delete(historyVersions)
      .where(
        and(
          versionScope(control.userId, control.id, control.epoch),
          notInArray(historyVersions.id, [...keep]),
        ),
      );
    await tx
      .delete(historyPayloads)
      .where(
        and(
          payloadScope(control.userId, control.id, control.epoch),
          sql`not exists (select 1 from ${historyVersions} where ${historyVersions.userId} = ${historyPayloads.userId} and ${historyVersions.noteId} = ${historyPayloads.noteId} and ${historyVersions.epoch} = ${historyPayloads.epoch} and ${historyVersions.payloadKey} = ${historyPayloads.key})`,
        ),
      );
  }
  control.versionCount = selectable;
}

export async function appendHistory(
  tx: HistoryTx,
  control: HistoryControl,
  input: Omit<HistoryCapture, 'kind' | 'originId'>,
) {
  const [latest] = await tx
    .select()
    .from(historyVersions)
    .where(versionScope(control.userId, control.id, control.epoch))
    .orderBy(desc(historyVersions.sequence))
    .limit(1);
  if (
    latest?.contentKey === input.contentKey &&
    input.reason !== 'before-restore' &&
    input.reason !== 'restored'
  )
    return { id: latest.id, added: false };
  const bytes = Buffer.from(input.data, 'base64');
  if (input.representation === 'delta') {
    const [parent] = await tx
      .select()
      .from(historyVersions)
      .where(
        and(
          versionScope(control.userId, control.id, control.epoch),
          eq(historyVersions.id, input.parentId ?? '00000000-0000-0000-0000-000000000000'),
        ),
      );
    if (!parent || parent.depth + 1 !== input.depth || parent.representation === 'vault-note')
      throw new HistoryFailure(
        'HISTORY_PARENT_MISSING',
        'The parent version has expired; send a full snapshot.',
      );
    const archive = await historyArchive(tx, control, parent.id);
    const chainBytes = archive.versions.reduce(
      (sum, entry) => sum + Buffer.from(entry.data, 'base64').length,
      0,
    );
    if (chainBytes + bytes.length > HISTORY_MAX_BYTES)
      throw new HistoryFailure(
        'HISTORY_PARENT_MISSING',
        'This chain is too large; send a full snapshot.',
      );
  } else if (input.depth !== 0 || input.parentId !== null)
    throw new HistoryFailure('HISTORY_INTEGRITY', 'Invalid snapshot dependency.');
  if (control.kind === 'note') {
    if (input.representation === 'vault-note' || digest(bytes) !== input.payloadKey)
      throw new HistoryFailure('HISTORY_INTEGRITY', 'History failed its payload check.');
    const prior = input.parentId
      ? await ordinaryHistoryState(tx, control, input.parentId)
      : undefined;
    let state: HistoryState;
    try {
      state = decodeHistory(bytes, input.representation, prior);
    } catch {
      throw new HistoryFailure('HISTORY_INTEGRITY', 'This checkpoint could not be decoded.');
    }
    if (state.files.length || digest(canonicalHistory(state)) !== input.contentKey)
      throw new HistoryFailure('HISTORY_INTEGRITY', 'History failed its content check.');
  }
  await tx
    .insert(historyPayloads)
    .values({
      userId: control.userId,
      noteId: control.id,
      epoch: control.epoch,
      key: input.payloadKey,
      data: bytes,
    })
    .onConflictDoNothing();
  if (bytes.length > HISTORY_MAX_BYTES)
    throw new HistoryFailure('HISTORY_INTEGRITY', 'This checkpoint is too large.');
  const now = new Date();
  control.nextSequence++;
  const { data: _data, ...descriptor } = input;
  const inserted = await tx
    .insert(historyVersions)
    .values({
      ...descriptor,
      noteId: control.id,
      epoch: control.epoch,
      userId: control.userId,
      sequence: control.nextSequence,
      // A checkpoint copied from an earlier one arrives now, whatever that one says.
      receivedAt: now,
      capturedAt: input.capturedAt > now ? now : input.capturedAt,
    })
    .onConflictDoNothing()
    .returning({ id: historyVersions.id });
  if (!inserted.length)
    throw new HistoryFailure('HISTORY_OPERATION_REUSED', 'This checkpoint id is already in use.');
  control.latestCaptureId = input.id;
  control.lastCheckpointAt = now;
  await pruneHistory(tx, control);
  await tx
    .update(noteHistory)
    .set({
      nextSequence: control.nextSequence,
      firstSequence: control.firstSequence,
      versionCount: control.versionCount,
      latestCaptureId: control.latestCaptureId,
      lastCheckpointAt: now,
    })
    .where(scope(control.userId, control.id));
  return { id: input.id, added: true };
}

export async function preserveOrdinary(
  tx: HistoryTx,
  control: HistoryControl,
  content: HistoryState['content'],
  reason: HistoryVersion['reason'],
) {
  const state: HistoryState = { content, files: [] };
  const contentKey = digest(canonicalHistory(state));
  const [latest] = await tx
    .select()
    .from(historyVersions)
    .where(versionScope(control.userId, control.id, control.epoch))
    .orderBy(desc(historyVersions.sequence))
    .limit(1);
  if (latest?.contentKey === contentKey && reason !== 'before-restore' && reason !== 'restored')
    return { id: latest.id, added: false };
  const previous = latest
    ? { state: await ordinaryHistoryState(tx, control, latest.id), depth: latest.depth }
    : undefined;
  const encoded = encodeHistory(state, previous);
  const input = {
    id: uuidv7(),
    noteId: control.id,
    epoch: control.epoch,
    capturedAt: new Date(),
    reason,
    representation: encoded.representation,
    parentId: encoded.representation === 'delta' ? (latest?.id ?? null) : null,
    depth: encoded.depth,
    contentKey,
    payloadKey: digest(encoded.data),
    sourceKey: contentKey,
    format: 1 as const,
    data: Buffer.from(encoded.data).toString('base64'),
  };
  try {
    return await appendHistory(tx, control, input);
  } catch (error) {
    if (!(error instanceof HistoryFailure) || error.code !== 'HISTORY_PARENT_MISSING') throw error;
    const bytes = packHistory(state);
    return appendHistory(tx, control, {
      ...input,
      representation: 'snapshot',
      parentId: null,
      depth: 0,
      payloadKey: digest(bytes),
      data: Buffer.from(bytes).toString('base64'),
    });
  }
}

export async function preserveVault(
  tx: HistoryTx,
  control: HistoryControl,
  data: string,
  reason: HistoryVersion['reason'],
) {
  const sourceKey = digest(data);
  const [known] = await tx
    .select()
    .from(historyVersions)
    .where(
      and(
        versionScope(control.userId, control.id, control.epoch),
        eq(historyVersions.sourceKey, sourceKey),
      ),
    )
    .orderBy(desc(historyVersions.sequence))
    .limit(1);
  if (known) {
    const archive = await historyArchive(tx, control, known.id);
    const selected = archive.versions.at(-1)!;
    return appendHistory(tx, control, {
      ...selected,
      id: uuidv7(),
      capturedAt: new Date(),
      reason,
      sourceKey,
    });
  }
  const bytes = Buffer.from(data, 'base64');
  return appendHistory(tx, control, {
    id: uuidv7(),
    noteId: control.id,
    epoch: control.epoch,
    capturedAt: new Date(),
    reason,
    representation: 'vault-note',
    parentId: null,
    depth: 0,
    contentKey: sourceKey,
    payloadKey: digest(bytes),
    sourceKey,
    format: 1,
    data,
  });
}

/** Capture the displaced server content, rather than trusting a stale client's preimage. */
export async function beforeContentWrite(
  tx: HistoryTx,
  control: HistoryControl,
  current: { content: HistoryState['content'] } | { data: string },
  envelope: HistoryWrite | undefined,
  body: unknown,
) {
  if (
    envelope &&
    !(await claimOperation(
      tx,
      control,
      'write',
      envelope.originId,
      envelope.operationId,
      digest(canonicalHistory(body)),
    ))
  )
    return false;
  const contentChanged =
    !('data' in current) || !envelope?.contentKey || envelope.contentKey !== control.lastContentKey;
  const newOrigin = !envelope || control.lastOriginId !== envelope.originId;
  if (
    contentChanged &&
    (newOrigin ||
      !control.lastCheckpointAt ||
      Date.now() - control.lastCheckpointAt.getTime() >= HISTORY_CONTINUOUS_MS)
  ) {
    if ('content' in current) await preserveOrdinary(tx, control, current.content, 'baseline');
    else await preserveVault(tx, control, current.data, 'baseline');
  }
  control.contentToken = uuidv7();
  await tx
    .update(noteHistory)
    .set({
      contentToken: control.contentToken,
      lastOriginId: envelope?.originId ?? null,
      lastContentKey: envelope?.contentKey ?? null,
    })
    .where(scope(control.userId, control.id));
  return true;
}

export async function deleteHistory(tx: HistoryTx, userId: string, noteId: string) {
  await tx.delete(noteHistory).where(scope(userId, noteId));
}
