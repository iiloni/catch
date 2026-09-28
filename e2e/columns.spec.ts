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
  await expect(page.getByRole('dialog').getByText('Default', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete New' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'New column name' }).fill('Review');
  await page.getByRole('button', { name: 'Add column' }).click();
  const reviewHandle = page.getByRole('button', { name: 'Reorder Review column' });
  const newHandle = page.getByRole('button', { name: 'Reorder New column' });
  await expect(reviewHandle).toBeVisible();
  const start = await reviewHandle.boundingBox();
  const end = await newHandle.boundingBox();
  if (!start || !end) throw new Error('Missing column drag handles');
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y - 12, { steps: 4 });
  const preview = page.locator('[data-column-drag-preview]');
  await expect(preview).toBeVisible();
  const lifted = await preview.boundingBox();
  const initialSlot = await page.locator('[data-column-drop-placeholder]').boundingBox();
  if (!lifted || !initialSlot) throw new Error('Missing initial column drag layout');
  expect(Math.abs(lifted.y - initialSlot.y)).toBeLessThan(initialSlot.height);
  const firstCard = await page.locator('[data-column-card="new"]').boundingBox();
  if (!firstCard) throw new Error('Missing first column');
  expect(lifted.y).toBeGreaterThan(firstCard.y + firstCard.height);
  await page.mouse.move(end.x + end.width / 2, end.y + 4, { steps: 12 });
  const placeholder = page.locator('[data-column-drop-placeholder]');
  await expect(placeholder).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(placeholder).toHaveCSS('border-top-style', 'dashed');
  const slot = await placeholder.boundingBox();
  const newCard = await page.locator('[data-column-card="new"]').boundingBox();
  if (!slot || !newCard) throw new Error('Missing column drop slot');
  expect(slot.y + slot.height).toBeLessThan(newCard.y);
  await page.mouse.up();
  await expect
    .poll(() =>
      page
        .getByRole('dialog')
        .locator('input[aria-label^="Name of "]')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value)),
    )
    .toEqual(['Review', 'New', 'In progress', 'On hold']);
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

test('column handles reorder independently of the sheet grip on touch', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'This test uses touch input.');
  await signUp(page);
  await page.getByRole('link', { name: 'Deck' }).click();
  await page.getByRole('button', { name: 'Edit columns' }).click();
  const sheet = page.getByRole('dialog').first();
  await expect(sheet).toHaveCSS('transform', 'none');
  const before = await sheet.boundingBox();
  if (!before) throw new Error('Missing column editor');

  const session = await page.context().newCDPSession(page);
  async function dragHandle(from: string, to: string) {
    const source = await page.getByRole('button', { name: `Reorder ${from} column` }).boundingBox();
    const target = await page.getByRole('button', { name: `Reorder ${to} column` }).boundingBox();
    if (!source || !target) throw new Error('Missing column drag handles');
    const start = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
    const end = {
      x: target.x + target.width / 2,
      y: start.y > target.y ? target.y + 4 : target.y + target.height - 4,
    };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await page.waitForTimeout(180);
    for (let step = 1; step <= 10; step++) {
      const y = start.y + ((end.y - start.y) * step) / 10;
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: start.x, y }],
      });
      await page.waitForTimeout(16);
    }
    await expect(sheet.locator('[data-column-drop-placeholder]')).toBeVisible();
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }

  const order = () =>
    sheet
      .locator('input[aria-label^="Name of "]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await dragHandle('In progress', 'New');
  await expect.poll(order).toEqual(['In progress', 'New', 'On hold']);
  await dragHandle('In progress', 'On hold');
  await expect.poll(order).toEqual(['New', 'On hold', 'In progress']);
  const after = await sheet.boundingBox();
  if (!after) throw new Error('Column editor closed during the drag');
  expect(Math.abs(after.y - before.y)).toBeLessThan(4);

  const grip = await sheet.locator('[data-sheet-grip]').boundingBox();
  if (!grip) throw new Error('Missing sheet grip');
  const point = { x: grip.x + grip.width / 2, y: grip.y + grip.height / 2 };
  await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  for (let step = 1; step <= 10; step++) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: point.x, y: point.y + step * 16 }],
    });
    await page.waitForTimeout(16);
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await session.detach();
  await expect(sheet).toHaveCount(0);
});
