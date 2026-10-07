import {
  blocksHaveContent,
  type Note,
  type NoteColor,
  positionBetween,
  type Vault,
  type VaultNotePayload,
} from '@catch/shared';
import type { Transaction } from '@tanstack/react-db';
import { useEffect } from 'react';
import { toast } from 'sonner';
import { uuidv7 } from 'uuidv7';
import { ApiError, api } from './api';
import { getSignedInUser } from './auth';
import { awaitVaultSync, vaultCollection, vaultNotesCollection, write } from './collections';
import { createStore } from './store';
import {
  createVaultKey,
  importVaultKey,
  openNote,
  openVaultKey,
  sealNote,
  sealUnderPassword,
} from './vaultCrypto';
import { forgetVaultKey, loadVaultKey, rememberVaultKey } from './vaultKeyStore';

/**
 * The vault (ADR 0020): notes the server only ever holds as ciphertext. The collections
 * sync and keep that ciphertext; this module holds the key while the vault is unlocked and
 * the notes it opens with it, both in memory only.
 */

/**
 * `loading` until the device knows whether the user has a vault, which a device that has
 * never synced one cannot tell offline.
 */
export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked';

export const vaultStatus = createStore<VaultStatus>('loading');
/** The vault's notes, opened. Empty unless unlocked. */
export const vaultNotes = createStore<readonly Note[]>([]);
/** How many notes the key could not open: sealed by a vault since replaced, or damaged. */
export const vaultUnreadable = createStore(0);
/** Whether this device keeps the key, so the vault opens without its password. */
export const vaultRemembered = createStore(false);

/** A hidden app locks a vault it does not remember once it has been away this long. */
const AUTO_LOCK_MS = 5 * 60_000;

type VaultChanges = Partial<Pick<Note, 'content' | 'color' | 'isPinned'>>;

let key: CryptoKey | null = null;
/** The vault the key belongs to; a vault deleted and set up again elsewhere has another. */
let keyVault: string | null = null;
let byId: ReadonlyMap<string, Note> = new Map();
// A note's words by its ciphertext, so a change to one note does not open them all again.
const opened = new Map<string, VaultNotePayload>();
/** A vault this device just made, until its row syncs back. */
let awaitingRow: string | null = null;
let started = false;
let refreshes = 0;

const userId = () => getSignedInUser()?.id ?? null;
const vaultRow = (): Vault | undefined => {
  const id = userId();
  return id ? vaultCollection.get(id) : undefined;
};
/** The recovery copy changes only when the key does, so it names the vault. */
const vaultIdentity = (vault: Pick<Vault, 'recoveryKey'>) => vault.recoveryKey;

/** Whether an id is a note in the unlocked vault. */
export const isVaultNote = (id: string) => byId.has(id);
export const getVaultNote = (id: string) => byId.get(id);

/** Locks: forgets the key and the notes it opened, in memory and in the device's keeping. */
function dropKey() {
  key = null;
  keyVault = null;
  awaitingRow = null;
  opened.clear();
  byId = new Map();
  vaultNotes.set([]);
  vaultUnreadable.set(0);
  vaultRemembered.set(false);
  const id = userId();
  return id ? forgetVaultKey(id) : Promise.resolve();
}

function refreshStatus() {
  const vault = vaultRow();
  if (!vault) {
    // Until the first sync, no row may only mean this device has not heard of the vault.
    const known = vaultCollection.isReady() && !(key && keyVault === awaitingRow);
    // Deleted on another device.
    if (key && known) void dropKey();
    vaultStatus.set(key ? 'unlocked' : known ? 'none' : 'loading');
    return;
  }
  awaitingRow = null;
  // Deleted and set up again on another device: this key opens none of the new vault.
  if (key && keyVault !== vaultIdentity(vault)) void dropKey();
  vaultStatus.set(key ? 'unlocked' : 'locked');
}

/** Opens every note the collection holds with the key, and publishes them. */
async function refreshNotes() {
  const current = ++refreshes;
  const owner = userId();
  const using = key;
  if (!owner || !using) return;
  const notes: Note[] = [];
  const seen = new Set<string>();
  let unreadable = 0;
  for (const row of vaultNotesCollection.values()) {
    seen.add(row.data);
    let payload = opened.get(row.data);
    if (!payload) {
      const result = await openNote(using, owner, row.id, row.data);
      if (current !== refreshes || key !== using) return;
      if (!result) {
        unreadable++;
        continue;
      }
      payload = result;
      opened.set(row.data, payload);
    }
    notes.push({
      id: row.id,
      userId: row.userId,
      content: payload.content,
      color: payload.color,
      isPinned: payload.isPinned,
      position: payload.position,
      status: null,
      isArchived: false,
      hiddenLinks: [],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: null,
    });
  }
  for (const data of opened.keys()) if (!seen.has(data)) opened.delete(data);
  byId = new Map(notes.map((note) => [note.id, note]));
  vaultNotes.set(notes);
  vaultUnreadable.set(unreadable);
}

