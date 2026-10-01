import { expect, test } from '@playwright/test';
import {
  card,
  createNote,
  openGalleryPage,
  openNote,
  signIn,
  signUp,
  waitForPageTransition,
} from './helpers';

test.use({
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

const picture = {
  name: 'pixel.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
    'base64',
  ),
};

async function upload(page: Parameters<typeof openNote>[0], file = picture) {
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  const picker = page.getByRole('region', { name: 'Add attachment' });
  await expect(picker).toBeVisible();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    picker.getByRole('button', { name: 'Files', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
}

test('video posters and playback work on the upload device and another device', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const email = await signUp(page);
  await createNote(page, 'Video attachments');
  await openNote(page, 'Video attachments');
  const video = {
    name: 'clip.mp4',
    mimeType: 'video/mp4',
    buffer: readFileSync(new URL('./fixtures/video.mp4', import.meta.url)),
  };
  await upload(page, video);
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByText('Waiting to upload')).toBeHidden();
  await expect(media.getByRole('img', { name: 'clip.mp4' })).toBeVisible();
  await expect
    .poll(() => media.getByRole('img').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(320);
  const id = await media.locator('[data-attachment]').getAttribute('data-attachment');
  const headers = await page.evaluate(() => ({
    Authorization: `Bearer ${localStorage.getItem('catch-auth-token')}`,
  }));
  const poster = await page.request.get(`/api/attachments/${id}/content?preview=true`, { headers });
  expect(poster.status()).toBe(200);
  expect(poster.headers()['content-type']).toBe('image/webp');
  expect(
    (
      await page.request.get(`/api/attachments/${id}/content?preview=true`, {
        headers: { Cookie: '' },
      })
    ).status(),
  ).toBe(401);

  async function playVideo(device: typeof page) {
    await device
      .getByRole('region', { name: 'Media' })
      .getByRole('button', { name: 'View clip.mp4' })
      .click();
    const viewer = device.locator('[data-media-viewer]');
    await expect(viewer.locator('[data-media-viewer-content]')).toHaveCSS('opacity', '1');
    await expect(viewer.getByText('Loading preview…')).toHaveCount(0);
    const player = viewer.locator('video');
    await expect(player).toBeVisible();
    await expect(player).toHaveAttribute('controls', '');
    await expect
      .poll(() => player.evaluate((node: HTMLVideoElement) => node.readyState))
      .toBeGreaterThanOrEqual(2);
    await player.evaluate(async (node: HTMLVideoElement) => {
      node.currentTime = 0;
      await node.play();
    });
    await expect
      .poll(() => player.evaluate((node: HTMLVideoElement) => node.currentTime))
      .toBeGreaterThan(0);
    await expect.poll(() => player.evaluate((node: HTMLVideoElement) => node.videoWidth)).toBe(320);
    await viewer.getByRole('button', { name: 'Close media viewer' }).click();
    await expect(viewer).toBeHidden();
  }
  await playVideo(page);
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await signIn(second, email);
    await openNote(second, 'Video attachments');
    await expect(
      second.getByRole('region', { name: 'Media' }).getByRole('img', { name: 'clip.mp4' }),
    ).toBeVisible();
    await playVideo(second);
  } finally {
    await other.close();
  }
});

test('attachments preview, retain their catalog without blocks, and remove privately', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const email = await signUp(page);
  await createNote(page, 'Attachments');
  await openNote(page, 'Attachments');
  await upload(page);
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByTitle('pixel.png', { exact: true })).toBeVisible();
  await expect(page.locator('.note-editor [data-content-type="image"] img')).toBeVisible();
  await expect(media.getByText('Waiting to upload')).toBeHidden();
  const id = await media.locator('[data-attachment]').getAttribute('data-attachment');
  const headers = await page.evaluate(() => ({
    Authorization: `Bearer ${localStorage.getItem('catch-auth-token')}`,
  }));
  const url = `/api/attachments/${id}/content`;
  expect((await page.request.get(url, { headers: { Cookie: '' } })).status()).toBe(401);
  const response = await page.request.get(url, { headers });
  expect(response.status()).toBe(200);
  expect(await response.body()).toEqual(picture.buffer);
  const ranged = await page.request.get(url, { headers: { ...headers, Range: 'bytes=0-7' } });
  expect(ranged.status()).toBe(206);
  expect(await ranged.body()).toEqual(picture.buffer.subarray(0, 8));
  expect(
    (await page.request.get(url, { headers: { ...headers, Range: 'bytes=99999-' } })).status(),
  ).toBe(416);

  // Removing an inline placement leaves the independent catalog intact.
  await page.evaluate(async (attachmentId) => {
    const { editorControls } = await import('/src/lib/dockState.ts');
    editorControls.get().removeAttachment(attachmentId);
  }, id);
  await expect(page.locator('.note-editor [data-content-type="image"]')).toHaveCount(0);
  await expect(media.getByTitle('pixel.png', { exact: true })).toBeVisible();
  await page.waitForTimeout(700);
  await page.reload();
  await expect(media.getByTitle('pixel.png', { exact: true })).toBeVisible();

  const other = await browser.newContext();
  const second = await other.newPage();
  await signIn(second, email);
  await openNote(second, 'Attachments');
  await expect(second.getByRole('region', { name: 'Media' }).getByRole('img')).toBeVisible();

  await media.getByRole('button', { name: 'Manage pixel.png' }).click();
  await page.getByRole('menuitem', { name: 'Rename', exact: true }).click();
  await page.getByRole('textbox', { name: 'File name' }).fill('Renamed.png');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(media.getByTitle('Renamed.png', { exact: true })).toBeVisible();
  await media.getByRole('button', { name: 'Manage Renamed.png' }).click();
  await page.getByRole('menuitem', { name: 'Add to note' }).click();
  await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0);
  await expect(page.locator('.note-editor [data-content-type="image"]')).toHaveCount(1);
  await page.waitForTimeout(700);
  await second.reload();
  await expect(second.locator('.note-editor [data-content-type="image"]')).toHaveCount(1);
  await media.getByRole('button', { name: 'Manage Renamed.png' }).click();
  await page.getByRole('menuitem', { name: 'Remove attachment' }).click();
  await expect(media).toBeHidden();
  await expect(page.locator('.note-editor [data-content-type="image"]')).toHaveCount(0);
  await expect.poll(async () => (await page.request.get(url, { headers })).status()).toBe(404);
  await expect(second.getByRole('region', { name: 'Media' })).toBeHidden();
  await expect(second.locator('.note-editor [data-content-type="image"]')).toHaveCount(0);
  await other.close();
});

