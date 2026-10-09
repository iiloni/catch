import { expect, test } from '@playwright/test';
import {
  card,
  moveNote,
  noteToolbar,
  openDeck,
  openNote,
  seedNotes,
  settledBox,
  signUp,
} from './helpers';

// A landscape tablet, wide enough to show an open note beside the page.
test.use({ viewport: { width: 1180, height: 820 } });

test('an open note sits beside the page, which stays usable', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, [
    { title: 'Alpha', body: 'First' },
    { title: 'Beta', body: 'Second' },
  ]);

  const dialog = await openNote(page, 'Alpha');
  const header = page.locator('[data-page-header]');
  await expect(header).toBeVisible();
  await expect(header).toHaveCSS('opacity', '1');
  const pane = await dialog.boundingBox();
  const alpha = await card(page, 'Alpha').boundingBox();
  expect(pane && alpha && alpha.x + alpha.width <= pane.x).toBe(true);

  // The page keeps its tabs while the note has its own toolbar.
  await expect(page.getByRole('link', { name: 'Deck' })).toBeVisible();
  await expect(noteToolbar(page)).toBeVisible();

  // The note is a card that ends above its toolbar rather than running under it.
  const noteCard = await dialog.locator('[data-note-scroll]').boundingBox();
  const toolbar = await noteToolbar(page).boundingBox();
  expect(noteCard && toolbar && noteCard.y + noteCard.height <= toolbar.y).toBe(true);

  // Opening another note swaps the pane's note in place.
  await card(page, 'Beta').getByRole('button', { name: 'Open note' }).click();
  // The new note fades in over the old one.
  await expect(
    page.getByRole('dialog').locator('[contenteditable]', { hasText: 'Second' }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(1);

  const attach = noteToolbar(page).getByRole('button', { name: 'Attach files', exact: true });
  await expect(attach).toBeEnabled();
  await attach.click();
  const picker = page.getByRole('region', { name: 'Add attachment' });
  await expect(picker).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    picker.getByRole('button', { name: 'Files', exact: true }).click(),
  ]);
  await chooser.setFiles({
    name: 'beta.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Attached to the second note'),
  });
  const fileBlock = page.getByRole('dialog').locator('[data-content-type="file"]');
  await expect(fileBlock).toBeVisible();
  await expect(fileBlock).toContainText('beta.txt');

  // Switching notes replaced the history entry, so one step back closes the pane.
  await page.goBack();
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(header).toHaveCSS('opacity', '1');
  await expect(page.getByRole('separator', { name: 'Resize note' })).toBeHidden();
  await expect(page).toHaveURL(/\/$/);
});

test('a quick note and its dock center over the split view with one formatting bar', async ({
  page,
}) => {
  await signUp(page);
  await seedNotes(page, [{ title: 'Alpha', body: 'First' }]);
  await openNote(page, 'Alpha');
  const dock = page.locator('[data-dock] > div');
  const initialDock = await dock.boundingBox();
  if (!initialDock) throw new Error('Missing page dock');
  const initialDockCenter = initialDock.x + initialDock.width / 2;

  // Chromium emulation has no on-screen keyboard; report its height as Android does.
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(320);
  });
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);

  const dockMotion = page.evaluate(
    () =>
      new Promise<{ center: number; searchOffset: number }[]>((resolve) => {
        const dock = document.querySelector('[data-dock] > div');
        const search = document.querySelector('[data-dock] a[aria-label="Search"]');
        const icon = document.querySelector('[data-dock] search svg');
        if (!dock || !search || !icon) return resolve([]);
        const samples: { center: number; searchOffset: number }[] = [];
        const end = performance.now() + 650;
        const record = () => {
          const dockBox = dock.getBoundingClientRect();
          const searchBox = search.getBoundingClientRect();
          const iconBox = icon.getBoundingClientRect();
          samples.push({
            center: dockBox.x + dockBox.width / 2,
            searchOffset: iconBox.x + iconBox.width / 2 - (searchBox.x + searchBox.width / 2),
          });
          if (performance.now() < end) requestAnimationFrame(record);
          else resolve(samples);
        };
        requestAnimationFrame(record);
      }),
  );
  await page.getByRole('button', { name: 'New note' }).click();
  const samples = await dockMotion;
  expect(samples.some(({ center }) => center > initialDockCenter + 20 && center < 570)).toBe(true);
  expect(Math.max(...samples.map(({ center }) => center))).toBeLessThan(593);
  expect(Math.max(...samples.map(({ searchOffset }) => Math.abs(searchOffset)))).toBeLessThan(5);
  const quickNote = page.getByRole('region', { name: 'New note' });
  await expect(quickNote.locator('[contenteditable]')).toBeFocused();
  await expect
    .poll(async () => {
      const box = await quickNote.boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - 1180 / 2) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  await expect
    .poll(async () => {
      const box = await dock.boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - 1180 / 2) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  expect(
    await quickNote.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return element.contains(
        document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2),
      );
    }),
  ).toBe(true);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);
  await expect(noteToolbar(page)).toBeHidden();

  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(quickNote).toBeHidden();
  await expect
    .poll(async () => {
      const box = await dock.boundingBox();
      return box ? Math.abs(box.x + box.width / 2 - initialDockCenter) : Number.POSITIVE_INFINITY;
    })
    .toBeLessThan(2);
  await expect(page.getByRole('toolbar', { name: 'Formatting' })).toHaveCount(1);
});

