import { expect, type Page, test } from '@playwright/test';
import { createNote, openNote, signUp, waitForPageTransition } from './helpers';

test('settings pages load promptly while all six collections keep syncing over HTTP', async ({
  page,
  isMobile,
}) => {
  const polls = new Map<string, number>();
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (
      url.pathname.startsWith('/api/shapes/') &&
      (url.searchParams.get('live') === 'true' || url.searchParams.has('cache-buster'))
    )
      polls.set(url.pathname, (polls.get(url.pathname) ?? 0) + 1);
  });
  await signUp(page);
  await createNote(page, 'Navigation while syncing');
  if (!isMobile) await openNote(page, 'Navigation while syncing');
  await page.evaluate(async () => {
    const collections = await import('/src/lib/collections.ts');
    await Promise.all(
      [
        collections.notesCollection,
        collections.boardColumnsCollection,
        collections.linkPreviewsCollection,
        collections.attachmentsCollection,
        collections.tagsCollection,
        collections.noteTagsCollection,
      ].map((collection) => collection.preload()),
    );
  });
  await expect.poll(() => [...polls.values()].filter((count) => count >= 2).length).toBe(6);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Appearance', exact: true })).toBeVisible({
    timeout: 4000,
  });
  const pages = page.getByRole('navigation', { name: 'Settings pages' });
  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: General' }).click();
    await pages.getByRole('button', { name: 'Tags', exact: true }).click();
  } else {
    await pages.getByRole('link', { name: 'Tags', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'New tag', exact: true })).toBeVisible({
    timeout: 4000,
  });
  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: Tags' }).click();
    await pages.getByRole('button', { name: 'Account', exact: true }).click();
  } else {
    await pages.getByRole('link', { name: 'Account', exact: true }).click();
  }
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible({
    timeout: 4000,
  });
});

/** Update is a user setting, with the project's links and the server's version. */
async function expectUpdatePage(page: Page) {
  await expect(page).toHaveURL(/\/settings\/update$/);
  await expect(page.getByRole('region', { name: 'Version', exact: true })).toContainText(
    'Server version',
  );
  await expect(page.getByRole('link', { name: 'GitHub repository' })).toHaveAttribute(
    'href',
    'https://github.com/iiloni/catch',
  );
  await expect(page.getByRole('link', { name: 'GitHub releases' })).toHaveAttribute(
    'href',
    'https://github.com/iiloni/catch/releases',
  );
  await expect(page.getByRole('button', { name: 'Check for updates' })).toBeEnabled();
  await expect(page.getByText('App version', { exact: true })).toBeHidden();
}

test('settings list their pages beside the open one on wide screens', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Phones pick pages from the dock.');
  await signUp(page);
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  // The page list takes the dock's place.
  await expect(page.getByRole('button', { name: 'New note' })).toBeHidden();

  await page.getByRole('button', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'System' }).click();

  const pages = page.getByRole('navigation', { name: 'Settings pages' });
  await pages.getByRole('link', { name: 'Account' }).click();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await pages.getByRole('link', { name: 'Update', exact: true }).click();
  await expectUpdatePage(page);

  // Switching pages replaced history, so one step back leaves Settings.
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
});

test('on phones the dock picks settings pages, also by holding and sliding', async ({
  page,
  context,
  isMobile,
}) => {
  test.skip(!isMobile, 'Wide screens list the pages beside the open one.');
  await signUp(page);
  await page.getByRole('button', { name: 'Settings' }).tap();
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await waitForPageTransition(page);

  const selector = page.getByRole('button', { name: 'Settings page: General' });
  await selector.tap();
  const picker = page.getByRole('navigation', { name: 'Settings pages' });
  await picker.getByRole('button', { name: 'Account' }).tap();
  await expect(page).toHaveURL(/\/settings\/account$/);
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await waitForPageTransition(page);
  await expect(picker).toBeHidden();

  // Hold the selector, slide onto General and let go.
  const box = await page.getByRole('button', { name: 'Settings page: Account' }).boundingBox();
  if (!box) throw new Error('Missing settings selector');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const session = await context.newCDPSession(page);
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
  await expect(picker).toBeVisible();
  const target = await picker.getByRole('button', { name: 'General' }).boundingBox();
  if (!target) throw new Error('Missing General in the picker');
  const end = target.y + target.height / 2;
  for (let step = 1; step <= 6; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y + ((end - start.y) * step) / 6 }],
    });
  }
  // A finger lifted while still moving is a fling to Chrome, which then drops the click of
  // the next tap. Rest on the page first, as a person does.
  await page.waitForTimeout(200);
  await session.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: start.x, y: end }],
  });
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('heading', { name: 'General' })).toBeVisible();
  await waitForPageTransition(page);

  await page.getByRole('button', { name: 'Settings page: General' }).tap();
  await picker.getByRole('button', { name: 'Update', exact: true }).tap();
  await expectUpdatePage(page);
  await waitForPageTransition(page);

  await page.getByRole('button', { name: 'Back' }).tap();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
});
