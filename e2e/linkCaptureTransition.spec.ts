import { expect, test } from '@playwright/test';
import { card, settledBox, signUp } from './helpers';

test('the new-note window grows into link capture and preserves its draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signUp(page);
  await page.route('**/api/link-previews/intake', (route) =>
    route.fulfill({
      json: {
        title: 'Captured page',
        description: 'Page details',
        siteName: 'Example',
        imageHash: null,
        imageWidth: null,
        imageHeight: null,
        iconHash: null,
        hue: null,
      },
    }),
  );
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(280);
  });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('Saved before changing modes');
  await popup.getByRole('button', { name: 'Save to Gallery', exact: true }).click();
  await popup.getByRole('button', { name: 'Colors', exact: true }).click();
  await popup.getByRole('button', { name: 'Red', exact: true }).click();
  await popup.getByRole('button', { name: 'Formatting', exact: true }).click();
  await settledBox(popup);
  const movement = await page.evaluate(async () => {
    const popup = document.querySelector('[aria-label="New note"]');
    if (!popup) throw new Error('Missing new-note window');
    const source = popup.getBoundingClientRect().toJSON();
    const button = [...popup.querySelectorAll('button')].find(
      (button) => button.getAttribute('aria-label') === 'Save link',
    );
    if (!button) throw new Error('Missing Save link action');
    button.click();
    const samples: { x: number; y: number; width: number; height: number }[] = [];
    for (let frame = 0; frame < 45; frame++) {
      await new Promise(requestAnimationFrame);
      const capture = document.querySelector('[data-link-overlay]');
      if (capture) {
        const { x, y, width, height } = capture.getBoundingClientRect();
        samples.push({ x, y, width, height });
      }
    }
    return { source, samples };
  });
  const first = movement.samples[0];
  const form = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  const target = await settledBox(form);
  expect(first).toBeDefined();
  expect(Math.abs(first!.x - movement.source.x)).toBeLessThan(12);
  expect(Math.abs(first!.y - movement.source.y)).toBeLessThan(24);
  expect(Math.abs(first!.height - movement.source.height)).toBeLessThan(40);
  await expect(form.getByLabel('Title', { exact: true })).toHaveCount(0);
  await expect(form.getByLabel('Your notes')).toHaveCount(0);
  await expect(
    form.getByText('Fetch the page details, add your thoughts, and save to Gallery.'),
  ).toHaveCount(0);
  expect(Math.abs(target.x - movement.source.x)).toBeLessThan(1);
  expect(Math.abs(target.width - movement.source.width)).toBeLessThan(1);
  expect(Math.abs(target.y + target.height - movement.source.bottom)).toBeLessThan(1);
  const dock = await page.locator('[data-dock]').boundingBox();
  expect(target.y + target.height).toBeLessThan(dock!.y);
  await expect(form.locator('[data-capture-actions]')).toHaveCount(0);
  // Restoring CSS sizing is essential: the keyboard can change after the morph ends.
  await expect.poll(() => form.evaluate((form) => form.style.height)).toBe('');
  await expect(form.getByLabel('URL', { exact: true })).toBeFocused();
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(340);
  });
  await expect
    .poll(() => form.evaluate((form) => form.getBoundingClientRect().bottom))
    .toBeLessThanOrEqual(844 - 340);
  await form.getByLabel('URL', { exact: true }).fill('https://example.com/');
  await form.getByRole('button', { name: 'Fetch details' }).click();
  await expect(form.getByLabel('Title', { exact: true })).toHaveValue('Captured page');
  await settledBox(form);
  const reverse = await page.evaluate(async () => {
    const capture = document.querySelector('[data-link-overlay]');
    const popup = document.querySelector('[aria-label="New note"][data-note-color]');
    if (!capture || !popup) throw new Error('Missing handoff surfaces');
    const from = capture.getBoundingClientRect().toJSON();
    const target = popup.getBoundingClientRect().toJSON();
    capture.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    const samples: { x: number; y: number; height: number }[] = [];
    for (let frame = 0; frame < 45; frame++) {
      await new Promise(requestAnimationFrame);
      if (popup) {
        const { x, y, height } = popup.getBoundingClientRect();
        samples.push({ x, y, height });
      }
    }
    return { from, target, samples };
  });
  await expect(form).toBeHidden();
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('textbox')).toBeFocused();
  await expect(popup.getByRole('textbox')).toContainText('Saved before changing modes');
  await expect(popup.getByRole('button', { name: 'Save to Deck', exact: true })).toBeVisible();
  await expect(popup).toHaveAttribute('data-note-color', 'red');
  await page.keyboard.press('Control+z');
  await expect(popup.getByRole('textbox')).toHaveText('');
  await page.keyboard.press('Control+Shift+z');
  await expect(popup.getByRole('textbox')).toContainText('Saved before changing modes');
  await popup.getByRole('button', { name: 'Save to Deck', exact: true }).click();
  expect(
    reverse.samples.some(
      (sample) =>
        sample.height < reverse.from.height - 20 && sample.height > reverse.target.height + 20,
    ),
  ).toBe(true);
  const last = reverse.samples.at(-1)!;
  expect(Math.abs(last.height - reverse.target.height)).toBeLessThan(5);
  expect(Math.abs(last.y - reverse.target.y)).toBeLessThan(5);
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' and kept editing');
  // Repeated round trips must keep updating the original draft, not create copies.
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(popup.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(card(page, 'Saved before changing modes and kept editing')).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('reduced motion opens link capture directly without a size transition', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signUp(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await settledBox(popup);
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await expect(form).toBeVisible();
  expect(
    await form.evaluate((form) => ({ height: form.style.height, top: form.style.top })),
  ).toEqual({ height: '', top: '' });
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(form).toBeHidden();
  await expect(popup.getByRole('textbox')).toBeFocused();
  await expect(page.getByRole('article')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByText('Catch your first note', { exact: true })).toBeVisible();
});

test('queued shares wait while closing capture restores the original editor', async ({ page }) => {
  await signUp(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ status: 404 }));
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await settledBox(popup);
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  await page.evaluate(async () => {
    const { captureWebShare } = await import('/src/lib/shareInbox.ts');
    const { prepareShare } = await import('/src/lib/receiveShare.ts');
    const { enqueueLinkCapture } = await import('/src/lib/linkCapture.ts');
    const form = new FormData();
    form.set('url', 'https://example.com/queued');
    const id = await captureWebShare(form);
    const prepared = await prepareShare(id);
    if (prepared.kind !== 'link') throw new Error('Expected a queued link');
    enqueueLinkCapture({ id, draft: prepared.draft });
  });
  const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(capture).toBeHidden();
  await expect(popup.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await expect(capture.getByLabel('URL', { exact: true })).toHaveValue(
    'https://example.com/queued',
  );
  await capture.getByLabel('URL', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(capture).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(0);
});

test('cancelling during the handoff restores the popup and leaves no stale origin on direct capture', async ({
  page,
}) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await settledBox(popup);
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  const form = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await form.getByLabel('URL', { exact: true }).fill('https://example.com/cancelled');
  await page.keyboard.press('Escape');
  // Enter during the reverse animation must not submit a link that was cancelled.
  await page.keyboard.press('Enter');
  await expect(form).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(0);
  await expect(popup.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await page.evaluate(async () => {
    const { linkCaptureOpen } = await import('/src/lib/linkCapture.ts');
    linkCaptureOpen.set(true);
  });
  await expect(form).toBeVisible();
  expect(await form.evaluate((form) => form.style.height)).toBe('');
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(page.getByText('Catch your first note', { exact: true })).toBeVisible();
});

test('the dock morphs from close to save, and pasting a link fetches without leaving the popup', async ({
  page,
  context,
}) => {
  await signUp(page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let fetches = 0;
  await page.route('**/api/link-previews/intake', (route) => {
    fetches++;
    return route.fulfill({
      json: {
        title: 'Pasted reading',
        description: 'Fetched from the pasted URL.',
        siteName: 'Example',
        imageHash: null,
        imageWidth: null,
        imageHeight: null,
        iconHash: null,
        hue: null,
      },
    });
  });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  const editor = popup.getByRole('textbox');
  await expect(editor).toBeFocused();
  await expect(page.getByRole('button', { name: 'Close new note', exact: true })).toBeVisible();
  await page.keyboard.type('A note worth keeping');
  const saveNote = page.getByRole('button', { name: 'Save note', exact: true });
  await expect(saveNote.locator('.lucide-square-pen')).toBeVisible();
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await expect(page.getByRole('button', { name: 'Close new note', exact: true })).toBeVisible();
  await page.keyboard.type('A note worth keeping');
  await saveNote.click();
  await expect(popup).toBeHidden();
  await expect(card(page, 'A note worth keeping')).toBeVisible();

  await page.getByRole('button', { name: 'New note', exact: true }).click();
  await expect(editor).toBeFocused();
  const link = popup.getByRole('button', { name: 'Save link', exact: true });
  await expect(link).toHaveText('');
  const attachment = popup.getByRole('button', { name: 'Attach files', exact: true });
  await attachment.scrollIntoViewIfNeeded();
  const attachmentBox = await attachment.boundingBox();
  await link.scrollIntoViewIfNeeded();
  const linkBox = await link.boundingBox();
  expect(linkBox!.x).toBeGreaterThan(attachmentBox!.x);
  await link.click();
  const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  const url = capture.getByLabel('URL', { exact: true });
  await expect(url).toBeFocused();
  await url.fill('javascript:alert(1)');
  await expect(page.getByRole('button', { name: 'Close link capture', exact: true })).toBeVisible();
  await url.selectText();
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/pasted'));
  await page.keyboard.press('Control+v');
  await expect(url).toHaveValue('https://example.com/pasted');
  await expect(capture.getByLabel('Title', { exact: true })).toHaveValue('Pasted reading');
  await expect(capture.getByLabel('Description')).toHaveValue('Fetched from the pasted URL.');
  expect(fetches).toBe(1);
  const saveLink = page.getByRole('button', { name: 'Save link', exact: true });
  await expect(saveLink.locator('.lucide-square-pen')).toBeVisible();
  await expect
    .poll(() =>
      saveLink.evaluate((button) => {
        const gradient = [...button.querySelectorAll('span')].find((span) =>
          getComputedStyle(span).backgroundImage.includes('gradient'),
        );
        return gradient ? Number(getComputedStyle(gradient).opacity) : 0;
      }),
    )
    .toBe(1);
  await saveLink.click();
  await expect(capture).toBeHidden();
  await expect(popup).toBeHidden();
  const captured = page
    .locator('[data-note-card]')
    .filter({ has: page.locator('[data-gallery-preview="https://example.com/pasted"]') });
  await expect(captured).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(2);
  await captured.getByRole('button', { name: 'Open note', exact: true }).click();
  const note = page.getByRole('dialog', { name: 'Edit note', exact: true });
  await expect(note.getByRole('textbox')).toContainText('Pasted reading');
  await expect(note.getByRole('textbox')).toContainText('Fetched from the pasted URL.');
});

for (const reducedMotion of [false, true]) {
  test(`returning from link capture transfers focus before removing the link field (${reducedMotion ? 'reduced' : 'full'} motion)`, async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
    await signUp(page);
    await page.evaluate(async () => {
      const { keyboardHeight } = await import('/src/lib/keyboard.ts');
      keyboardHeight.jump(280);
    });
    await page.getByRole('button', { name: 'New note', exact: true }).click();
    const popup = page.getByRole('region', { name: 'New note', exact: true });
    await expect(popup.getByRole('textbox')).toBeFocused();
    await page.keyboard.type('Continue this draft');
    await settledBox(popup);
    await popup.getByRole('button', { name: 'Save link', exact: true }).click();
    const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
    await expect(capture.getByLabel('URL', { exact: true })).toBeFocused();
    await settledBox(capture);
    const focus = await page.evaluate(async () => {
      const capture = document.querySelector('[data-link-overlay]');
      const input = capture?.querySelector('input');
      const editor = document.querySelector<HTMLElement>(
        '[aria-label="New note"] [contenteditable="true"]',
      );
      const close = document.querySelector<HTMLButtonElement>(
        '[data-dock] button[aria-label="Close link capture"]',
      );
      if (!capture || !input || !editor || !close) throw new Error('Missing handoff controls');
      let focusedBeforeRemoval = false;
      let focusedAtRemoval = false;
      let nonEditableFrames = 0;
      let focusReturns = 0;
      let loaderFrames = 0;
      let blankSettledFrames = 0;
      let readyDuringMorph = false;
      const popup = editor.closest<HTMLElement>('[aria-label="New note"]')!;
      const targetHeight = popup.getBoundingClientRect().height;
      const content = popup.querySelector<HTMLElement>('[data-quick-note-body]')!;
      const onFocus = (event: FocusEvent) => {
        if (event.target === editor) {
          focusReturns++;
          focusedBeforeRemoval = input.isConnected;
        }
      };
      document.addEventListener('focusin', onFocus);
      const observer = new MutationObserver(() => {
        if (!input.isConnected) {
          focusedAtRemoval = document.activeElement === editor;
          observer.disconnect();
        }
      });
      observer.observe(document.body, { subtree: true, childList: true });
      close.click();
      for (let frame = 0; frame < 60; frame++) {
        await new Promise(requestAnimationFrame);
        const active = document.activeElement;
        if (document.querySelector('[data-dock] .lucide-loader-circle')) loaderFrames++;
        const height = popup.getBoundingClientRect().height;
        const visible = Number(getComputedStyle(content).opacity) > 0.95;
        if (Math.abs(height - targetHeight) < 5 && !visible) blankSettledFrames++;
        if (visible && popup.style.height) readyDuringMorph = true;
        if (
          !(active instanceof HTMLElement) ||
          (!active.matches('input, textarea') && !active.isContentEditable)
        )
          nonEditableFrames++;
      }
      document.removeEventListener('focusin', onFocus);
      observer.disconnect();
      return {
        focusedBeforeRemoval,
        focusedAtRemoval,
        nonEditableFrames,
        focusReturns,
        loaderFrames,
        blankSettledFrames,
        readyDuringMorph,
      };
    });
    expect(focus).toEqual({
      focusedBeforeRemoval: true,
      focusedAtRemoval: true,
      nonEditableFrames: 0,
      focusReturns: 1,
      loaderFrames: 0,
      blankSettledFrames: 0,
      readyDuringMorph: !reducedMotion,
    });
    await expect(capture).toBeHidden();
    await expect(popup.getByRole('textbox')).toBeFocused();
    await page.keyboard.type(' after capture');
    await expect(popup.getByRole('textbox')).toContainText('Continue this draft after capture');
  });
}

test('link capture stays compact during fetching and grows to reveal the details', async ({
  page,
}) => {
  await signUp(page);
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/link-previews/intake', async (route) => {
    await pending;
    await route.fulfill({
      json: {
        title: 'Ready to edit',
        description: 'Fetched context',
        siteName: 'Example',
        imageHash: null,
        imageWidth: null,
        imageHeight: null,
        iconHash: null,
        hue: null,
      },
    });
  });
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await settledBox(popup);
  await popup.getByRole('button', { name: 'Save link', exact: true }).click();
  const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  const compact = await settledBox(capture);
  await expect(capture.getByRole('textbox')).toHaveCount(1);
  await expect(capture.getByRole('region', { name: 'Link placement' })).toBeHidden();
  await capture.getByLabel('URL', { exact: true }).fill('https://example.com/article');
  await expect(capture.getByRole('textbox')).toHaveCount(1);
  await capture.getByRole('button', { name: 'Fetch details' }).click();
  await expect(capture.getByText('Fetching page details…')).toBeVisible();
  await expect(capture.getByRole('textbox')).toHaveCount(1);
  await expect(capture.getByRole('region', { name: 'Link placement' })).toBeHidden();
  await settledBox(capture);
  await page.evaluate(() => {
    const heights: number[] = [];
    const sample = () => {
      const surface = document.querySelector('[data-link-overlay]');
      if (surface) heights.push(surface.getBoundingClientRect().height);
      if (heights.length < 60) requestAnimationFrame(sample);
    };
    Object.assign(window, { captureHeights: heights });
    requestAnimationFrame(sample);
  });
  finish();
  await expect(capture.getByLabel('Title', { exact: true })).toHaveValue('Ready to edit');
  await expect(capture.getByRole('button', { name: 'Save to Gallery', exact: true })).toBeVisible();
  await expect(
    capture.getByRole('button', { name: 'Background color', exact: true }),
  ).toBeVisible();
  await expect(capture.getByRole('button', { name: 'Choose tags', exact: true })).toBeVisible();
  const full = await settledBox(capture);
  expect(full.height).toBeGreaterThan(compact.height + 200);
  expect(Math.abs(full.width - compact.width)).toBeLessThan(1);
  expect(Math.abs(full.y + full.height - compact.y - compact.height)).toBeLessThan(1);
  const heights = await page.evaluate(() => Reflect.get(window, 'captureHeights') as number[]);
  expect(heights.some((height) => height > compact.height + 60 && height < full.height - 40)).toBe(
    true,
  );
  await page.keyboard.press('Escape');
  await expect(popup.getByRole('textbox')).toBeFocused();
});
