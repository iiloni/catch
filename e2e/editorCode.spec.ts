import { expect, type Locator, type Page, test } from '@playwright/test';
import { openNote, signUp } from './helpers';

/** Picks a code block's language from its searchable list, as someone typing would. */
async function chooseLanguage(page: Page, language: Locator, search: string, name: string) {
  await language.click();
  const list = page.getByRole('dialog', { name: 'Code language' });
  await list.getByRole('combobox', { name: 'Search languages' }).fill(search);
  await list.getByRole('option', { name, exact: true }).click();
  await expect(list).toBeHidden();
}

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
  await language.click();
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
  await language.click();
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
  await language.click();
  // Its own name stays a choice, so the list shows the block as what it is.
  await expect(
    page.getByRole('dialog', { name: 'Code language' }).getByRole('option', { name: 'brainfuck' }),
  ).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Escape');
  await chooseLanguage(page, language, 'py', 'Python');
  await expect(block.locator('.shiki', { hasText: 'def' })).toBeVisible();
});
