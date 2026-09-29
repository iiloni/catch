import { type Browser, expect, type Page, test } from '@playwright/test';
import { card, createNote, openNote, signIn, signUp } from './helpers';

// The dev server has no service worker, so these tests keep the page's own code reachable
// and cut off the API instead of the whole network. A full offline reload of a production
// build (where the service worker serves the app) is covered by ADR 0007's manual checks.

const offlineIndicator = (page: Page) => page.getByRole('button', { name: /^Offline/ });

/** Checks what the server has by signing in from a fresh device. */
async function expectOnServer(browser: Browser, email: string, titles: string[]) {
  const device = await browser.newContext();
  const page = await device.newPage();
  await signIn(page, email);
  // Queued writes may still be on their way; the fresh device streams them in as they land.
  for (const title of titles) await expect(card(page, title)).toBeVisible({ timeout: 15_000 });
  await device.close();
}

test('notes stay on the device when the server cannot be reached', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Kept locally', 'Readable without the server');

  await page.route('**/api/**', (route) => route.abort());
  await page.reload();
  await expect(card(page, 'Kept locally')).toContainText('Readable without the server');
});

test('changes made offline are queued and sync when back online', async ({
  page,
  context,
  browser,
}) => {
  const email = await signUp(page);
  // Loads the lazy editor while the dev server can still serve it.
  await createNote(page, 'Written online');

  await context.setOffline(true);
  await expect(offlineIndicator(page)).toBeVisible();
  await createNote(page, 'Written offline');
  const dialog = await openNote(page, 'Written online');
  await dialog.getByText('Written online').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' and edited offline');
  await expect(dialog.getByText('Saved on this device')).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(page.getByRole('button', { name: /^Offline, \d+ changes? waiting$/ })).toBeVisible();

  await context.setOffline(false);
  await expect(offlineIndicator(page)).toBeHidden();
  await expectOnServer(browser, email, ['Written offline', 'Written online and edited offline']);
});

test('queued changes survive a reload and sync once the server is back', async ({
  page,
  browser,
}) => {
  const email = await signUp(page);
  await createNote(page, 'First');

  await page.route('**/api/**', (route) => route.abort());
  await createNote(page, 'Queued');
  await page.reload();
  await expect(card(page, 'Queued')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Offline, 1 change waiting' })).toBeVisible();

  await page.unroute('**/api/**');
  // Coming back online retries straight away instead of after the backoff.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(offlineIndicator(page)).toBeHidden();
  await expectOnServer(browser, email, ['First', 'Queued']);
});
