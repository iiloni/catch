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
            queueMicrotask(deliver);
            return () => { stopped = true; window.removeEventListener('widget-test-tap', deliver); };
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

test('cold widget taps open directly without painting the browsing page', async ({
  page,
}, info) => {
  await widgetBridge(page);
  await signUp(page);
  await seedNotes(page, ['Direct widget note']);
  const id = await noteId(page, 'Direct widget note');
  await stageTap(page, 'note', id, false);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`note=${id}`));
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeHidden();
  await info.attach('direct-widget-first-frame', {
    body: await page.screenshot({ path: info.outputPath('widget-first-frame.png') }),
    contentType: 'image/png',
  });
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toContainText('Direct widget note');
  await expect(editor.getByRole('textbox')).toBeVisible();
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
