import { expect, type Page, test } from '@playwright/test';
import { z } from 'zod';
import {
  backToGallery,
  bearerToken,
  card,
  createNote,
  noteAction,
  noteToolbar,
  openDeck,
  openGalleryPage,
  openNote,
  seedNotes,
  settledBox,
  signUp,
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
  await expect(dialog.getByText('Synced', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();

  await expect(card(page, 'Groceries')).toContainText('Oat milk and eggs');
  await page.reload();
  await expect(card(page, 'Groceries')).toContainText('Oat milk and eggs');
});

test('swiping the quick-note handle up expands after the release threshold', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks the touch gesture.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('textbox').and(page.locator('[contenteditable]'))).toBeFocused();
  await page.keyboard.type('Swipe to expand');

  const window = page.getByRole('region', { name: 'New note' });
  const handle = page.getByTestId('quick-note-handle');
  const touch = await page.context().newCDPSession(page);
  async function pullUp(distance: number, checkCap = false) {
    const box = await handle.boundingBox();
    if (!box) throw new Error('Missing quick-note handle');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x, y, id: 1 }],
    });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y - distance, id: 1 }],
    });
    if (checkCap) {
      await expect
        .poll(async () => {
          const moved = await handle.boundingBox();
          return moved ? box.y - moved.y : 0;
        })
        .toBeGreaterThan(40);
      const moved = await handle.boundingBox();
      if (!moved) throw new Error('Missing dragged quick-note handle');
      expect(box.y - moved.y).toBeLessThanOrEqual(60);
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    return box.y;
  }

  const restingY = await pullUp(50);
  await expect(window).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect
    .poll(async () => {
      const box = await handle.boundingBox();
      return box ? Math.abs(box.y - restingY) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);

  await pullUp(240, true);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Swipe to expand');
  await expect(window).toBeHidden();
});

