import { expect, test } from '@playwright/test';
import {
  APP_LOAD_TIMEOUT,
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
test.use({ viewport: { width: 1180, height: 820 }, video: 'on' });

test.describe('expanded Gallery panes', () => {
  test('expanding beside Back animates the same card and dock, preserves editing, and restores the split', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 690, height: 830 });
    await signUp(page);
    await seedNotes(page, [{ title: 'More room', body: 'Keep writing here' }]);
    const dialog = await openNote(page, 'More room');
    const editor = dialog.getByRole('textbox');
    const originalEditor = await editor.elementHandle();
    const handle = page.getByRole('separator', { name: 'Resize note' });
    const savedShare = await handle.getAttribute('aria-valuenow');
    const before = await settledBox(dialog);
    const cardBefore = await settledBox(dialog.locator('[data-note-scroll]'));
    const dockBefore = await settledBox(noteToolbar(page));
    const galleryDock = page.locator('[data-dock] > div');
    const galleryBefore = await settledBox(galleryDock);
    const account = page.getByRole('button', { name: /^Account:/ });
    const accountBefore = await settledBox(account);
    const expand = dialog.getByRole('button', { name: 'Expand note', exact: true });
    const close = await dialog.getByRole('button', { name: 'Close', exact: true }).boundingBox();
    const control = await expand.boundingBox();
    expect(close && control && control.x >= close.x + close.width).toBe(true);
    await editor.click();
    await editor.press('Control+End');
    await page.keyboard.type(' extra');
    await expect(editor).toContainText('extra');

    const motion = page.evaluate(
      () =>
        new Promise<
          {
            left: number;
            width: number;
            dock: number;
            galleryX: number;
            galleryY: number;
            galleryWidth: number;
            accountX: number;
            pageOpacity: number;
            dockOpacity: number;
            accountOpacity: number;
          }[]
        >((resolve) => {
          const samples: {
            left: number;
            width: number;
            dock: number;
            galleryX: number;
            galleryY: number;
            galleryWidth: number;
            accountX: number;
            pageOpacity: number;
            dockOpacity: number;
            accountOpacity: number;
          }[] = [];
          const end = performance.now() + 5_000;
          const sample = () => {
            const note = document.querySelector('[role="dialog"]')?.getBoundingClientRect();
            const dock = document
              .querySelector('[aria-label="Note actions"]')
              ?.getBoundingClientRect();
            const gallery = document.querySelector('[data-dock] > div')?.getBoundingClientRect();
            const account = document.querySelector('[aria-label^="Account:"]');
            const page = document.querySelector('section[aria-label="Gallery"]');
            const glass = document.querySelector('[data-dock] .glass');
            const foreground = account?.closest('.header-fade');
            if (note && dock && gallery && account && page && glass && foreground)
              samples.push({
                left: note.x,
                width: note.width,
                dock: dock.x + dock.width / 2,
                galleryX: gallery.x,
                galleryY: gallery.y,
                galleryWidth: gallery.width,
                accountX: account.getBoundingClientRect().x,
                pageOpacity: Number(getComputedStyle(page).opacity),
                dockOpacity: Number(getComputedStyle(glass).opacity),
                accountOpacity: Number(getComputedStyle(foreground).opacity),
              });
            if (performance.now() < end && (!note || note.x > 12.1)) requestAnimationFrame(sample);
            else resolve(samples);
          };
          document
            .querySelector('[aria-label="Expand note"]')
            ?.addEventListener('pointerdown', () => requestAnimationFrame(sample), { once: true });
        }),
    );
    await expand.click();
    const samples = await motion;
    const expanded = await settledBox(dialog);
    expect(expanded.width - before.width).toBeGreaterThan(250);
    expect(expanded.x).toBeCloseTo(12, 0);
    expect(expanded.y).toBeCloseTo(before.y, 0);
    expect(expanded.height).toBeCloseTo(before.height, 0);
    expect(new Set(samples.map((frame) => Math.round(frame.width))).size).toBeGreaterThan(4);
    expect(new Set(samples.map((frame) => Math.round(frame.dock))).size).toBeGreaterThan(4);
    const fading = samples.filter((frame) => frame.pageOpacity > 0.05 && frame.pageOpacity < 0.95);
    expect(fading.length).toBeGreaterThan(3);
    for (const frame of samples) {
      expect(frame.galleryX).toBeCloseTo(galleryBefore.x, 0);
      expect(frame.galleryY).toBeCloseTo(galleryBefore.y, 0);
      expect(frame.galleryWidth).toBeCloseTo(galleryBefore.width, 0);
      expect(frame.accountX).toBeCloseTo(accountBefore.x, 0);
      expect(frame.dockOpacity).toBeCloseTo(frame.pageOpacity, 2);
      expect(frame.accountOpacity).toBeCloseTo(frame.pageOpacity, 2);
    }
    await testInfo.attach('expansion-frames', {
      body: JSON.stringify(samples),
      contentType: 'application/json',
    });
    await expect(account).toBeHidden();
    await expect(editor).toBeFocused();
    expect(await originalEditor?.evaluate((element) => element.isConnected)).toBe(true);
    await expect(handle).toBeHidden();
    await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toBeHidden();
    const noteCard = dialog.locator('[data-note-scroll]');
    const cardAfter = await settledBox(noteCard);
    const dockAfter = await settledBox(noteToolbar(page));
    expect(cardAfter.y).toBeCloseTo(cardBefore.y, 0);
    expect(cardAfter.y + cardAfter.height).toBeLessThanOrEqual(dockAfter.y);
    expect(dockAfter.y).toBeCloseTo(dockBefore.y, 0);
    expect(
      Number.parseFloat(
        await noteCard.evaluate((element) => getComputedStyle(element).borderTopLeftRadius),
      ),
    ).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('expanded-note.png') });
    await testInfo.attach('browser-version', {
      body: page.context().browser()?.version() ?? 'unknown',
      contentType: 'text/plain',
    });

    const restore = dialog.getByRole('button', { name: 'Show gallery', exact: true });
    await expect(restore).toHaveAttribute('aria-pressed', 'true');
    await restore.click();
    expect((await settledBox(dialog)).width).toBeCloseTo(before.width, 0);
    await expect(handle).toHaveAttribute('aria-valuenow', savedShare ?? '');
    await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toBeVisible();
    await expect(account).toBeVisible();
    expect((await settledBox(galleryDock)).width).toBeCloseTo(galleryBefore.width, 0);
    expect((await settledBox(account)).x).toBeCloseTo(accountBefore.x, 0);
    await expect(editor).toBeFocused();
    expect(await originalEditor?.evaluate((element) => element.isConnected)).toBe(true);
    await page
      .getByRole('toolbar', { name: 'Undo and redo' })
      .getByRole('button', { name: 'Undo', exact: true })
      .click();
    await expect(editor).not.toContainText('extra');

    // A second tap can reverse the width spring before it settles.
    await expand.click();
    await restore.click();
    expect((await settledBox(dialog)).width).toBeCloseTo(before.width, 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(card(page, 'More room')).toBeVisible();
  });

  test('the expanded pane is remembered through reopening, reload, folding and rotation with reduced motion', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 740, height: 860 });
    await signUp(page);
    await seedNotes(page, [
      {
        title: 'Remember this view',
        body: [
          'My tablet layout',
          ...Array.from({ length: 40 }, (_, index) => `Line ${index + 1}`),
        ].join('\n'),
      },
    ]);
    const dialog = await openNote(page, 'Remember this view');
    const scroller = dialog.locator('[data-note-scroll]');
    await scroller.evaluate((element) => {
      element.scrollTop = 180;
    });
    const scrollTop = await scroller.evaluate((element) => element.scrollTop);
    expect(scrollTop).toBeGreaterThan(100);
    await dialog.getByRole('button', { name: 'Expand note', exact: true }).click();
    expect((await settledBox(dialog)).x).toBeCloseTo(12, 0);
    expect(await scroller.evaluate((element) => element.scrollTop)).toBeCloseTo(scrollTop, 0);
    await page.goBack();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('link', { name: 'Gallery', exact: true })).toBeVisible();
    await openNote(page, 'Remember this view');
    await expect(dialog.getByRole('button', { name: 'Show gallery', exact: true })).toBeVisible();
    for (const viewport of [
      { width: 412, height: 915 },
      { width: 860, height: 740 },
    ]) {
      await page.setViewportSize(viewport);
      const box = await settledBox(dialog);
      expect(box.width).toBeCloseTo(viewport.width - (viewport.width < 672 ? 0 : 12), 0);
      const header = await dialog.locator('[data-note-header]').boundingBox();
      expect(header && header.x + header.width <= box.x + box.width + 1).toBe(true);
      await expect(noteToolbar(page)).toHaveCount(1);
      await expect(dialog.getByRole('textbox')).toContainText('My tablet layout');
    }
    await page.reload();
    await expect(dialog.getByRole('textbox')).toContainText('My tablet layout', {
      timeout: APP_LOAD_TIMEOUT,
    });
    await expect(dialog.getByRole('button', { name: 'Show gallery', exact: true })).toBeVisible();
    expect((await settledBox(dialog)).x).toBeCloseTo(12, 0);
    await page.screenshot({ path: testInfo.outputPath('expanded-note-reduced-motion.png') });
    await dialog.getByRole('button', { name: 'Show gallery', exact: true }).click();
    await expect(page.getByRole('separator', { name: 'Resize note' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
});

test('a note pane resumes opening when history restores it during its entrance', async ({
  page,
}) => {
  await signUp(page);
  await seedNotes(page, [{ title: 'Interrupted pane', body: 'Still reachable' }]);

  const restored = page.evaluate(async () => {
    const { paneReveal } = await import('/src/lib/splitView.ts');
    await new Promise<void>((resolve) => {
      const stop = paneReveal.on('change', (value) => {
        if (value <= 0.2 || value >= 1) return;
        stop();
        window.addEventListener(
          'popstate',
          () => {
            window.addEventListener('popstate', () => resolve(), { once: true });
            requestAnimationFrame(() => history.forward());
          },
          { once: true },
        );
        history.back();
      });
    });
  });
  await Promise.all([
    restored,
    card(page, 'Interrupted pane').getByRole('button', { name: 'Open note' }).click(),
  ]);

  const dialog = page.getByRole('dialog', { name: 'Edit note' });
  await expect(dialog.getByRole('textbox')).toContainText('Still reachable');
  await expect(dialog.getByRole('button', { name: 'Close', exact: true })).toBeInViewport();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
});

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