test('an offline attachment survives reload and uploads on reconnect', async ({ page }) => {
  await signUp(page);
  await createNote(page, 'Offline media');
  await openNote(page, 'Offline media');
  await page.waitForTimeout(1000);
  await page.route('**/api/**', (route) => route.abort());
  await upload(page);
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByRole('img')).toBeVisible();
  await expect(media.getByText('Waiting to upload')).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await openNote(page, 'Offline media');
  await expect(media.getByRole('img')).toBeVisible();
  await expect(page.locator('.note-editor [data-content-type="image"] img')).toBeVisible();
  await page.unroute('**/api/**');
  await page.reload();
  await expect(media.getByText('Waiting to upload')).toBeHidden({ timeout: 30000 });
  const id = await media.locator('[data-attachment]').getAttribute('data-attachment');
  const headers = await page.evaluate(() => ({
    Authorization: `Bearer ${localStorage.getItem('catch-auth-token')}`,
  }));
  await expect
    .poll(
      async () => (await page.request.get(`/api/attachments/${id}/content`, { headers })).status(),
      { timeout: 30000 },
    )
    .toBe(200);
});

test('the quick-note formatting attachment button expands the picker', async ({ page }) => {
  await signUp(page);
  await page.getByRole('button', { name: 'New note' }).click();
  await expect(page.locator('[contenteditable]')).toBeFocused();
  await page.keyboard.type('Quick attachment');
  await upload(page);
  await expect(page.locator('.note-editor [data-content-type="image"] img')).toBeVisible();
  await page.getByRole('button', { name: 'Close new note' }).click();
  await expect(card(page, 'Quick attachment')).toBeVisible();
  await openNote(page, 'Quick attachment');
  await expect(page.getByRole('region', { name: 'Media' }).getByRole('img')).toBeVisible();
});

