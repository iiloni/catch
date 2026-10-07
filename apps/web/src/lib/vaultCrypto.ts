import {
  type SaveVault,
  VAULT_KDF_ITERATIONS,
  type Vault,
  type VaultNotePayload,
  vaultNotePayloadSchema,
} from '@catch/shared';

/**
 * The vault's cryptography (ADR 0020), all of it the browser's own Web Crypto.
 *
 * One random 256 bit vault key seals every note with AES-GCM. The server keeps that key
 * sealed twice: under a key stretched from the vault password (PBKDF2-SHA256) and under one
 * derived from the recovery code (HKDF-SHA256; the code is already random). What is sealed
 * names its owner and its place as additional data, so the server cannot pass one note's
 * ciphertext off as another's, or one user's as another's.
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

/** The vault key ready for use. It cannot be read back out of the browser's keeping. */
export const importVaultKey = (raw: Bytes) =>
  crypto.subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);

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

export function sealNote(
  key: CryptoKey,
  userId: string,
  noteId: string,
  payload: VaultNotePayload,
) {
  return seal(key, utf8(JSON.stringify(payload)), noteContext(userId, noteId));
}

/** Null when the note was sealed with another key or is not what this device wrote. */
export async function openNote(
  key: CryptoKey,
  userId: string,
  noteId: string,
  data: string,
): Promise<VaultNotePayload | null> {
  const plain = await unseal(key, data, noteContext(userId, noteId));
  if (!plain) return null;
  try {
    return vaultNotePayloadSchema.parse(JSON.parse(decoder.decode(plain)));
  } catch {
    return null;
  }
}
