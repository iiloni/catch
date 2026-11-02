import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { card, settledBox, signUp } from './helpers';

const picture = {
  name: 'pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
    'base64',
  ),
};

async function openQuickNote(page: Page) {
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  const editor = popup.locator('[contenteditable="true"]');
  await expect(editor).toBeFocused();
  return { popup, editor, toolbar: popup.getByRole('toolbar', { name: 'Formatting' }) };
}

/** How far the row's edges fade, and how far it has scrolled. */
const fades = (toolbar: Locator) =>
  toolbar.evaluate((element) => ({
    before: Number.parseFloat(element.style.getPropertyValue('--fade-before')),
    after: Number.parseFloat(element.style.getPropertyValue('--fade-after')),
    left: element.scrollLeft,
    end: element.scrollWidth - element.clientWidth,
  }));

/** Arrows scroll smoothly, so a position read mid-glide is not where the row will stop. */
async function settledScroll(toolbar: Locator) {
  let left = -1;
  await expect
    .poll(async () => {
      const previous = left;
      await toolbar.page().waitForTimeout(100);
      left = (await fades(toolbar)).left;
      return left === previous;
    })
    .toBe(true);
}

test('the tool row fades only where it has more, and reveals its last tool', async ({ page }) => {
  await signUp(page);
  const { toolbar } = await openQuickNote(page);
  await settledBox(toolbar);
  await expect.poll(async () => (await fades(toolbar)).after).toBeGreaterThan(0);
  expect((await fades(toolbar)).before).toBe(0);

  await toolbar.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
  });
  await expect.poll(async () => (await fades(toolbar)).after).toBeLessThanOrEqual(1);
  expect((await fades(toolbar)).before).toBeGreaterThan(0);
  const [row, last] = await Promise.all([
    toolbar.boundingBox(),
    toolbar.getByRole('button', { name: 'Outdent', exact: true }).boundingBox(),
  ]);
  expect(last!.x + last!.width).toBeLessThanOrEqual(row!.x + row!.width);
});

test('a mouse scrolls the tool row with the wheel and its arrows', async ({ page, isMobile }) => {
  test.skip(isMobile, 'Checks mouse input.');
  await signUp(page);
  const { editor, toolbar, popup } = await openQuickNote(page);
  const box = await settledBox(toolbar);
  const before = popup.locator('[data-scroll-arrow="before"]');
  const after = popup.locator('[data-scroll-arrow="after"]');
  await expect(before).toHaveCSS('opacity', '0');
  await expect(after).toHaveCSS('opacity', '1');

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, 60);
  await expect.poll(async () => (await fades(toolbar)).left).toBeGreaterThan(0);
  await expect(before).toHaveCSS('opacity', '1');

  await page.mouse.wheel(0, -60);
  await expect.poll(async () => (await fades(toolbar)).left).toBe(0);

  for (let press = 0; press < 5; press++) {
    const { left, end } = await fades(toolbar);
    if (end - left <= 1) break;
    await after.click();
    await expect.poll(async () => (await fades(toolbar)).left).toBeGreaterThan(left);
    await settledScroll(toolbar);
  }
  await expect(after).toHaveCSS('opacity', '0');
  await expect(toolbar.getByRole('button', { name: 'Outdent', exact: true })).toBeInViewport({
    ratio: 1,
  });
  await before.click();
  await expect.poll(async () => (await fades(toolbar)).after).toBeGreaterThan(0);
  await expect(editor).toBeFocused();
});

test('the arrows are for a mouse and leave touch screens to the finger', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks touch input.');
  await signUp(page);
  const { popup } = await openQuickNote(page);
  await expect(popup.locator('[data-scroll-arrow="after"]')).toBeHidden();
});