test('copied notes keep independent attachments and files use download blocks', async ({
  page,
  browser,
  isMobile,
}) => {
  test.setTimeout(60000);
  await signUp(page);
  await createNote(page, 'Copy with files');
  await openNote(page, 'Copy with files');
  const file = {
    name: 'details.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Private attachment details'),
  };
  await upload(page, file);
  await expect(page.locator('.note-editor [data-content-type="file"]')).toHaveCount(1);
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByText('Waiting to upload')).toBeHidden();
  const originalId = await media.locator('[data-attachment]').getAttribute('data-attachment');
  const headers = await page.evaluate(() => ({
    Authorization: `Bearer ${localStorage.getItem('catch-auth-token')}`,
  }));
  const noteId = new URL(page.url()).searchParams.get('note');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const original = card(page, 'Copy with files');
  await waitForPageTransition(page);
  if (isMobile) {
    const box = await original.boundingBox();
    if (!box) throw new Error('Missing note layout');
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2, id: 1 }],
    });
    await page.waitForTimeout(400);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    const cell = page.locator('[data-note-cell]').filter({ has: original });
    await cell.hover();
    await cell.getByRole('button', { name: 'Select note' }).click();
  }
  await page
    .getByRole('toolbar', { name: 'Selected notes' })
    .getByRole('button', { name: 'Make a copy' })
    .click();
  await expect(card(page, 'Copy with files')).toHaveCount(2);
  await card(page, 'Copy with files').first().getByRole('button', { name: 'Open note' }).click();
  await expect(media.getByTitle('details.txt')).toBeVisible();
  await expect(media.getByText('Waiting to upload')).toBeHidden();
  const copyId = await media.locator('[data-attachment]').getAttribute('data-attachment');
  expect(copyId).not.toBe(originalId);
  const copyUrl = `/api/attachments/${copyId}/content`;
  await expect.poll(async () => (await page.request.get(copyUrl, { headers })).status()).toBe(200);
  const response = await page.request.get(copyUrl, { headers });
  expect(await response.body()).toEqual(file.buffer);
  expect(response.headers()['content-disposition']).toContain('attachment');
  expect(response.headers()['content-type']).toBe('application/octet-stream');

  const other = await browser.newContext();
  const stranger = await other.newPage();
  await signUp(stranger);
  const strangerHeaders = await stranger.evaluate(() => ({
    Authorization: `Bearer ${localStorage.getItem('catch-auth-token')}`,
  }));
  expect((await stranger.request.get(copyUrl, { headers: strangerHeaders })).status()).toBe(404);
  await stranger.request.patch(`/api/attachments/${copyId}`, {
    headers: strangerHeaders,
    data: { deletedAt: new Date().toISOString() },
  });
  expect((await page.request.get(copyUrl, { headers })).status()).toBe(200);
  await other.close();
  await page.request.delete(`/api/notes/${noteId}`, { headers });
  expect(
    (await page.request.get(`/api/attachments/${originalId}/content`, { headers })).status(),
  ).toBe(404);
  expect((await page.request.get(copyUrl, { headers })).status()).toBe(200);
});

