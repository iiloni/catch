import { expect, type Page, test } from '@playwright/test';
import {
  backToGallery,
  card,
  createNote,
  noteAction,
  noteToolbar,
  openGalleryPage,
  openNote,
  signUp,
  waitForPageTransition,
} from './helpers';

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

test('an empty quick note creates nothing', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('region', { name: 'New note' })).toBeVisible();
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(page.getByRole('region', { name: 'New note' })).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('a quick note can go straight to the deck', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('textbox').and(page.locator('[contenteditable]'))).toBeFocused();
  await page.keyboard.type('Refactor sync');
  await page.getByRole('button', { name: 'Save to Gallery' }).click();
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(card(page, 'Refactor sync')).toBeHidden();
  await page.getByRole('link', { name: 'Deck' }).click();
  await expect(card(page, 'Refactor sync')).toBeVisible();
});

test('the quick note formats text without leaving the editor', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox').and(page.locator('[contenteditable]'));
  await expect(editor).toBeFocused();
  await page.keyboard.type('Plan');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Checklist' }).click();
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(editor).toBeFocused();
  await page.keyboard.type('Book flights');
  await expect(editor.locator('[data-content-type="checkListItem"] strong')).toHaveText(
    'Book flights',
  );
  await expect(page.getByRole('button', { name: 'Checklist' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('holding a formatting button on Android shows its label', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Requires a touch pointer.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const bold = page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', {
    name: 'Bold',
  });
  await expect(bold).toBeEnabled();
  const box = await bold.boundingBox();
  if (!box) throw new Error('Missing formatting button layout');
  const touch = await page.context().newCDPSession(page);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ ...point, id: 1 }],
  });
  await expect(page.getByRole('tooltip')).toHaveText('Bold');
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(page.getByRole('tooltip')).toBeHidden();
  await expect(bold).toHaveAttribute('aria-pressed', 'false');
});

test('the editor dock keeps held labels above its edge', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Checks the touch toolbar layout.');
  await signUp(page);
  await createNote(page, 'Groceries', 'Oat milk');
  await openNote(page, 'Groceries');
  // Chromium emulation has no on-screen keyboard; report its height as Android does.
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  const dock = page.locator('[data-dock] .glass').first();
  const bold = page.getByRole('toolbar', { name: 'Formatting' }).getByRole('button', {
    name: 'Bold',
  });
  await expect(bold).toBeVisible();
  const dockBox = await dock.boundingBox();
  const boldBox = await bold.boundingBox();
  if (!dockBox || !boldBox) throw new Error('Missing dock layout');
  const checklistBox = await page
    .getByRole('toolbar', { name: 'Formatting' })
    .getByRole('button', { name: 'Checklist' })
    .boundingBox();
  if (!checklistBox) throw new Error('Missing checklist layout');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing viewport');
  expect(dockBox.x).toBeLessThan(6);
  expect(viewport.width - dockBox.x - dockBox.width).toBeLessThan(6);
  expect(boldBox.x + boldBox.width / 2 - dockBox.x).toBeGreaterThan(24);
  expect(dockBox.x + dockBox.width - checklistBox.x - checklistBox.width / 2).toBeGreaterThan(24);

  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: boldBox.x + boldBox.width / 2, y: boldBox.y + boldBox.height / 2, id: 1 }],
  });
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText('Bold');
  const tipBox = await tooltip.boundingBox();
  if (!tipBox) throw new Error('Missing tooltip layout');
  expect(tipBox.y + tipBox.height).toBeLessThanOrEqual(dockBox.y);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
});

test('tapping blank space below a short note focuses its last block', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks the touch editing surface.');
  await signUp(page);
  await createNote(page, 'Groceries', 'Oat milk');
  const dialog = await openNote(page, 'Groceries');
  const lastBlock = dialog.locator('[data-content-type="paragraph"]').last();
  const box = await lastBlock.boundingBox();
  if (!box) throw new Error('Missing last block layout');
  await page.touchscreen.tap(box.x + 40, box.y + box.height + 100);
  await expect(dialog.locator('[contenteditable]')).toBeFocused();
  await page.keyboard.type('!');
  await expect(lastBlock).toContainText('Oat milk!');
});

