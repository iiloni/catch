import type {
  Attachment,
  HistoryState,
  Note,
  NoteTags,
  Reminder,
  Vault,
  VaultFile,
  VaultNote,
  VaultNotePayload,
} from '@catch/shared';
import { canonicalHistory, historyReading } from '@catch/shared';
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
import {
  clearHistoryContentKeys,
  historyVaultLocked,
  rememberHistoryContentKey,
} from './historyEvents';
import { stopHistoryWorker } from './historyWorker';
import { createStore } from './store';
import {
  BiometricError,
  biometricsSupported,
  forgetBiometricKey,
  openWithBiometrics,
  sealWithBiometrics,
} from './vaultBiometrics';
import {
  createVaultKey,
  importFileKey,
  openFile,
  openFromDevice,
  openNote,
  openVaultHistory,
  openVaultKey,
  openWithPin,
  sealForDevice,
  sealNote,
  sealUnderPassword,
  sealUnderPin,
  sealVaultHistory,
  vaultHistoryIdentity,
} from './vaultCrypto';
import {
  forgetVaultBiometric,
  forgetVaultDevice,
  forgetVaultKey,
  forgetVaultPin,
  type KeptVaultPin,
  keepVaultBiometric,
  keepVaultPin,
  loadVaultBiometric,
  loadVaultKey,
  loadVaultPin,
  rememberVaultKey,
  vaultSeenKey,
} from './vaultKeyStore';

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
/**
 * The PIN this device opens the vault with in place of its password, if it has one: how many
 * digits it has and how many more wrong ones it takes before the device forgets it.
 */
export const vaultPin = createStore<{ length: number; left: number } | null>(null);
/** Whether this device opens the vault with a fingerprint, tried before the PIN (Android only). */
export const vaultBiometrics = createStore(false);
/**
 * Set when the phone's fingerprints changed, which turns fingerprint unlock off, until the
 * next unlock with the PIN or password offers to turn it on again.
 */
export const vaultBiometricsLost = createStore(false);

/** Wrong PINs in a row before the device forgets its PIN and asks for the password. */
export const PIN_ATTEMPTS = 5;
/** A hidden app locks a vault it does not remember once it has been away this long. */
const AUTO_LOCK_MS = 5 * 60_000;
/**
 * With a PIN or a fingerprint, opening the vault again is quick, so it locks sooner: a minute
 * after the app is hidden (as when the phone's screen goes off), and after five minutes on
 * screen with nobody touching it, as on a computer left open.
 */
const QUICK_AUTO_LOCK_MS = 60_000;
const IDLE_LOCK_MS = 5 * 60_000;
const IDLE_CHECK_MS = 15_000;

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
/** The vault this device's PIN opens, once it has been read. */
let pinVault: string | null = null;
/** The vault this device's fingerprint opens, once it has been read. */
let biometricVault: string | null = null;
/** When someone last touched the app, for locking a vault left open. */
let lastActive = Date.now();
let idleTimer: ReturnType<typeof setInterval> | null = null;
let entries: ReadonlyMap<string, Entry> = new Map();
/** Every file in the unlocked vault, by its id. */
let files: ReadonlyMap<string, { noteId: string; file: VaultFile }> = new Map();
// A note's words by its ciphertext, so a change to one note does not open them all again.
const opened = new Map<string, VaultNotePayload>();
/** The opened note each published one was made from. */
const shown = new Map<string, VaultNotePayload>();
let started = false;

/** Called before the key goes, so an editor can save what it still holds. */
export const beforeVaultLock = new Set<() => void | Promise<void>>();

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

/**
 * Locks: forgets the key and the notes it opened. The device forgets the key it remembers;
 * a PIN set here stays for the next unlock, unless the vault it opens is gone (`everything`).
 */