test('a new note takes a child tag from the same chooser as any other note', async ({ page }) => {
  await signUp(page);
  const token = await page.evaluate(() => localStorage.getItem('catch-auth-token'));
  const addTag = async (name: string, parentId: string | null, color: string | null) => {
    const value = randomUUID();
    const id = `${value.slice(0, 14)}7${value.slice(15)}`;
    const response = await page.request.post('/api/tags', {
      headers: { Authorization: `Bearer ${token}` },
      data: { id, name, parentId, color, icon: parentId ? null : 'briefcase' },
    });
    expect(response.status()).toBe(200);
    return id;
  };
  const work = await addTag('Work', null, 'blue');
  await addTag('Release', await addTag('Projects', work, null), null);

  const { popup, editor } = await openQuickNote(page);
  await page.keyboard.type('Filed under a child');
  await popup.getByRole('button', { name: 'Background color', exact: true }).click();
  await page.getByRole('button', { name: 'Blue: Work', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.getByRole('button', { name: 'Release', exact: true }).click();
  await expect(popup).toHaveAttribute('data-note-color', 'blue');
  await expect(popup.getByText('Release', { exact: true })).toBeVisible();
  await expect(editor).toBeFocused();

  // Escape puts the picker away and leaves the note open; the next one saves it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Back to parent tags' })).toBeHidden();
  await expect(popup).toBeVisible();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  const saved = card(page, 'Filed under a child');
  await expect(saved).toHaveAttribute('data-note-color', 'blue');
  await expect(saved.getByText('Release', { exact: true })).toBeVisible();
});

test('a tag made from the quick note is assigned and leaves the note open', async ({ page }) => {
  await signUp(page);
  const { popup } = await openQuickNote(page);
  await popup.getByRole('button', { name: 'Background color', exact: true }).click();
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New tag' });
  const name = form.getByRole('textbox', { name: 'Name' });
  await name.fill('Travel');
  await expect(name).toHaveValue('Travel');
  await form.getByRole('button', { name: 'Green', exact: true }).click();

  // Keys in the form belong to the form, though React bubbles them to the window. The modal
  // form hides the window from roles, so the window is found by its label.
  await name.press('Escape');
  await expect(form).toBeHidden();
  await expect(popup).toBeVisible();

  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  await name.fill('Travel');
  await form.getByRole('button', { name: 'Green', exact: true }).click();
  await form.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(popup).toHaveAttribute('data-note-color', 'green');
  await expect(popup.getByText('Travel', { exact: true })).toBeVisible();
});

test('choosing a color keeps the formatting row, the focus and the words', async ({ page }) => {
  await signUp(page);
  const { popup, editor, toolbar } = await openQuickNote(page);
  await page.keyboard.type('Kept in focus');
  await popup.getByRole('button', { name: 'Background color', exact: true }).click();
  await page.getByRole('button', { name: 'Red', exact: true }).click();
  await expect(popup).toHaveAttribute('data-note-color', 'red');
  await expect(toolbar).toBeVisible();
  await expect(editor).toBeFocused();

  // Typing goes on without a stop to put the picker away.
  await page.keyboard.type(' and typing');
  await expect(page.getByRole('button', { name: 'Red', exact: true })).toBeHidden();
  await expect(editor).toContainText('Kept in focus and typing');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(card(page, 'Kept in focus and typing')).toHaveAttribute('data-note-color', 'red');
});

test('the color picker stays above the keyboard on a small phone', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Checks the on-screen keyboard.');
  await page.setViewportSize({ width: 360, height: 640 });
  await signUp(page);
  const { popup } = await openQuickNote(page);
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(280);
  });
  await page.keyboard.type('One\nTwo\nThree\nFour\nFive\nSix');
  await popup.getByRole('button', { name: 'Background color', exact: true }).click();
  const gray = page.getByRole('button', { name: 'Gray', exact: true });
  await settledBox(gray);
  await expect(gray).toBeVisible();
  const box = await gray.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(640 - 280);
  expect(box!.y).toBeGreaterThanOrEqual(0);
});