test('search finds notes by any word, including archived ones', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Groceries', 'Oat milk');
  await createNote(page, 'Old receipts', 'Milk crate');
  await noteAction(page, 'Old receipts', 'Archive');

  await page.getByRole('link', { name: 'Search' }).click();
  // Focused within the tap, so a phone raises its keyboard straight away.
  await expect(page.getByRole('textbox', { name: 'Search notes' })).toBeFocused();
  await page.getByRole('textbox', { name: 'Search notes' }).click();
  await expect(page).toHaveURL(/\/search$/);
  await page.getByRole('textbox', { name: 'Search notes' }).fill('milk');
  const results = page.getByRole('region', { name: 'Results' });
  await expect(results.getByRole('article')).toHaveCount(2);
  await expect(results.getByText('Archived')).toBeVisible();

  await page.getByRole('textbox', { name: 'Search notes' }).fill('oat milk');
  await expect(results.getByRole('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close search' }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
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
  await openGalleryPage(page, 'Trash');
  await noteAction(page, 'Dentist', 'Restore');
  await expect(card(page, 'Dentist')).toBeHidden();
  await backToGallery(page);
  await expect(card(page, 'Dentist')).toBeVisible();

  await noteAction(page, 'Dentist', 'Move to trash');
  await openGalleryPage(page, 'Trash');
  await page.getByRole('button', { name: 'Empty trash' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Empty trash' }).click();
  await expect(page.getByText('No notes in the trash.')).toBeVisible();
});

test('archive and unarchive', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Old receipts');

  await noteAction(page, 'Old receipts', 'Archive');
  await expect(card(page, 'Old receipts')).toBeHidden();
  await openGalleryPage(page, 'Archive');
  const dialog = await noteAction(page, 'Old receipts', 'Unarchive');
  await dialog.getByRole('button', { name: 'Close' }).click();
  await backToGallery(page);
  await expect(card(page, 'Old receipts')).toBeVisible();
});

test('a sideways touch archives a gallery card', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Gallery swipe is a touch gesture.');
  await signUp(page);
  await createNote(page, 'Swipe me');

  const bounds = await card(page, 'Swipe me').boundingBox();
  if (!bounds) throw new Error('Missing gallery card');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const surface = page.locator('[data-swipe-archive]').filter({ has: card(page, 'Swipe me') });
  const cue = surface.locator('[data-swipe-archive-cue]');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y }],
  });
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 40, y }],
  });
  await expect(cue).toHaveCSS('opacity', '0');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 200, y }],
  });
  await expect(cue).toHaveCSS('opacity', '1');
  await expect
    .poll(async () => (await card(page, 'Swipe me').boundingBox())?.x ?? 0)
    .toBeGreaterThan(bounds.x + 75);
  const dragged = await card(page, 'Swipe me').boundingBox();
  if (!dragged) throw new Error('Missing dragged card');
  expect(dragged.x - bounds.x).toBeLessThanOrEqual(100);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 40, y }],
  });
  await expect(cue).toHaveCSS('opacity', '0');
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: x + 200, y }],
  });
  await expect(cue).toHaveCSS('opacity', '1');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(card(page, 'Swipe me')).toBeHidden();
  await openGalleryPage(page, 'Archive');
  await expect(card(page, 'Swipe me')).toBeVisible();
});

test('swiping the open note down or up closes it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The editor swipe is a touch gesture.');
  await signUp(page);
  await createNote(page, 'Swipe to close');
  const cdp = await page.context().newCDPSession(page);

  for (const direction of [1, -1]) {
    const dialog = await openNote(page, 'Swipe to close');
    const scroll = dialog.locator('[data-note-scroll]');
    await scroll.evaluate((element, toward) => {
      element.scrollTop = toward > 0 ? 0 : element.scrollHeight;
    }, direction);
    const bounds = await scroll.boundingBox();
    if (!bounds) throw new Error('Missing note scroll area');
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y }],
    });
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + direction * 300 }],
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(dialog).toBeHidden();
  }
});

