import { expect, test } from '@playwright/test';
import { card, seedNotes, signUp, waitForPageTransition } from './helpers';

test('installed apps reopen the last Deck or Gallery without overriding navigation or note links', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const result = matchMedia(query);
      if (query === '(display-mode: standalone)') {
        Object.defineProperty(result, 'matches', { value: true });
      }
      return result;
    };
    const observer = new MutationObserver(() => {
      const heading = document.querySelector('h1');
      if (heading) {
        document.documentElement.dataset.firstPage = heading.textContent ?? '';
        observer.disconnect();
      }
    });
    observer.observe(document, { subtree: true, childList: true });
  });
  await signUp(page);
  await seedNotes(page, ['Linked gallery note']);
  const noteId = await card(page, 'Linked gallery note').getAttribute('data-note-card');
  expect(noteId).toBeTruthy();

  await page.getByRole('link', { name: 'Deck', exact: true }).click();
  await waitForPageTransition(page);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await waitForPageTransition(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/deck$/);
  await expect(page.getByRole('heading', { name: 'Deck', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-first-page', 'Deck');

  await page.route('**/api/**', (route) => route.abort());
  await page.goto('/');
  await expect(page).toHaveURL(/\/deck$/);
  await expect(page.getByRole('heading', { name: 'Deck', exact: true })).toBeVisible();
  await page.unrouteAll({ behavior: 'wait' });

  // The saved Deck must not turn the Gallery tab into another Deck launch.
  await page.getByRole('link', { name: 'Gallery', exact: true }).click();
  await waitForPageTransition(page);
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await waitForPageTransition(page);
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'Deck', exact: true }).click();
  await waitForPageTransition(page);
  await page.goto(`/?note=${noteId}`);
  await expect(page).toHaveURL(new RegExp(`/\\?note=${noteId}$`));
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Edit note' }).getByRole('textbox')).toContainText(
    'Linked gallery note',
  );
});

test('ordinary browser tabs keep the requested Gallery URL despite an installed app preference', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Browser URL behavior is independent of layout; installed launches cover both.',
  );
  await signUp(page);
  await page.evaluate(() => localStorage.setItem('catch-home-page', '/deck'));
  await page.goto('/');
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Deck', exact: true }).click();
  await waitForPageTransition(page);
  await page.getByRole('link', { name: 'Gallery', exact: true }).click();
  await waitForPageTransition(page);
  expect(await page.evaluate(() => localStorage.getItem('catch-home-page'))).toBe('/deck');
});
