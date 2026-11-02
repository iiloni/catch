import { expect, type Locator, test } from '@playwright/test';
import { card, caretToEnd, openNote, signUp } from './helpers';

/** How far the painted text sits from each side of the line it is set in. */
async function textInsets(line: Locator) {
  return line.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return { left: text.left - box.left, right: box.right - text.right };
  });
}

async function expectStartsRight(line: Locator) {
  await expect.poll(async () => (await textInsets(line)).right).toBeLessThan(4);
  expect((await textInsets(line)).left, `${line}`).toBeGreaterThan(20);
}

async function expectStartsLeft(line: Locator) {
  await expect.poll(async () => (await textInsets(line)).left).toBeLessThan(4);
  expect((await textInsets(line)).right, `${line}`).toBeGreaterThan(20);
}

test('Hebrew and Arabic lines read from the right beside English ones', async ({ page }) => {
  await signUp(page);
  await page.evaluate(async () => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { transaction } = createNote({
      userId: getSignedInUser().id,
      content: [
        { type: 'heading', props: { level: 3 }, content: 'רשימת קניות' },
        { type: 'paragraph', content: 'חלב' },
        { type: 'checkListItem', content: 'خبز' },
        { type: 'paragraph', content: 'Oat milk' },
      ],
    });
    await transaction.isPersisted.promise;
  });

  const preview = card(page, 'רשימת קניות');
  await expectStartsRight(preview.getByText('חלב'));
  // A checklist row turns around as a whole, its box on the right.
  await expectStartsRight(preview.locator('[data-content-type="checkListItem"]'));
  await expectStartsLeft(preview.getByText('Oat milk'));

  const dialog = await openNote(page, 'רשימת קניות');
  // A heading's text is only as wide as its words, so measure against the whole block.
  const line = (text: string) =>
    dialog
      .locator('.bn-block-content')
      .filter({ has: page.locator('.bn-inline-content', { hasText: new RegExp(`^${text}$`) }) });
  await expectStartsRight(line('רשימת קניות'));
  await expectStartsRight(line('חלב'));
  await expectStartsLeft(line('Oat milk'));

  // A checklist row turns around with its text: the box stands on the right.
  const row = dialog.locator('[data-content-type="checkListItem"]');
  const checkbox = await row.getByRole('checkbox').boundingBox();
  const text = await row.locator('.bn-inline-content').boundingBox();
  if (!checkbox || !text) throw new Error('Missing checklist layout');
  expect(checkbox.x).toBeGreaterThan(text.x);

  // A line typed in the editor follows what is typed into it.
  await caretToEnd(line('Oat milk').locator('.bn-inline-content'));
  await page.keyboard.press('Enter');
  await page.keyboard.type('שלום');
  await expectStartsRight(line('שלום'));
});
