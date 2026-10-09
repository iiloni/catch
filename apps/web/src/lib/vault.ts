import type {
  Attachment,
  Note,
  NoteTags,
  Reminder,
  Vault,
  VaultFile,
  VaultNotePayload,
} from '@catch/shared';
import { useEffect } from 'react';
import { ApiError, api } from './api';
import { closeSealedFiles, setSealedFiles } from './attachmentFiles';
import { getSignedInUser } from './auth';
import {
  awaitVaultSync,
  publishVaultAssignments,
  remindersCollection,
  vaultCollection,
  vaultNotesCollection,
} from './collections';
import { createStore } from './store';
import {
  createVaultKey,
  importFileKey,
  openFile,
  openFromDevice,
  openNote,
  openVaultKey,
  sealForDevice,
  sealNote,
  sealUnderPassword,
} from './vaultCrypto';
import { forgetVaultKey, loadVaultKey, rememberVaultKey, vaultSeenKey } from './vaultKeyStore';

/**
 * The vault (ADR 0020): notes the server only ever holds as ciphertext. The collections
 * sync and keep that ciphertext; this module holds the key while the vault is unlocked and
 * the notes it opens with it, both in memory only.
 *
 * The rest of the app reaches vault notes through `lib/noteStore.ts`, which sends each
 * change to the notes collection or to here by the note's id.
 */

/**
 * `loading` until the device knows whether the user has a vault, which a device that has
 * never synced one cannot tell offline.
 */
export type VaultStatus = 'loading' | 'none' | 'locked' | 'unlocked';

export const vaultStatus = createStore<VaultStatus>('loading');
/** Whether the pages show the vault's notes in place of the ordinary ones. */
export const vaultMode = createStore(false);
/** Whether the form that sets the vault up or unlocks it is asked for. */
export const vaultPrompt = createStore(false);
/** The vault's notes, opened. Empty unless unlocked. */
export const vaultNotes = createStore<readonly Note[]>([]);
/** How many notes the key could not open: sealed by a vault since replaced, or damaged. */
export const vaultUnreadable = createStore(0);
/** Whether this device keeps the key, so the vault opens without its password. */
export const vaultRemembered = createStore(false);

/** A hidden app locks a vault it does not remember once it has been away this long. */
const AUTO_LOCK_MS = 5 * 60_000;

type Bytes = Uint8Array<ArrayBuffer>;
type Tags = Pick<NoteTags, 'primaryTagId' | 'secondaryTagIds'>;
type Entry = {
  note: Note;
  tags: Tags;
  files: readonly VaultFile[];
  reminder: Reminder | null;
};

let key: Bytes | null = null;
/** The same key as Web Crypto holds it, for sealing files. */
let fileKey: CryptoKey | null = null;
/** The vault the key belongs to; a vault deleted and set up again elsewhere has another. */
let keyVault: string | null = null;
/** A vault this device just made, until its row syncs back. */
let awaitingRow: string | null = null;
let entries: ReadonlyMap<string, Entry> = new Map();
/** Every file in the unlocked vault, by its id. */
let files: ReadonlyMap<string, { noteId: string; file: VaultFile }> = new Map();
// A note's words by its ciphertext, so a change to one note does not open them all again.
const opened = new Map<string, VaultNotePayload>();
/** The opened note each published one was made from. */
const shown = new Map<string, VaultNotePayload>();
let started = false;

/** Called before the key goes, so an editor can save what it still holds. */
export const beforeVaultLock = new Set<() => void>();

const userId = () => getSignedInUser()?.id ?? null;
const vaultRow = (): Vault | undefined => {
  const id = userId();
  return id ? vaultCollection.get(id) : undefined;
};
/** The recovery copy changes only when the key does, so it names the vault. */
const vaultIdentity = (vault: Pick<Vault, 'recoveryKey'>) => vault.recoveryKey;

/** Whether an id is a note in the unlocked vault. */
export const isVaultNote = (id: string) => entries.has(id);
export const getVaultNote = (id: string) => entries.get(id)?.note;
/** A vault note's tags, in the shape other notes' assignments have. */
export function getVaultNoteTags(id: string): NoteTags | undefined {
  const entry = entries.get(id);
  return entry && { id, userId: entry.note.userId, ...entry.tags };
}
export const isVaultMode = () => vaultMode.get();

