import { readFile } from 'node:fs/promises';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { openNote, signUp } from './helpers';

async function revealCodeActions(page: Page, block: Locator) {
  const pill = block.locator('.note-code-toolbar');
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) await pill.hover();
  else if (!(await pill.getAttribute('data-expanded'))) {
    await block
      .getByRole('button', { name: /^Code language/ })
      .locator('.code-language-icon')
      .tap();
  }
  await expect(block.getByRole('button', { name: 'Download snippet' })).toBeVisible();
}

async function openLanguagePicker(page: Page, language: Locator) {
  const block = language.locator('xpath=ancestor::*[@data-content-type="codeBlock"]');
  if (await page.evaluate(() => matchMedia('(hover: hover)').matches)) {
    await revealCodeActions(page, block);
    await language.click();
  } else {
    await language.locator('.code-language-icon').tap();
    if (!(await page.getByRole('dialog', { name: 'Code language' }).isVisible()))
      await language.tap();
  }
}

async function pasteSource(target: Locator, text: string) {
  await target.click();
  await target.evaluate((element, text) => {
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true });
    // Firefox does not expose programmatically populated DataTransfer data here.
    Object.defineProperty(event, 'clipboardData', {
      value: {
        types: ['text/plain'],
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
    element.dispatchEvent(event);
  }, text);
}

/** Picks a code block's language from its searchable list, as someone typing would. */
async function chooseLanguage(page: Page, language: Locator, search: string, name: string) {
  await openLanguagePicker(page, language);
  const list = page.getByRole('dialog', { name: 'Code language' });
  await list.getByRole('combobox', { name: 'Search languages' }).fill(search);
  await list.getByRole('option', { name, exact: true }).click();
  await expect(list).toBeHidden();
}

async function codeNote(
  page: Page,
  language: string,
  color = 'default',
  source = '# Greets someone\ndef greet(name):\n    return f"Hello, {name}" * 2',
  after = 'After the code',
) {
  await signUp(page);
  await page.evaluate(
    async ({ language, color, source, after }) => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const { transaction } = createNote({
        userId: getSignedInUser().id,
        color,
        content: [
          { id: 'title', type: 'heading', props: { level: 3 }, content: 'Snippet' },
          {
            id: 'code',
            type: 'codeBlock',
            props: { language },
            content: source,
          },
          { id: 'after', type: 'paragraph', content: after },
        ],
      });
      await transaction.isPersisted.promise;
    },
    { language, color, source, after },
  );
  return openNote(page, 'Snippet');
}