async function adoptKey(raw: Uint8Array<ArrayBuffer>, vault: Pick<Vault, 'recoveryKey'>) {
  key = await importVaultKey(raw);
  // The browser keeps the key from here; this copy of its bytes has no further use.
  raw.fill(0);
  keyVault = vaultIdentity(vault);
  refreshStatus();
  await refreshNotes();
}

async function setRemembered(remember: boolean) {
  const id = userId();
  if (!id) return;
  if (remember && key && keyVault) await rememberVaultKey(id, { key, vault: keyVault });
  else await forgetVaultKey(id);
  vaultRemembered.set(remember && key !== null);
}

/** Starts following the vault. Pages that show it call this through `useVault`. */
function start() {
  if (started) return;
  started = true;
  vaultCollection.subscribeChanges(refreshStatus, { includeInitialState: true });
  vaultCollection.onFirstReady(refreshStatus);
  vaultNotesCollection.subscribeChanges(() => void refreshNotes(), { includeInitialState: true });
  void restoreKey();

  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    // Checked on return rather than with a timer, which a sleeping phone does not run.
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    if (key && !vaultRemembered.get() && away >= AUTO_LOCK_MS) void lockVault();
  });
}

/** Unlocks with the key this device was asked to remember, if it still fits the vault. */
async function restoreKey() {
  const id = userId();
  if (!id || key) return;
  const kept = await loadVaultKey(id);
  if (!kept || key) return;
  const vault = vaultRow();
  if (vault && kept.vault !== vaultIdentity(vault)) {
    await forgetVaultKey(id);
    return;
  }
  key = kept.key;
  keyVault = kept.vault;
  vaultRemembered.set(true);
  refreshStatus();
  await refreshNotes();
}

/** The vault's status, kept current while the calling component is mounted. */
export function useVault() {
  useEffect(start, []);
  return vaultStatus.use();
}

export class VaultError extends Error {}

function requireUser() {
  const id = userId();
  if (!id) throw new VaultError('Sign in to use the vault.');
  // Browsers only offer Web Crypto to pages served over HTTPS (or from localhost).
  if (!globalThis.crypto?.subtle) {
    throw new VaultError('The vault needs Catch to be opened over HTTPS.');
  }
  return id;
}

/** What went wrong with a request, in words for the form that made it. */
function requestFailure(error: unknown, conflict?: string) {
  if (error instanceof VaultError) return error;
  if (error instanceof ApiError && error.status === 409 && conflict)
    return new VaultError(conflict);
  return new VaultError('Could not reach the server. The vault needs a connection for this.');
}

/**
 * Sets the vault up and unlocks it. Returns the recovery code, which exists nowhere else:
 * the caller must show it.
 */
export async function createVault(password: string, remember: boolean) {
  const id = requireUser();
  const { raw, vault, recoveryCode } = await createVaultKey(id, password);
  try {
    await awaitVaultSync((await api.createVault(vault)).txid);
  } catch (error) {
    throw requestFailure(error, 'This account already has a vault. Unlock it instead.');
  }
  awaitingRow = vaultIdentity(vault);
  await adoptKey(raw, vault);
  await setRemembered(remember);
  return recoveryCode;
}

/** Unlocks the vault. False for a wrong password. */
export async function unlockVault(password: string, remember: boolean) {
  const id = requireUser();
  const vault = vaultRow();
  if (!vault) return false;
  const raw = await openVaultKey(id, vault, { password });
  if (!raw) return false;
  await adoptKey(raw, vault);
  await setRemembered(remember);
  return true;
}

/**
 * Unlocks the vault with the recovery code and gives it a new password. False for a wrong
 * code. The code stays valid.
 */
export async function recoverVault(recoveryCode: string, password: string, remember: boolean) {
  const id = requireUser();
  const vault = vaultRow();
  if (!vault) return false;
  const raw = await openVaultKey(id, vault, { recoveryCode });
  if (!raw) return false;
  await resealVault(id, vault, raw, password);
  await adoptKey(raw, vault);
  await setRemembered(remember);
  return true;
}

/** Changes the vault password. False when the current one is wrong. */
export async function changeVaultPassword(current: string, next: string) {
  const id = requireUser();
  const vault = vaultRow();
  if (!vault) return false;
  const raw = await openVaultKey(id, vault, { password: current });
  if (!raw) return false;
  try {
    await resealVault(id, vault, raw, next);
  } finally {
    raw.fill(0);
  }
  return true;
}

