import { expect, test } from '@playwright/test';
import { card, createNote, openNote, signIn, signUp } from './helpers';

test('a refused session keeps cached notes editable and queued writes survive signing in', async ({
  page,
  browser,
}) => {
  const email = await signUp(page);
  await createNote(page, 'Saved note');
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/shapes/') || path.startsWith('/api/notes')) {
      return route.fulfill({ status: 401, json: { error: 'Unauthorized' } });
    }
    return route.continue();
  });
  await createNote(page, 'Queued note');
  await page.reload();
  await expect(page.getByRole('button', { name: /^Signed out/ })).toBeVisible();
  await expect(card(page, 'Saved note')).toBeVisible();
  await expect(card(page, 'Queued note')).toBeVisible();

  const dialog = await openNote(page, 'Saved note');
  await dialog.getByText('Saved note', { exact: true }).click();
  await page.keyboard.press('End');
  await page.keyboard.type(' edited');
  await expect(dialog.getByText('Saved on this device')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card(page, 'Saved note edited')).toBeVisible();

  await page.unroute('**/api/**');
  await page.getByRole('button', { name: /^Signed out/ }).click();
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(card(page, 'Saved note edited')).toBeVisible({ timeout: 15_000 });
  await expect(card(page, 'Queued note')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Signed out/ })).toBeHidden();
  // A fresh device verifies that the retained outbox reached the server.
  const device = await browser.newContext();
  try {
    const fresh = await device.newPage();
    await signIn(fresh, email);
    await expect(card(fresh, 'Saved note edited')).toBeVisible({ timeout: 15_000 });
    await expect(card(fresh, 'Queued note')).toBeVisible();
  } finally {
    await device.close();
  }
});