test('a code block highlights its language and can be set to another', async ({ page }) => {
  const dialog = await codeNote(page, 'python');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  const language = block.getByRole('button', { name: /^Code language/ });
  await expect(language).toHaveText('Python');
  // The picker is not a hover-only control.
  await expect(language).toHaveCSS('opacity', '1');

  const keyword = block.locator('.shiki', { hasText: 'def' });
  await expect(keyword).toBeVisible();
  const colors = () =>
    block.evaluate((element) => ({
      keyword: getComputedStyle(element.querySelector('.shiki') as Element).color,
      text: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
    }));
  const python = await colors();
  // Tokens take the app's syntax colors, on a tint of the note instead of BlockNote's black.
  expect(new Set(Object.values(python)).size).toBe(3);
  expect(python.background).not.toBe('rgb(22, 22, 22)');

  await chooseLanguage(page, language, 'plain', 'Plain text');
  await expect(language).toHaveText('Plain text');
  await expect(block.locator('.shiki')).toHaveCount(0);
  await expect(block).toContainText('def greet(name):');
  // Choosing from the list is not leaving the note, and the code takes the typing again.
  await expect(dialog).toBeVisible();
  await page.keyboard.type('!');
  await expect(block).toContainText('{name}" * 2!');

  // An alias finds its language, and Enter takes the best match.
  await openLanguagePicker(page, language);
  const list = page.getByRole('dialog', { name: 'Code language' });
  await expect(list.getByRole('option', { name: 'Plain text' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await list.getByRole('combobox', { name: 'Search languages' }).fill('js');
  await expect(list.getByRole('option').first()).toHaveText('JavaScript');
  await page.keyboard.press('Enter');
  await expect(list).toBeHidden();
  await expect(language).toHaveText('JavaScript');
  await expect(block.locator('.shiki', { hasText: 'return' })).toBeVisible();

  // Escape puts the list away and leaves the note open and the language alone.
  await openLanguagePicker(page, language);
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(dialog).toBeVisible();
  await expect(language).toHaveText('JavaScript');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]note=/);
  await expect(dialog).toBeHidden();
  await page.reload();
  const reopened = await openNote(page, 'Snippet');
  await expect(reopened.getByRole('button', { name: /^Code language/ })).toHaveText('JavaScript');
});

test('typing a fence with an alias starts a block in that language', async ({ page }) => {
  const dialog = await codeNote(page, 'text');
  await dialog.getByText('After the code').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const answer: number = 42;');
  const block = dialog.locator('[data-content-type="codeBlock"]').last();
  await expect(block.getByRole('button', { name: /^Code language/ })).toHaveText('TypeScript');
  await expect(block.locator('.shiki', { hasText: 'const' })).toBeVisible();
});

test('a language outside the list keeps its name and leaves the editor working', async ({
  page,
}) => {
  const dialog = await codeNote(page, 'brainfuck');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  const language = block.getByRole('button', { name: /^Code language/ });
  await expect(language).toHaveText('brainfuck');
  await expect(block).toContainText('def greet(name):');
  await openLanguagePicker(page, language);
  // Its own name stays a choice, so the list shows the block as what it is.
  await expect(
    page.getByRole('dialog', { name: 'Code language' }).getByRole('option', { name: 'brainfuck' }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await chooseLanguage(page, language, 'py', 'Python');
  await expect(block.locator('.shiki', { hasText: 'def' })).toBeVisible();
});

test('snippet actions copy and download the latest source without markup', async ({
  page,
  browserName,
  context,
}) => {
  const source = '  print("héllo 🦊")\n\n';
  const dialog = await codeNote(page, 'py', 'default', source);
  const block = dialog.locator('[data-content-type="codeBlock"]');
  // The clipboard itself is available to headless Chromium. Firefox has no equivalent
  // permission grant, so exercise its action with a clipboard implementation instead.
  if (browserName === 'chromium') {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  } else {
    await page.evaluate(() =>
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            (window as unknown as { copiedSnippet: string }).copiedSnippet = text;
          },
        },
      }),
    );
  }
  await revealCodeActions(page, block);
  await block.getByRole('button', { name: 'Copy snippet', exact: true }).click();
  await expect(page.getByText('Snippet copied', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(async () =>
      'copiedSnippet' in window
        ? (window as unknown as { copiedSnippet: string }).copiedSnippet
        : navigator.clipboard.readText(),
    ),
  ).toBe(source);

  // Edit after the toolbar was mounted, then export that exact new source.
  await block.locator('pre > code').click();
  await page.keyboard.type('# latest');
  await expect(block.locator('pre > code')).toContainText('# latest');
  const latest = await block.locator('pre > code').textContent();
  await revealCodeActions(page, block);
  const downloaded = page.waitForEvent('download');
  await block.getByRole('button', { name: 'Download snippet' }).click();
  const file = await downloaded;
  expect(file.suggestedFilename()).toBe('snippet.py');
  expect(await readFile((await file.path())!, 'utf8')).toBe(latest);
});