test('an empty quick note folds the gallery switcher away and creates nothing', async ({
  page,
}) => {
  await signUp(page);
  const switcher = page.getByRole('navigation', { name: 'Gallery pages' });
  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(switcher).toBeVisible();
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('region', { name: 'New note' })).toBeVisible();
  await expect(switcher).toBeHidden();
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(page.getByRole('region', { name: 'New note' })).toBeHidden();
  await expect(switcher).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('a quick note can go straight to the deck', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.getByRole('textbox').and(page.locator('[contenteditable]'))).toBeFocused();
  await page.keyboard.type('Refactor sync');
  await page.getByRole('button', { name: 'Save to Gallery' }).click();
  await page.getByRole('button', { name: 'Save note' }).click();
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
  await seedNotes(page, [{ title: 'Groceries', body: 'Oat milk' }]);
  await openNote(page, 'Groceries');
  // Chromium emulation has no on-screen keyboard; report its height as Android does.
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  const dock = page.locator('[data-dock] .glass').first();
  const bar = page.getByRole('toolbar', { name: 'Formatting' });
  const bold = bar.getByRole('button', { name: 'Bold' });
  await expect(bold).toBeVisible();
  const dockBox = await dock.boundingBox();
  const firstBox = await bar.getByRole('button').first().boundingBox();
  // The row scrolls on a phone, so its last tool is measured at the end of the row.
  await bar.evaluate((row) => row.scrollTo({ left: row.scrollWidth, behavior: 'instant' }));
  const lastBox = await bar.getByRole('button').last().boundingBox();
  await bar.evaluate((row) => row.scrollTo({ left: 0, behavior: 'instant' }));
  const boldBox = await bold.boundingBox();
  if (!dockBox || !firstBox || !lastBox || !boldBox) throw new Error('Missing dock layout');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('Missing viewport');
  expect(dockBox.x).toBeLessThan(6);
  expect(viewport.width - dockBox.x - dockBox.width).toBeLessThan(6);
  expect(firstBox.x + firstBox.width / 2 - dockBox.x).toBeGreaterThan(24);
  expect(dockBox.x + dockBox.width - lastBox.x - lastBox.width / 2).toBeGreaterThan(24);

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
  await seedNotes(page, [{ title: 'Groceries', body: 'Oat milk' }]);
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
  await seedNotes(page, [
    { title: 'Groceries', body: 'Oat milk' },
    { title: 'Old receipts', body: 'Milk crate' },
  ]);
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

test('users only see and change their own notes', { tag: '@api' }, async ({
  playwright,
  baseURL,
  extraHTTPHeaders,
}) => {
  // A context each, so neither account's session cookie rides along with the other's token.
  async function account() {
    const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders });
    const response = await context.post('/api/auth/sign-up/email', {
      headers: { Origin: 'https://localhost' },
      data: {
        email: `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`,
        name: '',
        password: 'password123',
      },
    });
    expect(response.ok()).toBeTruthy();
    const token = bearerToken(response);
    const headers = { Authorization: `Bearer ${token}` };
    /** The ids of the notes this account's shape syncs. */
    async function noteIds() {
      const shape = await context.get('/api/shapes/notes?offset=-1', { headers });
      expect(shape.ok()).toBeTruthy();
      const rows = z.array(z.object({ value: z.object({ id: z.string() }).optional() }));
      return rows.parse(await shape.json()).flatMap((row) => (row.value ? [row.value.id] : []));
    }
    return { context, headers, noteIds };
  }
  const alice = await account();
  const bob = await account();
  const id = crypto.randomUUID().replace(/^(.{14})./, '$17');
  const created = await alice.context.post('/api/notes', {
    headers: alice.headers,
    data: { id, content: [{ type: 'paragraph', content: 'Alice secret' }] },
  });
  expect(created.status()).toBe(201);

  expect(await alice.noteIds()).toEqual([id]);
  expect(await bob.noteIds()).toEqual([]);
  const edit = await bob.context.patch(`/api/notes/${id}`, {
    headers: bob.headers,
    data: { isArchived: true },
  });
  expect(edit.status()).toBe(404);
  // Deleting answers as a replayed write would, and removes nothing.
  const removal = await bob.context.delete(`/api/notes/${id}`, { headers: bob.headers });
  expect(await removal.json()).toEqual({ txid: null });
  expect(await alice.noteIds()).toEqual([id]);
  await alice.context.dispose();
  await bob.context.dispose();
});

test('trash with undo, restore, and delete forever', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Dentist']);

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

test('toasts close from their button, or with a swipe by touch or mouse', async ({
  page,
  isMobile,
}) => {
  await signUp(page);
  await seedNotes(page, ['Dentist', 'Plumber']);
  const toast = page.locator('[data-sonner-toast]');
  // Well inside the four seconds after which a toast closes by itself.
  const dismissed = { timeout: 1000 };

  await noteAction(page, 'Dentist', 'Move to trash');
  await toast.getByRole('button', { name: 'Close toast' }).click();
  await expect(toast).toHaveCount(0, dismissed);

  await noteAction(page, 'Plumber', 'Move to trash');
  const message = toast.getByText('Moved to trash');
  // Toasts slide in; measure where this one settles.
  await message.hover({ trial: true });
  const bounds = await message.boundingBox();
  if (!bounds) throw new Error('Missing toast');
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  if (isMobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const dy of [10, 30, 60]) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x, y: y - dy }],
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 80, y, { steps: 5 });
    await page.mouse.up();
  }
  await expect(toast).toHaveCount(0, dismissed);
});

