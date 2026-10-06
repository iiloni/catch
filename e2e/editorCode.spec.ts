import { expect, type Page, test } from '@playwright/test';
import { openNote, signUp } from './helpers';

async function codeNote(page: Page, language: string, color = 'default') {
  await signUp(page);
  await page.evaluate(
    async ({ language, color }) => {
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
            content: '# Greets someone\ndef greet(name):\n    return f"Hello, {name}" * 2',
          },
          { id: 'after', type: 'paragraph', content: 'After the code' },
        ],
      });
      await transaction.isPersisted.promise;
    },
    { language, color },
  );
  return openNote(page, 'Snippet');
}

test('a code block highlights its language and can be set to another', async ({ page }) => {
  const dialog = await codeNote(page, 'python');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  const language = block.getByRole('combobox', { name: 'Code language' });
  await expect(language).toHaveValue('python');
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

  await language.selectOption({ label: 'Plain text' });
  await expect(block.locator('.shiki')).toHaveCount(0);
  await expect(block).toContainText('def greet(name):');

  await language.selectOption({ label: 'JavaScript' });
  await expect(block.locator('.shiki', { hasText: 'return' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const reopened = await openNote(page, 'Snippet');
  await expect(reopened.getByRole('combobox', { name: 'Code language' })).toHaveValue('javascript');
});

test('typing a fence with an alias starts a block in that language', async ({ page }) => {
  const dialog = await codeNote(page, 'text');
  await dialog.getByText('After the code').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('```ts ');
  await page.keyboard.type('const answer: number = 42;');
  const block = dialog.locator('[data-content-type="codeBlock"]').last();
  await expect(block.getByRole('combobox', { name: 'Code language' })).toHaveValue('typescript');
  await expect(block.locator('.shiki', { hasText: 'const' })).toBeVisible();
});

test('a language outside the list keeps its name and leaves the editor working', async ({
  page,
}) => {
  const dialog = await codeNote(page, 'brainfuck');
  const block = dialog.locator('[data-content-type="codeBlock"]');
  const language = block.getByRole('combobox', { name: 'Code language' });
  await expect(language).toHaveValue('brainfuck');
  await expect(block).toContainText('def greet(name):');
  await language.selectOption({ label: 'Python' });
  await expect(block.locator('.shiki', { hasText: 'def' })).toBeVisible();
});
