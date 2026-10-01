import { expect, test } from '@playwright/test';
import { openNote, seedNotes, signUp } from './helpers';

test('mobile notes scroll behind the controls and keep their timestamp below the content', async ({
  page,
  isMobile,
}) => {
  test.skip(!isMobile, 'Checks the full-screen mobile editor.');
  await signUp(page);
  await page.evaluate(async () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '24px');
    document.documentElement.style.setProperty('--safe-area-inset-bottom', '20px');
    const { createNote } = await import('/src/lib/notes.ts');
    const { getSignedInUser } = await import('/src/lib/auth.ts');
    const { transaction } = createNote({
      userId: getSignedInUser().id,
      color: 'yellow',
      content: [
        { type: 'heading', props: { level: 3 }, content: 'A day outside' },
        ...Array.from({ length: 24 }, (_, index) => ({
          type: 'paragraph',
          content: `Stop ${index + 1}: a walk along the river, with time to pause and look around.`,
        })),
      ],
    });
    await transaction.isPersisted.promise;
  });
  const dialog = await openNote(page, 'A day outside');
  const area = dialog.locator('[data-note-scroll]');
  const header = dialog.locator('[data-note-header]');
  const topBlur = dialog.locator('.page-top-blur');
  const bottomBlur = dialog.locator('.page-bottom-blur');
  await expect(dialog.getByRole('status')).toBeEmpty();
  await expect(topBlur).toHaveCSS('opacity', '0');
  await expect(bottomBlur).toHaveCSS('opacity', '1');
  const headerBefore = await header.boundingBox();
  expect(headerBefore).not.toBeNull();
  expect((await area.boundingBox())?.y).toBe(0);
  const heading = await dialog.getByRole('heading', { name: 'A day outside' }).boundingBox();
  expect(heading?.y).toBeGreaterThan((headerBefore?.y ?? 0) + (headerBefore?.height ?? 0));

  await area.evaluate((area) => {
    area.scrollTop = 140;
  });
  await expect(topBlur).toHaveCSS('opacity', '1');
  expect(await header.boundingBox()).toEqual(headerBefore);
  await page.screenshot({ path: 'test-results/mobile-note-edge-blurs.png' });

  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(300);
  });
  await expect(bottomBlur).toHaveCSS('bottom', '300px');
  await area.evaluate((area) => {
    area.scrollTop = area.scrollHeight;
  });
  await expect(bottomBlur).toHaveCSS('opacity', '0');
  const timestamp = dialog.getByText(/^Edited/);
  await expect(timestamp).toBeVisible();
  const timestampBounds = await timestamp.boundingBox();
  const lastLine = await dialog.getByText(/^Stop 24:/).boundingBox();
  expect(timestampBounds?.y).toBeGreaterThan((lastLine?.y ?? 0) + (lastLine?.height ?? 0));
  await expect(timestamp).toHaveCSS('text-align', 'center');
  const dock = await page.locator('[data-note-toolbar]').boundingBox();
  expect((timestampBounds?.y ?? 0) + (timestampBounds?.height ?? 0)).toBeLessThan(dock?.y ?? 0);

  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(0);
  });
  await page.screenshot({ path: 'test-results/mobile-note-timestamp.png' });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
});

