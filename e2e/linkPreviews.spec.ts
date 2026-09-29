import { expect, test } from '@playwright/test';
import { card, createNote, openNote, signUp } from './helpers';

test('a note’s links show under its card, in an overlay and in the open note', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Links', 'see https://example.com/page and https://example.org');

  // Before or after the server fetches them, the underlay names the first link.
  const underlay = page.getByRole('button', { name: /^2 links, first / });
  await expect(underlay).toBeVisible();
  await underlay.click();
  await expect(page.getByRole('dialog', { name: '2 links' })).toBeVisible();
  const overlay = page.getByRole('dialog');
  await expect(overlay.getByRole('link')).toHaveCount(2);
  await expect(overlay.getByRole('link').first()).toHaveAttribute(
    'href',
    'https://example.com/page',
  );

  // Removing a preview leaves the link in the note's text.
  await overlay.getByRole('button', { name: 'Link options' }).first().click();
  await page.getByRole('menuitem', { name: 'Remove preview' }).click();
  await expect(overlay.getByRole('link')).toHaveCount(1);
  await expect(overlay).toHaveAccessibleName('Link');
  await overlay.getByRole('button', { name: 'Close' }).click();
  await expect(overlay).toBeHidden();
  await expect(page.getByRole('button', { name: /^Link: / })).toBeVisible();
  await expect(card(page, 'Links')).toContainText('https://example.com/page');

  const dialog = await openNote(page, 'Links');
  const links = dialog.getByRole('region', { name: 'Links' });
  await expect(links.getByRole('link')).toHaveAttribute('href', 'https://example.org');
});

test('link previews can be turned off in Settings', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Bookmarks', 'https://example.com is a link and some text');
  await expect(page.getByRole('button', { name: /^Link: / })).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('switch', { name: 'Link previews' }).click();
  await page.goBack();
  await expect(card(page, 'Bookmarks')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Link: / })).toBeHidden();
});

test('the link overlay dismisses with an upward or downward touch swipe', async ({ page }) => {
  test.skip(test.info().project.name !== 'android');
  await signUp(page);
  await createNote(page, 'Swipe links', 'https://example.com and https://example.org');
  const underlay = page.getByRole('button', { name: /^2 links, first / });
  const overlay = page.getByRole('dialog', { name: '2 links' });
  const cdp = await page.context().newCDPSession(page);

  for (const delta of [-150, 150]) {
    await underlay.click();
    await expect(overlay).toBeVisible();
    const header = await overlay.locator('header').boundingBox();
    if (!header) throw new Error('Link overlay header is missing');
    const x = header.x + 30;
    const y = header.y + header.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y + (delta * step) / 6 }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(overlay).toBeHidden();
  }
});
