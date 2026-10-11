import {
  type SaveVault,
  VAULT_KDF_ITERATIONS,
  type Vault,
  type VaultNotePayload,
  vaultNotePayloadSchema,
} from '@catch/shared';
import { gcm } from '@noble/ciphers/aes.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * The vault's cryptography (ADR 0020).
 *
 * One random 256 bit vault key seals every note and file with AES-256-GCM. The server keeps that key
 * sealed twice: under a key stretched from the vault password (PBKDF2-SHA256) and under one
 * derived from the recovery code (HKDF-SHA256; the code is already random). What is sealed
 * names its owner and its place as additional data, so the server cannot pass one note's
 * ciphertext off as another's, or one user's as another's.
 *
 * Keys and files go through the browser's Web Crypto. Notes are sealed with the same cipher
 * from `@noble/ciphers`, which is synchronous; the two read each other's output.
 */

type Bytes = Uint8Array<ArrayBuffer>;
type Sealed = Pick<Vault, 'salt' | 'iterations' | 'passwordKey' | 'recoveryKey'>;

const NONCE_BYTES = 12;
const KEY_BYTES = 32;
const SALT_BYTES = 16;
const RECOVERY_BYTES = 20;
const AES = { name: 'AES-GCM', length: 256 } as const;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const utf8 = (text: string): Bytes => new Uint8Array(encoder.encode(text));
const random = (length: number): Bytes => crypto.getRandomValues(new Uint8Array(length));

export function toBase64(bytes: Uint8Array) {
  let binary = '';
  // In pieces: a large note as one argument list overflows the stack.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function seal(key: CryptoKey, plain: Bytes, context: string) {
  // A random nonce per message is safe for far more messages than a vault will ever hold.
  const iv = random(NONCE_BYTES);
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(context) }, key, plain),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64(out);
}

/** Null for the wrong key, another context, or anything changed since it was sealed. */
async function unseal(key: CryptoKey, data: string, context: string): Promise<Bytes | null> {
  try {
    const bytes = fromBase64(data);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.subarray(0, NONCE_BYTES), additionalData: utf8(context) },
      key,
      bytes.subarray(NONCE_BYTES),
    );
    return new Uint8Array(plain);
  } catch {
    return null;
  }
}

const keyContext = (userId: string, kind: 'password' | 'recovery') =>
  `catch-vault-key:${kind}:${userId}`;
const noteContext = (userId: string, noteId: string) => `catch-vault-note:${userId}:${noteId}`;

async function passwordWrappingKey(password: string, salt: Bytes, iterations: number) {
  // Composed and decomposed forms of one password must be one password.
  const material = await crypto.subtle.importKey(
    'raw',
    utf8(password.normalize('NFKC')),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    AES,
    false,
    ['encrypt', 'decrypt'],
  );
}

async function recoveryWrappingKey(userId: string, code: Bytes) {
  const material = await crypto.subtle.importKey('raw', code, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: utf8(keyContext(userId, 'recovery')),
    },
    material,
    AES,
    false,
    ['encrypt', 'decrypt'],
  );
}

// RFC 4648 base32: no 0, 1, 8 or 9 to mistake for a letter when copied by hand.
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A recovery code as shown to the user: 32 characters in groups of four. */
export function formatRecoveryCode(bytes: Uint8Array) {
  let bits = '';
  for (const byte of bytes) bits += byte.toString(2).padStart(8, '0');
  let text = '';
  for (let start = 0; start < bits.length; start += 5) {
    text += BASE32[Number.parseInt(bits.slice(start, start + 5).padEnd(5, '0'), 2)];
  }
  return text.match(/.{1,4}/g)?.join('-') ?? text;
}

/** The bytes of a typed recovery code, however it was spaced or cased; null if it is not one. */
export function parseRecoveryCode(text: string): Bytes | null {
  const letters = text.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (letters.length !== Math.ceil((RECOVERY_BYTES * 8) / 5)) return null;
  let bits = '';
  for (const letter of letters) {
    const value = BASE32.indexOf(letter);
    if (value < 0) return null;
    bits += value.toString(2).padStart(5, '0');
  }
  const bytes = new Uint8Array(RECOVERY_BYTES);
  for (let index = 0; index < RECOVERY_BYTES; index++) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
}

