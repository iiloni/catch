import { expect, type Page, test } from '@playwright/test';
import { openNote, signUp } from './helpers';

async function setKeyboardHeight(page: Page, height: number, animated = false) {
  // Replay the inset reported by Android without resizing the browser viewport.
  await page.evaluate(
    async ({ height, animated }) => {
      const { keyboardHeight } = await import('/src/lib/keyboard.ts');
      if (!animated) return keyboardHeight.jump(height);
      const from = keyboardHeight.get();
      for (let step = 1; step <= 10; step++) {
        await new Promise(requestAnimationFrame);
        keyboardHeight.set(from + ((height - from) * step) / 10);
      }
    },
    { height, animated },
  );
}

async function caretBounds(page: Page) {
  return page.evaluate(() => {
    const selection = window.getSelection();
    if (!selection?.focusNode) throw new Error('Missing caret');
    const range = document.createRange();
    range.setStart(selection.focusNode, selection.focusOffset);
    range.collapse(true);
    const node = selection.focusNode;
    const element = node instanceof Element ? node : node.parentElement;
    const rect = range.getClientRects()[0] ?? element?.getBoundingClientRect();
    if (!rect) throw new Error('Missing caret bounds');
    const area = document.querySelector('[data-note-scroll]');
    if (!area) throw new Error('Missing note scroll area');
    const bounds = area.getBoundingClientRect();
    const toolbarTops = Array.from(document.querySelectorAll('[data-note-toolbar]'))
      .map((toolbar) => toolbar.getBoundingClientRect())
      .filter((rect) => rect.height > 0 && rect.right > bounds.left && rect.left < bounds.right)
      .map((rect) => rect.top);
    return {
      top: rect.top,
      bottom: rect.bottom,
      visibleTop: bounds.top,
      visibleBottom: Math.min(bounds.bottom, window.innerHeight, ...toolbarTops),
      scrollTop: area.scrollTop,
    };
  });
}

async function expectCaretVisible(page: Page) {
  await expect
    .poll(async () => {
      const caret = await caretBounds(page);
      return caret.bottom <= caret.visibleBottom - 4 && caret.top >= caret.visibleTop;
    })
    .toBe(true);
}

// The app only hears of a keyboard from a touch device, whatever the width of its screen.
test.skip(({ isMobile }) => !isMobile, 'An overlay keyboard needs a touch device.');

for (const [layout, viewport] of [
  ['phone', { width: 412, height: 839 }],
  ['panel', { width: 900, height: 450 }],
  ['narrow pane', { width: 720, height: 820 }],
  ['pane', { width: 1100, height: 900 }],
] as const) {
  test(`${layout}: the caret clears an overlay keyboard on every opening`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await signUp(page);
    await page.evaluate(async () => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const { transaction } = createNote({
        userId: getSignedInUser().id,
        content: [
          { type: 'heading', props: { level: 3 }, content: 'Keyboard scrolling' },
          ...Array.from({ length: 30 }, (_, index) => ({
            type: 'checkListItem',
            content: `Checklist item ${index}`,
          })),
          { id: 'wrapped', type: 'paragraph', content: 'A long wrapped paragraph. '.repeat(100) },
        ],
      });
      await transaction.isPersisted.promise;
    });
    const dialog = await openNote(page, 'Keyboard scrolling');
    const editor = dialog.getByRole('textbox');
    const area = dialog.locator('[data-note-scroll]');
    await editor.locator('[data-id="wrapped"] p').click();
    await page.keyboard.press('Control+End');
    await expect(editor).toBeFocused();
    await area.evaluate((area) => {
      const selection = window.getSelection();
      if (!selection?.focusNode) throw new Error('Missing caret');
      const range = document.createRange();
      range.setStart(selection.focusNode, selection.focusOffset);
      range.collapse(true);
      // Start lower in the note, with the last line visible before the keyboard opens.
      area.scrollTop +=
        range.getBoundingClientRect().bottom - area.getBoundingClientRect().bottom + 100;
    });
    const before = await caretBounds(page);
    expect(before.bottom).toBeGreaterThan(viewport.height - 240);

    const height = layout === 'panel' ? 170 : 300;
    await setKeyboardHeight(page, height, true);
    await expectCaretVisible(page);
    expect((await caretBounds(page)).scrollTop).toBeGreaterThan(before.scrollTop);
    // Only the caret's line must fit: the paragraph itself is taller than the visible area.
    expect(
      await editor.locator('[data-id="wrapped"] p').evaluate((p) => p.getBoundingClientRect().top),
    ).toBeLessThan((await caretBounds(page)).visibleTop);

    await setKeyboardHeight(page, height + 40);
    await expectCaretVisible(page);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('toolbar', { name: 'Undo and redo' })).toBeVisible();
    await expectCaretVisible(page);
    await page.keyboard.type('Typing on a new line');
    await expectCaretVisible(page);

    // Selecting text beneath the floating toolbar must bring its line back above it.
    await area.evaluate((area) => {
      area.scrollTop -= 80;
    });
    await page.keyboard.press('Shift+ArrowLeft');
    await expectCaretVisible(page);

    const scrollWithKeyboard = (await caretBounds(page)).scrollTop;
    await setKeyboardHeight(page, 0);
    // Removing the keyboard padding may clamp the scroll position to the new maximum.
    await expect
      .poll(() =>
        area.evaluate(
          (area, previous) =>
            area.scrollTop === Math.min(previous, area.scrollHeight - area.clientHeight),
          scrollWithKeyboard,
        ),
      )
      .toBe(true);
    // Moving back down while the keyboard is hidden should still work on the next opening.
    await area.evaluate((area) => {
      area.scrollTop -= 120;
    });
    await setKeyboardHeight(page, height);
    await expectCaretVisible(page);
    await expect(editor).toBeFocused();

    await setKeyboardHeight(page, 0);
    await editor.locator('h3').click();
    await page.keyboard.press('Control+Home');
    const scrollAtTitle = (await caretBounds(page)).scrollTop;
    await setKeyboardHeight(page, height, true);
    await expectCaretVisible(page);
    expect((await caretBounds(page)).scrollTop).toBe(scrollAtTitle);
  });
}
