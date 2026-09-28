import { expect, test } from '@playwright/test';
import { card, createNote, noteToolbar, openNote, signUp } from './helpers';

// A landscape tablet, wide enough to show an open note beside the page.
test.use({ viewport: { width: 1180, height: 820 } });

test('an open note sits beside the page, which stays usable', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Alpha', 'First');
  await createNote(page, 'Beta', 'Second');

  const dialog = await openNote(page, 'Alpha');
  const pane = await dialog.boundingBox();
  const alpha = await card(page, 'Alpha').boundingBox();
  expect(pane && alpha && alpha.x + alpha.width <= pane.x).toBe(true);

  // The page keeps its tabs while the note has its own toolbar.
  await expect(page.getByRole('link', { name: 'Deck' })).toBeVisible();
  await expect(noteToolbar(page)).toBeVisible();

  // Opening another note swaps the pane's note in place.
  await card(page, 'Beta').getByRole('button', { name: 'Open note' }).click();
  // The new note fades in over the old one.
  await expect(
    page.getByRole('dialog').locator('[contenteditable]', { hasText: 'Second' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);

  // Switching notes replaced the history entry, so one step back closes the pane.
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByRole('separator', { name: 'Resize note' })).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});

test('the split is resized by dragging the handle, within limits', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Alpha');
  const dialog = await openNote(page, 'Alpha');
  const handle = page.getByRole('separator', { name: 'Resize note' });
  await expect(handle).toBeVisible();

  const box = await handle.boundingBox();
  if (!box) throw new Error('No handle');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const share = async () => Number(await handle.getAttribute('aria-valuenow'));
  const before = await share();

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y, { steps: 5 });
  await page.mouse.up();
  const wider = await share();
  expect(wider).toBeGreaterThan(before);
  const paneAfter = await dialog.boundingBox();
  expect(paneAfter?.x).toBeGreaterThan(box.x + 100);

  // Far past either edge, the split stops at its limits.
  const moved = await handle.boundingBox();
  if (!moved) throw new Error('No handle');
  await page.mouse.move(moved.x + moved.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(5, y, { steps: 5 });
  await page.mouse.up();
  const min = await handle.getAttribute('aria-valuemin');
  expect(await handle.getAttribute('aria-valuenow')).toBe(min);

  // The split is remembered.
  await page.goto('/');
  await openNote(page, 'Alpha');
  await expect(handle).toHaveAttribute('aria-valuenow', String(min));
});
