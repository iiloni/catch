// @vitest-environment node
import type { Note, Vault, VaultFile, VaultNote } from '@catch/shared';
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
  publishVaultAssignments: vi.fn(),
  write: (mutate: () => void) => {
    mutate();
    return { id: 'write', isPersisted: { promise: Promise.resolve() } };
  },
}));
vi.mock('./auth', () => ({ getSignedInUser: () => ({ id: 'user-1' }) }));
vi.mock('./attachmentFiles', () => ({ setSealedFiles: vi.fn(), closeSealedFiles: vi.fn() }));
vi.stubGlobal('document', { addEventListener: () => {}, visibilityState: 'visible' });
vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
vi.mock('./vaultKeyStore', () => ({
  vaultSeenKey: (id: string) => `catch-vault:${id}`,
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

import { closeSealedFiles } from './attachmentFiles';
import { publishVaultAssignments } from './collections';
import {
  changeVaultNote,
  changeVaultNoteFiles,
  changeVaultNoteTags,
  changeVaultPassword,
  createVault,
  deleteVault,
  enterVault,
  getSealedFiles,
  getVaultFiles,
  getVaultNote,
  getVaultNoteTags,
  insertVaultNote,
  isVaultNote,
  leaveVault,
  lockVault,
  recoverVault,
  removeVaultNote,
  unlockVault,
  vaultFileNote,
  vaultMode,
  vaultNotes,
  vaultPrompt,
  vaultStatus,
} from './vault';
import { forgetVaultKey, rememberVaultKey } from './vaultKeyStore';

const paragraph = (text: string) => [{ type: 'paragraph', content: [{ type: 'text', text }] }];
const TAG = '0199a0a0-0000-7000-8000-00000000000a';
let made = 0;
const note = (content: Note['content']): Note => ({
  id: `0199a0a0-0000-7000-8000-${String(++made).padStart(12, '0')}`,
  userId: 'user-1',
  content,
  color: 'default',
  status: 'todo',
  isPinned: false,
  isArchived: false,
  position: 'a0',
  hiddenLinks: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
});
const add = (text: string) => {
  const added = note(paragraph(text));
  insertVaultNote(added);
  return added.id;
};

describe('the vault', () => {
  let recoveryCode = '';

  beforeEach(async () => {
    if (vaultStatus.get() === 'unlocked') await lockVault();
    store.vault.rows.clear();
    store.notes.rows.clear();
    vaultPrompt.set(false);
    vi.mocked(rememberVaultKey).mockClear();
    vi.mocked(forgetVaultKey).mockClear();
    recoveryCode = await createVault('correct horse', false);
  });

  it('is unlocked by setting it up, and keeps the key off the device unless asked', () => {
    expect(vaultStatus.get()).toBe('unlocked');
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(rememberVaultKey).not.toHaveBeenCalled();
  });

  it('gives the collection only ciphertext', () => {
    const id = add('buried under the oak');
    expect(isVaultNote(id)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('buried under the oak'));
    const stored = JSON.stringify([...store.notes.values()]);
    expect(stored).not.toContain('oak');
    expect(atob(store.notes.get(id)?.data ?? '')).not.toContain('oak');
  });

  it('seals where a note is kept, its tags and its files along with its words', async () => {
    const id = add('secret');
    const file: VaultFile = {
      id: '0199a0a0-0000-7000-8000-0000000000f1',
      name: 'passport.jpg',
      mimeType: 'image/jpeg',
      size: 10,
      kind: 'image',
      createdAt: new Date(),
      thumbnailId: null,
      sealId: '0199a0a0-0000-7000-8000-0000000000f1',
    };
    changeVaultNote(id, (draft) => {
      draft.isArchived = true;
      draft.deletedAt = new Date(0);
      draft.status = 'done';
    });
    changeVaultNoteTags(id, (draft) => {
      draft.primaryTagId = TAG;
    });
    changeVaultNoteFiles(id, (files) => [...files, file]);
    expect(getVaultNoteTags(id)).toMatchObject({ id, primaryTagId: TAG, secondaryTagIds: [] });
    expect(vi.mocked(publishVaultAssignments).mock.lastCall?.[0].get(id)?.primaryTagId).toBe(TAG);
    expect(getVaultFiles(id)).toMatchObject([{ id: file.id, noteId: id, name: 'passport.jpg' }]);
    expect(vaultFileNote(file.id)).toBe(id);
    const stored = JSON.stringify([...store.notes.values()]);
    expect(stored).not.toContain('passport');
    expect(stored).not.toContain(TAG);

    // Another visit opens all of it again from the ciphertext alone.
    await lockVault();
    expect(vaultFileNote(file.id)).toBeUndefined();
    expect(closeSealedFiles).toHaveBeenCalled();
    await unlockVault('correct horse', false);
    expect(getVaultNote(id)).toMatchObject({
      isArchived: true,
      status: 'done',
      deletedAt: new Date(0),
    });
    expect(getVaultNoteTags(id)?.primaryTagId).toBe(TAG);
    expect(getSealedFiles(id)).toEqual([file]);
  });

  it('deletes a note for good', () => {
    const id = add('gone');
    removeVaultNote(id);
    expect(store.notes.rows.size).toBe(0);
    expect(vaultNotes.get()).toEqual([]);
    expect(isVaultNote(id)).toBe(false);
  });

  it('forgets everything when locked, and opens again only with the password', async () => {
    const id = add('secret');
    await lockVault();
    expect(vaultStatus.get()).toBe('locked');
    expect(vaultNotes.get()).toEqual([]);
    expect(isVaultNote(id)).toBe(false);
    expect(forgetVaultKey).toHaveBeenCalledWith('user-1');
    expect(() => insertVaultNote(note([]))).toThrow('locked');
    expect(await unlockVault('wrong horse', false)).toBe(false);
    expect(vaultStatus.get()).toBe('locked');
    expect(await unlockVault('correct horse', true)).toBe(true);
    expect(getVaultNote(id)?.content).toEqual(paragraph('secret'));
    expect(rememberVaultKey).toHaveBeenCalledOnce();
  });

  it('shows its notes when entered, and locks on leaving unless the device remembers it', async () => {
    enterVault();
    expect(vaultMode.get()).toBe(true);
    leaveVault();
    await vi.waitFor(() => expect(vaultStatus.get()).toBe('locked'));
    expect(vaultMode.get()).toBe(false);

    // Locked: entering asks for the password instead.
    enterVault();
    expect(vaultMode.get()).toBe(false);
    expect(vaultPrompt.get()).toBe(true);

    await unlockVault('correct horse', true);
    enterVault();
    leaveVault();
    expect(vaultMode.get()).toBe(false);
    expect(vaultStatus.get()).toBe('unlocked');
  });

  it('changes the password without losing the notes or the recovery code', async () => {
    const id = add('kept');
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
    add('secret');
    await deleteVault();
    expect(vaultStatus.get()).toBe('none');
    expect(vaultNotes.get()).toEqual([]);
  });
});
