import { expect, type Page, test } from '@playwright/test';
import { blocksToPlainText } from '../packages/shared/src/plainText';
import { card, noteToolbar, openDeck, openNote, signUp } from './helpers';

async function seed(page: Page, vault: boolean) {
  await signUp(page);
  await page.evaluate(async (vault) => {
    const { createNote, setNotePinned } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    if (vault) {
      const { createVault, enterVault } = await import('/src/lib/vault.ts');
      await createVault('gallery move test password', true);
      enterVault();
    }
    const saved = [];
    const pinned = [];
    for (const title of ['Old task', 'Task peer', 'Task pinned', 'Recent note', 'Recent pinned']) {
      const note = createNote({
        userId: getSignedInUser().id,
        vault,
        status: title.startsWith('Recent') ? null : 'new',
        content: [{ type: 'heading', props: { level: 3 }, content: title }],
      });
      saved.push(note.transaction.isPersisted.promise);
      if (title.endsWith('pinned')) pinned.push(note.id);
    }
    await Promise.all(saved);
    await Promise.all(pinned.map((id) => setNotePinned(id, true).isPersisted.promise));
  }, vault);
}

async function states(page: Page) {
  const notes = await page.evaluate(async () => {
    const { noteStore } = await import('/src/lib/noteStore.ts');
    const { isVaultMode } = await import('/src/lib/vault.ts');
    const { sortNotes } = await import('/src/lib/sortNotes.ts');
    return sortNotes([...noteStore.values(isVaultMode())], 'position').map((note) => ({
      id: note.id,
      content: note.content,
      status: note.status,
      position: note.position,
      pinned: note.isPinned,
      createdAt: note.createdAt.toISOString(),
    }));
  });
  return notes.map(({ content, ...note }) => ({ ...note, title: blocksToPlainText(content) }));
}

async function reloadGallery(page: Page, vault: boolean) {
  await page.reload();
  if (vault) {
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const { vaultStatus } = await import('/src/lib/vault.ts');
          return vaultStatus.get();
        }),
      )
      .toBe('unlocked');
    await page.getByRole('button', { name: 'Open the vault' }).click();
  }
  await expect(card(page, 'Recent note')).toBeVisible();
}

for (const vault of [false, true]) {
  test.describe(vault ? 'vault' : 'ordinary notes', () => {
    test('sending an older deck note to the gallery places it ahead of newer notes', async ({
      page,
    }) => {
      await seed(page, vault);
      const before = (await states(page)).find((note) => note.title === 'Old task');
      await openDeck(page);
      const dialog = await openNote(page, 'Old task');
      await noteToolbar(page).getByRole('button', { name: 'Move note' }).click();
      await page
        .getByRole('group', { name: 'Move note', exact: true })
        .getByRole('button', { name: 'Send to gallery' })
        .click();
      await dialog.getByRole('button', { name: 'Close' }).click();
      await page.getByRole('link', { name: 'Gallery' }).click();
      await expect(card(page, 'Old task')).toBeVisible();
      const gallery = async () => (await states(page)).filter((note) => note.status === null);
      const expected = ['Recent pinned', 'Old task', 'Recent note'];
      await expect.poll(async () => (await gallery()).map((note) => note.title)).toEqual(expected);
      expect((await gallery()).find((note) => note.title === 'Old task')?.createdAt).toBe(
        before?.createdAt,
      );
      await reloadGallery(page, vault);
      await expect.poll(async () => (await gallery()).map((note) => note.title)).toEqual(expected);
    });

    test('bulk gallery moves preserve pin groups and input order, and Undo restores deck positions', async ({
      page,
      isMobile,
    }) => {
      test.skip(
        isMobile,
        'Bulk ordering has no layout changes; single-note moves cover both layouts.',
      );
      await seed(page, vault);
      const before = await states(page);
      const deck = before.filter((note) => note.status !== null);
      // Supply the two unpinned notes oldest first, opposite to their original deck order.
      const ids = ['Old task', 'Task peer', 'Task pinned'].map(
        (title) => deck.find((note) => note.title === title)!.id,
      );
      const send = () =>
        page.evaluate(async (ids) => {
          const { getNote, sendNotesToGallery } = await import('/src/lib/notes.ts');
          await sendNotesToGallery(ids.map((id) => getNote(id)!)).isPersisted.promise;
        }, ids);
      await send();
      const moved = await states(page);
      expect(moved.map((note) => note.title)).toEqual([
        'Task pinned',
        'Recent pinned',
        'Old task',
        'Task peer',
        'Recent note',
      ]);
      expect(moved.every((note) => note.status === null)).toBe(true);
      expect(new Set(moved.map((note) => note.position)).size).toBe(moved.length);
      for (const note of moved) {
        const original = before.find((row) => row.id === note.id);
        expect(note.createdAt).toBe(original?.createdAt);
        expect(note.pinned).toBe(original?.pinned);
      }
      await page.getByRole('button', { name: 'Undo', exact: true }).click();
      await expect.poll(() => states(page)).toEqual(before);
      await send();
      await reloadGallery(page, vault);
      await expect.poll(() => states(page)).toEqual(moved);
    });
  });
}
