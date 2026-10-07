// @vitest-environment node
import type { VaultNotePayload } from '@catch/shared';
import { describe, expect, it } from 'vitest';
import {
  createVaultKey,
  formatRecoveryCode,
  fromBase64,
  importVaultKey,
  openNote,
  openVaultKey,
  parseRecoveryCode,
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
  isPinned: false,
  position: 'a0',
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
  it('round-trips a note and hides its words', async () => {
    const { raw } = await createVaultKey(USER, 'correct horse', ROUNDS);
    const key = await importVaultKey(raw);
    const data = await sealNote(key, USER, NOTE, payload);
    expect(new TextDecoder().decode(fromBase64(data))).not.toContain('safe');
    expect(await openNote(key, USER, NOTE, data)).toEqual(payload);
  });

  it('seals the same note differently every time', async () => {
    const key = await importVaultKey((await createVaultKey(USER, 'p', ROUNDS)).raw);
    expect(await sealNote(key, USER, NOTE, payload)).not.toBe(
      await sealNote(key, USER, NOTE, payload),
    );
  });

  it('refuses another key, another note id, another user and changed bytes', async () => {
    const key = await importVaultKey((await createVaultKey(USER, 'p', ROUNDS)).raw);
    const otherKey = await importVaultKey((await createVaultKey(USER, 'p', ROUNDS)).raw);
    const data = await sealNote(key, USER, NOTE, payload);
    expect(await openNote(otherKey, USER, NOTE, data)).toBeNull();
    expect(await openNote(key, USER, '0199a0a0-0000-7000-8000-000000000002', data)).toBeNull();
    expect(await openNote(key, 'user-2', NOTE, data)).toBeNull();
    const bytes = fromBase64(data);
    bytes.set([(bytes.at(-1) ?? 0) ^ 1], bytes.length - 1);
    expect(await openNote(key, USER, NOTE, toBase64(bytes))).toBeNull();
    expect(await openNote(key, USER, NOTE, 'not base64!')).toBeNull();
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