test('the sync pill slides from above and changes width without moving the header controls', async ({
  page,
}) => {
  await signUp(page);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '40px');
  });
  await seedNotes(page, [{ title: 'A quiet afternoon', body: 'Read a few pages' }]);
  const dialog = await openNote(page, 'A quiet afternoon');
  const status = dialog.getByRole('status');
  await expect(status).toBeEmpty();
  await expect(status).toHaveCSS('overflow-y', 'hidden');
  expect((await status.boundingBox())?.y).toBe(40);
  const close = dialog.getByRole('button', { name: 'Close', exact: true });
  const closeBefore = await close.boundingBox();
  const statusBefore = await status.boundingBox();
  const editorBefore = await dialog.getByRole('textbox').boundingBox();
  if (!statusBefore || !editorBefore) throw new Error('Missing sync status area or editor');
  const statusCenter = statusBefore.x + statusBefore.width / 2;

  let releaseWrite = () => {};
  const holdWrite = new Promise<void>((resolve) => {
    releaseWrite = resolve;
  });
  await page.route('**/api/notes/*', async (route) => {
    if (route.request().method() === 'PATCH') await holdWrite;
    await route.continue();
  });
  await dialog.getByText('Read a few pages').click();
  await page.keyboard.press('End');
  const entrance = page.evaluate(() => {
    return new Promise<{ top: number; center: number }[]>((resolve) => {
      const positions: { top: number; center: number }[] = [];
      const start = performance.now();
      function sample() {
        const pill = document.querySelector('[data-sync-pill]');
        if (pill) {
          const rect = pill.getBoundingClientRect();
          positions.push({ top: rect.y, center: rect.x + rect.width / 2 });
        }
        if (performance.now() - start >= 1500) return resolve(positions);
        requestAnimationFrame(sample);
      }
      sample();
    });
  });
  await page.keyboard.type(' and take some notes');
  await expect(status.getByText('Syncing…')).toBeVisible();
  const positions = await entrance;
  expect(positions.length).toBeGreaterThan(2);
  expect(Math.min(...positions.map(({ top }) => top))).toBeLessThan(positions.at(-1)?.top ?? 0);
  expect(positions.every(({ center }) => Math.abs(center - statusCenter) < 1)).toBe(true);
  expect(await status.boundingBox()).toEqual(statusBefore);
  expect(await dialog.getByRole('textbox').boundingBox()).toMatchObject({
    x: editorBefore.x,
    y: editorBefore.y,
    width: editorBefore.width,
  });
  expect(await close.boundingBox()).toEqual(closeBefore);
  const pill = dialog.locator('[data-sync-pill]');
  const restingPill = await pill.boundingBox();
  expect(restingPill).not.toBeNull();
  expect(
    Math.abs(
      (restingPill?.y ?? 0) +
        (restingPill?.height ?? 0) / 2 -
        ((closeBefore?.y ?? 0) + (closeBefore?.height ?? 0) / 2),
    ),
  ).toBeLessThan(1);
  const syncingWidth = (await pill.boundingBox())?.width ?? 0;

  // Sample the rendered widths while the real write reaches the server and settles.
  const resizing = page.evaluate(() => {
    return new Promise<{ width: number; center: number }[]>((resolve) => {
      const sizes: { width: number; center: number }[] = [];
      const start = performance.now();
      function sample() {
        const pill = document.querySelector('[data-sync-pill]');
        if (pill) {
          const rect = pill.getBoundingClientRect();
          sizes.push({ width: rect.width, center: rect.x + rect.width / 2 });
        }
        if (performance.now() - start >= 1500) return resolve(sizes);
        requestAnimationFrame(sample);
      }
      sample();
    });
  });
  releaseWrite();
  await expect(status.getByText('Synced', { exact: true })).toBeVisible();
  const sizes = await resizing;
  const syncedWidth = (await pill.boundingBox())?.width ?? 0;
  expect(syncedWidth).toBeLessThan(syncingWidth);
  expect(sizes.some(({ width }) => width > syncedWidth + 1 && width < syncingWidth - 1)).toBe(true);
  const center = sizes[0]?.center ?? 0;
  expect(sizes.every((size) => Math.abs(size.center - center) < 1)).toBe(true);
  expect(await close.boundingBox()).toEqual(closeBefore);
  await page.evaluate(async () => {
    const { keyboardHeight } = await import('/src/lib/keyboard.ts');
    keyboardHeight.jump(300);
  });
  const exiting = await page.evaluate(() => {
    return new Promise<{ bottom: number; clipTop: number; safeTop: number }[]>(
      (resolve, reject) => {
        const frames: { bottom: number; clipTop: number; safeTop: number }[] = [];
        const start = performance.now();
        let changedInset = false;
        function sample() {
          const pill = document.querySelector('[data-sync-pill]');
          if (!pill) return resolve(frames);
          if (performance.now() - start > 5000)
            return reject(new Error('Pill did not finish exiting'));
          // Native system bar insets can change while a keyboard/rotation animation is running.
          if (!changedInset && Number(getComputedStyle(pill).opacity) < 0.99) {
            document.documentElement.style.setProperty('--safe-area-inset-top', '60px');
            changedInset = true;
          }
          const clip = pill.parentElement;
          if (!clip) throw new Error('Missing pill clip');
          frames.push({
            bottom: pill.getBoundingClientRect().bottom,
            clipTop: clip.getBoundingClientRect().top,
            safeTop: changedInset ? 60 : 40,
          });
          requestAnimationFrame(sample);
        }
        sample();
      },
    );
  });
  expect(exiting.some(({ safeTop }) => safeTop === 60)).toBe(true);
  expect(exiting.every(({ clipTop, safeTop }) => clipTop >= safeTop - 1)).toBe(true);
  expect(exiting.some(({ bottom, clipTop }) => bottom < clipTop)).toBe(true);
  await expect(pill).toHaveCount(0);
});
