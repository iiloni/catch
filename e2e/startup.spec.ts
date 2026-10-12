import { expect, test } from '@playwright/test';
import { card, createNote, seedNotes, signUp, waitForPageTransition } from './helpers';

test('cold startup stays usable during sync and arriving notes enter progressively', async ({
  page,
}) => {
  await signUp(page);
  await seedNotes(page, ['First saved note', 'Second saved note']);

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    const observer = new MutationObserver(() => {
      if (!document.documentElement.dataset.firstHeaderOpacity) {
        const header = document.querySelector('[data-page-header]');
        const title = header?.querySelector('h1');
        const brand = header?.querySelector('img[alt="Catch"]');
        const control = header?.querySelector('button[aria-label="Settings"]');
        if (title && brand && control) {
          const visibleOpacity = (element: Element) => {
            let opacity = 1;
            for (let current: Element | null = element; current; current = current.parentElement) {
              opacity *= Number(getComputedStyle(current).opacity);
            }
            return opacity;
          };
          document.documentElement.dataset.firstHeaderOpacity = JSON.stringify(
            [title, brand, control].map(visibleOpacity),
          );
        }
      }
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
    await expect(page.locator('html')).toHaveAttribute('data-first-header-opacity', '[1,1,1]');
    await expect(page.getByRole('button', { name: 'New note' })).toBeEnabled();
    await expect(page.locator('#root')).not.toHaveAttribute('inert');
    await expect(page.locator('#app-launch')).toHaveCount(0);
    releaseSync();
    await page.unrouteAll({ behavior: 'wait' });
    // Every seeded card must have entered before observing whether a remount repeats it.
    for (const title of ['First saved note', 'Second saved note']) {
      await expect(card(page, title)).toBeVisible({ timeout: 15_000 });
      await expect(
        card(page, title).locator('xpath=ancestor::*[@data-note-cell]/div[1]'),
      ).toHaveCSS('opacity', '1');
    }
    await expect(page.locator('html')).toHaveAttribute('data-saw-note-entry', 'true');
    await expect(page.locator('[data-dock]')).toHaveCSS('opacity', '1');

    // A route remount must not fade the saved cards in again.
    await page.getByRole('link', { name: 'Search', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Search', exact: true })).toBeVisible();
    await waitForPageTransition(page);
    await page.evaluate(() => {
      delete document.documentElement.dataset.sawNoteEntry;
    });
    await page.getByRole('button', { name: 'Close search', exact: true }).click();
    await waitForPageTransition(page);
    await expect(card(page, 'First saved note')).toBeVisible();
    await expect(card(page, 'Second saved note')).toBeVisible();
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