test('archive moves to the header and the attachment dock has the requested order', async ({
  page,
}) => {
  await signUp(page);
  await createNote(page, 'Toolbar changes');
  const dialog = await openNote(page, 'Toolbar changes');
  const toolbar = page.getByRole('toolbar', { name: 'Note actions' });
  await expect(toolbar.getByRole('button')).toHaveCount(4);
  await expect(toolbar.getByRole('button').nth(1)).toHaveAccessibleName('Attach files');
  await expect(toolbar.getByRole('button').last()).toHaveAccessibleName('Pin');
  await dialog.getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(dialog).toBeHidden();
  await openGalleryPage(page, 'Archive');
  await openNote(page, 'Toolbar changes');
  await dialog.getByRole('button', { name: 'Unarchive', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
});

test.describe('live capture', () => {
  test.use({
    permissions: ['camera', 'microphone'],
  });

  test('camera photos, video, and audio recordings attach inline and in the catalog', async ({
    page,
  }) => {
    test.setTimeout(60000);
    await signUp(page);
    await createNote(page, 'Captured media');
    await openNote(page, 'Captured media');
    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await expect
      .poll(() =>
        page
          .locator('[aria-label="Camera"] video')
          .evaluate((element: HTMLVideoElement) => element.videoWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Take photo', exact: true }).click();
    await expect(page.locator('.note-editor [data-content-type="image"] img')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add attachment' })).toBeHidden();

    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await page.getByRole('button', { name: 'Record audio', exact: true }).click();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(
      page.getByRole('group', { name: 'Audio recorder' }).getByRole('status'),
    ).toContainText('0:01');
    await page.getByRole('button', { name: 'Save recording', exact: true }).click();
    await expect(page.locator('.note-editor [data-content-type="audio"] audio')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Add attachment' })).toBeHidden();

    await page.getByRole('button', { name: 'Attach files', exact: true }).click();
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Record', exact: true }).click();
    await expect(page.getByRole('group', { name: 'Camera' }).getByRole('status')).toContainText(
      '0:01',
    );
    await page.getByRole('button', { name: 'Save recording', exact: true }).click();
    await expect(page.locator('.note-editor [data-content-type="video"] video')).toBeVisible();
    const media = page.getByRole('region', { name: 'Media' });
    await expect(media.getByRole('listitem')).toHaveCount(3);
    await expect(media.getByText('Waiting to upload')).toHaveCount(0);
    // Upload completion does not mean the debounced note content has been saved.
    await expect(page.getByRole('dialog').getByText('Synced', { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await page.reload();
    await expect(page.locator('.note-editor [data-content-type="audio"] audio')).toBeVisible();
    await expect(page.locator('.note-editor [data-content-type="video"] video')).toBeVisible();
    await expect(media.getByRole('listitem')).toHaveCount(3);
  });
});

test('catalog actions insert at the cursor and toolbar uploads retain their captured position', async ({
  page,
}) => {
  test.setTimeout(60000);
  await signUp(page);
  await createNote(page, 'Insertion positions', 'First paragraph');
  await openNote(page, 'Insertion positions');
  await upload(page);
  const media = page.getByRole('region', { name: 'Media' });
  await expect(media.getByRole('img')).toBeVisible();
  const id = await media.locator('[data-attachment]').getAttribute('data-attachment');
  await page.evaluate(async (attachmentId) => {
    const { editorControls } = await import('/src/lib/dockState.ts');
    editorControls.get().removeAttachment(attachmentId);
  }, id);
  // Empty cursor block is replaced.
  await page.evaluate(async () => {
    const { editorControls } = await import('/src/lib/dockState.ts');
    editorControls.get().focusEnd();
  });
  await page.keyboard.press('Enter');
  const before = await page.evaluate(async () => {
    const { editorControls } = await import('/src/lib/dockState.ts');
    return editorControls.get().getContent().length;
  });
  await media.getByRole('button', { name: 'Manage pixel.png' }).click();
  await page.getByRole('menuitem', { name: 'Add to note' }).click();
  await expect(page.getByRole('menu', { includeHidden: true })).toHaveCount(0);
  const after = await page.evaluate(async () => {
    const { editorControls } = await import('/src/lib/dockState.ts');
    return editorControls.get().getContent().length;
  });
  expect(after).toBe(before + 1);
  await expect(page.locator('.note-editor [data-content-type="image"]')).toHaveCount(1);
  await media.getByRole('button', { name: 'Manage pixel.png' }).click();
  await expect(page.getByRole('menuitem', { name: 'Show in note' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(async (attachmentId) => {
    const { editorControls } = await import('/src/lib/dockState.ts');
    editorControls.get().removeAttachment(attachmentId);
  }, id);
  const paragraph = page
    .locator('.note-editor [data-content-type="paragraph"]')
    .filter({ hasText: 'First paragraph' });
  await paragraph.click();
  await page.keyboard.press('End');
  await media.getByRole('button', { name: 'Manage pixel.png' }).click();
  await page.getByRole('menuitem', { name: 'Add to note' }).click();
  const order = await page.locator('.note-editor [data-content-type]').evaluateAll((blocks) =>
    blocks.map((block) => ({
      type: block.getAttribute('data-content-type'),
      text: block.textContent,
    })),
  );
  const index = order.findIndex((block) => block.text?.includes('First paragraph'));
  expect(order[index + 1]?.type).toBe('image');

  // Close the picker while its selected file is being stored. The callback must still
  // insert into this editor, even though the picker component has unmounted.
  await paragraph.click();
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await page
    .getByRole('region', { name: 'Add attachment' })
    .getByRole('button', { name: 'Files', exact: true })
    .click();
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('[aria-label="Choose files"]');
    const toggle = document.querySelector<HTMLButtonElement>(
      '[data-note-toolbar] [aria-label="Attach files"]',
    );
    if (!input || !toggle) throw new Error('Missing attachment controls');
    const selected = new DataTransfer();
    selected.items.add(new File(['Toolbar file bytes'], 'toolbar.txt', { type: 'text/plain' }));
    input.files = selected.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    toggle.click();
  });
  await expect(media.getByTitle('toolbar.txt', { exact: true })).toBeVisible();
  await expect(page.locator('.note-editor [data-content-type="file"]')).toHaveCount(1);
  await media.getByRole('button', { name: 'View toolbar.txt' }).click();
  await expect(page.locator('[data-media-viewer]')).toContainText('Download this file to open it.');
  await page.getByRole('button', { name: 'Close media viewer' }).click();
  await expect(page.locator('[data-media-viewer]')).toBeHidden();
  await media.getByRole('button', { name: 'View pixel.png' }).click();
  await expect(page.locator('[data-media-viewer] img')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-media-viewer]')).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  const thumbnails = await media.locator('[data-media-thumbnail]').evaluateAll((buttons) =>
    buttons.map((button) => ({
      width: button.getBoundingClientRect().width,
      height: button.getBoundingClientRect().height,
    })),
  );
  expect(thumbnails).toEqual([
    { width: 64, height: 64 },
    { width: 64, height: 64 },
  ]);
});

test('media viewer fills the viewport and supports zoom, pan, pinch, navigation, and focus return', async ({
  page,
  isMobile,
}, testInfo) => {
  test.setTimeout(60000);
  await signUp(page);
  await createNote(page, 'Media stage');
  await openNote(page, 'Media stage');
  const raster = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Missing canvas context');
    context.fillStyle = '#62798b';
    context.fillRect(0, 0, 800, 600);
    context.fillStyle = '#efca80';
    context.fillRect(200, 100, 400, 400);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await upload(page, {
    name: 'landscape.png',
    mimeType: 'image/png',
    buffer: Buffer.from(raster, 'base64'),
  });
  await upload(page, { ...picture, name: 'second.png' });
  const media = page.getByRole('region', { name: 'Media', exact: true });
  const thumbnail = media.getByRole('button', { name: 'View landscape.png', exact: true });
  await expect(thumbnail).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await page.evaluate(() => {
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      const decoded = decode.call(this);
      return this.closest('[data-media-stage]')
        ? decoded.then(() => new Promise<void>((resolve) => setTimeout(resolve, 350)))
        : decoded;
    };
  });
  await media.getByRole('button', { name: 'Manage landscape.png' }).click();
  await expect(page.getByRole('menuitem', { name: 'Keep offline' })).toBeVisible();
  await expect(page.locator('[data-media-viewer]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  const row = await thumbnail.boundingBox();
  if (!row) throw new Error('Missing media row');
  expect(row.width).toBeGreaterThan(160);
  // Click the filename area, beyond the 64 px thumbnail and away from the menu.
  await thumbnail.click({ position: { x: row.width / 2, y: row.height / 2 } });
  const viewer = page.locator('[data-media-viewer]');
  const fadingContent = viewer.locator('[data-media-viewer-content]');
  await expect(viewer).toHaveAccessibleName('landscape.png');
  await expect(fadingContent).toHaveCSS('opacity', '0');
  await expect(viewer).toContainText('800 × 600');
  const entrance = await fadingContent.evaluate(async (node) => {
    const samples: number[] = [];
    const started = performance.now();
    while (performance.now() - started < 750) {
      const opacity = Number(getComputedStyle(node).opacity);
      samples.push(opacity);
      if (opacity === 1) break;
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  expect(entrance.some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
  await expect(fadingContent).toHaveCSS('opacity', '1');
  const frame = await viewer.boundingBox();
  const viewport = page.viewportSize();
  if (!frame || !viewport) throw new Error('Missing viewer bounds');
  expect(frame.x).toBe(0);
  expect(frame.y).toBe(0);
  expect(frame.width).toBeCloseTo(viewport.width, 0);
  expect(frame.height).toBeCloseTo(viewport.height, 0);
  const details = viewer.locator('[data-media-details]');
  if (viewport.width < 640) {
    const info = viewer.getByRole('button', { name: 'Attachment details', exact: true });
    const close = viewer.getByRole('button', { name: 'Close media viewer' });
    const next = viewer.getByRole('button', { name: 'Next attachment' });
    const nav = await next.locator('..').boundingBox();
    const closeBounds = await close.boundingBox();
    if (!nav || !closeBounds) throw new Error('Missing narrow viewer controls');
    expect(nav.x + nav.width / 2).toBeCloseTo(viewport.width / 2, 0);
    expect(closeBounds.y).toBeGreaterThan(viewport.height - 90);
    await expect(details).toHaveAttribute('inert', '');
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toHaveCSS('transform', 'none');
    const sheetBounds = await details.boundingBox();
    const zoomBounds = await viewer.getByRole('group', { name: 'Image controls' }).boundingBox();
    if (!sheetBounds || !zoomBounds) throw new Error('Missing sheet bounds');
    expect(sheetBounds.y + sheetBounds.height).toBeLessThan(zoomBounds.y);
    await page.screenshot({ path: testInfo.outputPath('media-viewer-details.png') });
    await info.click();
    await expect(details).toHaveAttribute('inert', '');

    // Real touch events verify continuous sheet movement without zooming or swapping media.
    const session = await page.context().newCDPSession(page);
    const infoBounds = await info.boundingBox();
    if (!infoBounds) throw new Error('Missing Info button');
    const start = {
      x: infoBounds.x + infoBounds.width / 2,
      y: infoBounds.y + infoBounds.height / 2,
    };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y - 80 }],
    });
    await expect(details).not.toHaveAttribute('inert', '');
    const partial = await details.boundingBox();
    if (!partial) throw new Error('Missing dragging sheet');
    expect(partial.y).toBeGreaterThan(sheetBounds.y + 20);
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: start.x, y: start.y - 240 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toHaveCSS('transform', 'none');
    const handle = await details
      .getByRole('button', { name: 'Hide attachment details' })
      .boundingBox();
    if (!handle) throw new Error('Missing details handle');
    const grip = { x: handle.x + handle.width / 2, y: handle.y + handle.height / 2 };
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [grip] });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: grip.x, y: grip.y + 220 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(details).toHaveAttribute('inert', '');
    await expect(viewer).toHaveAccessibleName('landscape.png');
    // The next tap must still work after a drag dismissal.
    await info.click();
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await details.getByRole('button', { name: 'Hide attachment details' }).click();
    await expect(details).toHaveAttribute('inert', '');
    await expect(info).toBeFocused();
    const imageStart = { x: viewport.width / 2, y: viewport.height / 2 };
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [imageStart],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: imageStart.x, y: imageStart.y - 80 }],
    });
    await expect(details).not.toHaveAttribute('inert', '');
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: imageStart.x, y: imageStart.y - 240 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await expect(details).toHaveCSS('transform', 'none');
    await expect(viewer).toHaveAccessibleName('landscape.png');
    await expect(viewer.getByRole('button', { name: 'Reset zoom' })).toHaveText('100%');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [imageStart],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: imageStart.x, y: imageStart.y + 80 }],
    });
    const pushed = await details.boundingBox();
    if (!pushed) throw new Error('Missing dragged details');
    expect(pushed.y).toBeGreaterThan(sheetBounds.y + 40);
    await expect(info).toHaveAttribute('aria-expanded', 'true');
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: imageStart.x, y: imageStart.y + 240 }],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(info).toHaveAttribute('aria-expanded', 'false');
    await expect(details).toHaveAttribute('inert', '');
    await expect(viewer).toHaveAccessibleName('landscape.png');
    await session.detach();
  } else {
    await expect(viewer.getByRole('button', { name: 'Keep offline' })).toBeVisible();
    await expect(
      viewer.getByRole('button', { name: 'Attachment details', exact: true }),
    ).toHaveCount(0);
  }
  const stage = viewer.locator('[data-media-stage]');
  const center = { x: viewport.width / 2, y: viewport.height / 2 };
  const zoom = viewer.getByRole('button', { name: 'Reset zoom' });
  const image = viewer.getByRole('img', { name: 'landscape.png' });
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -250);
  await expect
    .poll(async () => Number.parseInt((await zoom.textContent()) ?? '0', 10))
    .toBeGreaterThan(100);
  await page.mouse.down();
  await page.mouse.move(center.x + 70, center.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect
    .poll(() => image.evaluate((node) => node.style.transform))
    .not.toContain('translate(0px, 0px)');
  await page.keyboard.press('0');
  await expect(zoom).toHaveText('100%');
  if (isMobile) {
    const session = await page.context().newCDPSession(page);
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [
        { x: center.x - 40, y: center.y, id: 1 },
        { x: center.x + 40, y: center.y, id: 2 },
      ],
    });
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [
        { x: center.x - 80, y: center.y, id: 1 },
        { x: center.x + 80, y: center.y, id: 2 },
      ],
    });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect(zoom).toHaveText('200%');
    await expect(viewer).toHaveAccessibleName('landscape.png');
    await page.keyboard.press('0');
    await session.detach();
  }
  // Two taps zoom; a drag never acts as a tap or closes the viewer.
  await stage.dblclick({ position: center });
  await expect(zoom).toHaveText('250%');
  await zoom.click();
  await expect(zoom).toHaveText('100%');
  await viewer.getByRole('button', { name: 'Fill screen', exact: true }).click();
  await expect(
    viewer.getByRole('button', { name: 'Fit image to screen', exact: true }),
  ).toBeVisible();
  await viewer.getByRole('button', { name: 'Fit image to screen', exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('media-viewer.png') });
  await viewer.getByRole('button', { name: 'Next attachment', exact: true }).click();
  await expect(viewer).toHaveAccessibleName('second.png');
  await expect(zoom).toHaveText('100%');
  await page.keyboard.press('ArrowLeft');
  await expect(viewer).toHaveAccessibleName('landscape.png');
  // Swiping the fitted image navigates, while a zoomed drag pans.
  await page.mouse.move(center.x + 60, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x - 60, center.y, { steps: 5 });
  await page.mouse.up();
  await expect(viewer).toHaveAccessibleName('second.png');
  if (isMobile) {
    await page.setViewportSize({ width: 320, height: viewport.height });
    const info = await viewer
      .getByRole('button', { name: 'Attachment details', exact: true })
      .boundingBox();
    const close = await viewer.getByRole('button', { name: 'Close media viewer' }).boundingBox();
    const controls = await viewer.getByRole('group', { name: 'Image controls' }).boundingBox();
    if (!info || !close || !controls) throw new Error('Missing small-phone controls');
    expect(controls.x).toBeGreaterThan(info.x + info.width);
    expect(controls.x + controls.width).toBeLessThan(close.x);
    await page.screenshot({ path: testInfo.outputPath('media-viewer-small-phone.png') });
  }
  if (isMobile) await page.keyboard.press('Escape');
  else await stage.click({ button: 'right', position: center });
  const exitOpacity = await page.evaluate(async () => {
    const samples: number[] = [];
    const started = performance.now();
    while (performance.now() - started < 350) {
      const viewer = document.querySelector('[data-media-viewer-content]');
      if (!viewer) break;
      samples.push(Number(getComputedStyle(viewer).opacity));
      await new Promise(requestAnimationFrame);
    }
    return samples;
  });
  expect(exitOpacity.some((opacity) => opacity > 0 && opacity < 1)).toBe(true);
  await expect(viewer).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible();
  await expect(thumbnail).toBeFocused();
});

import { readFileSync } from 'node:fs';