let dropping: Promise<void> | null = null;
function dropKey(forget: 'remembered' | 'everything' = 'remembered'): Promise<void> {
  dropping ??= dropKeyNow().finally(() => {
    dropping = null;
  });
  return dropping.then(() => forgetOnDevice(forget));
}
async function forgetOnDevice(forget: 'remembered' | 'everything') {
  const id = userId();
  if (!id) return;
  if (forget === 'remembered') return forgetVaultKey(id);
  clearPin();
  clearBiometrics();
  await forgetVaultDevice(id);
}
async function dropKeyNow() {
  // A save that fails must not leave the vault open: its owner reports it, and the key goes.
  if (key)
    for (const save of beforeVaultLock) {
      try {
        await save();
      } catch {}
    }
  stopHistoryWorker();
  clearHistoryContentKeys();
  for (const clear of historyVaultLocked) clear();
  key?.fill(0);
  key = null;
  fileKey = null;
  keyVault = null;
  awaitingRow = null;
  if (idleTimer !== null) clearInterval(idleTimer);
  idleTimer = null;
  opened.clear();
  shown.clear();
  publish(new Map(), 0);
  closeSealedFiles();
  vaultMode.set(false);
  vaultRemembered.set(false);
}

function refreshStatus() {
  const vault = vaultRow();
  if (!vault) {
    // Until the first sync, no row may only mean this device has not heard of the vault.
    const known = vaultCollection.isReady() && !(key && keyVault === awaitingRow);
    // Deleted on another device.
    if (key && known) void dropKey('everything');
    const id = userId();
    if (known && id) {
      localStorage.removeItem(vaultSeenKey(id));
      if (pinVault) void dropPin(id);
      if (biometricVault) void dropBiometrics(id);
    }
    vaultStatus.set(key ? 'unlocked' : known ? 'none' : 'loading');
    return;
  }
  awaitingRow = null;
  localStorage.setItem(vaultSeenKey(vault.userId), 'true');
  // Deleted and set up again on another device: this key opens none of the new vault.
  const identity = vaultIdentity(vault);
  if (key && keyVault !== identity) void dropKey('everything');
  else {
    if (pinVault && pinVault !== identity) void dropPin(vault.userId);
    if (biometricVault && biometricVault !== identity) void dropBiometrics(vault.userId);
  }
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
  lastActive = Date.now();
  idleTimer ??= setInterval(lockIfIdle, IDLE_CHECK_MS);
  refreshStatus();
  refreshNotes();
}

/** Whether the vault locks on its own here: always, unless the device remembers it. */
const locksItself = () => key !== null && !vaultRemembered.get();
/** Whether the vault opens here without its password: with a PIN or a fingerprint. */
const quickUnlock = () => vaultPin.get() !== null || vaultBiometrics.get();

function lockIfIdle() {
  if (!locksItself() || !quickUnlock() || document.visibilityState !== 'visible') return;
  if (Date.now() - lastActive >= IDLE_LOCK_MS) void lockVault();
}

async function setRemembered(remember: boolean) {
  const id = userId();
  if (!id) return;
  if (remember && key && keyVault) {
    // A vault that stays open has nothing for a PIN or a fingerprint to open. First, so one
    // the device fails to forget leaves the vault as it was.
    await forgetPin(id);
    await forgetBiometrics(id);
    await rememberVaultKey(id, { ...(await sealForDevice(key)), vault: keyVault });
  } else await forgetVaultKey(id);
  vaultRemembered.set(remember && key !== null);
}

function clearPin() {
  pinVault = null;
  vaultPin.set(null);
}

/** Forgets this device's PIN. Throws, leaving it set, when the device could not delete it. */
async function forgetPin(id: string) {
  await forgetVaultPin(id);
  clearPin();
}

/**
 * Lets go of a PIN that opens nothing any longer: used up, or for a vault since replaced.
 * It goes even if the device fails to delete it, since such a PIN is never tried again.
 */
async function dropPin(id: string) {
  clearPin();
  try {
    await forgetVaultPin(id);
  } catch {}
}

function clearBiometrics() {
  biometricVault = null;
  vaultBiometrics.set(false);
}

/**
 * Turns fingerprint unlock off. Throws, leaving it on, when the device could not delete its
 * Keystore key or its sealed copy. The key goes first: without it no copy opens.
 */
async function forgetBiometrics(id: string) {
  await forgetBiometricKey(id);
  await forgetVaultBiometric(id);
  clearBiometrics();
}

/** As `dropPin`, for a fingerprint that opens nothing any longer. */
async function dropBiometrics(id: string) {
  clearBiometrics();
  await forgetBiometricKey(id).catch(() => {});
  await forgetVaultBiometric(id).catch(() => {});
}