test('opening the attachment picker saves nothing until a file is chosen', async ({ page }) => {
  await signUp(page);
  const { popup } = await openQuickNote(page);
  const attach = popup.getByRole('button', { name: 'Attach files', exact: true });
  await attach.click();
  await expect(page.getByRole('region', { name: 'Add attachment' })).toBeVisible();
  await expect(page.locator('[data-note-card]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close new note', exact: true }).click();
  await expect(popup).toBeHidden();
  await expect(page.getByText('Empty note discarded')).toHaveCount(0);

  const { popup: second, editor } = await openQuickNote(page);
  await second.getByRole('button', { name: 'Attach files', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Add attachment' });
  await expect(picker).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    picker.getByRole('button', { name: 'Files', exact: true }).click(),
  ]);
  await chooser.setFiles(picture);
  await expect(picker).toBeHidden();
  await expect(editor.locator('[data-content-type="image"] img')).toBeVisible();
  await page.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(second).toBeHidden();
  await expect(page.locator('[data-note-card]')).toHaveCount(1);
});

/** Presses the attachment button and records the window's height on every frame after. */
async function openPickerWatchingHeight(popup: Locator) {
  const heights = popup.evaluate(async (element) => {
    const seen: number[] = [element.getBoundingClientRect().height];
    const button = element.querySelector<HTMLButtonElement>('[aria-label="Attach files"]');
    button?.click();
    for (let frame = 0; frame < 50; frame++) {
      await new Promise(requestAnimationFrame);
      seen.push(element.getBoundingClientRect().height);
    }
    return seen;
  });
  const seen = await heights;
  const picker = popup.getByRole('region', { name: 'Add attachment' });
  await expect(picker).toBeVisible();
  return { seen, picker };
}

test('the window grows into the attachment picker without first shrinking', async ({ page }) => {
  await signUp(page);
  const { popup } = await openQuickNote(page);
  await settledBox(popup);
  const { seen, picker } = await openPickerWatchingHeight(popup);
  const [start] = seen;
  expect(Math.min(...seen)).toBeGreaterThanOrEqual(start! - 1);
  const pickerHeight = (await picker.boundingBox())!.height;
  expect(seen.at(-1)!).toBeGreaterThanOrEqual(start! + pickerHeight - 2);
});

test('the window still grows for the attachment picker after link capture', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The window sizing is the same on both layouts.');
  await signUp(page);
  const { popup, editor } = await openQuickNote(page);
  const attach = popup.getByRole('button', { name: 'Attach files', exact: true });
  await attach.click();
  const picker = page.getByRole('region', { name: 'Add attachment' });
  await expect(picker).toBeVisible();
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Add Rich Link' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeFocused();
  // The picker stays as it was left.
  await expect(picker).toBeVisible();
  await expect(attach).toHaveAttribute('aria-expanded', 'true');
  await attach.click();
  await expect(picker).toBeHidden();
  await settledBox(popup);

  // The morph back must leave no fixed size behind, here or on the next render.
  const { seen } = await openPickerWatchingHeight(popup);
  const [start] = seen;
  expect(seen.at(-1)!).toBeGreaterThanOrEqual(start! + (await picker.boundingBox())!.height - 2);
  const inline = await popup.evaluate((element) =>
    ['top', 'left', 'width', 'height'].filter((property) =>
      element.style.getPropertyValue(property),
    ),
  );
  expect(inline).toEqual([]);

  await editor.click();
  const grown = (await popup.boundingBox())!.height;
  await page.keyboard.type('One\nTwo\nThree\nFour');
  await attach.click();
  await expect(picker).toBeHidden();
  await expect.poll(async () => (await popup.boundingBox())!.height).toBeLessThan(grown);
});

