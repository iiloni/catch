// @vitest-environment node
import type { VaultNotePayload } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import {
  createVaultKey,
  FILE_CHUNK_BYTES,
  formatRecoveryCode,
  fromBase64,
  importFileKey,
  openFile,
  openFromDevice,
  openNote,
  openVaultKey,
  parseRecoveryCode,
  sealedFileSize,
  sealFile,
  sealForDevice,
  sealNote,
  sealUnderPassword,
  toBase64,
} from './vaultCrypto';

// Far fewer rounds than a real vault, which would make every test take a second.
const ROUNDS = 1000;
const USER = 'user-1';
const NOTE = '0199a0a0-0000-7000-8000-000000000001';
const payload: VaultNotePayload = {
  v: 1,
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'the safe is behind the map' }] }],
  color: 'default',
  status: 'todo',
  isPinned: false,
  isArchived: false,
  position: 'a0',
  deletedAt: null,
  updatedAt: new Date(0),
  primaryTagId: null,
  secondaryTagIds: [],
  files: [],
  reminder: null,
};

describe('vault keys', () => {
  it('opens with the password and with the recovery code', async () => {
    const { raw, vault, recoveryCode } = await createVaultKey(USER, 'correct horse', ROUNDS);
    expect(await openVaultKey(USER, vault, { password: 'correct horse' })).toEqual(raw);
    expect(await openVaultKey(USER, vault, { recoveryCode })).toEqual(raw);
    expect(await openVaultKey(USER, vault, { recoveryCode: recoveryCode.toLowerCase() })).toEqual(
      raw,
    );
  });

  it('stays shut for a wrong password, a wrong code or another user', async () => {
    const { vault, recoveryCode } = await createVaultKey(USER, 'correct horse', ROUNDS);
    const other = await createVaultKey(USER, 'correct horse', ROUNDS);
    expect(await openVaultKey(USER, vault, { password: 'wrong horse' })).toBeNull();
    expect(await openVaultKey(USER, vault, { recoveryCode: other.recoveryCode })).toBeNull();
    expect(await openVaultKey(USER, vault, { recoveryCode: 'not a code' })).toBeNull();
    expect(await openVaultKey('user-2', vault, { password: 'correct horse' })).toBeNull();
    expect(await openVaultKey('user-2', vault, { recoveryCode })).toBeNull();
  });

  it('keeps the key and the recovery code through a password change', async () => {
    const { raw, vault, recoveryCode } = await createVaultKey(USER, 'old password', ROUNDS);
    const changed = { ...vault, ...(await sealUnderPassword(USER, raw, 'new password', ROUNDS)) };
    expect(changed.salt).not.toBe(vault.salt);
    expect(await openVaultKey(USER, changed, { password: 'old password' })).toBeNull();
    expect(await openVaultKey(USER, changed, { password: 'new password' })).toEqual(raw);
    expect(await openVaultKey(USER, changed, { recoveryCode })).toEqual(raw);
  });

  it('never puts the key or the password in what the server keeps', async () => {
    const { raw, vault } = await createVaultKey(USER, 'correct horse', ROUNDS);
    const stored = JSON.stringify(vault);
    expect(stored).not.toContain(toBase64(raw));
    expect(stored).not.toContain('correct horse');
  });
});

describe('vault notes', () => {
  const newKey = async () => (await createVaultKey(USER, 'p', ROUNDS)).raw;

  it('round-trips a note and hides its words', async () => {
    const key = await newKey();
    const data = sealNote(key, USER, NOTE, payload);
    expect(new TextDecoder().decode(fromBase64(data))).not.toContain('safe');
    expect(openNote(key, USER, NOTE, data)).toEqual(payload);
  });

  it('seals the same note differently every time', async () => {
    const key = await newKey();
    expect(sealNote(key, USER, NOTE, payload)).not.toBe(sealNote(key, USER, NOTE, payload));
  });

  it('refuses another key, another note id, another user and changed bytes', async () => {
    const key = await newKey();
    const data = sealNote(key, USER, NOTE, payload);
    expect(openNote(await newKey(), USER, NOTE, data)).toBeNull();
    expect(openNote(key, USER, '0199a0a0-0000-7000-8000-000000000002', data)).toBeNull();
    expect(openNote(key, 'user-2', NOTE, data)).toBeNull();
    const bytes = fromBase64(data);
    bytes.set([(bytes.at(-1) ?? 0) ^ 1], bytes.length - 1);
    expect(openNote(key, USER, NOTE, toBase64(bytes))).toBeNull();
    expect(openNote(key, USER, NOTE, 'not base64!')).toBeNull();
  });

  it('writes what Web Crypto reads, so notes and files share one key', async () => {
    const raw = await newKey();
    const data = fromBase64(sealNote(raw, USER, NOTE, payload));
    const plain = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: data.subarray(0, 12),
        additionalData: new TextEncoder().encode(`catch-vault-note:${USER}:${NOTE}`),
      },
      await importFileKey(raw),
      data.subarray(12),
    );
    expect(JSON.parse(new TextDecoder().decode(plain)).content).toEqual(payload.content);
  });
});

