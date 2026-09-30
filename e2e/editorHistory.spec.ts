import { expect, test } from '@playwright/test';
import { createNote, openNote, signUp } from './helpers';

test('history buttons follow edits and shortcuts, preserve focus, and reset on reopen', async ({
  page,
}) => {
  await signUp(page);
  await createNote(page, 'History toolbar', 'Original body');
  const dialog = await openNote(page, 'History toolbar');
  const editor = dialog.getByRole('textbox');
  const body = editor.locator('p').last();
  const toolbar = page.getByRole('toolbar', { name: 'Undo and redo' });
  const undo = toolbar.getByRole('button', { name: 'Undo', exact: true });
  const redo = toolbar.getByRole('button', { name: 'Redo', exact: true });

  await expect(toolbar).toBeHidden();
  await body.click();
  await page.keyboard.press('End');
  await expect(toolbar).toBeHidden();
  const entrance = page.evaluate(
    () =>
      new Promise<{ x: number; y: number; overflow: number }[]>((resolve) => {
        const samples: { x: number; y: number; overflow: number }[] = [];
        const observer = new MutationObserver(() => {
          const toolbar = Array.from(
            document.querySelectorAll<HTMLElement>('[aria-label="Undo and redo"]'),
          ).find((element) => element.getBoundingClientRect().height > 0);
          const surface = toolbar?.firstElementChild;
          if (!toolbar || !surface) return;
          observer.disconnect();
          const end = performance.now() + 1000;
          const sample = () => {
            const bounds = toolbar.getBoundingClientRect();
            const rect = surface.getBoundingClientRect();
            samples.push({
              x: rect.x - bounds.x,
              y: rect.y - bounds.y,
              overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            });
            if (performance.now() < end) requestAnimationFrame(sample);
            else resolve(samples);
          };
          requestAnimationFrame(sample);
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }),
  );
  await page.keyboard.insertText(' changed');
  const samples = await entrance;
  const floating = (page.viewportSize()?.width ?? 0) < 640;
  expect(samples.some(({ x, y }) => (floating ? x > 5 : y < -5))).toBe(true);
  expect(samples.every(({ x, y }) => Math.abs(floating ? y : x) < 1)).toBe(true);
  expect(Math.abs(samples.at(-1)?.x ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
  expect(Math.abs(samples.at(-1)?.y ?? Number.POSITIVE_INFINITY)).toBeLessThan(1);
  expect(Math.max(...samples.map(({ overflow }) => overflow))).toBeLessThanOrEqual(1);
  await expect(undo).toBeEnabled();
  await expect(redo).toBeDisabled();
  const box = await toolbar.boundingBox();
  const back = await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox();
  if (!box || !back) throw new Error('Missing history or back toolbar');
  if ((page.viewportSize()?.width ?? 0) >= 640) {
    expect(Math.abs(box.y + box.height / 2 - back.y - back.height / 2)).toBeLessThan(2);
    expect(box.x).toBeGreaterThan(back.x + back.width);
  } else {
    const dock = await page.locator('[data-note-toolbar]').last().boundingBox();
    if (!dock) throw new Error('Missing note dock');
    expect(box.y + box.height).toBeLessThan(dock.y);
    expect(Math.abs(box.x + box.width - dock.x - dock.width)).toBeLessThan(2);
  }

  await undo.click();
  await expect(body).toHaveText('Original body');
  await expect(editor).toBeFocused();
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  await redo.click();
  await expect(body).toHaveText('Original body changed');
  await expect(editor).toBeFocused();
  await expect(redo).toBeDisabled();

  await page.keyboard.press('Control+z');
  await expect(body).toHaveText('Original body');
  await expect(redo).toBeEnabled();
  await page.keyboard.press('Control+Shift+z');
  await expect(body).toHaveText('Original body changed');
  await expect(redo).toBeDisabled();
  await undo.click();
  await page.keyboard.insertText(' replacement');
  await expect(body).toHaveText('Original body replacement');
  await expect(redo).toBeDisabled();

  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  const reopened = await openNote(page, 'History toolbar');
  await expect(reopened.getByRole('textbox').locator('p').last()).toHaveText(
    'Original body replacement',
  );
  await expect(toolbar).toBeHidden();
});

test('checkbox edits use the same undo and redo history', async ({ page }) => {
  await signUp(page);
  await page.evaluate(async () => {
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { transaction } = createNote({
      userId: getSignedInUser().id,
      content: [
        { type: 'heading', props: { level: 3 }, content: 'History checklist' },
        { type: 'checkListItem', content: 'First item', props: { checked: false } },
      ],
    });
    await transaction.isPersisted.promise;
  });
  const dialog = await openNote(page, 'History checklist');
  const checkbox = dialog.getByRole('checkbox');
  const toolbar = page.getByRole('toolbar', { name: 'Undo and redo' });
  await expect(toolbar).toBeHidden();
  await checkbox.click();
  await expect(checkbox).toBeChecked();
  await toolbar.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(checkbox).not.toBeChecked();
  await toolbar.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(checkbox).toBeChecked();
});

test('a narrow split pane floats history above its dock and keeps the sync pill centered', async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 820 });
  await signUp(page);
  await createNote(page, 'Narrow history', 'Keep the header steady');
  const dialog = await openNote(page, 'Narrow history');
  const status = dialog.getByRole('status');
  const before = await status.boundingBox();
  if (!before) throw new Error('Missing sync status area');
  await dialog.getByRole('textbox').locator('p').last().click();
  await page.keyboard.press('End');
  await page.keyboard.insertText('!');
  const history = page.getByRole('toolbar', { name: 'Undo and redo' });
  await expect(history).toBeVisible();
  await expect(dialog.getByRole('toolbar', { name: 'Undo and redo' })).toHaveCount(0);
  await expect(status.getByText('Synced', { exact: true })).toBeVisible();
  await expect
    .poll(async () => {
      const pill = await dialog.locator('[data-sync-pill]').boundingBox();
      return pill
        ? Math.abs(pill.x + pill.width / 2 - before.x - before.width / 2)
        : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(1);
  expect(await status.boundingBox()).toEqual(before);
  const box = await history.boundingBox();
  const actions = await page.getByRole('toolbar', { name: 'Note actions' }).boundingBox();
  if (!box || !actions) throw new Error('Missing history or note actions');
  expect(box.y + box.height).toBeLessThan(actions.y);
  expect(Math.abs(box.x + box.width - actions.x - actions.width)).toBeLessThan(2);

  await page.setViewportSize({ width: 1180, height: 820 });
  await expect(dialog.getByRole('toolbar', { name: 'Undo and redo' })).toBeVisible();
  await expect(history).toHaveCount(1);
  await history.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(dialog.getByRole('textbox').locator('p').last()).toHaveText(
    'Keep the header steady',
  );
});