test('a picker opened while the window morphs back from link capture grows smoothly', async ({
  page,
  isMobile,
}) => {
  test.skip(isMobile, 'The window sizing is the same on both layouts.');
  await signUp(page);
  const { popup } = await openQuickNote(page);
  await settledBox(popup);
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await expect(capture.getByLabel('URL', { exact: true })).toBeFocused();
  await settledBox(capture);
  const heights = await page.evaluate(async () => {
    const window = document.querySelector<HTMLElement>('[aria-label="New note"]');
    const close = document.querySelector<HTMLElement>(
      '[data-dock] button[aria-label="Close link capture"]',
    );
    const attach = window?.querySelector<HTMLElement>('[aria-label="Attach files"]');
    if (!window || !close || !attach) throw new Error('Missing controls');
    close.click();
    for (let frame = 0; frame < 6; frame++) await new Promise(requestAnimationFrame);
    // A tap while the morph still holds the window's size.
    attach.dispatchEvent(
      new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }),
    );
    attach.click();
    const seen: number[] = [];
    for (let frame = 0; frame < 60; frame++) {
      await new Promise(requestAnimationFrame);
      seen.push(window.getBoundingClientRect().height);
    }
    return seen;
  });
  const steps = heights.slice(1).map((height, index) => height - heights[index]!);
  // Held at its old size, the window stood still and then jumped by most of the picker.
  expect(Math.max(...steps.map(Math.abs))).toBeLessThan(30);
  const picker = page.getByRole('region', { name: 'Add attachment' });
  await expect(picker).toBeVisible();
  const [box, pickerBox] = await Promise.all([popup.boundingBox(), picker.boundingBox()]);
  expect(Math.abs(heights.at(-1)! - box!.height)).toBeLessThanOrEqual(1);
  expect(box!.height).toBeGreaterThan(pickerBox!.height + 100);
});

test('every attachment option fits above the keyboard on a small phone', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks the on-screen keyboard.');
  await page.setViewportSize({ width: 360, height: 640 });
  await signUp(page);
  const { popup } = await openQuickNote(page);
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(280);
  });
  await page.keyboard.type('One\nTwo\nThree\nFour\nFive\nSix\nSeven\nEight');
  // A tag's badge takes room from the window too, and gives it up to the picker.
  await popup.getByRole('button', { name: 'Background color', exact: true }).click();
  await page.getByRole('button', { name: 'New tag', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'New tag' });
  await form.getByRole('textbox', { name: 'Name' }).fill('Errands');
  await form.getByRole('button', { name: 'Save tag', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(popup.getByText('Errands', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await popup.getByRole('button', { name: 'Attach files', exact: true }).click();
  const files = popup.getByRole('button', { name: 'Files', exact: true });
  await settledBox(files);
  const [window, option, tools] = await Promise.all([
    popup.boundingBox(),
    files.boundingBox(),
    popup.getByRole('toolbar', { name: 'Formatting' }).boundingBox(),
  ]);
  expect(option!.y + option!.height).toBeLessThanOrEqual(tools!.y);
  expect(option!.y).toBeGreaterThanOrEqual(window!.y);
  expect(tools!.y + tools!.height).toBeLessThanOrEqual(window!.y + window!.height);
});

test('attachments open while a slow editor is still loading', async ({ page }) => {
  let releaseEditor = () => {};
  const editorReady = new Promise<void>((resolve) => {
    releaseEditor = resolve;
  });
  await page.route('**/src/components/NoteEditor/NoteEditor.tsx*', async (route) => {
    await editorReady;
    await route.continue();
  });
  try {
    await signUp(page);
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const popup = page.getByRole('region', { name: 'New note', exact: true });
    await popup.getByRole('button', { name: 'Attach files', exact: true }).click();
    const picker = page.getByRole('region', { name: 'Add attachment' });
    await expect(picker).toBeVisible();
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      picker.getByRole('button', { name: 'Files', exact: true }).click(),
    ]);
    releaseEditor();
    await expect(popup.locator('[contenteditable="true"]')).toBeVisible();
    await chooser.setFiles(picture);
    await expect(popup.locator('[data-content-type="image"] img')).toBeVisible();
  } finally {
    releaseEditor();
  }
});
