import { expect, test } from '@playwright/test';
import { card, createNote, noteAction, noteToolbar, openNote, signUp } from './helpers';

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

  // The note is a card that ends above its toolbar rather than running under it.
  const noteCard = await dialog.locator('[data-note-scroll]').boundingBox();
  const toolbar = await noteToolbar(page).boundingBox();
  expect(noteCard && toolbar && noteCard.y + noteCard.height <= toolbar.y).toBe(true);

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

test('a quick note and its dock center over the split view with one formatting bar', async ({
  page,
}) => {
  await signUp(page);
  await createNote(page, 'Alpha', 'First');
  await openNote(page, 'Alpha');
  const dock = page.locator('[data-dock] > div');
  const initialDock = await dock.boundingBox();
  if (!initialDock) throw new Error('Missing page dock');
  const initialDockCenter = initialDock.x + initialDock.width / 2;

  // Chromium emulation has no on-screen keyboard; report its height as Android does.
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);

  const dockMotion = page.evaluate(
    () =>
      new Promise<{ center: number; searchOffset: number }[]>((resolve) => {
        const dock = document.querySelector('[data-dock] > div');
        const search = document.querySelector('[data-dock] a[aria-label="Search"]');
        const icon = search?.querySelector('svg');
        if (!dock || !search || !icon) return resolve([]);
        const samples: { center: number; searchOffset: number }[] = [];
        const end = performance.now() + 650;
        const record = () => {
          const dockBox = dock.getBoundingClientRect();
          const searchBox = search.getBoundingClientRect();
          const iconBox = icon.getBoundingClientRect();
          samples.push({
            center: dockBox.x + dockBox.width / 2,
            searchOffset: iconBox.x + iconBox.width / 2 - (searchBox.x + searchBox.width / 2),
          });
          if (performance.now() < end) requestAnimationFrame(record);
          else resolve(samples);
        };
        requestAnimationFrame(record);
      }),
  );
  await page.getByRole('button', { name: 'New note' }).click();
  const samples = await dockMotion;
  expect(samples.some(({ center }) => center > initialDockCenter + 20 && center < 570)).toBe(true);
  expect(Math.max(...samples.map(({ center }) => center))).toBeLessThan(593);
  expect(Math.max(...samples.map(({ searchOffset }) => Math.abs(searchOffset)))).toBeLessThan(5);
  const quickNote = page.getByRole('region', { name: 'New note' });
  await expect(quickNote.locator('[contenteditable]')).toBeFocused();
  await expect
    .poll(async () => {
      const box = await quickNote.boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - 1180 / 2) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  await expect
    .poll(async () => {
      const box = await dock.boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - 1180 / 2) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  expect(
    await quickNote.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(true);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);
  await expect(noteToolbar(page)).toBeHidden();

  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(quickNote).toBeHidden();
  await expect
    .poll(async () => {
      const box = await dock.boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - initialDockCenter) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);
});

test('on the deck a note pops up over the board instead', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Ship it');
  await noteAction(page, 'Ship it', 'Add to deck');

  // The page beside the pane stays usable, and leaving for the deck closes the note.
  await page.getByRole('link', { name: 'Deck' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const dialog = await openNote(page, 'Ship it');
  await expect(page.getByRole('separator', { name: 'Resize note' })).toBeHidden();
  const box = await dialog.boundingBox();
  expect(box && Math.abs(box.x + box.width / 2 - 1180 / 2)).toBeLessThan(2);
  // The page's dock turns into the note's toolbar, as on a phone.
  await expect(noteToolbar(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deck' })).toBeHidden();
  // The panel ends above the toolbar rather than running under it.
  const toolbar = await noteToolbar(page).boundingBox();
  expect(box && toolbar && box.y + box.height <= toolbar.y).toBe(true);
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
