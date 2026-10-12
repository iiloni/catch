import { expect, type Page, test } from '@playwright/test';
import { signUp } from './helpers';

async function stageShare(page: Page, files = false) {
  return page.evaluate(async (files) => {
    const modulePath = '/src/lib/shareInbox.ts';
    const inbox: { captureWebShare: (form: FormData) => Promise<string> } = await import(
      modulePath
    );
    const form = new FormData();
    form.set('title', 'Shared trip');
    form.set('text', files ? 'Pack light\nhttps://example.com/trip' : 'Pack light');
    if (files) {
      form.append('files', new File(['tickets'], 'tickets.txt', { type: 'text/plain' }));
      form.append('files', new File(['map'], 'map.txt', { type: 'text/plain' }));
    }
    return inbox.captureWebShare(form);
  }, files);
}

test('shared text and multiple files become one note, with no duplicate after reload', async ({
  page,
}) => {
  // Three full Vite loads, the lazy editor, and an autosave share this test's budget.
  test.setTimeout(60_000);
  await signUp(page);
  const id = await stageShare(page, true);
  await page.goto(`/share?id=${id}`);
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByRole('textbox')).toContainText('Shared trip');
  await expect(editor.getByRole('textbox')).toContainText('Pack light');
  await expect(
    editor.getByRole('link', { name: 'https://example.com/trip', exact: true }),
  ).toBeVisible();
  await expect(editor.getByText('tickets.txt', { exact: true })).toBeVisible();
  await expect(editor.getByText('map.txt', { exact: true })).toBeVisible();
  const saved = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${id}`) && response.request().method() === 'PATCH',
  );
  await editor.getByRole('textbox').focus();
  await expect(editor.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Edited after sharing');
  await saved;
  await page.goto(`/share?id=${id}`);
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByRole('textbox')).toContainText('Edited after sharing');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('a share survives signup and its full reload', async ({ page }) => {
  await page.goto('/login');
  // Firefox reports a navigation that interrupts the sign-in page's own loading as failed.
  await expect(page.getByLabel('Email')).toBeVisible();
  const id = await stageShare(page);
  await page.goto(`/share?id=${id}`);
  await expect(page).toHaveURL(/\/login\?redirect=.*share/);
  await page.getByRole('button', { name: 'Need an account? Sign up' }).click();
  await page.getByLabel('Email').fill(`share-${Date.now()}-${Math.random()}@example.com`);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('textbox')).toContainText('Shared trip');
});

test('an offline share is queued locally and survives reload', async ({ page }) => {
  await signUp(page);
  // Development has no service worker: block the API while keeping Vite code reachable.
  await page.route('**/api/**', (route) => route.abort());
  const id = await stageShare(page, true);
  await page.goto(`/share?id=${id}`);
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByRole('textbox')).toContainText('Shared trip');
  await page.reload();
  await expect(editor).toBeVisible({ timeout: 15_000 });
  await expect(editor.getByRole('textbox')).toContainText('Pack light');
  await expect(editor.getByText('tickets.txt', { exact: true })).toBeVisible();
});

test.describe('production PWA share target', () => {
  test.use({ baseURL: process.env.E2E_PWA_BASE_URL });
  test.skip(
    !process.env.E2E_PWA_BASE_URL,
    'Set E2E_PWA_BASE_URL to a production preview with an API proxy.',
  );

  test('receives a multipart POST offline through the real service worker', async ({
    page,
    context,
  }) => {
    await signUp(page);
    await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
      // Warm the editor, which is precached but still must finish initializing on a first visit.
      const button = [...document.querySelectorAll('button')].find(
        (button) => button.getAttribute('aria-label') === 'New note',
      );
      button?.click();
    });
    await expect(
      page.getByRole('region', { name: 'New note', exact: true }).getByRole('textbox'),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Close new note' }).click();
    await context.setOffline(true);
    // Submitting a form navigation matches the browser's share_target delivery.
    await page.evaluate(() => {
      const form = document.createElement('form');
      form.action = '/share';
      form.method = 'POST';
      form.enctype = 'multipart/form-data';
      for (const [name, value] of [
        ['title', 'Offline PWA share'],
        ['text', 'Saved from another app'],
      ]) {
        const input = document.createElement('input');
        input.name = name;
        input.value = value;
        form.append(input);
      }
      const files = document.createElement('input');
      files.name = 'files';
      files.type = 'file';
      files.multiple = true;
      const transfer = new DataTransfer();
      transfer.items.add(new File(['first'], 'first.txt', { type: 'text/plain' }));
      transfer.items.add(new File(['second'], 'second.txt', { type: 'text/plain' }));
      files.files = transfer.files;
      form.append(files);
      document.body.append(form);
      form.submit();
    });
    const editor = page.getByRole('dialog', { name: 'Edit note' });
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor.getByRole('textbox')).toContainText('Offline PWA share');
    await expect(editor.getByText('first.txt', { exact: true })).toBeVisible();
    await expect(editor.getByText('second.txt', { exact: true })).toBeVisible();
    await page.reload();
    await expect(editor.getByRole('textbox')).toContainText('Saved from another app');
    await context.setOffline(false);
    await expect(editor.getByRole('status').filter({ hasText: 'Synced' }).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});
