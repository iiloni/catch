import { expect, test } from '@playwright/test';
import { card, createNote, noteAction, openNote, signUp } from './helpers';

test('notes are created, edited, and synced across tabs', async ({ page, context }) => {
  await signUp(page);
  await createNote(page, 'Groceries', 'Oat milk');

  const otherTab = await context.newPage();
  await otherTab.goto('/');
  await expect(card(otherTab, 'Groceries')).toContainText('Oat milk');

  const dialog = await openNote(otherTab, 'Groceries');
  await dialog.getByText('Oat milk').click();
  await otherTab.keyboard.press('End');
  await otherTab.keyboard.type(' and eggs');
  await expect(dialog.getByText(/^Edited/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(card(page, 'Groceries')).toContainText('Oat milk and eggs');
  await page.reload();
  await expect(card(page, 'Groceries')).toContainText('Oat milk and eggs');
});

test('an empty composer creates nothing', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'Take a note…' }).click();
  await page
    .getByRole('region', { name: 'New note' })
    .getByRole('button', { name: 'Close' })
    .click();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('users only see their own notes', async ({ browser }) => {
  const alice = await (await browser.newContext()).newPage();
  await signUp(alice);
  await createNote(alice, 'Alice secret');

  const bob = await (await browser.newContext()).newPage();
  await signUp(bob);
  await expect(bob.getByText('Alice secret')).toBeHidden();
});

test('trash with undo, restore, and delete forever', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Dentist');

  await noteAction(page, 'Dentist', 'Move to trash');
  await expect(card(page, 'Dentist')).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Dentist')).toBeVisible();

  await noteAction(page, 'Dentist', 'Move to trash');
  await page.getByRole('link', { name: 'Trash' }).click();
  await noteAction(page, 'Dentist', 'Restore');
  await expect(card(page, 'Dentist')).toBeHidden();
  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(card(page, 'Dentist')).toBeVisible();

  await noteAction(page, 'Dentist', 'Move to trash');
  await page.getByRole('link', { name: 'Trash' }).click();
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText('No notes in the trash.')).toBeVisible();
});

test('archive and unarchive', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Old receipts');

  await noteAction(page, 'Old receipts', 'Archive');
  await expect(card(page, 'Old receipts')).toBeHidden();
  await page.getByRole('link', { name: 'Archive' }).click();
  await noteAction(page, 'Old receipts', 'Unarchive');
  await page.getByRole('link', { name: 'Notes' }).click();
  await expect(card(page, 'Old receipts')).toBeVisible();
});

test('color and pin', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'First');
  await createNote(page, 'Second');

  const dialog = await openNote(page, 'First');
  await dialog.getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Teal' }).click();
  await page.keyboard.press('Escape');
  await dialog.getByRole('button', { name: 'Pin', exact: true }).click();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(card(page, 'First')).toHaveAttribute('data-note-color', 'teal');
  // Pinned notes come first, ahead of the newer note.
  await expect(page.getByRole('article').first()).toContainText('First');
});

test('deck board moves notes between columns and back to the gallery', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Board drag uses a mouse; touch dragging is covered manually.');
  await signUp(page);
  await createNote(page, 'Ship it');
  await noteAction(page, 'Ship it', 'Add to deck');
  await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('radio', { name: 'Board view' }).click();
  const newColumn = page.getByRole('region', { name: 'New column' });
  const holdColumn = page.getByRole('region', { name: 'On hold column' });
  await expect(newColumn.getByText('Ship it')).toBeVisible();

  async function drag(from: typeof newColumn, to: typeof newColumn) {
    const source = await from.getByRole('article').first().boundingBox();
    const target = await to.boundingBox();
    if (!source || !target) throw new Error('Missing layout');
    await page.mouse.move(source.x + source.width / 2, source.y + 20);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + 40, { steps: 5 });
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 15,
    });
    await page.mouse.up();
    // Wait for the drag overlay's drop animation to finish before the next drag.
    await expect(page.getByRole('article')).toHaveCount(1);
  }

  await drag(newColumn, holdColumn);
  await expect(holdColumn.getByText('Ship it')).toBeVisible();

  await drag(holdColumn, page.getByRole('region', { name: 'Send to gallery' }));
  await expect(holdColumn.getByText('Ship it')).toBeHidden();
  await page.getByRole('radio', { name: 'Grid view' }).click();
  const gallery = page.getByRole('region', { name: 'Gallery' });
  await expect(gallery.getByText('Ship it')).toBeVisible();
});