test('on the deck a note pops up over the board instead', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Ship it']);
  await moveNote(page, 'Ship it');

  // The page beside the pane stays usable, and leaving for the deck closes the note.
  await page.getByRole('link', { name: 'Deck' }).click();
  await expect(page.getByRole('dialog')).toBeHidden();

  const dialog = await openNote(page, 'Ship it');
  await expect(page.getByRole('separator', { name: 'Resize note' })).toBeHidden();
  const box = await dialog.boundingBox();
  expect(box && Math.abs(box.x + box.width / 2 - 1180 / 2)).toBeLessThan(2);
  // The page's dock turns into the note's toolbar, as on a phone.
  await expect(noteToolbar(page)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deck' })).toBeHidden();
  // The panel ends above the toolbar rather than running under it.
  const toolbar = await noteToolbar(page).boundingBox();
  expect(box && toolbar && box.y + box.height <= toolbar.y).toBe(true);
});

test('the split is resized by dragging the handle, within limits', async ({ page }) => {
  await signUp(page);
  await seedNotes(page, ['Alpha']);
  const dialog = await openNote(page, 'Alpha');
  const handle = page.getByRole('separator', { name: 'Resize note' });
  await expect(handle).toBeVisible();

  const box = await handle.boundingBox();
  if (!box) throw new Error('No handle');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const share = async () => Number(await handle.getAttribute('aria-valuenow'));
  const before = await share();

  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 150, y, { steps: 5 });
  await page.mouse.up();
  const wider = await share();
  expect(wider).toBeGreaterThan(before);
  const paneAfter = await dialog.boundingBox();
  expect(paneAfter?.x).toBeGreaterThan(box.x + 100);

  // Far past either edge, the split stops at its limits.
  const moved = await handle.boundingBox();
  if (!moved) throw new Error('No handle');
  await page.mouse.move(moved.x + moved.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(5, y, { steps: 5 });
  await page.mouse.up();
  const min = await handle.getAttribute('aria-valuemin');
  expect(await handle.getAttribute('aria-valuenow')).toBe(min);

  // The split is remembered.
  await page.goto('/');
  await openNote(page, 'Alpha');
  await expect(handle).toHaveAttribute('aria-valuenow', String(min));
});

test('narrow note panes keep header actions and undo reachable', async ({ page }) => {
  await page.setViewportSize({ width: 672, height: 820 });
  await signUp(page);
  await seedNotes(page, ['Toolbar fit']);
  const dialog = await openNote(page, 'Toolbar fit');
  const header = dialog.locator('[data-note-header]');
  const handle = page.getByRole('separator', { name: 'Resize note' });
  const editor = dialog.getByRole('textbox');

  const expectActionsInside = async () => {
    await expect
      .poll(() =>
        header.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return [...element.querySelectorAll('button')]
            .filter((button) => button.checkVisibility())
            .every((button) => {
              const box = button.getBoundingClientRect();
              return box.left >= bounds.left && box.right <= bounds.right;
            });
        }),
      )
      .toBe(true);
  };

  await expectActionsInside();
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' extra');
  const history = page.getByRole('toolbar', { name: 'Undo and redo' });
  await expect(history).toBeVisible();
  await expect(history).toHaveCount(1);
  const dock = await settledBox(noteToolbar(page));
  const undoBox = await settledBox(history);
  expect(undoBox.y + undoBox.height).toBeLessThan(dock.y);
  await history.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(editor).not.toContainText('extra');
  await dialog.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Unpin', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await dialog.getByRole('button', { name: 'Share', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Share' })).toBeVisible();
  await page.keyboard.press('Escape');

  // The same narrow pane can occur on a large display after resizing the split.
  await page.setViewportSize({ width: 1180, height: 820 });
  await handle.press('End');
  await expectActionsInside();
  await expect(history).toHaveCount(1);
  await handle.press('Home');
  await expectActionsInside();
  await expect(header.getByRole('toolbar', { name: 'Undo and redo' })).toBeVisible();
  await expect(history).toHaveCount(1);
});