/** Seals the vault key under a password, with a salt of its own. */
export async function sealUnderPassword(
  userId: string,
  raw: Bytes,
  password: string,
  iterations = VAULT_KDF_ITERATIONS,
): Promise<Pick<SaveVault, 'salt' | 'iterations' | 'passwordKey'>> {
  const salt = random(SALT_BYTES);
  const wrapping = await passwordWrappingKey(password, salt, iterations);
  return {
    salt: toBase64(salt),
    iterations,
    passwordKey: await seal(wrapping, raw, keyContext(userId, 'password')),
  };
}

/**
 * A new vault: its key, how the server is to keep it, and the recovery code, which is shown
 * once and kept nowhere.
 */
export async function createVaultKey(userId: string, password: string, iterations?: number) {
  const raw = random(KEY_BYTES);
  const code = random(RECOVERY_BYTES);
  const vault: SaveVault = {
    ...(await sealUnderPassword(userId, raw, password, iterations)),
    recoveryKey: await seal(
      await recoveryWrappingKey(userId, code),
      raw,
      keyContext(userId, 'recovery'),
    ),
  };
  return { raw, vault, recoveryCode: formatRecoveryCode(code) };
}

/** The vault key, opened with the password or the recovery code. Null when it is wrong. */
export async function openVaultKey(
  userId: string,
  vault: Sealed,
  secret: { password: string } | { recoveryCode: string },
): Promise<Bytes | null> {
  if ('password' in secret) {
    const wrapping = await passwordWrappingKey(
      secret.password,
      fromBase64(vault.salt),
      vault.iterations,
    );
    return unseal(wrapping, vault.passwordKey, keyContext(userId, 'password'));
  }
  const code = parseRecoveryCode(secret.recoveryCode);
  if (!code) return null;
  return unseal(
    await recoveryWrappingKey(userId, code),
    vault.recoveryKey,
    keyContext(userId, 'recovery'),
  );
}

/**
 * Seals a note. Synchronous, unlike Web Crypto, so a change to a vault note is sealed
 * inside the same optimistic write that changes any other note.
 */
export function sealNote(raw: Bytes, userId: string, noteId: string, payload: VaultNotePayload) {
  const iv = random(NONCE_BYTES);
  const sealed = gcm(raw, iv, utf8(noteContext(userId, noteId))).encrypt(
    utf8(JSON.stringify(payload)),
  );
  const out = new Uint8Array(iv.length + sealed.length);
  out.set(iv);
  out.set(sealed, iv.length);
  return toBase64(out);
}

/** Null when the note was sealed with another key or is not what this device wrote. */
export function openNote(
  raw: Bytes,
  userId: string,
  noteId: string,
  data: string,
): VaultNotePayload | null {
  try {
    const bytes = fromBase64(data);
    const plain = gcm(
      raw,
      bytes.subarray(0, NONCE_BYTES),
      utf8(noteContext(userId, noteId)),
    ).decrypt(bytes.subarray(NONCE_BYTES));
    return vaultNotePayloadSchema.parse(JSON.parse(decoder.decode(plain)));
  } catch {
    return null;
  }
}

/** A file's own bytes, or the thumbnail the device made of it. */
export type FilePart = 'content' | 'thumbnail';
const fileContext = (userId: string, sealId: string, part: FilePart, piece: string) =>
  `catch-vault-file:${userId}:${sealId}:${part}:${piece}`;

/** Files are sealed in pieces this size, so a large one never has to sit in memory twice. */
export const FILE_CHUNK_BYTES = 4 * 1024 * 1024;
const PIECE_OVERHEAD = NONCE_BYTES + 16;
const SEALED_CHUNK_BYTES = FILE_CHUNK_BYTES + PIECE_OVERHEAD;

/** How many bytes a file of this size is once sealed. */
export const sealedFileSize = (size: number) =>
  size + Math.max(1, Math.ceil(size / FILE_CHUNK_BYTES)) * PIECE_OVERHEAD;

/** The key as Web Crypto holds it, for files: far faster than sealing megabytes in script. */
export const importFileKey = (raw: Bytes) =>
  crypto.subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);

/**
 * Seals a file piece by piece. Each piece names what it was sealed as, its place and whether
 * it is the last, so pieces cannot be reordered, dropped from the end or moved between files.
 */
export async function sealFile(
  key: CryptoKey,
  userId: string,
  sealId: string,
  part: FilePart,
  file: Blob,
) {
  const count = Math.max(1, Math.ceil(file.size / FILE_CHUNK_BYTES));
  const parts: Bytes[] = [];
  for (let index = 0; index < count; index++) {
    const piece = new Uint8Array(
      await file.slice(index * FILE_CHUNK_BYTES, (index + 1) * FILE_CHUNK_BYTES).arrayBuffer(),
    );
    const iv = random(NONCE_BYTES);
    const context = fileContext(userId, sealId, part, `${index}:${index === count - 1}`);
    const sealed = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: utf8(context) },
        key,
        piece,
      ),
    );
    parts.push(iv, sealed);
  }
  return new Blob(parts, { type: 'application/octet-stream' });
}

