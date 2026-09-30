import { expect, test } from '@playwright/test';
import { card, signUp } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`the ${theme} checklist preview matches the mounted editor without shifting`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await signUp(page);
    await page.evaluate(async () => {
      const { createNote } = await import('/src/lib/notes.ts');
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const { transaction } = createNote({
        userId: getSignedInUser().id,
        color: 'yellow',
        content: [
          { id: 'title', type: 'heading', props: { level: 3 }, content: 'Transition list' },
          {
            id: 'wrapped',
            type: 'checkListItem',
            content:
              'An item with enough text to wrap onto multiple lines on a phone, keeping the checkbox and text in exactly the same positions.',
          },
          {
            id: 'done',
            type: 'checkListItem',
            props: { checked: true },
            content: [{ type: 'text', text: 'Already done', styles: { bold: true } }],
          },
          { id: 'empty', type: 'paragraph', content: [] },
          {
            id: 'parent',
            type: 'checkListItem',
            content: 'Parent item',
            children: [
              { id: 'nested', type: 'checkListItem', content: 'Nested item' },
              { id: 'bullet', type: 'bulletListItem', content: 'A bullet item' },
              { id: 'numbered', type: 'numberedListItem', content: 'A numbered item' },
            ],
          },
          { id: 'last', type: 'checkListItem', content: 'Last item' },
        ],
      });
      await transaction.isPersisted.promise;
    });
    const note = card(page, 'Transition list');
    await expect(note).toBeVisible();
    const cardStyle = await note
      .locator('.note-checkbox')
      .nth(1)
      .evaluate((checkbox) => {
        const style = getComputedStyle(checkbox);
        return {
          background: style.backgroundColor,
          border: style.borderColor,
          check: getComputedStyle(checkbox, '::after').maskImage,
        };
      });

    // Capture the last preview geometry and the first editor geometry across the actual swap.
    const transition = page.evaluate(() => {
      function measure(root: Element, preview: boolean) {
        const bounds = root.getBoundingClientRect();
        const rows = preview
          ? root.querySelectorAll<HTMLElement>('.note-preview-block')
          : root.querySelectorAll<HTMLElement>('[data-node-type="blockContainer"]');
        return Array.from(rows, (row) => {
          const body = row.firstElementChild;
          if (!body) throw new Error('Missing block content');
          const rect = body.getBoundingClientRect();
          const paragraph =
            body.querySelector('.bn-inline-content, p, .note-preview-list > span:last-child') ??
            body;
          const range = document.createRange();
          range.selectNodeContents(paragraph);
          const text = range.getBoundingClientRect();
          const checkbox = body.querySelector('.note-checkbox, input[type="checkbox"]');
          const box = checkbox?.getBoundingClientRect();
          const style = checkbox ? getComputedStyle(checkbox) : null;
          return {
            id: preview ? row.dataset.previewBlock : row.dataset.id,
            x: rect.x - bounds.x,
            y: rect.y - bounds.y,
            width: rect.width,
            height: rect.height,
            textX: text.x - bounds.x,
            textY: text.y - bounds.y,
            textWidth: text.width,
            textHeight: text.height,
            checkbox:
              box && style
                ? {
                    x: box.x - bounds.x,
                    y: box.y - bounds.y,
                    width: box.width,
                    height: box.height,
                    background: style.backgroundColor,
                    border: style.borderColor,
                    check: getComputedStyle(checkbox, '::after').maskImage,
                  }
                : null,
          };
        });
      }
      return new Promise<{
        preview: ReturnType<typeof measure>;
        editor: ReturnType<typeof measure>;
      }>((resolve, reject) => {
        let preview: ReturnType<typeof measure> | undefined;
        let frame = 0;
        const timeout = setTimeout(() => {
          cancelAnimationFrame(frame);
          reject(new Error('Did not capture the preview-to-editor swap'));
        }, 15_000);
        function capture() {
          const staticPreview = document.querySelector('[role="dialog"] .note-preview-editor');
          if (staticPreview) preview = measure(staticPreview, true);
          const editor = document.querySelector('[role="dialog"] .bn-editor');
          if (editor && preview) {
            clearTimeout(timeout);
            resolve({ preview, editor: measure(editor, false) });
            return;
          }
          frame = requestAnimationFrame(capture);
        }
        capture();
      });
    });
    await note.getByRole('button', { name: 'Open note' }).click();
    const { preview, editor } = await transition;
    expect(preview.map((row) => row.id)).toEqual(editor.map((row) => row.id));
    for (const [index, row] of editor.entries()) {
      const before = preview[index];
      for (const key of [
        'x',
        'y',
        'width',
        'height',
        'textX',
        'textY',
        'textWidth',
        'textHeight',
      ] as const) {
        expect(Math.abs(row[key] - before[key]), `${row.id}: ${key}`).toBeLessThan(0.6);
      }
      expect(before.checkbox).toEqual(row.checkbox);
    }
    const checked = editor.find((row) => row.id === 'done')?.checkbox;
    expect(checked).toMatchObject(cardStyle);
    await page.screenshot({ path: `test-results/checklist-${theme}.png` });
  });
}