test('a code pill expands from its icon and keeps keyboard and touch actions available', async ({
  page,
}) => {
  const dialog = await codeNote(page, 'python');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  const pill = block.locator('.note-code-toolbar');
  const language = block.getByRole('button', { name: 'Code language: Python' });
  await page.mouse.move(0, 0);
  await expect(pill).not.toHaveAttribute('data-expanded');
  await expect(block.getByRole('button', { name: 'Copy snippet' })).toBeHidden();
  const icon = language.locator('.code-language-icon');
  const initial = (await icon.boundingBox())!;
  await revealCodeActions(page, block);
  await expect(pill).toHaveAttribute('data-expanded');
  const expanded = (await icon.boundingBox())!;
  expect(Math.abs(initial.x - expanded.x)).toBeLessThan(2);
  await expect.poll(async () => (await pill.boundingBox())!.width).toBeGreaterThan(120);
  await expect(icon).toHaveCSS('mask-image', /python\.svg/);

  await dialog.getByText('After the code').click();
  await page.mouse.move(0, 0);
  await expect(block.getByRole('button', { name: 'Copy snippet' })).toBeHidden();
  await language.focus();
  await expect(block.getByRole('button', { name: 'Copy snippet' })).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(block.getByRole('button', { name: 'Copy snippet' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await expect(block.getByRole('button', { name: 'Copy snippet' })).toBeHidden();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await language.focus();
  await expect(pill).toHaveCSS('transition-duration', '0s');
});

test('pasting code normalizes its margin and detects an unlabelled language', async ({ page }) => {
  const dialog = await codeNote(page, '', 'default', '');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  await pasteSource(
    block.locator('pre > code'),
    '    def greet(name):\r\n        print("Hello, " + name)\r\n        return True\r\n',
  );
  await expect(block.locator('pre > code')).toHaveJSProperty(
    'textContent',
    'def greet(name):\n    print("Hello, " + name)\n    return True\n',
  );
  await expect(block.getByRole('button', { name: /^Code language/ })).toHaveText('Python');
  await expect(block.locator('.shiki', { hasText: 'def' })).toBeVisible();
});

test('explicit languages and plain text choices survive paste, and detection can be retried', async ({
  page,
}) => {
  const dialog = await codeNote(page, 'javascript', 'default', '');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  const language = block.getByRole('button', { name: /^Code language/ });
  await pasteSource(block.locator('pre > code'), '    def greet(name):\n        return True');
  await expect(language).toHaveText('JavaScript');
  await chooseLanguage(page, language, 'detect', 'Detect language');
  await expect(language).toHaveText('Python');

  await chooseLanguage(page, language, 'plain', 'Plain text');
  await block.locator('pre > code').click();
  // Clear only this block, leaving the note's other blocks alone.
  await block.locator('pre > code').evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press('Backspace');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page).not.toHaveURL(/[?&]note=/);
  await expect(dialog).toBeHidden();
  await page.reload();
  const reopened = await openNote(page, 'Snippet');
  const plain = reopened.locator('[data-content-type="codeBlock"]');
  await pasteSource(plain.locator('pre > code'), 'def greet(name):\n    return True');
  await expect(plain.getByRole('button', { name: /^Code language/ })).toHaveText('Plain text');
});

test('a language choice wins while automatic detection is loading', async ({ page }) => {
  const dialog = await codeNote(page, '', 'default', '');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let started = () => {};
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route('**/src/lib/detectCodeLanguage.ts*', async (route) => {
    started();
    await held;
    await route.continue();
  });
  try {
    await pasteSource(block.locator('pre > code'), 'def greet(name):\n    return True');
    await requested;
    await chooseLanguage(
      page,
      block.getByRole('button', { name: /^Code language/ }),
      'plain',
      'Plain text',
    );
  } finally {
    release();
  }
  await page.evaluate(async () => {
    await import('/src/lib/detectCodeLanguage.ts');
  });
  await expect(block.getByRole('button', { name: /^Code language/ })).toHaveText('Plain text');
});

for (const [fence, language] of [
  ['', 'Python'],
  ['text', 'Plain text'],
]) {
  test(`pasted ${fence || 'unlabelled'} fences normalize code and select ${language}`, async ({
    page,
  }) => {
    const dialog = await codeNote(page, 'text', 'default', 'Existing code', '');
    await pasteSource(
      dialog.locator('[data-content-type="paragraph"]').last(),
      `\`\`\`${fence}\n    def greet(name):\n        return True\n\`\`\``,
    );
    const added = dialog.locator('[data-content-type="codeBlock"]').last();
    await expect(added.getByRole('button', { name: /^Code language/ })).toHaveText(language);
    await expect(added.locator('pre > code')).toHaveJSProperty(
      'textContent',
      'def greet(name):\n    return True',
    );
  });
}
