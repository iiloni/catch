import { expect, test } from '@playwright/test';
import { makeZip } from '../apps/web/src/test/zip';
import { card, openGalleryPage, signUp } from './helpers';

const usec = (iso: string) => new Date(iso).getTime() * 1000;

/** A Google Takeout archive of Keep, as the export writes it. */
async function takeout() {
  const note = (name: string, fields: Record<string, unknown>) => ({
    name: `Takeout/Keep/${name}.json`,
    text: JSON.stringify({
      color: 'DEFAULT',
      isTrashed: false,
      isPinned: false,
      isArchived: false,
      textContent: '',
      title: name,
      createdTimestampUsec: usec('2024-01-01T10:00:00Z'),
      userEditedTimestampUsec: usec('2024-01-02T10:00:00Z'),
      ...fields,
    }),
  });
  const zip = await makeZip([
    note('Groceries', {
      color: 'YELLOW',
      isPinned: true,
      listContent: [
        { text: 'Oat milk', isChecked: false },
        { text: 'Eggs', isChecked: true },
      ],
    }),
    note('Trip ideas', {
      textContent: 'Lisbon in spring\nhttps://en.wikipedia.org/wiki/Lisbon',
      createdTimestampUsec: usec('2023-05-01T10:00:00Z'),
    }),
    note('Old plans', { textContent: 'Kept for later', isArchived: true }),
    note('Deleted', { textContent: 'Gone', isTrashed: true }),
    { name: 'Takeout/Keep/Labels.txt', text: 'Home' },
  ]);
  return {
    name: 'takeout.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await zip.arrayBuffer()),
  };
}

test('notes are imported from a Google Keep export, once', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings/data');
  await expect(page.getByRole('heading', { name: 'Data Management' }).first()).toBeVisible();

  const archive = await takeout();
  const importButton = page.getByRole('button', { name: 'Import from Google Keep' });
  await expect(importButton).toBeEnabled();
  await page.getByLabel('Google Takeout export').setInputFiles(archive);
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Import 3 notes?' })).toBeVisible();
  await expect(dialog).toContainText('1 note in Keep’s trash stays behind.');
  await dialog.getByRole('button', { name: 'Import' }).click();
  await expect(dialog).toBeHidden();
  // The page follows the server saving them, then sums up.
  await expect(page.getByRole('status')).toContainText('3 notes imported from Google Keep');

  // Reloading shows what the server has, not what this page added.
  await page.goto('/');
  await expect(card(page, 'Groceries')).toContainText('Oat milk');
  await expect(card(page, 'Trip ideas')).toContainText('Lisbon in spring');
  await expect(card(page, 'Deleted')).toHaveCount(0);
  await expect(card(page, 'Old plans')).toHaveCount(0);
  await page.reload();
  await expect(card(page, 'Groceries')).toBeVisible();
  await openGalleryPage(page, 'Archive');
  await expect(card(page, 'Old plans')).toBeVisible();

  // The same export again adds nothing.
  await page.goto('/settings/data');
  await expect(importButton).toBeEnabled();
  await page.getByLabel('Google Takeout export').setInputFiles(archive);
  await expect(page.getByText('Every note in this export is already in Catch.')).toBeVisible();
});

test('an import keeps going when the page is left, and shows its progress on return', async ({
  page,
}) => {
  await signUp(page);
  const zip = await makeZip(
    Array.from({ length: 120 }, (_, index) => ({
      name: `Takeout/Keep/Note ${index}.json`,
      text: JSON.stringify({
        title: `Imported ${index}`,
        textContent: 'From Keep',
        createdTimestampUsec: usec('2024-01-01T10:00:00Z') + index * 1_000_000,
        userEditedTimestampUsec: usec('2024-01-02T10:00:00Z') + index * 1_000_000,
      }),
    })),
  );
  // A slow server, so the import is still going when the page is left.
  await page.route('**/api/notes/batch', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });

  await page.goto('/settings/data');
  await expect(page.getByRole('button', { name: 'Import from Google Keep' })).toBeEnabled();
  await page.getByLabel('Google Takeout export').setInputFiles({
    name: 'takeout.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await zip.arrayBuffer()),
  });
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  const progress = page.getByRole('progressbar', { name: 'Importing from Google Keep' });
  await expect(progress).toBeVisible();
  await expect(page.getByText('0 of 120 notes saved on your server')).toBeVisible();

  // The notes show at once, while the server is still taking them.
  await page.goto('/');
  await expect(card(page, 'Imported 119')).toBeVisible();

  await page.goto('/settings/data');
  await expect(progress).toBeVisible();
  await expect(page.getByRole('button', { name: 'Import from Google Keep' })).toBeDisabled();
  await expect(page.getByRole('status')).toContainText('120 notes imported from Google Keep', {
    timeout: 20_000,
  });
  await page.getByRole('button', { name: 'Dismiss' }).click();
  await expect(page.getByRole('status')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Import from Google Keep' })).toBeEnabled();
});
