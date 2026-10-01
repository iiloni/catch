import { expect, type Locator, type Page, test } from '@playwright/test';
import { openNote, signUp } from './helpers';

async function listNote(page: Page, kind = 'checkListItem', count = 3) {
  await signUp(page);
  await page.evaluate(
    async ({ kind, count }) => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const { transaction } = createNote({
        userId: getSignedInUser().id,
        content: [
          { type: 'heading', props: { level: 3 }, content: 'Touch list' },
          ...Array.from({ length: count }, (_, index) => ({
            id: `item-${index}`,
            type: kind,
            props: kind === 'checkListItem' ? { checked: index === 0 } : {},
            content: [{ type: 'text', text: `Item ${index}`, styles: { bold: index === 0 } }],
            children:
              index === 0 ? [{ id: 'child', type: 'bulletListItem', content: 'Child' }] : [],
          })),
        ],
      });
      await transaction.isPersisted.promise;
    },
    { kind, count },
  );
  return openNote(page, 'Touch list');
}

async function center(item: Locator) {
  const box = await item.boundingBox();
  if (!box) throw new Error('Missing list item layout');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test('checkboxes have a 44px target and toggle from its padding', async ({ page, isMobile }) => {
  const dialog = await listNote(page);
  const item = dialog.locator('[data-content-type="checkListItem"]').first();
  const checkbox = item.getByRole('checkbox');
  const target = item.locator('div:has(> input)');
  const box = await target.boundingBox();
  if (!box) throw new Error('Missing checkbox target');
  expect(box.width).toBeGreaterThanOrEqual(44);
  expect(box.height).toBeGreaterThanOrEqual(44);
  await expect(checkbox).toBeChecked();
  const point = { x: box.x + 2, y: box.y + 2 };
  if (isMobile) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await expect(checkbox).not.toBeChecked();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await openNote(page, 'Touch list');
  await expect(page.getByRole('dialog').getByRole('checkbox').first()).toBeChecked();
});

for (const kind of ['checkListItem', 'bulletListItem', 'numberedListItem']) {
  test(`holding a ${kind} reorders it with its children and supports undo`, async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'Requires a real touch gesture.');
    const dialog = await listNote(page, kind);
    const content = dialog.locator(`[data-content-type="${kind}"]`);
    const from = await center(content.filter({ hasText: 'Item 0' }));
    const to = await center(content.filter({ hasText: 'Item 2' }));
    const touch = await page.context().newCDPSession(page);
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
    await expect(dialog.locator('[data-list-dragging]')).toBeVisible();
    await page.screenshot({ path: `test-results/editor-${kind}-held.png` });
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ ...to, y: to.y + 12 }],
    });
    await expect(dialog.locator('[data-list-drop="after"]')).toBeVisible();
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const rows = dialog.locator('.bn-editor > .bn-block-group > .bn-block-outer');
    await expect(rows).toHaveText(['Touch list', 'Item 1', 'Item 2', 'Item 0Child']);
    await expect(rows.last().locator('strong')).toHaveText('Item 0');
    await expect(
      rows.last().locator('[data-id="child"][data-node-type="blockContainer"]'),
    ).toBeVisible();
    if (kind === 'checkListItem') await expect(rows.last().getByRole('checkbox')).toBeChecked();
    await dialog.locator('[contenteditable="true"]').click();
    await page.keyboard.press('Control+z');
    await expect(rows).toHaveText(['Touch list', 'Item 0Child', 'Item 1', 'Item 2']);
    await page.keyboard.press('Control+Shift+z');
    await expect(rows).toHaveText(['Touch list', 'Item 1', 'Item 2', 'Item 0Child']);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.reload();
    await openNote(page, 'Touch list');
    await expect(
      page.getByRole('dialog').locator('.bn-editor > .bn-block-group > .bn-block-outer'),
    ).toHaveText(['Touch list', 'Item 1', 'Item 2', 'Item 0Child']);
  });
}

test('touch scrolling cancels a pending hold and touchcancel discards a drag', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Requires a real touch gesture.');
  const dialog = await listNote(page, 'checkListItem', 30);
  const content = dialog.locator('[data-content-type="checkListItem"]');
  const from = await center(content.nth(5));
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...from, y: from.y - 100 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(dialog.locator('[data-list-holding]')).toHaveCount(0);
  const scrollTop = () => dialog.locator('[data-note-scroll]').evaluate((area) => area.scrollTop);
  await expect.poll(scrollTop).toBeGreaterThan(0);
  // The swipe ends in a fling, which keeps scrolling over a `scrollTop` set while it runs.
  let last = -1;
  await expect
    .poll(async () => {
      const previous = last;
      last = await scrollTop();
      return last === previous;
    })
    .toBe(true);
  await dialog.locator('[data-note-scroll]').evaluate((area) => {
    area.scrollTop = 0;
  });
  const restart = await center(content.nth(1));
  const to = await center(content.nth(3));
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [restart] });
  await expect(dialog.locator('[data-list-dragging]')).toBeVisible();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [to] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(dialog.locator('[data-list-dragging], [data-list-drop]')).toHaveCount(0);
  await expect(content.nth(1)).toHaveText('Item 1');

  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [restart] });
  await expect(dialog.locator('[data-list-dragging]')).toBeVisible();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ x: restart.x, y: (page.viewportSize()?.height ?? 839) - 12 }],
  });
  await expect
    .poll(() => dialog.locator('[data-note-scroll]').evaluate((area) => area.scrollTop))
    .toBeGreaterThan(100);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
  await expect(dialog.locator('[data-list-dragging], [data-list-drop]')).toHaveCount(0);
  await expect(content.nth(1)).toHaveText('Item 1');
});

test('a quick note list also reorders by holding, while a tap still edits text', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Requires a real touch gesture.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const editor = page.getByRole('textbox').and(page.locator('[contenteditable="true"]'));
  await expect(editor).toBeFocused();
  await page.keyboard.type('Quick list');
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: 'Checklist' }).click();
  await page.keyboard.type('First');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Second');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Third');
  const items = editor.locator('[data-content-type="checkListItem"]');
  await items.first().locator('p').tap();
  await expect(editor).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type('!');
  await expect(items.first()).toHaveText('First!');
  const from = await center(items.first());
  const to = await center(items.last());
  const touch = await page.context().newCDPSession(page);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await expect(page.locator('[data-list-dragging]')).toBeVisible();
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchMove',
    touchPoints: [{ ...to, y: to.y + 12 }],
  });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect(items).toHaveText(['Second', 'Third', 'First!']);
});