/** Whether a kept PIN may still be tried: it is for this vault and has tries left. */
const usablePin = (kept: KeptVaultPin, vault: Pick<Vault, 'recoveryKey'> | undefined) =>
  kept.failures < PIN_ATTEMPTS && (!vault || kept.vault === vaultIdentity(vault));

const pinState = (kept: { length: number; failures: number }) => ({
  length: kept.length,
  left: Math.max(0, PIN_ATTEMPTS - kept.failures),
});

/**
 * Whether a PIN or fingerprint kept for `vault` may still open the user's vault. Read when
 * the device reads them, which can end after the first sync: `refreshStatus` saw no PIN or
 * fingerprint to drop then, so a vault deleted meanwhile is caught here.
 */
function forThisVault(vault: string) {
  const row = vaultRow();
  return row ? vault === vaultIdentity(row) : !vaultCollection.isReady();
}

/** Reads whether this device has a PIN for the vault. */
async function restorePin() {
  const id = userId();
  if (!id) return;
  let kept: KeptVaultPin | null;
  try {
    kept = await loadVaultPin(id);
  } catch {
    // Unreadable for now: the vault asks for its password, and the PIN is read next launch.
    return;
  }
  if (kept && (!usablePin(kept, vaultRow()) || !forThisVault(kept.vault))) {
    await dropPin(id);
    return;
  }
  pinVault = kept?.vault ?? null;
  vaultPin.set(kept && pinState(kept));
}

/** Reads whether this device opens the vault with a fingerprint. */
async function restoreBiometrics() {
  const id = userId();
  if (!id || !biometricsSupported()) return;
  let kept: Awaited<ReturnType<typeof loadVaultBiometric>>;
  try {
    kept = await loadVaultBiometric(id);
  } catch {
    return;
  }
  if (kept && !forThisVault(kept.vault)) {
    await dropBiometrics(id);
    return;
  }
  biometricVault = kept?.vault ?? null;
  vaultBiometrics.set(kept !== null);
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
  void restorePin();
  void restoreBiometrics();

  let hiddenAt: number | null = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    // Checked on return rather than with a timer, which a sleeping phone does not run.
    const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
    hiddenAt = null;
    lastActive = Date.now();
    const limit = quickUnlock() ? QUICK_AUTO_LOCK_MS : AUTO_LOCK_MS;
    if (locksItself() && away >= limit) void lockVault();
  });
  const active = () => {
    lastActive = Date.now();
  };
  for (const type of ['pointerdown', 'keydown', 'wheel', 'input']) {
    document.addEventListener(type, active, { capture: true, passive: true });
  }
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

/**
 * Locks the vault and has this device forget the key it remembers. A PIN or fingerprint set
 * here stays.
 */
export async function lockVault() {
  await dropKey();
  refreshStatus();
}

/**
 * Whether this device keeps the key between visits. Only an unlocked vault can start to,
 * and starting turns off the device's PIN and fingerprint.
 */
export const rememberVault = (remember: boolean) => setRemembered(remember);

/**
 * Lets this device open the vault with a PIN in place of its password, and stop remembering
 * it. Only an unlocked vault can be given one. The vault still locks on leaving it.
 */
export async function setVaultPin(pin: string) {
  const { id, key: current } = unlocked();
  const vault = keyVault;
  if (!vault) throw new VaultError('The vault is locked.');
  // A copy: locking meanwhile wipes the key in place.
  const raw = current.slice();
  try {
    const sealed = await sealUnderPin(id, raw, pin);
    await keepVaultPin(id, { ...sealed, vault, length: pin.length, failures: 0 });
  } finally {
    raw.fill(0);
  }
  if (vaultRemembered.get()) {
    await forgetVaultKey(id);
    vaultRemembered.set(false);
  }
  pinVault = vault;
  vaultPin.set({ length: pin.length, left: PIN_ATTEMPTS });
}

/** Turns this device's PIN off: the vault then asks for its password. */
export async function removeVaultPin() {
  const id = userId();
  if (id) await forgetPin(id);
}

