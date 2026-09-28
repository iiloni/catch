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

test('opening a quick note folds the gallery switcher away', async ({ page }) => {
  await signUp(page);
  const switcher = page.getByRole('navigation', { name: 'Gallery pages' });
  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(switcher).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('region', { name: 'New note' })).toBeVisible();
  await expect(switcher).toBeHidden();
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(switcher).toBeHidden();
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

test('deck drag reorders within a column and places notes in another', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Board drag uses a mouse; touch dragging is covered manually.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) {
    await createNote(page, title);
    await noteAction(page, title, 'Add to deck');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  }
  await page.getByRole('link', { name: 'Deck' }).click();
  await waitForPageTransition(page);
  const newColumn = page.getByRole('region', { name: 'New column' });
  const progressColumn = page.getByRole('region', { name: 'In progress column' });
  const order = async (column: typeof newColumn) =>
    column.getByRole('article').getByRole('heading').allTextContents();
  await expect.poll(() => order(newColumn)).toEqual(['Three', 'Two', 'One']);

  async function dragAbove(title: string, destination: typeof newColumn, above?: string) {
    const source = await newColumn.getByRole('article').filter({ hasText: title }).boundingBox();
    if (!source) throw new Error('Missing source card');
    await page.mouse.move(source.x + source.width / 2, source.y + 20);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + 40, { steps: 5 });
    await expect.poll(() => page.getByRole('article').filter({ hasText: title }).count()).toBe(2);
    const overlay = await page.getByRole('article').filter({ hasText: title }).last().boundingBox();
    if (!overlay) throw new Error('Missing dragged card');
    expect(Math.abs(overlay.width - source.width)).toBeLessThan(1);
    expect(Math.abs(overlay.height - source.height)).toBeLessThan(1);
    const held = page.getByRole('article').filter({ hasText: title }).last();
    const actionsOpacity = () =>
      held
        .getByRole('button', { name: 'Send to gallery' })
        .evaluate((button) => getComputedStyle(button.parentElement as HTMLElement).opacity);
    await expect.poll(actionsOpacity).toBe('1');
    expect(
      await held
        .getByRole('button', { name: 'Pin' })
        .evaluate((button) => getComputedStyle(button).opacity),
    ).toBe('1');
    const box = above
      ? await destination.getByRole('article').filter({ hasText: above }).boundingBox()
      : await destination.boundingBox();
    if (!box) throw new Error('Missing destination');
    await page.mouse.move(box.x + box.width / 2, box.y + (above ? 8 : 80), { steps: 15 });
    const heldShadow = await held.evaluate((article) => getComputedStyle(article).boxShadow);
    await expect
      .poll(() =>
        newColumn
          .locator('[data-board-card] article')
          .filter({ hasText: title })
          .evaluate((article) => getComputedStyle(article).boxShadow),
      )
      .toBe(heldShadow);
    await page.mouse.up();
    const placed = page.locator('[data-board-card] article').filter({ hasText: title });
    await expect
      .poll(() =>
        placed
          .getByRole('button', { name: 'Send to gallery' })
          .evaluate((button) => getComputedStyle(button.parentElement as HTMLElement).opacity),
      )
      .toBe('1');
    await expect
      .poll(() => placed.evaluate((article) => getComputedStyle(article).boxShadow))
      .toBe(heldShadow);
    await expect(page.getByRole('region', { name: 'Send to gallery' })).toBeHidden();
  }

  await dragAbove('One', newColumn, 'Three');
  await expect.poll(() => order(newColumn)).toEqual(['One', 'Three', 'Two']);
  await dragAbove('Two', progressColumn);
  await expect.poll(() => order(progressColumn)).toEqual(['Two']);
  await dragAbove('One', progressColumn, 'Two');
  await expect.poll(() => order(progressColumn)).toEqual(['One', 'Two']);
  await page.reload();
  await expect.poll(() => order(newColumn)).toEqual(['Three']);
  await expect.poll(() => order(progressColumn)).toEqual(['One', 'Two']);
});

test('a long press reorders deck notes on touch', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Long press is a touch gesture.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) {
    await createNote(page, title);
    await noteAction(page, title, 'Add to deck');
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
  }
  await page.getByRole('link', { name: 'Deck' }).click();
  await waitForPageTransition(page);
  const column = page.getByRole('region', { name: 'New column' });
  const order = () => column.getByRole('article').getByRole('heading').allTextContents();
  await expect.poll(order).toEqual(['Three', 'Two', 'One']);
  const source = await column.getByRole('article').filter({ hasText: 'One' }).boundingBox();
  const destination = await column.getByRole('article').filter({ hasText: 'Three' }).boundingBox();
  if (!source || !destination) throw new Error('Missing cards');
  const from = { x: source.x + source.width / 2, y: source.y + 20 };
  const to = { x: destination.x + destination.width / 2, y: destination.y + 8 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await page.waitForTimeout(400);
  for (let step = 1; step <= 10; step++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: from.x + ((to.x - from.x) * step) / 10, y: from.y + ((to.y - from.y) * step) / 10 },
      ],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(order).toEqual(['One', 'Three', 'Two']);
  await page.reload();
  await expect.poll(order).toEqual(['One', 'Three', 'Two']);
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

