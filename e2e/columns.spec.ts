import { expect, test } from '@playwright/test';
import { card, createNote, noteAction, signUp, waitForPageTransition } from './helpers';

test('columns can be added, reordered and deleted without losing notes', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'This test moves a card with the mouse.');
  await signUp(page);
  await createNote(page, 'Ship it');
  await noteAction(page, 'Ship it', 'Add to deck');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  await page.getByRole('link', { name: 'Deck' }).click();
  await waitForPageTransition(page);

  await page.getByRole('button', { name: 'Edit columns' }).click();
  await expect(page.getByText('Protected default column')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete New' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'New column name' }).fill('Review');
  await page.getByRole('button', { name: 'Add column' }).click();
  await expect(page.getByRole('button', { name: 'Move Review up' })).toBeVisible();
  await page.getByRole('button', { name: 'Move Review up' }).click();
  await page.keyboard.press('Escape');
  const review = page.getByRole('region', { name: 'Review column' });
  const source = await page
    .getByRole('region', { name: 'New column' })
    .getByRole('article')
    .boundingBox();
  const target = await review.boundingBox();
  if (!source || !target) throw new Error('Missing Deck layout');
  await page.mouse.move(source.x + source.width / 2, source.y + 20);
  await page.mouse.down();
  await page.mouse.move(source.x + source.width / 2 + 20, source.y + 40, { steps: 5 });
  await page.mouse.move(target.x + target.width / 2, target.y + 100, { steps: 15 });
  await page.mouse.up();
  await expect(review.getByText('Ship it')).toBeVisible();

  await page.getByRole('button', { name: 'Edit columns' }).click();
  await page.getByRole('button', { name: 'Delete Review' }).click();
  await expect(page.getByText('Any notes in this column will be moved to New.')).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Delete Review' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete Review' }).click();
  await page.getByRole('button', { name: 'Delete column' }).click();
  await expect(page.locator('section[aria-label="Review column"]')).toHaveCount(0);
  await expect(page.locator('section[aria-label="New column"]').getByText('Ship it')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('region', { name: 'New column' }).getByText('Ship it')).toBeVisible();
  await expect(card(page, 'Ship it')).toBeVisible();
});

test('column editor stays above the virtual keyboard', async ({ page }) => {
  await signUp(page);
  await page.getByRole('link', { name: 'Deck' }).click();
  await page.getByRole('button', { name: 'Edit columns' }).click();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing viewport');
  await expect
    .poll(async () => {
      const box = await page.getByRole('dialog').first().boundingBox();
      return box ? viewport.height - box.y - box.height : 0;
    })
    .toBeGreaterThanOrEqual(8);
  const field = page.getByRole('textbox', { name: 'New column name' });
  await field.focus();
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  await expect
    .poll(async () => {
      const box = await page.getByRole('dialog').first().boundingBox();
      return box ? box.y + box.height : Number.POSITIVE_INFINITY;
    })
    .toBeLessThanOrEqual(viewport.height - 320 - 8);
  const sheet = await page.getByRole('dialog').first().boundingBox();
  const input = await field.boundingBox();
  if (!sheet || !input) throw new Error('Missing column editor layout');
  expect(viewport.height - 320 - sheet.y - sheet.height).toBeGreaterThanOrEqual(8);
  expect(sheet.x).toBeGreaterThanOrEqual(8);
  expect(viewport.width - sheet.x - sheet.width).toBeGreaterThanOrEqual(8);
  await expect(page.getByRole('dialog').first()).toHaveCSS('border-bottom-left-radius', '28px');
  expect(input.y + input.height).toBeLessThanOrEqual(sheet.y + sheet.height);
});
