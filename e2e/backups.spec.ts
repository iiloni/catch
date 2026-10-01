import { readFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';

// Restoring is not driven from here: it would put back the database under every other test.
// It is covered against a database of its own in apps/server/src/backups.

async function openBackups(page: Page) {
  const answered = page.waitForResponse((response) =>
    new URL(response.url()).pathname.endsWith('/api/admin/backups'),
  );
  await page.goto('/settings/admin/backups');
  return answered;
}

test('an admin backs up the server, downloads the backup and deletes it', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The server makes one backup at a time, so one project drives it.');
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // The seeded admin has notes to sync on its first load, unlike a fresh account.
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 15_000 });

  expect((await openBackups(page)).status()).toBe(200);
  const section = page.getByRole('region', { name: 'Server backups' });
  await expect(section).toBeVisible();
  const backups = section.getByRole('button', { name: /^Manage the backup from/ });
  const before = await backups.count();

  await section.getByRole('button', { name: 'Back up now' }).click();
  await expect(page.getByText('Backup saved on the server')).toBeVisible({ timeout: 30_000 });
  await expect(backups).toHaveCount(before + 1);

  // The newest is listed first.
  await backups.first().click();
  const downloading = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Download' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^catch-backup-[\d_-]+-manual\.zip$/);
  const archive = await readFile(await download.path());
  expect(archive.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');
  expect(archive.includes('manifest.json')).toBe(true);

  await expect(page.getByRole('menu')).toBeHidden();
  await backups.first().click();
  await page.getByRole('menuitem', { name: 'Delete' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
  await expect(backups).toHaveCount(before);
});