/** A vault note's files, as the attachments any note has. */
export function getVaultFiles(noteId: string): Attachment[] {
  const entry = entries.get(noteId);
  if (!entry) return [];
  return entry.files.map(({ thumbnailId: _thumbnail, sealId: _seal, ...file }) => ({
    ...file,
    userId: entry.note.userId,
    noteId,
    status: 'ready',
    sourceId: null,
    deletedAt: null,
  }));
}
/** A vault note's files as the note keeps them, with what each was sealed as. */
export const getSealedFiles = (noteId: string) => entries.get(noteId)?.files ?? [];
/** The vault note a file is in, if it is in one. */
export const vaultFileNote = (fileId: string) => files.get(fileId)?.noteId;

/** Tells the device's file store which files are sealed, and how to open them. */
const sealedFile: Parameters<typeof setSealedFiles>[0] = (id, preview) => {
  const found = files.get(id);
  const owner = userId();
  if (!found || !fileKey || !owner) return undefined;
  const { file } = found;
  const key = fileKey;
  // An image with no thumbnail of its own is shown as it is, as a new one is anywhere.
  const thumbnail = preview && file.thumbnailId !== null;
  if (preview && !thumbnail && file.kind !== 'image') return null;
  return {
    id: thumbnail ? file.thumbnailId! : file.id,
    open: (sealed) =>
      openFile(
        key,
        owner,
        file.sealId,
        thumbnail ? 'thumbnail' : 'content',
        sealed,
        thumbnail ? 'image/webp' : file.mimeType,
      ),
  };
};

/** The key for sealing and opening the vault's files, while it is unlocked. */
export const vaultFileKey = () => fileKey;

function publish(next: ReadonlyMap<string, Entry>, unreadable = vaultUnreadable.get()) {
  entries = next;
  files = new Map(
    [...next].flatMap(([noteId, entry]) =>
      entry.files.map((file) => [file.id, { noteId, file }] as const),
    ),
  );
  vaultNotes.set([...next.values()].map((entry) => entry.note));
  vaultUnreadable.set(unreadable);
  publishVaultAssignments(
    new Map(
      [...next].flatMap(([id, entry]) =>
        entry.tags.primaryTagId || entry.tags.secondaryTagIds.length > 0
          ? [[id, { id, userId: entry.note.userId, ...entry.tags }]]
          : [],
      ),
    ),
  );
}

/** Locks: forgets the key and the notes it opened, in memory and in the device's keeping. */
function dropKey() {
  if (key) for (const save of beforeVaultLock) save();
  key?.fill(0);
  key = null;
  fileKey = null;
  keyVault = null;
  awaitingRow = null;
  opened.clear();
  shown.clear();
  publish(new Map(), 0);
  closeSealedFiles();
  vaultMode.set(false);
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
    const id = userId();
    if (known && id) localStorage.removeItem(vaultSeenKey(id));
    vaultStatus.set(key ? 'unlocked' : known ? 'none' : 'loading');
    return;
  }
  awaitingRow = null;
  localStorage.setItem(vaultSeenKey(vault.userId), 'true');
  // Deleted and set up again on another device: this key opens none of the new vault.
  if (key && keyVault !== vaultIdentity(vault)) void dropKey();
  vaultStatus.set(key ? 'unlocked' : 'locked');
}

const fromPayload = (
  row: { id: string; userId: string; createdAt: Date },
  payload: VaultNotePayload,
): Entry => ({
  note: {
    id: row.id,
    userId: row.userId,
    content: payload.content,
    color: payload.color,
    status: payload.status,
    isPinned: payload.isPinned,
    isArchived: payload.isArchived,
    position: payload.position,
    hiddenLinks: [],
    galleryPreviewUrl: null,
    createdAt: row.createdAt,
    updatedAt: payload.updatedAt,
    deletedAt: payload.deletedAt,
  },
  tags: { primaryTagId: payload.primaryTagId, secondaryTagIds: payload.secondaryTagIds },
  files: payload.files,
  reminder: payload.reminder,
});

const toPayload = ({ note, tags, files, reminder }: Entry): VaultNotePayload => ({
  v: 1,
  content: note.content,
  color: note.color,
  status: note.status,
  isPinned: note.isPinned,
  isArchived: note.isArchived,
  position: note.position,
  deletedAt: note.deletedAt,
  updatedAt: note.updatedAt,
  primaryTagId: tags.primaryTagId,
  secondaryTagIds: tags.secondaryTagIds,
  files: [...files],
  reminder,
});