describe('vault files', () => {
  const FILE = '0199a0a0-0000-7000-8000-0000000000f1';
  const newKey = async () => importFileKey((await createVaultKey(USER, 'p', ROUNDS)).raw);
  const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());
  // Longer than one piece, so the pieces' order and count are put to the test.
  const large = new Uint8Array(FILE_CHUNK_BYTES + 1000).map((_, index) => index % 251);

  it('round-trips a file of several pieces, at the size it said it would be', async () => {
    const key = await newKey();
    const sealed = await sealFile(key, USER, FILE, 'content', new Blob([large]));
    expect(sealed.size).toBe(sealedFileSize(large.length));
    const opened = await openFile(key, USER, FILE, 'content', sealed, 'image/png');
    expect(opened.type).toBe('image/png');
    // Compared as buffers: matching four million numbers one by one takes the runner half a minute.
    expect(Buffer.compare(await bytes(opened), large)).toBe(0);
  });

  it('round-trips an empty file', async () => {
    const key = await newKey();
    const sealed = await sealFile(key, USER, FILE, 'content', new Blob([]));
    expect(sealed.size).toBe(sealedFileSize(0));
    expect((await openFile(key, USER, FILE, 'content', sealed, '')).size).toBe(0);
  });

  it('refuses another file, another part, another user, and pieces cut off or swapped', async () => {
    const key = await newKey();
    const sealed = await sealFile(key, USER, FILE, 'content', new Blob([large]));
    const open = (blob: Blob, user = USER, id = FILE, part: 'content' | 'thumbnail' = 'content') =>
      openFile(key, user, id, part, blob, '');
    await expect(open(sealed, 'user-2')).rejects.toThrow();
    await expect(open(sealed, USER, NOTE)).rejects.toThrow();
    await expect(open(sealed, USER, FILE, 'thumbnail')).rejects.toThrow();
    const piece = FILE_CHUNK_BYTES + 28;
    // Only the first piece, as if the rest of the file had been dropped.
    await expect(open(sealed.slice(0, piece))).rejects.toThrow();
    // Only the last piece, in the first one's place.
    await expect(open(sealed.slice(piece))).rejects.toThrow();
  });
});

describe('a remembered key', () => {
  it('opens only with the device key it was sealed under', async () => {
    const { raw } = await createVaultKey(USER, 'p', ROUNDS);
    const kept = await sealForDevice(raw);
    expect(kept.sealed).not.toContain(toBase64(raw));
    expect(await openFromDevice(kept.deviceKey, kept.sealed)).toEqual(raw);
    const other = await sealForDevice(raw);
    expect(await openFromDevice(other.deviceKey, kept.sealed)).toBeNull();
  });
});

describe('recovery codes', () => {
  it('reads back what it wrote, however it is typed', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    const code = formatRecoveryCode(bytes);
    expect(code).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(parseRecoveryCode(code)).toEqual(bytes);
    expect(parseRecoveryCode(code.toLowerCase().replaceAll('-', ' '))).toEqual(bytes);
  });

  it('rejects codes of the wrong length or alphabet', () => {
    expect(parseRecoveryCode('ABCD')).toBeNull();
    expect(parseRecoveryCode('1'.repeat(32))).toBeNull();
  });
});

describe('vault history', () => {
  it('deduplicates identities within a note while binding ciphertext to owner, epoch and representation', async () => {
    const { vaultHistoryIdentity, sealVaultHistory, openVaultHistory } = await import(
      './vaultCrypto'
    );
    const key = (await createVaultKey(USER, 'history', ROUNDS)).raw;
    const context = { userId: USER, noteId: NOTE, epoch: NOTE };
    const bytes = new TextEncoder().encode('private version content');
    const payloadKey = vaultHistoryIdentity(key, context, 'payload:snapshot', bytes);
    const sealed = sealVaultHistory(key, context, 'snapshot', payloadKey, bytes);
    expect(openVaultHistory(key, context, 'snapshot', payloadKey, sealed)).toEqual(bytes);
    expect(sealVaultHistory(key, context, 'snapshot', payloadKey, bytes)).not.toBe(sealed);
    for (const other of [
      { ...context, userId: 'other' },
      { ...context, noteId: 'other' },
      { ...context, epoch: 'other' },
    ]) {
      expect(vaultHistoryIdentity(key, other, 'payload:snapshot', bytes)).not.toBe(payloadKey);
      expect(() => openVaultHistory(key, other, 'snapshot', payloadKey, sealed)).toThrow();
    }
    expect(() => openVaultHistory(key, context, 'delta', payloadKey, sealed)).toThrow();
    const tampered = fromBase64(sealed);
    tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
    expect(() =>
      openVaultHistory(key, context, 'snapshot', payloadKey, toBase64(tampered)),
    ).toThrow();
  });
});