export type PinUnlock =
  | { result: 'unlocked' }
  | { result: 'wrong'; left: number }
  /** Too many wrong PINs in a row: the device has forgotten it. */
  | { result: 'locked-out' }
  /** No PIN opens the vault here any longer: its copy is gone, or for a vault since replaced. */
  | { result: 'forgotten' };

// One try at a time, so each counts the wrong ones the last try wrote.
let pinTries: Promise<unknown> = Promise.resolve();

/**
 * Unlocks the vault with this device's PIN. After `PIN_ATTEMPTS` wrong ones in a row the
 * device forgets the PIN, and the vault asks for its password.
 */
export function unlockWithPin(pin: string): Promise<PinUnlock> {
  const attempt = pinTries.then(() => tryPin(pin));
  pinTries = attempt.catch(() => {});
  return attempt;
}

async function tryPin(pin: string): Promise<PinUnlock> {
  const id = requireUser();
  const vault = vaultRow();
  const kept = await loadVaultPin(id);
  if (!vault || !kept || !usablePin(kept, vault)) {
    await dropPin(id);
    return { result: kept && kept.failures >= PIN_ATTEMPTS ? 'locked-out' : 'forgotten' };
  }
  // Counted before it is tried, so closing the app mid-try does not give a try back.
  const failures = kept.failures + 1;
  await keepVaultPin(id, { ...kept, failures });
  const raw = await openWithPin(id, kept, pin);
  if (raw === null) {
    await dropPin(id);
    return { result: 'forgotten' };
  }
  if (raw === 'wrong' && failures >= PIN_ATTEMPTS) {
    await dropPin(id);
    return { result: 'locked-out' };
  }
  if (raw === 'wrong') {
    const state = pinState({ ...kept, failures });
    vaultPin.set(state);
    return { result: 'wrong', left: state.left };
  }
  await keepVaultPin(id, { ...kept, failures: 0 });
  vaultPin.set(pinState({ ...kept, failures: 0 }));
  await adoptKey(raw, vault);
  return { result: 'unlocked' };
}

/** The words on the phone's fingerprint prompt: its title and its button out. */
export type BiometricPromptText = { title: string; cancel: string };

/**
 * Lets this phone open the vault with a fingerprint, once one confirms it. Only an unlocked
 * vault can. Throws a `BiometricError` when the prompt ends without one.
 */
export async function enableVaultBiometrics(prompt: BiometricPromptText) {
  const { id, key: current } = unlocked();
  const vault = keyVault;
  if (!vault) throw new VaultError('The vault is locked.');
  // The phone replaces the Keystore key before the prompt, so a dismissed prompt here would
  // leave a working copy unopenable.
  if (vaultBiometrics.get()) return;
  // A copy: locking meanwhile wipes the key in place.
  const raw = current.slice();
  let sealed: Awaited<ReturnType<typeof sealWithBiometrics>>;
  try {
    sealed = await sealWithBiometrics(id, raw, prompt);
  } finally {
    raw.fill(0);
  }
  try {
    await keepVaultBiometric(id, { ...sealed, vault });
  } catch (error) {
    await forgetBiometricKey(id).catch(() => {});
    throw error;
  }
  if (vaultRemembered.get()) {
    await forgetVaultKey(id);
    vaultRemembered.set(false);
  }
  biometricVault = vault;
  vaultBiometrics.set(true);
  vaultBiometricsLost.set(false);
}

/** Turns fingerprint unlock off on this phone. */
export async function removeVaultBiometrics() {
  const id = userId();
  if (id) await forgetBiometrics(id);
}

export type BiometricUnlock = {
  result:
    | 'unlocked'
    /** Dismissed: the PIN or password form takes over. */
    | 'canceled'
    /** The prompt's own button, asking for the PIN or password. */
    | 'fallback'
    /** Too many tries: the phone takes no fingerprint for a while. */
    | 'lockout'
    /** The phone's fingerprints changed, which turned fingerprint unlock off. */
    | 'invalidated'
    /** Fingerprint unlock opens nothing here any longer, and is off. */
    | 'forgotten'
    | 'failed';
};

let biometricTry: Promise<BiometricUnlock> | null = null;

/** Unlocks the vault with a fingerprint. One prompt at a time. */
export function unlockWithBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlock> {
  biometricTry ??= tryBiometrics(prompt).finally(() => {
    biometricTry = null;
  });
  return biometricTry;
}

