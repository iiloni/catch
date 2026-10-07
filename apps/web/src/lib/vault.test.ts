// @vitest-environment node
import type { Vault, VaultNote } from '@catch/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The collections as plain maps: what the device's database and the outbox would be given.
const store = vi.hoisted(() => {
  const collection = <T>(key: (row: T) => string) => {
    const rows = new Map<string, T>();
    return {
      rows,
      values: () => rows.values(),
      get: (id: string) => rows.get(id),
      has: (id: string) => rows.has(id),
      insert: (row: T) => void rows.set(key(row), row),
      update: (id: string, change: (draft: T) => void) => {
        const draft = { ...(rows.get(id) as T) };
        change(draft);
        rows.set(id, draft);
      },
      delete: (id: string) => void rows.delete(id),
      isReady: () => true,
      onFirstReady: () => () => {},
      subscribeChanges: () => ({ unsubscribe: () => {} }),
    };
  };
  return {
    vault: collection<Vault>((row) => row.userId),
    notes: collection<VaultNote>((row) => row.id),
  };
});

vi.mock('./collections', () => ({
  vaultCollection: store.vault,
  vaultNotesCollection: store.notes,
  awaitVaultSync: async () => true,
  write: (mutate: () => void) => {
    mutate();
    return { id: 'write', isPersisted: { promise: Promise.resolve() } };
  },
}));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./vaultKeyStore', () => ({
  rememberVaultKey: vi.fn(async () => {}),
  loadVaultKey: vi.fn(async () => null),
  forgetVaultKey: vi.fn(async () => {}),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));
vi.mock('./api', () => ({
  ApiError: class extends Error {},
  api: {
    createVault: vi.fn(async (body: Omit<Vault, 'userId' | 'updatedAt'>) => {
      store.vault.insert({ ...body, userId: 'user-1', updatedAt: new Date() });
      return { txid: 1 };
    }),
    saveVault: vi.fn(async (body: Omit<Vault, 'userId' | 'updatedAt'>) => {
      store.vault.insert({ ...body, userId: 'user-1', updatedAt: new Date() });
      return { txid: 2 };
    }),
    deleteVault: vi.fn(async () => {
      store.vault.rows.clear();
      store.notes.rows.clear();
      return { txid: 3 };
    }),
  },
}));

import {
  changeVaultPassword,
  createVault,
  createVaultNote,
  deleteVault,
  deleteVaultNote,
  discardVaultNoteIfEmpty,
  getVaultNote,
  isVaultNote,
  lockVault,
  recoverVault,
  unlockVault,
  updateVaultNote,
  vaultNotes,
  vaultStatus,
} from './vault';
import { forgetVaultKey, rememberVaultKey } from './vaultKeyStore';

const paragraph = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];

describe('the vault', () => {
  let recoveryCode = '';

  beforeEach(async () => {
    if (vaultStatus.get() === 'unlocked') await lockVault();
    store.vault.rows.clear();
    store.notes.rows.clear();
    vi.mocked(rememberVaultKey).mockClear();
    vi.mocked(forgetVaultKey).mockClear();
    recoveryCode = await createVault('correct horse', false);
  });

  it('is unlocked by setting it up, and keeps the key off the device unless asked', () => {
    expect(vaultStatus.get()).toBe('unlocked');
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(rememberVaultKey).not.toHaveBeenCalled();
  });

  it('gives the collection only ciphertext', async () => {
    const { id } = await createVaultNote({ content: paragraph('buried under the oak') });
    expect(isVaultNote(id)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('buried under the oak'));
    const stored = JSON.stringify([...store.notes.values()]);
    expect(stored).not.toContain('oak');
    expect(atob(store.notes.get(id)?.data ?? '')).not.toContain('oak');
  });

  it('applies changes made in quick succession on top of each other', async () => {
    const { id } = await createVaultNote({ content: [] });
    await Promise.all([
      updateVaultNote(id, { content: paragraph('first') }),
      updateVaultNote(id, { isPinned: true }),
      updateVaultNote(id, { color: 'red' }),
    ]);
    expect(getVaultNote(id)).toMatchObject({
      content: paragraph('first'),
      isPinned: true,
      color: 'red',
    });
  });

  it('does not discard a note whose first save is still being sealed', async () => {
    const { id } = await createVaultNote({ content: [] });
    void updateVaultNote(id, { content: paragraph('typed just before closing') });
    expect(await discardVaultNoteIfEmpty(id)).toBe(false);
    expect(getVaultNote(id)?.content).toEqual(paragraph('typed just before closing'));
  });

  it('discards a note left empty, and deletes one for good', async () => {
    const empty = await createVaultNote({ content: [] });
    expect(await discardVaultNoteIfEmpty(empty.id)).toBe(true);
    const { id } = await createVaultNote({ content: paragraph('gone') });
    await deleteVaultNote(id);
    expect(store.notes.rows.size).toBe(0);
    expect(vaultNotes.get()).toEqual([]);
  });

  it('forgets everything when locked, and opens again only with the password', async () => {
    const { id } = await createVaultNote({ content: paragraph('secret') });
    await lockVault();
    expect(vaultStatus.get()).toBe('locked');
    expect(vaultNotes.get()).toEqual([]);
    expect(isVaultNote(id)).toBe(false);
    expect(forgetVaultKey).toHaveBeenCalledWith('user-1');
    await expect(updateVaultNote(id, { isPinned: true })).rejects.toThrow('locked');
    expect(await unlockVault('wrong horse', false)).toBe(false);
    expect(vaultStatus.get()).toBe('locked');
    expect(await unlockVault('correct horse', true)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('secret'));
    expect(rememberVaultKey).toHaveBeenCalledOnce();
  });

  it('changes the password without losing the notes or the recovery code', async () => {
    const { id } = await createVaultNote({ content: paragraph('kept') });
    expect(await changeVaultPassword('wrong horse', 'new password')).toBe(false);
    expect(await changeVaultPassword('correct horse', 'new password')).toBe(true);
    await lockVault();
    expect(await unlockVault('correct horse', false)).toBe(false);
    expect(await unlockVault('new password', false)).toBe(true);
    await lockVault();
    expect(
      await recoverVault('AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'x'.repeat(8), false),
    ).toBe(false);
    expect(await recoverVault(recoveryCode, 'after recovery', false)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('kept'));
    await lockVault();
    expect(await unlockVault('after recovery', false)).toBe(true);
  });

  it('is gone once deleted', async () => {
    await createVaultNote({ content: paragraph('secret') });
    await deleteVault();
    expect(vaultStatus.get()).toBe('none');
    expect(vaultNotes.get()).toEqual([]);
  });
});