/** Opens a sealed file as a blob of the given type. Throws if any piece is not as sealed. */
export async function openFile(
  key: CryptoKey,
  userId: string,
  sealId: string,
  part: FilePart,
  sealed: Blob,
  type: string,
) {
  const count = Math.max(1, Math.ceil(sealed.size / SEALED_CHUNK_BYTES));
  const parts: ArrayBuffer[] = [];
  for (let index = 0; index < count; index++) {
    const piece = new Uint8Array(
      await sealed
        .slice(index * SEALED_CHUNK_BYTES, (index + 1) * SEALED_CHUNK_BYTES)
        .arrayBuffer(),
    );
    const context = fileContext(userId, sealId, part, `${index}:${index === count - 1}`);
    parts.push(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: piece.subarray(0, NONCE_BYTES), additionalData: utf8(context) },
        key,
        piece.subarray(NONCE_BYTES),
      ),
    );
  }
  return new Blob(parts, { type });
}

/**
 * The vault key for a device asked to remember it: sealed under a key of the device's own,
 * which the browser keeps and never shows to scripts.
 */
export async function sealForDevice(raw: Bytes) {
  const deviceKey = await crypto.subtle.generateKey(AES, false, ['encrypt', 'decrypt']);
  return { deviceKey, sealed: await seal(deviceKey, raw, 'catch-vault-key:device') };
}

export const openFromDevice = (deviceKey: CryptoKey, sealed: string) =>
  unseal(deviceKey, sealed, 'catch-vault-key:device');

export type VaultHistoryContext = { userId: string; noteId: string; epoch: string };
const historyDomain = (context: VaultHistoryContext) =>
  `catch-vault-history:1:${context.userId}:${context.noteId}:${context.epoch}`;
function historyKey(raw: Bytes, context: VaultHistoryContext, role: 'encryption' | 'identity') {
  return hkdf(sha256, raw, undefined, utf8(`${historyDomain(context)}:${role}`), KEY_BYTES);
}
function concatHistoryBytes(prefix: Uint8Array, data: Uint8Array) {
  const result = new Uint8Array(prefix.length + data.length);
  result.set(prefix);
  result.set(data, prefix.length);
  return result;
}
const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
/** Keyed, domain-separated identities reveal equality only within this note and epoch. */
export function vaultHistoryIdentity(
  raw: Bytes,
  context: VaultHistoryContext,
  role: string,
  data: Uint8Array,
) {
  const derived = historyKey(raw, context, 'identity');
  try {
    return hex(hmac(sha256, derived, concatHistoryBytes(utf8(`${role}:`), data)));
  } finally {
    derived.fill(0);
  }
}
export function sealVaultHistory(
  raw: Bytes,
  context: VaultHistoryContext,
  representation: 'snapshot' | 'delta',
  payloadKey: string,
  bytes: Uint8Array,
) {
  const derived = historyKey(raw, context, 'encryption');
  try {
    const nonce = random(NONCE_BYTES);
    const sealed = gcm(
      derived,
      nonce,
      utf8(`${historyDomain(context)}:${representation}:${payloadKey}`),
    ).encrypt(bytes);
    const result = new Uint8Array(nonce.length + sealed.length);
    result.set(nonce);
    result.set(sealed, nonce.length);
    return toBase64(result);
  } finally {
    derived.fill(0);
  }
}
export function openVaultHistory(
  raw: Bytes,
  context: VaultHistoryContext,
  representation: 'snapshot' | 'delta',
  payloadKey: string,
  data: string,
): Bytes {
  const derived = historyKey(raw, context, 'encryption');
  try {
    const bytes = fromBase64(data);
    const plain = gcm(
      derived,
      bytes.subarray(0, NONCE_BYTES),
      utf8(`${historyDomain(context)}:${representation}:${payloadKey}`),
    ).decrypt(bytes.subarray(NONCE_BYTES));
    if (vaultHistoryIdentity(raw, context, `payload:${representation}`, plain) !== payloadKey)
      throw new Error('Invalid history identity.');
    return new Uint8Array(plain);
  } finally {
    derived.fill(0);
  }
}