async function tryBiometrics(prompt: BiometricPromptText): Promise<BiometricUnlock> {
  const id = requireUser();
  if (key) return { result: 'unlocked' };
  const vault = vaultRow();
  if (!vault) return { result: 'failed' };
  const kept = await loadVaultBiometric(id);
  if (!kept || kept.vault !== vaultIdentity(vault)) {
    await dropBiometrics(id);
    return { result: 'forgotten' };
  }
  let raw: Bytes;
  try {
    raw = await openWithBiometrics(id, kept, prompt);
  } catch (error) {
    const reason = error instanceof BiometricError ? error.reason : 'failed';
    if (reason === 'invalidated') {
      await dropBiometrics(id);
      vaultBiometricsLost.set(true);
      return { result: 'invalidated' };
    }
    if (reason === 'gone') {
      await dropBiometrics(id);
      return { result: 'forgotten' };
    }
    return { result: reason === 'unavailable' ? 'failed' : reason };
  }
  // Unlocked another way while the prompt was up.
  if (key) {
    raw.fill(0);
    return { result: 'unlocked' };
  }
  await adoptKey(raw, vault);
  return { result: 'unlocked' };
}

/** Deletes the vault and every note in it, for good, on every device. */
export async function deleteVault() {
  requireUser();
  try {
    await awaitVaultSync((await api.deleteVault()).txid);
  } catch (error) {
    throw requestFailure(error);
  }
  await dropKey('everything');
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
  rememberHistoryContentKey(data, {
    contentKey: vaultHistoryContentIdentity(entry.note.id, entry.note.id, {
      content: payload.content,
      files: [],
    }),
    readingKey: vaultHistoryReadingIdentity(entry.note.id, payload.content),
  });
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

/** History never exposes the vault key to a worker or durable store. */
export function vaultHistoryContentIdentity(noteId: string, epoch: string, state: HistoryState) {
  const { id: userId, key } = unlocked();
  return vaultHistoryIdentity(
    key,
    { userId, noteId, epoch },
    'content',
    new TextEncoder().encode(canonicalHistory(state)),
  );
}
/**
 * How a vault note reads, for folding versions that read the same (ADR 0022). Keyed per
 * note and not per epoch, like the identity a note write carries: a version the server kept
 * from a write must fold with the one the device captured of the same words.
 */
export function vaultHistoryReadingIdentity(noteId: string, content: Note['content']) {
  const { id: userId, key } = unlocked();
  return vaultHistoryIdentity(
    key,
    { userId, noteId, epoch: noteId },
    'reading',
    new TextEncoder().encode(historyReading(content)),
  );
}
export function vaultHistorySeal(
  noteId: string,
  epoch: string,
  representation: 'snapshot' | 'delta',
  bytes: Uint8Array,
) {
  const { id: userId, key } = unlocked();
  const context = { userId, noteId, epoch };
  const payloadKey = vaultHistoryIdentity(key, context, `payload:${representation}`, bytes);
  return { payloadKey, data: sealVaultHistory(key, context, representation, payloadKey, bytes) };
}
export function vaultHistoryOpen(
  noteId: string,
  epoch: string,
  representation: 'snapshot' | 'delta',
  payloadKey: string,
  data: string,
) {
  const { id: userId, key } = unlocked();
  return openVaultHistory(key, { userId, noteId, epoch }, representation, payloadKey, data);
}
export function openVaultHistoryNote(noteId: string, data: string): HistoryState {
  const { id: userId, key } = unlocked();
  const payload = openNote(key, userId, noteId, data);
  if (!payload) throw new VaultError('This version could not be opened.');
  return { content: payload.content, files: payload.files };
}
/** Preserve current placement, tags, reminder and files when replacing only content. */
export function sealVaultHistoryRestore(current: VaultNote, content: Note['content']) {
  const { id: userId, key } = unlocked();
  const payload = openNote(key, userId, current.id, current.data);
  if (!payload) throw new VaultError('The current note could not be opened.');
  if (payload.deletedAt) throw new VaultError('Restore this note from Trash first.');
  return sealNote(key, userId, current.id, { ...payload, content, updatedAt: new Date() });
}