/** Opens every note the collection holds with the key, and publishes them. */
function refreshNotes() {
  const owner = userId();
  if (!owner || !key) return;
  const next = new Map<string, Entry>();
  const seen = new Set<string>();
  let unreadable = 0;
  for (const row of vaultNotesCollection.values()) {
    seen.add(row.data);
    let payload = opened.get(row.data);
    if (!payload) {
      const result = openNote(key, owner, row.id, row.data);
      if (!result) {
        unreadable++;
        continue;
      }
      payload = result;
      opened.set(row.data, payload);
    }
    // Unchanged notes keep their objects, so their cards do not draw again.
    const current = entries.get(row.id);
    next.set(
      row.id,
      current && shown.get(row.id) === payload ? current : fromPayload(row, payload),
    );
    shown.set(row.id, payload);
  }
  for (const data of opened.keys()) if (!seen.has(data)) opened.delete(data);
  for (const id of shown.keys()) if (!next.has(id)) shown.delete(id);
  publish(next, unreadable);
}

async function adoptKey(raw: Bytes, vault: Pick<Vault, 'recoveryKey'>) {
  fileKey = await importFileKey(raw);
  key = raw;
  keyVault = vaultIdentity(vault);
  refreshStatus();
  refreshNotes();
}

async function setRemembered(remember: boolean) {
  const id = userId();
  if (!id) return;
  if (remember && key && keyVault) {
    await rememberVaultKey(id, { ...(await sealForDevice(key)), vault: keyVault });
  } else await forgetVaultKey(id);
  vaultRemembered.set(remember && key !== null);
}

/**
 * Whether this device has seen the user's vault. Only then does the app follow the vault
 * from the start: a user without one never asks the server for it.
 */
export function hasSeenVault() {
  const id = userId();
  return id !== null && localStorage.getItem(vaultSeenKey(id)) === 'true';
}

/** Starts following the vault: at launch on a device that has seen it, or when first asked for. */
export function startVault() {
  if (started) return;
  started = true;
  setSealedFiles(sealedFile);
  vaultCollection.subscribeChanges(refreshStatus, { includeInitialState: true });
  vaultCollection.onFirstReady(refreshStatus);
  vaultNotesCollection.subscribeChanges(refreshNotes, { includeInitialState: true });
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
  const raw =
    vault && kept.vault !== vaultIdentity(vault)
      ? null
      : await openFromDevice(kept.deviceKey, kept.sealed);
  if (!raw || key) {
    if (!raw) await forgetVaultKey(id);
    return;
  }
  await adoptKey(raw, { recoveryKey: kept.vault });
  vaultRemembered.set(true);
}

/** The vault's status, kept current while the calling component is mounted. */
export function useVault() {
  useEffect(startVault, []);
  return vaultStatus.use();
}

/** The vault's notes while the pages are showing the vault, or null while they are not. */
export function useVaultView(): readonly Note[] | null {
  const mode = vaultMode.use();
  const notes = vaultNotes.use();
  return mode ? notes : null;
}

