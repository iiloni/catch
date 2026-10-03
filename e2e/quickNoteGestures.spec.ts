import { type CDPSession, expect, test } from '@playwright/test';
import { card, settledBox, signUp } from './helpers';

async function swipe(touch: CDPSession, x: number, y: number, delta: number) {
  // Preserve the intended finger timing even when browser-command delivery is slow.
  let timestamp = Date.now() / 1000;
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y, id: 1 }],
    timestamp,
  });
  // Include the small initial movements that a finger makes before a swipe commits.
  const distances = [2, 4, 7, 10, 14, 20, 30, 45, 60, 80, 100, 120]
    .filter((distance) => distance < Math.abs(delta))
    .concat(Math.abs(delta));
  for (const distance of distances) {
    timestamp += 0.016;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: y + Math.sign(delta) * distance, id: 1 }],
      timestamp,
    });
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
  // Rest before release so Chrome does not consume the next tap after a fling.
  await new Promise((resolve) => setTimeout(resolve, 100));
  await touch.send('Input.dispatchTouchEvent', {
    type: 'touchEnd',
    touchPoints: [],
    timestamp: timestamp + 0.1,
  });
}

test('quick-note swipes save from text, blank space, and a formatting button', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks touch gesture ownership.');
  await signUp(page);
  // Match the popup's position while an Android keyboard is visible.
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(280);
  });
  const touch = await page.context().newCDPSession(page);
  for (const part of ['text', 'blank', 'tool']) {
    await page.getByRole('button', { name: 'New note' }).click();
    const popup = page.getByRole('region', { name: 'New note' });
    const editor = popup.locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();
    const title = `Saved from ${part}`;
    await page.keyboard.type(title);
    const target =
      part === 'tool'
        ? popup.getByRole('button', { name: 'Bold', exact: true })
        : editor.locator('[data-content-type]').first();
    const box = await settledBox(target);
    const x = part === 'blank' ? box.x + box.width - 8 : box.x + 20;
    await swipe(touch, x, box.y + box.height / 2, 140);
    await expect(popup).toBeHidden();
    await expect(card(page, title)).toBeVisible();
    await expect(card(page, title).locator('strong')).toHaveCount(0);
  }
});

test('quick-note swipes expand from the editor and keep a short pull focused', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks touch gesture ownership.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const popup = page.getByRole('region', { name: 'New note' });
  const editor = popup.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Expand from the body');
  const touch = await page.context().newCDPSession(page);
  let box = await settledBox(editor.locator('[data-content-type]').first());
  await swipe(touch, box.x + box.width - 8, box.y + box.height / 2, -40);
  await expect(popup).toBeVisible();
  await expect(editor).toBeFocused();
  await page.keyboard.type('!');
  box = await settledBox(editor.locator('[data-content-type]').first());
  await swipe(touch, box.x + box.width - 8, box.y + box.height / 2, -160);
  await expect(popup).toBeHidden();
  await expect(page.getByRole('dialog')).toContainText('Expand from the body!');
});

test('quick-note scrolling and text selection keep their gestures', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Checks touch gesture ownership.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const popup = page.getByRole('region', { name: 'New note' });
  const editor = popup.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Long draft');
  await page.keyboard.press('Enter');
  await page.keyboard.insertText('A line of draft content '.repeat(100));
  const scroll = popup.locator('[data-quick-note-scroll]');
  const box = await settledBox(scroll);
  expect(
    await scroll.evaluate((element) => element.scrollHeight - element.clientHeight),
  ).toBeGreaterThan(400);
  await scroll.evaluate((element) => {
    element.scrollTop = 200;
  });
  const touch = await page.context().newCDPSession(page);
  await swipe(touch, box.x + box.width / 2, box.y + box.height / 2, -140);
  await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(200);
  await expect(popup).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await scroll.evaluate((element) => {
    element.scrollTop = 0;
  });
  await editor.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element.querySelector('[data-content-type]') ?? element);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  });
  const titleBox = await settledBox(editor.locator('[data-content-type]').first());
  await swipe(touch, titleBox.x + titleBox.width - 8, titleBox.y + titleBox.height / 2, 140);
  await expect(popup).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('quick-note tools still scroll horizontally and respond to taps', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks touch gesture ownership.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const popup = page.getByRole('region', { name: 'New note' });
  const editor = popup.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Scrollable tools');
  const toolbar = popup.getByRole('toolbar', { name: 'Formatting' });
  const box = await settledBox(toolbar);
  const touch = await page.context().newCDPSession(page);
  const x = box.x + box.width - 40;
  const y = box.y + box.height / 2;
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (const delta of [30, 60, 100, 140]) {
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: x - delta, y }],
    });
  }
  await page.waitForTimeout(100);
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => toolbar.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await expect(popup).toBeVisible();
  await expect(editor).toBeFocused();
  const checklist = toolbar.getByRole('button', { name: 'Checklist' });
  await checklist.scrollIntoViewIfNeeded();
  await checklist.tap();
  await expect(checklist).toHaveAttribute('aria-pressed', 'true');
  await expect(editor).toBeFocused();
});

test('quick-note mouse dragging stays on the handle', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Checks the mouse handle.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const popup = page.getByRole('region', { name: 'New note' });
  const editor = popup.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Mouse handle');
  const box = await settledBox(page.getByTestId('quick-note-handle'));
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 160, { steps: 5 });
  await page.mouse.up();
  await expect(popup).toBeHidden();
  await expect(page.getByRole('dialog')).toContainText('Mouse handle');
});

test('gradual quick-note pulls expand from an empty or populated editing surface', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks gradual touch movement.');
  await signUp(page);
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(280);
  });
  const touch = await page.context().newCDPSession(page);
  for (const filled of [false, true]) {
    await page.getByRole('button', { name: 'New note' }).click();
    const popup = page.getByRole('region', { name: 'New note' });
    const editor = popup.locator('[contenteditable="true"]');
    await expect(editor).toBeFocused();
    if (filled) await page.keyboard.type('Gradual pull');
    const box = await settledBox(editor.locator('[data-content-type]').first());
    const x = box.x + box.width - 8;
    const y = box.y + box.height / 2;
    await swipe(touch, x, y, -120);
    await expect(popup).toBeHidden();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    if (filled) await expect(dialog).toContainText('Gradual pull');
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  }
});

test('quick-note swipes survive the touched editor element being replaced', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks native touch targeting across an editor remount.');
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  const popup = page.getByRole('region', { name: 'New note' });
  const editor = popup.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await page.keyboard.type('Survives a remount');
  const heading = editor.locator('[data-content-type]').first();
  const box = await settledBox(heading);
  await heading.evaluate((element) => {
    element.addEventListener(
      'touchstart',
      (event) => {
        const target = event.target;
        if (!(target instanceof Element)) throw new Error('Missing touch target');
        requestAnimationFrame(() => target.replaceWith(target.cloneNode(true)));
      },
      { once: true, passive: true },
    );
  });
  const touch = await page.context().newCDPSession(page);
  await swipe(touch, box.x + box.width - 8, box.y + box.height / 2, -140);
  await expect(popup).toBeHidden();
  await expect(page.getByRole('dialog')).toContainText('Survives a remount');
});