/** A card's grid cell, which also holds the check that selects it. */
function cell(page: Page, title: string) {
  return page
    .locator('[data-note-cell]')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

/** Selects a note with the check that appears when hovering its card. */
async function hoverSelect(page: Page, title: string) {
  await cell(page, title).hover();
  await cell(page, title).getByRole('button', { name: 'Select note' }).click();
}

test('a long press starts selecting notes, and taps add more', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Long press is a touch gesture.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) await createNote(page, title);

  const point = await centerOf(page, 'One');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  const toolbar = page.getByRole('toolbar', { name: 'Selected notes' });
  await expect(toolbar).toBeVisible();
  await expect(page.getByLabel('1 selected')).toBeVisible();
  // Letting go does not open the note.
  await expect(page.getByRole('dialog')).toBeHidden();

  const two = card(page, 'Two').getByRole('button', { name: 'Select note' });
  await two.tap();
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('2 selected')).toBeVisible();

  await toolbar.getByRole('button', { name: 'Make a copy' }).tap();
  await expect(toolbar).toBeHidden();
  await expect(page.getByRole('button', { name: 'Settings' })).toBeVisible();
  await expect(card(page, 'One')).toHaveCount(2);
  await expect(card(page, 'Two')).toHaveCount(2);
  await expect(card(page, 'Three')).toHaveCount(1);
});

test('selected notes are recolored, archived and trashed together', async ({ page, isMobile }) => {
  test.skip(isMobile, 'The check that starts selecting appears on hover.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) await createNote(page, title);

  await hoverSelect(page, 'One');
  const toolbar = page.getByRole('toolbar', { name: 'Selected notes' });
  await expect(toolbar).toBeVisible();
  await card(page, 'Two').getByRole('button', { name: 'Select note' }).click();
  await expect(page.getByLabel('2 selected')).toBeVisible();

  await toolbar.getByRole('button', { name: 'Background color' }).click();
  await page.getByRole('button', { name: 'Red' }).click();
  await expect(card(page, 'One')).toHaveAttribute('data-note-color', 'red');
  await expect(card(page, 'Two')).toHaveAttribute('data-note-color', 'red');
  await expect(card(page, 'Three')).toHaveAttribute('data-note-color', 'default');
  // Escape closes the palette first, and only then ends selecting.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Red' })).toBeHidden();
  await expect(page.getByLabel('2 selected')).toBeVisible();

  await toolbar.getByRole('button', { name: 'Archive' }).click();
  await expect(card(page, 'One')).toBeHidden();
  await expect(card(page, 'Two')).toBeHidden();
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'One')).toBeVisible();
  await expect(card(page, 'Two')).toBeVisible();

  await hoverSelect(page, 'Three');
  await expect(page.getByLabel('1 selected')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(toolbar).toBeHidden();

  await hoverSelect(page, 'Three');
  await toolbar.getByRole('button', { name: 'Move to trash' }).click();
  await expect(card(page, 'Three')).toBeHidden();
  await openGalleryPage(page, 'Trash');
  await expect(card(page, 'Three')).toBeVisible();
});

test('archived and trashed notes are selected, unarchived, restored and deleted', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The check that starts selecting appears on hover.');
  await signUp(page);
  for (const title of ['One', 'Two', 'Three']) await createNote(page, title);
  const toolbar = page.getByRole('toolbar', { name: 'Selected notes' });
  for (const title of ['One', 'Two']) await hoverSelect(page, title);
  await toolbar.getByRole('button', { name: 'Archive' }).click();
  await hoverSelect(page, 'Three');
  await toolbar.getByRole('button', { name: 'Move to trash' }).click();

  await openGalleryPage(page, 'Archive');
  await hoverSelect(page, 'One');
  // Selecting swaps the back button for the count, and grows a toolbar at the top right.
  await expect(page.getByRole('button', { name: 'Back to Gallery' })).toBeHidden();
  await toolbar.getByRole('button', { name: 'Unarchive' }).click();
  await expect(card(page, 'One')).toBeHidden();
  await expect(toolbar).toBeHidden();
  await hoverSelect(page, 'Two');
  await toolbar.getByRole('button', { name: 'Move to trash' }).click();
  await expect(card(page, 'Two')).toBeHidden();

  await backToGallery(page);
  await expect(card(page, 'One')).toBeVisible();
  await openGalleryPage(page, 'Trash');
  await hoverSelect(page, 'Two');
  await expect(page.getByRole('button', { name: 'Empty trash' })).toBeHidden();
  await toolbar.getByRole('button', { name: 'Restore' }).click();
  await expect(card(page, 'Two')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Empty trash' })).toBeVisible();

  await hoverSelect(page, 'Three');
  await toolbar.getByRole('button', { name: 'Delete forever' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete forever' }).click();
  await expect(card(page, 'Three')).toBeHidden();
  await expect(page.getByText('No notes in the trash.')).toBeVisible();

  // Restoring put the archived note back in the archive.
  await backToGallery(page);
  await openGalleryPage(page, 'Archive');
  await expect(card(page, 'Two')).toBeVisible();
});