async function resealVault(
  id: string,
  vault: Vault,
  raw: Uint8Array<ArrayBuffer>,
  password: string,
) {
  const sealed = await sealUnderPassword(id, raw, password);
  try {
    await awaitVaultSync((await api.saveVault({ ...sealed, recoveryKey: vault.recoveryKey })).txid);
  } catch (error) {
    throw requestFailure(error);
  }
}

/** Locks the vault and has this device forget its key. */
export async function lockVault() {
  // Let a note being sealed reach the outbox before the key goes.
  await queue;
  await dropKey();
  refreshStatus();
}

/** Whether this device keeps the key between visits. Only an unlocked vault can start to. */
export const rememberVault = (remember: boolean) => setRemembered(remember);

/** Deletes the vault and every note in it, for good, on every device. */
export async function deleteVault() {
  requireUser();
  try {
    await awaitVaultSync((await api.deleteVault()).txid);
  } catch (error) {
    throw requestFailure(error);
  }
  await dropKey();
  refreshStatus();
}

// Sealing is asynchronous, so changes wait their turn: each builds on the one before it.
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

function unlocked() {
  const id = userId();
  if (!id || !key) throw new VaultError('The vault is locked.');
  return { id, key };
}

const payloadOf = (note: Note): VaultNotePayload => ({
  v: 1,
  content: note.content,
  color: note.color,
  isPinned: note.isPinned,
  position: note.position,
});

/** Adds a note to the vault, ahead of its other notes. Settles once it can be opened. */
export function createVaultNote(input: { content: Note['content']; color?: NoteColor }) {
  return enqueue(async () => {
    const { id: owner, key } = unlocked();
    let first: string | null = null;
    for (const note of byId.values()) {
      if (first === null || note.position < first) first = note.position;
    }
    const id = uuidv7();
    const payload: VaultNotePayload = {
      v: 1,
      content: input.content,
      color: input.color ?? 'default',
      isPinned: false,
      position: positionBetween(null, first),
    };
    const data = await sealNote(key, owner, id, payload);
    opened.set(data, payload);
    const now = new Date();
    const transaction = write(() =>
      vaultNotesCollection.insert({ id, userId: owner, data, createdAt: now, updatedAt: now }),
    );
    await refreshNotes();
    return { id, transaction };
  });
}

/**
 * Changes a vault note. A note is sealed whole, so unlike other notes the last device to
 * save one replaces all of it. Resolves to the write, whose `isPersisted.promise` settles
 * once the server has it.
 */
export function updateVaultNote(id: string, changes: VaultChanges): Promise<Transaction> {
  return enqueue(async () => {
    const { id: owner, key } = unlocked();
    const note = byId.get(id);
    if (!note) throw new VaultError('This note is no longer in the vault.');
    const payload = { ...payloadOf(note), ...changes };
    const data = await sealNote(key, owner, id, payload);
    opened.set(data, payload);
    const transaction = write(() =>
      vaultNotesCollection.update(id, (draft) => {
        draft.data = data;
        draft.updatedAt = new Date();
      }),
    );
    await refreshNotes();
    return transaction;
  });
}

async function removeNote(id: string) {
  if (!vaultNotesCollection.has(id)) return;
  write(() => vaultNotesCollection.delete(id));
  await refreshNotes();
}

/** Deletes a vault note for good: the vault has no trash, only this chance to undo. */
export function deleteVaultNote(id: string) {
  return enqueue(async () => {
    const note = byId.get(id);
    await removeNote(id);
    if (!note) return;
    toast('Note deleted', {
      action: { label: 'Undo', onClick: () => void restoreVaultNote(note) },
    });
  });
}

function restoreVaultNote(note: Note) {
  return enqueue(async () => {
    const { id: owner, key } = unlocked();
    if (vaultNotesCollection.has(note.id)) return;
    const payload = payloadOf(note);
    const data = await sealNote(key, owner, note.id, payload);
    opened.set(data, payload);
    write(() =>
      vaultNotesCollection.insert({
        id: note.id,
        userId: owner,
        data,
        createdAt: note.createdAt,
        updatedAt: new Date(),
      }),
    );
    await refreshNotes();
  });
}

/**
 * As `discardIfEmpty` for other notes: a vault note closed without content is deleted. It
 * waits its turn, so a save still being sealed counts as content.
 */
export function discardVaultNoteIfEmpty(id: string) {
  return enqueue(async () => {
    const note = byId.get(id);
    if (!note || blocksHaveContent(note.content)) return false;
    await removeNote(id);
    toast('Empty note discarded');
    return true;
  });
}

/** A note in the unlocked vault, kept current. Undefined once the vault locks. */
export function useVaultNote(id: string | undefined) {
  vaultNotes.use();
  return id ? byId.get(id) : undefined;
}