test('color and pin', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'First');
  await createNote(page, 'Second');

  const dialog = await openNote(page, 'First');
  // The palette grows out of the dock rather than opening a popup.
  await noteToolbar(page).getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Teal' }).click();
  await noteToolbar(page).getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(noteToolbar(page).getByRole('button', { name: 'Unpin' })).toBeVisible();
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

  await page.getByRole('link', { name: 'Deck' }).click();
  const newColumn = page.getByRole('region', { name: 'New column' });
  const holdColumn = page.getByRole('region', { name: 'On hold column' });
  await expect(newColumn.getByText('Ship it')).toBeVisible();
  await waitForPageTransition(page);

  async function drag(from: typeof newColumn, to: typeof newColumn) {
    const source = await from.getByRole('article').first().boundingBox();
    if (!source) throw new Error('Missing layout');
    await page.mouse.move(source.x + source.width / 2, source.y + 20);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + 40, { steps: 5 });
    // The "Send to gallery" target only appears once a drag starts.
    await expect(to).toBeVisible();
    const target = await to.boundingBox();
    if (!target) throw new Error('Missing layout');
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, {
      steps: 15,
    });
    await page.mouse.up();
    // The gallery target leaves when the drag ends; wait for that before the next drag.
    await expect(page.getByRole('region', { name: 'Send to gallery' })).toBeHidden();
  }

  await drag(newColumn, holdColumn);
  await expect(holdColumn.getByText('Ship it')).toBeVisible();

  await drag(holdColumn, page.getByRole('region', { name: 'Send to gallery' }));
  await expect(page.getByText('No notes in the deck')).toBeVisible();
  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(card(page, 'Ship it')).toBeVisible();
});

/** Gallery card titles in reading order: top to bottom, then left to right. */
async function galleryOrder(page: Page) {
  const cards = await page.getByRole('article').all();
  const placed = await Promise.all(
    cards.map(async (element) => ({
      title: (await element.getByRole('heading').first().textContent()) ?? '',
      box: await element.boundingBox(),
    })),
  );
  return placed
    .sort((a, b) => (a.box?.y ?? 0) - (b.box?.y ?? 0) || (a.box?.x ?? 0) - (b.box?.x ?? 0))
    .map((entry) => entry.title);
}

async function centerOf(page: Page, title: string) {
  const box = await card(page, title).boundingBox();
  if (!box) throw new Error(`Missing card ${title}`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('gallery notes are rearranged by dragging', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The touch version is below.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) await createNote(page, title);
  // New notes go first.
  await expect.poll(() => galleryOrder(page)).toEqual(['Three', 'Two', 'One']);

  const from = await centerOf(page, 'One');
  const to = await centerOf(page, 'Three');
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  // The other cards make room while the note is still held.
  await expect.poll(async () => (await centerOf(page, 'Three')).x).toBeGreaterThan(to.x + 50);
  await page.mouse.up();

  await expect.poll(() => galleryOrder(page)).toEqual(['One', 'Three', 'Two']);
  // Letting go does not open the note.
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect.poll(() => galleryOrder(page)).toEqual(['One', 'Three', 'Two']);
});

test('a long press picks up a gallery note to move it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Long press is a touch gesture.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) await createNote(page, title);
  await expect.poll(() => galleryOrder(page)).toEqual(['Three', 'Two', 'One']);

  const from = await centerOf(page, 'One');
  const to = await centerOf(page, 'Three');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await page.waitForTimeout(400);
  for (let step = 1; step <= 10; step++) {
    const point = {
      x: from.x + ((to.x - from.x) * step) / 10,
      y: from.y + ((to.y - from.y) * step) / 10,
    };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [point] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect.poll(() => galleryOrder(page)).toEqual(['One', 'Three', 'Two']);
  await expect(page.getByRole('dialog')).toBeHidden();
  await page.reload();
  await expect.poll(() => galleryOrder(page)).toEqual(['One', 'Three', 'Two']);
});
