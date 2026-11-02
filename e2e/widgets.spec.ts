import { expect, type Page, test } from '@playwright/test';
import { card, caretToEnd, seedNotes, signUp } from './helpers';

// Exercise the real routing, editor, autosave and outbox with the native bridge boundary mocked.
async function widgetBridge(page: Page) {
  await page.route(/\/src\/lib\/nativeWidgets\.ts(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
        // A cold tap belongs to the next launch, like the one Android retains for a new process.
        const cold = sessionStorage.getItem('widget-test-cold-launch');
        if (cold) {
          sessionStorage.setItem('widget-test-launch', cold);
          sessionStorage.removeItem('widget-test-cold-launch');
        }
        const read = () => JSON.parse(sessionStorage.getItem('widget-test-launch') || 'null');
        export const nativeWidgets = {
          available: true,
          clear: async () => {},
          pending: async () => read(),
          acknowledge: async id => {
            if (read()?.id === id) sessionStorage.removeItem('widget-test-launch');
          },
          watchLaunch(listener) {
            let stopped = false;
            const deliver = () => { const launch = read(); if (!stopped && launch) listener(launch); };
            window.addEventListener('widget-test-tap', deliver);
            // A real bridge reply can arrive after the first page has painted.
            const initial = setTimeout(deliver, 250);
            return () => { stopped = true; clearTimeout(initial); window.removeEventListener('widget-test-tap', deliver); };
          }
        };
        export function watchNativeWidgets() { return () => {}; }
      `,
    }),
  );
}

async function stageTap(
  page: Page,
  action: 'note' | 'compose' | 'search',
  noteId?: string,
  deliver = true,
  deliveries = 1,
) {
  await page.evaluate(
    async ({ action, noteId, deliver, deliveries }) => {
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const { getServerUrl } = await import('/src/lib/serverUrl.ts');
      // Staged for the next page load, the tap must not reach this page's pending initial delivery.
      sessionStorage.setItem(
        deliver ? 'widget-test-launch' : 'widget-test-cold-launch',
        JSON.stringify({
          id: crypto.randomUUID(),
          account: getSignedInUser().id,
          server: getServerUrl(),
          action,
          noteId,
        }),
      );
      if (deliver) {
        for (let i = 0; i < deliveries; i++) window.dispatchEvent(new Event('widget-test-tap'));
      }
    },
    { action, noteId, deliver, deliveries },
  );
}

async function noteId(page: Page, title: string) {
  const id = await card(page, title).getAttribute('data-note-card');
  expect(id).toBeTruthy();
  return id as string;
}

async function stored(page: Page) {
  await page.evaluate(async () => {
    const { waitForPendingWritesStored } = await import('/src/lib/collections.ts');
    await waitForPendingWritesStored();
  });
}

type StartupFrames = {
  count: number;
  browsing: number[];
  sawNote: boolean;
  running: boolean;
  captured: boolean;
};

async function recordStartupFrames(page: Page, screenshotPath: string) {
  let capture: (image: Buffer) => void = () => {};
  let fail: (error: unknown) => void = () => {};
  const firstFrame = new Promise<Buffer>((resolve, reject) => {
    capture = resolve;
    fail = reject;
  });
  await page.exposeBinding('captureWidgetStartup', async () => {
    try {
      capture(await page.screenshot({ path: screenshotPath }));
    } catch (error) {
      fail(error);
    }
  });
  await page.addInitScript(() => {
    const frames: StartupFrames = {
      count: 0,
      browsing: [],
      sawNote: false,
      running: true,
      captured: false,
    };
    (window as Window & { widgetStartupFrames: StartupFrames }).widgetStartupFrames = frames;
    const visible = (element: Element) => {
      const box = element.getBoundingClientRect();
      if (
        !box.width ||
        !box.height ||
        box.right <= 0 ||
        box.bottom <= 0 ||
        box.left >= innerWidth ||
        box.top >= innerHeight
      )
        return false;
      if (getComputedStyle(element).visibility === 'hidden') return false;
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        if (style.display === 'none' || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const sample = () => {
      if (!frames.running) return;
      frames.count++;
      const browsing = [...document.querySelectorAll('h1')].some(
        (heading) => /^(Gallery|Deck)$/.test(heading.textContent ?? '') && visible(heading),
      );
      const note = document.querySelector('[role="dialog"][data-note-color]');
      const noteVisible = Boolean(note && visible(note));
      // A wide-screen pane may show the browsing page beside the note once it is open.
      if (browsing && !noteVisible && !frames.sawNote) frames.browsing.push(frames.count);
      if (noteVisible) frames.sawNote = true;
      const opening = [...document.querySelectorAll('[role="status"]')].some(
        (status) => status.textContent === 'Opening note…' && visible(status),
      );
      if (!frames.captured && (browsing || noteVisible || opening)) {
        frames.captured = true;
        void (
          window as Window & { captureWidgetStartup: () => Promise<void> }
        ).captureWidgetStartup();
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
  return { firstFrame };
}

test('cold widget taps do not paint the browsing page before the note', async ({ page }, info) => {
  await widgetBridge(page);
  await signUp(page);
  await seedNotes(page, ['Direct widget note']);
  const id = await noteId(page, 'Direct widget note');
  await stageTap(page, 'note', id, false);
  const { firstFrame } = await recordStartupFrames(page, info.outputPath('widget-first-frame.png'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await info.attach('direct-widget-first-frame', {
    body: await firstFrame,
    contentType: 'image/png',
  });
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toContainText('Direct widget note');
  await expect(editor.getByRole('textbox')).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as Window & { widgetStartupFrames: StartupFrames }).widgetStartupFrames.sawNote,
      ),
    )
    .toBe(true);
  const frames = await page.evaluate(() => {
    const frames = (window as Window & { widgetStartupFrames: StartupFrames }).widgetStartupFrames;
    frames.running = false;
    return frames;
  });
  expect(frames.count).toBeGreaterThan(0);
  expect(frames.browsing, 'Gallery/Deck must not appear before the first note frame').toEqual([]);
  await expect(page).toHaveURL(new RegExp(`note=${id}`));

  await info.attach('direct-widget-editor', {
    body: await page.screenshot({ path: info.outputPath('widget-editor.png') }),
    contentType: 'image/png',
  });
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
});

test('a widget replaces an edited note and retains its last keystrokes', async ({ page }) => {
  await widgetBridge(page);
  await signUp(page);
  await seedNotes(page, ['First widget note', 'Second widget note']);
  const second = await noteId(page, 'Second widget note');
  await card(page, 'First widget note').click();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  const text = editor.getByRole('textbox');
  await expect(text).toBeVisible();
  await caretToEnd(text.locator('h3'));
  await page.keyboard.type(' with unsaved changes');
  await stageTap(page, 'note', second);
  await expect(editor.filter({ hasText: 'Second widget note' })).toBeVisible();
  await expect(editor).toHaveCount(1);
  await expect(page.getByText('Close the open note to use this widget.')).toHaveCount(0);
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(editor).toBeHidden();
  await stored(page);
  await page.reload();
  await expect(card(page, 'First widget note with unsaved changes')).toBeVisible();
});

test('a widget saves the composer and capture can replace an open note', async ({ page }) => {
  await widgetBridge(page);
  await signUp(page);
  await seedNotes(page, ['Destination widget note']);
  const id = await noteId(page, 'Destination widget note');
  await page.getByRole('button', { name: 'New note', exact: true }).click();
  const popup = page.getByRole('region', { name: 'New note', exact: true });
  await expect(popup.getByRole('textbox')).toBeFocused();
  await page.keyboard.type('Draft saved by widget');
  await stageTap(page, 'note', id);
  await expect(popup).toBeHidden();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toContainText('Destination widget note');
  await stageTap(page, 'compose');
  await expect(editor).toBeHidden();
  await expect(popup.getByRole('textbox')).toBeFocused();
  await expect(popup.getByRole('textbox')).toHaveText('');
  await page.keyboard.press('Escape');
  await expect(popup).toBeHidden();
  await stored(page);
  await page.reload();
  await expect(card(page, 'Draft saved by widget')).toBeVisible();
});

for (const source of ['card', 'widget', 'card with a restored caret'] as const) {
  test(`widget search saves and leaves a note opened from a ${source}`, async ({ page }, info) => {
    await widgetBridge(page);
    await signUp(page);
    await seedNotes(page, ['Search handoff note']);
    const id = await noteId(page, 'Search handoff note');
    if (source !== 'widget') {
      await card(page, 'Search handoff note').click();
    } else {
      await stageTap(page, 'note', id, false);
      await page.reload();
    }
    const editor = page.getByRole('dialog', { name: 'Edit note' });
    await expect(editor.getByRole('textbox')).toBeVisible();
    if (source === 'card with a restored caret') {
      await editor.getByRole('textbox').evaluate((element) => {
        // Reproduce the focus selection restore undoing the first End, without a timer race.
        const restore = (event: Event) => {
          if (!(event instanceof KeyboardEvent) || event.key !== 'End') return;
          element.removeEventListener('keyup', restore);
          const text = element.querySelector('.bn-inline-content')?.firstChild;
          if (!text) throw new Error('Missing note text');
          window.getSelection()?.collapse(text, 'Search handoff n'.length);
          document.dispatchEvent(new Event('selectionchange'));
        };
        element.addEventListener('keyup', restore);
      });
    }
    await caretToEnd(editor.getByRole('textbox').locator('h3'));
    await page.keyboard.type(' saved before search');
    if (source !== 'widget') {
      await page.evaluate(() => {
        // Native WebViews can deliver the Back traversal after another bridge reply.
        const back = history.back.bind(history);
        history.back = () => setTimeout(back, 200);
      });
    }
    // Android reads the retained tap from both the launch event and app resume.
    await stageTap(page, 'search', undefined, true, 2);
    await expect(page).toHaveURL(/\/search$/);
    await expect(editor).toBeHidden();
    const search = page.getByRole('textbox', { name: 'Search notes', exact: true });
    await expect(search).toBeFocused();
    await search.fill('saved before search');
    await expect(
      page.getByText('Search handoff note saved before search', { exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/search$/);
    await info.attach('widget-search-handoff', {
      body: await page.screenshot({ path: info.outputPath('widget-search.png') }),
      contentType: 'image/png',
    });
    await stored(page);
    await page.reload();
    await expect(search).toBeVisible();
    await search.fill('saved before search');
    await expect(
      page.getByText('Search handoff note saved before search', { exact: true }),
    ).toBeVisible();
  });
}

for (const action of ['compose', 'search'] as const) {
  test(`a cold widget ${action} launch focuses its mounted input`, async ({ page }) => {
    await widgetBridge(page);
    await signUp(page);
    await stageTap(page, action, undefined, false);
    await page.reload();
    const input =
      action === 'compose'
        ? page.getByRole('region', { name: 'New note', exact: true }).getByRole('textbox')
        : page.getByRole('textbox', { name: 'Search notes', exact: true });
    await expect(input).toBeFocused();
    await page.keyboard.type('Cold widget keyboard');
    if (action === 'compose') await expect(input).toHaveText('Cold widget keyboard');
    else await expect(input).toHaveValue('Cold widget keyboard');
    await page.keyboard.press('Escape');
    await expect(input).toBeHidden();
    await page.evaluate(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
    });
    // A completed request must not refocus a field or reopen the keyboard later.
    await expect
      .poll(() => page.evaluate(() => document.activeElement === document.body))
      .toBe(true);
  });
}

test('widget images encode bounded attachment and link thumbnails and work from offline files', async ({
  page,
  context,
}) => {
  await signUp(page);
  const asset = 'a'.repeat(64);
  // Use this app's endpoint, never contact a third-party site in a widget test.
  await page.route(`**/api/link-previews/assets/${asset}`, async (route) => {
    const bytes = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 900;
      canvas.height = 600;
      const paint = canvas.getContext('2d');
      if (!paint) throw new Error('Missing canvas');
      paint.fillStyle = '#76b5da';
      paint.fillRect(0, 0, 900, 600);
      return canvas.toDataURL('image/png').split(',')[1];
    });
    await route.fulfill({ contentType: 'image/png', body: Buffer.from(bytes, 'base64') });
  });
  const attachment = '0198f3a0-0000-7000-8000-000000000099';
  await page.evaluate(async (id) => {
    const { storeAttachmentBlob } = await import('/src/lib/attachmentFiles.ts');
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 800;
    const paint = canvas.getContext('2d');
    if (!paint) throw new Error('Missing canvas');
    paint.fillStyle = '#59966b';
    paint.fillRect(0, 0, 1200, 800);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (image) => (image ? resolve(image) : reject(new Error('Missing image'))),
        'image/png',
      ),
    );
    await storeAttachmentBlob(id, blob, false, true);
  }, attachment);
  const encode = async (kind: 'attachment' | 'link', id: string) =>
    page.evaluate(
      async ({ kind, id }) => {
        const { widgetImagePublisher } = await import('/src/lib/widgetImages.ts');
        return new Promise<{
          width: number;
          height: number;
          length: number;
          key: string | undefined;
        }>((resolve, reject) => {
          const timeout = setTimeout(() => {
            images.stop();
            reject(new Error('Widget image timed out'));
          }, 10000);
          const images = widgetImagePublisher((snapshot) => {
            const note = snapshot.notes[0];
            if (!note?.image) return;
            const picture = new Image();
            picture.onload = () => {
              clearTimeout(timeout);
              images.stop();
              resolve({
                width: picture.naturalWidth,
                height: picture.naturalHeight,
                length: note.image?.length ?? 0,
                key: note.imageKey,
              });
            };
            picture.src = `data:image/jpeg;base64,${note.image}`;
          });
          images.update(
            {
              version: 1,
              notes: [
                {
                  id: 'note',
                  title: 'Image note',
                  body: '',
                  color: 'default',
                  pinned: false,
                  column: null,
                  tags: [],
                },
              ],
              tags: [],
              columns: [],
            },
            new Map([['note', { kind, id }]]),
          );
        });
      },
      { kind, id },
    );
  const linked = await encode('link', asset);
  expect(linked).toMatchObject({ width: 320, height: 213, key: `link:${asset}` });
  expect(linked.length).toBeLessThanOrEqual(64000);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible();
  await context.setOffline(true);
  try {
    const cached = await encode('attachment', attachment);
    expect(cached).toMatchObject({ width: 320, height: 213, key: `attachment:${attachment}` });
    expect(cached.length).toBeLessThanOrEqual(64000);
  } finally {
    await context.setOffline(false);
  }
});
