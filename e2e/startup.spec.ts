import { expect, test } from '@playwright/test';
import { card, createNote, seedNotes, signUp, waitForPageTransition } from './helpers';

test('cold startup stays usable during sync and arriving notes enter progressively', async ({
  page,
}) => {
  await signUp(page);
  await seedNotes(page, ['First saved note', 'Second saved note']);

  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.documentElement.dataset.sawNoteEntry === 'true') return;
      for (const card of document.querySelectorAll<HTMLElement>('[data-note-cell] > div')) {
        const opacity = Number(getComputedStyle(card).opacity);
        if (opacity > 0 && opacity < 1) {
          document.documentElement.dataset.sawNoteEntry = 'true';
        }
      }
    });
    observer.observe(document, { subtree: true, attributes: true, childList: true });
  });

  let releaseSync: () => void = () => {};
  const syncHeld = new Promise<void>((resolve) => {
    releaseSync = resolve;
  });
  await page.route('**/api/shapes/**', async (route) => {
    await syncHeld;
    await route.continue();
  });
  try {
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled();
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.locator('#app-launch')).toHaveCount(0);
    releaseSync();
    await page.unrouteAll({ behavior: 'wait' });
    await expect(card(page, 'First saved note')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('html')).toHaveAttribute('data-saw-note-entry', 'true');
    await expect(
      card(page, 'First saved note').locator('xpath=ancestor::*[@data-note-cell]/div[1]'),
    ).toHaveCSS('opacity', '1');
    await expect(page.locator('[data-dock]')).toHaveCSS('opacity', '1');

    // A route remount must not fade the saved cards in again.
    await page.getByRole('link', { name: 'Search', exact: true }).click();
    await waitForPageTransition(page);
    await page.evaluate(() => {
      delete document.documentElement.dataset.sawNoteEntry;
    });
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await waitForPageTransition(page);
    await expect(card(page, 'First saved note')).toBeVisible();
    await expect(page.locator('html')).not.toHaveAttribute('data-saw-note-entry');
  } finally {
    releaseSync();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('reduced motion shows saved notes immediately on an offline cold load', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Online note');
  await page.route('**/api/**', (route) => route.abort());
  await createNote(page, 'Offline saved note');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (document.documentElement.dataset.sawNoteEntry === 'true') return;
      for (const card of document.querySelectorAll<HTMLElement>('[data-note-cell] > div')) {
        if (getComputedStyle(card).opacity !== '1') {
          document.documentElement.dataset.sawNoteEntry = 'true';
        }
      }
    });
    observer.observe(document, { subtree: true, attributes: true, childList: true });
  });
  await page.reload();
  await expect(card(page, 'Offline saved note')).toBeVisible();
  await expect(page.locator('#root')).not.toHaveAttribute('inert');
  await expect(page.locator('#app-launch')).toHaveCount(0);
  await expect(page.locator('html')).not.toHaveAttribute('data-saw-note-entry');
  await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled();
});