test('archive from the note header, undo restoring the pin, and unarchive', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Old receipts']);

  // Archive sits in the header, which leaves the dock these four in this order.
  const opened = await openNote(page, 'Old receipts');
  const toolbar = noteToolbar(page);
  await expect(toolbar.getByRole('button')).toHaveCount(4);
  await expect(toolbar.getByRole('button').nth(1)).toHaveAccessibleName('Attach files');
  await expect(toolbar.getByRole('button').last()).toHaveAccessibleName('Pin');
  await toolbar.getByRole('button', { name: 'Pin', exact: true }).click();
  await opened.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(opened).toBeHidden();
  await expect(card(page, 'Old receipts')).toBeHidden();
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Note archived' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Old receipts')).toBeVisible();
  await page.reload();
  const restored = await openNote(page, 'Old receipts');
  await expect(toolbar.getByRole('button', { name: 'Unpin' })).toBeVisible();
  await restored.getByRole('button', { name: 'Close' }).click();

  // Reopened while it is still closing, the editor has to close again.
  const reopened = await noteAction(page, 'Old receipts', 'Archive');
  await expect(reopened).toBeHidden();
  await expect(card(page, 'Old receipts')).toBeHidden();
  await openGalleryPage(page, 'Archive');
  const dialog = await openNote(page, 'Old receipts');
  await dialog.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close' }).click();
  await backToGallery(page);
  await expect(card(page, 'Old receipts')).toBeVisible();
});

test('a sideways touch archives a gallery card', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Gallery swipe is a touch gesture.');
  await signUp(page);
  await seedNotes(page, ['Swipe me']);

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
  const toast = page.locator('[data-sonner-toast]').filter({ hasText: 'Note archived' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Undo' }).click();
  await expect(card(page, 'Swipe me')).toBeVisible();
  await openGalleryPage(page, 'Archive');
  await expect(card(page, 'Swipe me')).toBeHidden();
});

test('swiping the open note down or up closes it', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'The editor swipe is a touch gesture.');
  await signUp(page);
  await seedNotes(page, ['Swipe to close']);
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

test('opening and closing a note leaves the page where it was scrolled', async ({ page }) => {
  // Short enough that a few notes scroll, and narrow enough for the full-screen editor.
  await page.setViewportSize({ width: 400, height: 360 });
  await signUp(page);
  const body = 'Wraps over a few lines of a narrow card to make it tall';
  await seedNotes(
    page,
    ['Last', 'Third', 'Second', 'First'].map((title) => ({ title, body })),
  );
  await expect(card(page, 'First')).toBeVisible();

  // Entry motion changes the card's bounds; establish the scroll baseline after it lands.
  await settledBox(card(page, 'Last'));
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await card(page, 'Last').scrollIntoViewIfNeeded();
  const scrolled = await page.evaluate(() => window.scrollY);
  expect(scrolled).toBeGreaterThan(0);

  const dialog = await openNote(page, 'Last');
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
  await page.goBack();
  await expect(dialog).toBeHidden();
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled);
});

test('color and pin', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['First', 'Second']);

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
  await seedNotes(page, ['Ship it'], 'new');

  await openDeck(page);
  const newColumn = page.getByRole('region', { name: 'New column' });
  const holdColumn = page.getByRole('region', { name: 'On hold column' });
  await expect(newColumn.getByText('Ship it')).toBeVisible();

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
  await expect(newColumn.getByText('Drop notes here')).toBeVisible();
  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(card(page, 'Ship it')).toBeVisible();
});