/** A note in the unlocked vault, kept current. Undefined once the vault locks. */
export function useVaultNote(id: string | undefined) {
  vaultNotes.use();
  return id ? entries.get(id)?.note : undefined;
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

async function resealVault(id: string, vault: Vault, raw: Bytes, password: string) {
  const sealed = await sealUnderPassword(id, raw, password);
  try {
    await awaitVaultSync((await api.saveVault({ ...sealed, recoveryKey: vault.recoveryKey })).txid);
  } catch (error) {
    throw requestFailure(
      error,
      'This vault was deleted and set up again on another device. Reload to use the new one.',
    );
  }
}

/** Locks the vault and has this device forget its key. */
export async function lockVault() {
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

/** Shows the vault's notes, asking for it to be set up or unlocked first if need be. */
export function enterVault() {
  startVault();
  if (key) vaultMode.set(true);
  else vaultPrompt.set(true);
}

/** Back to the ordinary notes. A device that does not remember the vault locks it. */
export function leaveVault() {
  if (vaultRemembered.get()) vaultMode.set(false);
  else void lockVault();
}

/**
 * Runs `then` inside the vault when the id is one of its notes, as when a reminder is
 * opened from outside: a locked vault asks for its password first. False for any other note.
 */
export function inVaultFor(id: string, then: () => void) {
  if (!vaultNotesCollection.has(id)) return false;
  enterVault();
  if (vaultMode.get()) {
    then();
    return true;
  }
  const stop = () => {
    stopMode();
    stopPrompt();
  };
  const stopMode = vaultMode.subscribe(() => {
    if (!vaultMode.get()) return;
    stop();
    then();
  });
  // Entering sets the mode before it closes the form, so a form closed first was dismissed.
  const stopPrompt = vaultPrompt.subscribe(() => {
    if (!vaultPrompt.get()) stop();
  });
  return true;
}

/**
 * As `inVaultFor`, for an id found in the address when the app starts: the device's copy of
 * the vault may still be loading, so this waits a while for the note to turn up in it.
 */
export function openIfVaultNote(id: string, then: () => void) {
  if (inVaultFor(id, then) || !hasSeenVault()) return;
  startVault();
  const done = () => {
    subscription.unsubscribe();
    window.clearTimeout(timer);
  };
  const subscription = vaultNotesCollection.subscribeChanges(() => {
    if (!vaultNotesCollection.has(id)) return;
    done();
    inVaultFor(id, then);
  });
  const timer = window.setTimeout(done, 10_000);
}

function unlocked() {
  const id = userId();
  if (!id || !key) throw new VaultError('The vault is locked.');
  return { id, key };
}

/**
 * The changes below belong inside `write()`, like changes to any synced collection: each
 * seals the note and puts the ciphertext in the collection, and so in the outbox.
 */

function store(entry: Entry, exists: boolean) {
  const { id: owner, key } = unlocked();
  const payload = toPayload(entry);
  const data = sealNote(key, owner, entry.note.id, payload);
  opened.set(data, payload);
  shown.set(entry.note.id, payload);
  if (exists) {
    vaultNotesCollection.update(entry.note.id, (draft) => {
      draft.data = data;
      draft.updatedAt = new Date();
    });
  } else {
    vaultNotesCollection.insert({
      id: entry.note.id,
      userId: owner,
      data,
      createdAt: entry.note.createdAt,
      updatedAt: entry.note.updatedAt,
    });
  }
  const next = new Map(entries);
  next.set(entry.note.id, entry);
  publish(next);
}

/** Adds a note to the vault, with its tags and files if it has any. */
export function insertVaultNote(note: Note, tags?: Tags, files: readonly VaultFile[] = []) {
  store(
    { note, tags: tags ?? { primaryTagId: null, secondaryTagIds: [] }, files, reminder: null },
    vaultNotesCollection.has(note.id),
  );
}

/**
 * Changes a vault note. A note is sealed whole, so unlike other notes the last device to
 * save one replaces all of it.
 */
export function changeVaultNote(id: string, change: (draft: Note) => void) {
  const entry = entries.get(id);
  if (!entry) throw new VaultError('This note is no longer in the vault.');
  const note = { ...entry.note };
  change(note);
  let reminder = entry.reminder;
  // The server holds back a trashed note's reminder, but cannot see that a vault note is in
  // the trash. So the reminder comes off as the note goes in, kept sealed in the note, and
  // goes back on when the note comes out.
  if (!entry.note.deletedAt && note.deletedAt) {
    const row = remindersCollection.get(id);
    if (row) {
      reminder = { ...row };
      remindersCollection.delete(id);
    }
  } else if (entry.note.deletedAt && !note.deletedAt && reminder) {
    if (!remindersCollection.has(id)) remindersCollection.insert({ ...reminder });
    reminder = null;
  }
  store({ ...entry, note, reminder }, true);
}

export function changeVaultNoteTags(id: string, change: (draft: Tags) => void) {
  const entry = entries.get(id);
  if (!entry) throw new VaultError('This note is no longer in the vault.');
  const tags = { ...entry.tags };
  change(tags);
  store({ ...entry, tags }, true);
}

/** Changes which files a vault note holds, or what they are called. */
export function changeVaultNoteFiles(id: string, change: (files: VaultFile[]) => VaultFile[]) {
  const entry = entries.get(id);
  if (!entry) throw new VaultError('This note is no longer in the vault.');
  store({ ...entry, files: change([...entry.files]) }, true);
}

/** Deletes a vault note for good. */
export function removeVaultNote(id: string) {
  if (!vaultNotesCollection.has(id)) return;
  vaultNotesCollection.delete(id);
  const next = new Map(entries);
  next.delete(id);
  shown.delete(id);
  publish(next);
}
