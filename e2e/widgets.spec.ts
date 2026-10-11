import { expect, type Page, test } from '@playwright/test';
import { card, seedNotes, signUp } from './helpers';

// Exercise the real routing, editor, autosave and outbox with the native bridge boundary mocked.
async function widgetBridge(page: Page) {
  await page.route(/\/src\/lib\/nativeWidgets\.ts(?:\?|$)/, (route) =>
    route.fulfill({
      contentType: 'text/javascript',
      body: `
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

async function stageTap(page: Page, action: 'note' | 'compose', noteId?: string, deliver = true) {
  await page.evaluate(
    async ({ action, noteId, deliver }) => {
      const { getSignedInUser } = await import('/src/lib/auth.ts');
      const { getServerUrl } = await import('/src/lib/serverUrl.ts');
      sessionStorage.setItem(
        'widget-test-launch',
        JSON.stringify({
          id: crypto.randomUUID(),
          account: getSignedInUser().id,
          server: getServerUrl(),
          action,
          noteId,
        }),
      );
      if (deliver) window.dispatchEvent(new Event('widget-test-tap'));
    },
    { action, noteId, deliver },
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
  await text.click();
  await page.keyboard.press('ControlOrMeta+End');
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