test('deck drag reorders within a column and places notes in another', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Board drag uses a mouse; touch dragging is covered manually.');
  await signUp(page);
  await seedNotes(page, ['One', 'Two', 'Three'], 'new');
  await openDeck(page);
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
        .getByRole('button', { name: 'Move note' })
        .evaluate(
          (button) => getComputedStyle(button.parentElement?.parentElement as HTMLElement).opacity,
        );
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
          .getByRole('button', { name: 'Move note' })
          .evaluate(
            (button) =>
              getComputedStyle(button.parentElement?.parentElement as HTMLElement).opacity,
          ),
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
  await seedNotes(page, ['One', 'Two', 'Three'], 'new');
  await openDeck(page);
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
  await seedNotes(page, ['One', 'Two', 'Three']);
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
  await seedNotes(page, ['One', 'Two', 'Three']);
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
  await seedNotes(page, ['One', 'Two', 'Three']);

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
  await seedNotes(page, ['One', 'Two', 'Three']);

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
  await seedNotes(page, ['One', 'Two', 'Three']);
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

/** A deck card's draggable cell, which also holds the check that selects it. */
function boardCell(page: Page, title: string) {
  return page
    .locator('[data-board-card]')
    .filter({ has: page.getByRole('heading', { name: title }) });
}

test('selected deck notes move together as a stack, or stay put when cancelled', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'Board drag uses a mouse; the touch version is below.');
  await signUp(page);
  await seedNotes(page, ['One', 'Two', 'Three'], 'new');
  await openDeck(page);
  const newColumn = page.getByRole('region', { name: 'New column' });
  const holdColumn = page.getByRole('region', { name: 'On hold column' });
  const order = (column: typeof newColumn) =>
    column.locator('[data-board-card]:visible article').getByRole('heading').allTextContents();
  await expect.poll(() => order(newColumn)).toEqual(['Three', 'Two', 'One']);

  for (const title of ['Three', 'One']) {
    await boardCell(page, title).hover();
    await boardCell(page, title).getByRole('button', { name: 'Select note' }).click();
  }
  const toolbar = page.getByRole('toolbar', { name: 'Selected notes' });
  await expect(page.getByLabel('2 selected')).toBeVisible();

  async function dragStack(to: () => Promise<{ x: number; y: number }>) {
    const source = await boardCell(page, 'One').boundingBox();
    if (!source) throw new Error('Missing source card');
    await page.mouse.move(source.x + source.width / 2, source.y + 20);
    await page.mouse.down();
    await page.mouse.move(source.x + source.width / 2 + 20, source.y + 40, { steps: 5 });
    await expect(page.getByLabel('2 notes', { exact: true })).toBeVisible();
    // The rest of the selection leaves its column for the stack.
    await expect.poll(() => order(newColumn)).toEqual(['Two']);
    const point = await to();
    await page.mouse.move(point.x, point.y, { steps: 15 });
    await page.mouse.up();
    await expect(page.getByRole('region', { name: 'Cancel move' })).toBeHidden();
  }

  const cancel = page.getByRole('region', { name: 'Cancel move' });
  await dragStack(async () => {
    const box = await cancel.boundingBox();
    if (!box) throw new Error('Missing cancel target');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  });
  await expect.poll(() => order(newColumn)).toEqual(['Three', 'Two', 'One']);
  await expect(page.getByLabel('2 selected')).toBeVisible();

  await dragStack(async () => {
    const box = await holdColumn.boundingBox();
    if (!box) throw new Error('Missing destination');
    return { x: box.x + box.width / 2, y: box.y + 80 };
  });
  await expect.poll(() => order(holdColumn)).toEqual(['Three', 'One']);
  await expect.poll(() => order(newColumn)).toEqual(['Two']);
  // Moving the stack is done with the selection.
  await expect(toolbar).toBeHidden();
  await page.reload();
  await expect.poll(() => order(holdColumn)).toEqual(['Three', 'One']);

  await boardCell(page, 'Three').hover();
  await boardCell(page, 'Three').getByRole('button', { name: 'Select note' }).click();
  await toolbar.getByRole('button', { name: 'Send to gallery' }).click();
  await expect.poll(() => order(holdColumn)).toEqual(['One']);
  await page.getByRole('link', { name: 'Gallery' }).click();
  await expect(card(page, 'Three')).toBeVisible();
});

test('a long press selects deck notes, and taps add more', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Long press is a touch gesture.');
  await signUp(page);
  await seedNotes(page, ['One', 'Two'], 'new');
  await openDeck(page);

  const box = await boardCell(page, 'One').boundingBox();
  if (!box) throw new Error('Missing card');
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x: box.x + box.width / 2, y: box.y + 20 }],
  });
  await page.waitForTimeout(400);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

  await expect(page.getByLabel('1 selected')).toBeVisible();
  await expect(page.getByRole('dialog')).toBeHidden();
  const two = card(page, 'Two').getByRole('button', { name: 'Select note' });
  await two.tap();
  await expect(two).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('2 selected')).toBeVisible();
});
