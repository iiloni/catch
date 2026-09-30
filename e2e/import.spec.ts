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
  await expect(
    page.getByText('Every note and available attachment in this export is already in Catch.'),
  ).toBeVisible();
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

const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
  'base64',
);

async function mediaTakeout(includeMedia = true) {
  const note = {
    title: 'Keep media',
    textContent: 'Original Keep words',
    createdTimestampUsec: usec('2024-02-01T10:00:00Z'),
    userEditedTimestampUsec: usec('2024-02-02T10:00:00Z'),
    attachments: [
      { filePath: 'photo.png', mimetype: 'image/png' },
      { filePath: 'details.txt', mimetype: 'text/plain' },
    ],
  };
  const zip = await makeZip([
    { name: 'Takeout/Keep/Media.json', text: JSON.stringify(note) },
    ...(includeMedia
      ? [
          { name: 'Takeout/Keep/photo.png', bytes: new Uint8Array(imageBytes) },
          { name: 'Takeout/Keep/details.txt', text: 'Keep attachment bytes', stored: true },
          {
            name: 'Takeout/Keep/Only.json',
            text: JSON.stringify({
              title: '',
              textContent: '',
              createdTimestampUsec: usec('2024-03-01T10:00:00Z'),
              userEditedTimestampUsec: usec('2024-03-02T10:00:00Z'),
              attachments: [{ filePath: 'only.png', mimetype: 'image/png' }],
            }),
          },
          { name: 'Takeout/Keep/only.png', bytes: new Uint8Array(imageBytes) },
        ]
      : []),
  ]);
  return {
    name: 'takeout.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(await zip.arrayBuffer()),
  };
}

test('Keep attachments fill the catalog without inline blocks and reimports preserve edits and removals', async ({
  page,
}) => {
  await signUp(page);
  await page.goto('/settings/data');
  const importButton = page.getByRole('button', { name: 'Import from Google Keep' });
  await expect(importButton).toBeEnabled();
  // An earlier import with no media files.
  await page.getByLabel('Google Takeout export').setInputFiles(await mediaTakeout(false));
  await expect(page.getByRole('dialog')).toContainText('2 attachments could not be matched');
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status')).toContainText('1 note imported from Google Keep');
  await page.goto('/');
  await card(page, 'Keep media').getByRole('button', { name: 'Open note' }).click();
  await expect(page.locator('.note-editor [contenteditable]')).toBeVisible();
  const headers = await page.evaluate(() => ({
    Authorization: `Bearer ${localStorage.getItem('catch-auth-token')}`,
  }));
  const noteId = new URL(page.url()).searchParams.get('note');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  // Simulate a later edit: re-importing must not replace this content.
  await page.request.patch(`/api/notes/${noteId}`, {
    headers,
    data: {
      content: [
        {
          type: 'heading',
          props: { level: 3 },
          content: [{ type: 'text', text: 'Keep media', styles: {} }],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'My edited words', styles: {} }] },
      ],
    },
  });
  await page.goto('/settings/data');
  await expect(importButton).toBeEnabled();
  const archive = await mediaTakeout();
  await page.getByLabel('Google Takeout export').setInputFiles(archive);
  await expect(page.getByRole('dialog')).toContainText('3 attachments will be added');
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByRole('status')).toContainText(
    '1 note and 3 attachments imported from Google Keep',
    { timeout: 30000 },
  );
  await page.goto('/');
  await card(page, 'Keep media').getByRole('button', { name: 'Open note' }).click();
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByRole('listitem')).toHaveCount(2);
  await expect(page.locator('.note-editor')).toContainText('My edited words');
  await expect(
    page.locator(
      '.note-editor [data-content-type="image"], .note-editor [data-content-type="file"]',
    ),
  ).toHaveCount(0);
  const imageId = await media
    .locator('[data-attachment]')
    .filter({ has: page.getByTitle('photo.png', { exact: true }) })
    .getAttribute('data-attachment');
  expect(
    await (await page.request.get(`/api/attachments/${imageId}/content`, { headers })).body(),
  ).toEqual(imageBytes);
  await media.getByRole('button', { name: 'View photo.png' }).click();
  const viewer = page.locator('[data-media-viewer]');
  await expect(viewer.getByRole('img')).toBeVisible();
  await viewer.getByRole('button', { name: 'Close media viewer' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  await media.getByRole('button', { name: 'Manage photo.png' }).click();
  await expect(page.getByRole('menuitem', { name: 'Add to note' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Remove attachment' }).click();
  await expect(media.getByRole('listitem')).toHaveCount(1);
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  // A note consisting only of media was retained.
  await expect(
    page.locator('article').filter({ has: page.getByRole('img', { name: 'only.png' }) }),
  ).toBeVisible();
  await page.goto('/settings/data');
  await expect(importButton).toBeEnabled();
  await page.getByLabel('Google Takeout export').setInputFiles(archive);
  await expect(
    page.getByText('Every note and available attachment in this export is already in Catch.'),
  ).toBeVisible();
});

test('prepared Keep attachment uploads survive an offline reload', async ({ page }) => {
  await signUp(page);
  await page.goto('/settings/data');
  await expect(page.getByRole('button', { name: 'Import from Google Keep' })).toBeEnabled();
  await page.getByLabel('Google Takeout export').setInputFiles(await mediaTakeout());
  await page.route('**/api/**', (route) => route.abort());
  await page.getByRole('dialog').getByRole('button', { name: 'Import' }).click();
  await expect(page.getByText('0 of 3 attachments saved on your server')).toBeVisible();
  await expect(page.getByText(/Preparing .* on this device/)).toHaveCount(0);
  await page.reload();
  await expect(page.getByText('0 of 3 attachments saved on your server')).toBeVisible();
  await page.goto('/');
  await card(page, 'Keep media').getByRole('button', { name: 'Open note' }).click();
  await expect(page.getByRole('region', { name: 'Media' }).getByRole('img')).toBeVisible();
  await expect(page.locator('.note-editor [data-content-type="image"]')).toHaveCount(0);
  await page.unroute('**/api/**');
  await page.goto('/settings/data');
  await expect(page.getByRole('status')).toContainText(
    '2 notes and 3 attachments imported from Google Keep',
    { timeout: 30000 },
  );
});