for (const layout of ['split view', 'popup'] as const) {
  test(`the ${layout} scrollbar stays inside the card and scrolls without losing the caret`, async ({
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'Mouse scrollbar interactions are covered on desktop');
    await signUp(page);
    await seedNotes(
      page,
      [
        'Short note',
        {
          title: 'Long note',
          body: 'A long note should scroll inside its rounded card. '.repeat(200),
        },
      ],
      layout === 'popup' ? 'new' : undefined,
    );
    if (layout === 'popup') await openDeck(page);

    const dialog = await openNote(page, 'Short note');
    const track = dialog.locator('[data-slot="scroll-area-scrollbar"]');
    await expect(track).toBeHidden();
    const shortNoteBox = await settledBox(dialog.locator('[data-note-scroll]'));
    await page.mouse.click(
      shortNoteBox.x + shortNoteBox.width / 2,
      shortNoteBox.y + shortNoteBox.height - 48,
    );
    await expect(dialog.getByRole('textbox')).toBeFocused();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();

    await openNote(page, 'Long note');
    const viewport = dialog.locator('[data-note-scroll]');
    const thumb = track.locator('[data-slot="scroll-area-thumb"]');
    await expect(thumb).toBeVisible();
    const areaBox = await settledBox(viewport);
    const trackBox = await settledBox(track);
    expect(trackBox.y - areaBox.y).toBeGreaterThanOrEqual(15);
    expect(areaBox.y + areaBox.height - (trackBox.y + trackBox.height)).toBeGreaterThanOrEqual(15);
    expect(areaBox.x + areaBox.width - (trackBox.x + trackBox.width)).toBeGreaterThanOrEqual(3);

    const scrollTop = () => viewport.evaluate((element) => element.scrollTop);
    const pageScrollTop = await page.evaluate(() => window.scrollY);
    await page.mouse.move(areaBox.x + areaBox.width / 2, areaBox.y + areaBox.height / 2);
    await page.mouse.wheel(0, 240);
    await expect.poll(scrollTop).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollTop);

    const editor = dialog.getByRole('textbox');
    await editor.click();
    await expect(editor).toBeFocused();
    const caret = await editor.evaluate(() => {
      const selection = window.getSelection();
      return { anchor: selection?.anchorOffset, focus: selection?.focusOffset };
    });
    const beforeDrag = await scrollTop();
    const thumbBox = await settledBox(thumb);
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, thumbBox.y + thumbBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(thumbBox.x + thumbBox.width / 2, trackBox.y + trackBox.height - 1, {
      steps: 8,
    });
    await page.mouse.up();
    await expect.poll(scrollTop).toBeGreaterThan(beforeDrag + 100);
    await expect(editor).toBeFocused();
    expect(
      await editor.evaluate(() => {
        const selection = window.getSelection();
        return { anchor: selection?.anchorOffset, focus: selection?.focusOffset };
      }),
    ).toEqual(caret);
    await expect
      .poll(() =>
        viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(2);
    const endThumbBox = await thumb.boundingBox();
    expect(
      endThumbBox && areaBox.y + areaBox.height - (endThumbBox.y + endThumbBox.height),
    ).toBeGreaterThanOrEqual(15);

    // Folding into the phone layout must keep the same editor and its undo history.
    await page.keyboard.type('Resize keeps this edit');
    await expect(editor).toContainText('Resize keeps this edit');
    await page.setViewportSize({ width: 560, height: 820 });
    await expect(editor).toBeFocused();
    const undo = page
      .getByRole('toolbar', { name: 'Undo and redo' })
      .getByRole('button', { name: 'Undo', exact: true });
    await expect(undo).toBeEnabled();
    await undo.click();
    await expect(editor).not.toContainText('Resize keeps this edit');
  });
}
