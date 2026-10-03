import { expect, type Page, test } from '@playwright/test';
import { card, openNote, seedNotes, signUp } from './helpers';

const metadata = {
  title: 'Fetched page title',
  description: 'Context from the shared page.',
  siteName: 'Example',
  imageHash: null,
  imageWidth: null,
  imageHeight: null,
  iconHash: null,
  hue: null,
};

async function stageLink(
  page: Page,
  url = 'https://example.com/article#reading',
  explicit = false,
) {
  return page.evaluate(
    async ({ url, explicit }) => {
      const modulePath = '/src/lib/shareInbox.ts';
      const inbox: { captureWebShare: (form: FormData) => Promise<string> } = await import(
        modulePath
      );
      const form = new FormData();
      form.set('title', 'Shared page title');
      form.set(explicit ? 'url' : 'text', url);
      if (explicit) form.set('text', 'Selected passage');
      return inbox.captureWebShare(form);
    },
    { url, explicit },
  );
}

test('an Android-style link share fetches details, waits for Save and reopens the same edited note', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await signUp(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ json: metadata }));
  const id = await stageLink(page);
  await page.goto(`/share?id=${id}`);
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue(
    'https://example.com/article#reading',
  );
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(metadata.title);
  await expect(page.getByLabel('Description')).toHaveValue(metadata.description);
  await expect(page.getByRole('dialog', { name: 'Edit note' })).toBeHidden();
  await page.getByLabel('Title', { exact: true }).fill('My shared link');
  await page.getByLabel('Your notes').fill('Keep for the weekend.');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`note=${id}`));
  await expect(editor.getByRole('textbox')).toContainText('My shared link');
  await expect(editor.getByRole('textbox')).toContainText('Keep for the weekend.');
  const patched = page.waitForResponse(
    (response) =>
      response.url().includes(`/api/notes/${id}`) && response.request().method() === 'PATCH',
  );
  await editor.getByRole('textbox').focus();
  await expect(editor.getByRole('textbox')).toBeFocused();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Edited after capture');
  await patched;
  await page.goto(`/share?id=${id}`);
  await expect(editor).toBeVisible();
  await expect(editor.getByRole('textbox')).toContainText('Edited after capture');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('article')).toHaveCount(1);
});

test('pending native link shares recover in order and cancelled shares stay cancelled', async ({
  page,
}) => {
  await signUp(page);
  await seedNotes(page, ['Existing note']);
  await openNote(page, 'Existing note');
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ json: metadata }));
  const first = await stageLink(page, 'https://example.com/first');
  const second = await stageLink(page, 'https://example.com/second');
  // This is also how a native receipt resumes after acknowledgement and WebView recreation.
  await page.reload();
  const capture = page.getByRole('dialog', { name: 'Add Rich Link', exact: true });
  await expect(capture.getByLabel('URL', { exact: true })).toHaveValue('https://example.com/first');
  await capture.getByLabel('Your notes').fill('Unsaved capture thoughts');
  await expect(page).toHaveURL(/note=/);
  await capture.getByLabel('URL', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(capture.getByLabel('URL', { exact: true })).toHaveValue(
    'https://example.com/second',
  );
  await expect(capture.getByLabel('Title', { exact: true })).toHaveValue(metadata.title);
  await capture.getByLabel('Title', { exact: true }).fill('Second shared link');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  await expect(capture).toBeHidden();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor.getByRole('textbox')).toContainText('Existing note');
  await editor.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(card(page, 'Second shared link')).toBeVisible();
  await page.goto(`/share?id=${first}`);
  await expect(capture).toBeHidden();
  await expect(page.getByRole('article')).toHaveCount(2);
  await page.goto(`/share?id=${second}`);
  await expect(page.getByRole('dialog', { name: 'Edit note' }).getByRole('textbox')).toContainText(
    'Second shared link',
  );
});

test('a PWA link share survives login and can be cancelled without saving', async ({
  page,
  context,
}) => {
  const email = await signUp(page);
  await page.route('**/api/link-previews/intake', (route) => route.fulfill({ json: metadata }));
  const id = await stageLink(page, 'https://example.com/selected', true);
  await page.evaluate(() => {
    localStorage.removeItem('catch-auth-token');
    localStorage.removeItem('catch-user');
  });
  await context.clearCookies();
  await page.goto(`/share?id=${id}`);
  await expect(page).toHaveURL(/\/login\?redirect=.*share/);
  await page.reload();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByLabel('URL', { exact: true })).toHaveValue('https://example.com/selected');
  await expect(page.getByLabel('Your notes')).toHaveValue('Selected passage');
  await page.getByLabel('URL', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Close link capture', exact: true }).click();
  await expect(page.getByText('Catch your first note', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Catch your first note', { exact: true })).toBeVisible();
});

test('a link share saves offline even when details cannot be fetched', async ({
  page,
  isMobile,
}) => {
  test.skip(
    isMobile,
    'Persistence does not depend on layout; capture, recovery and login run on both.',
  );
  await signUp(page);
  const id = await stageLink(page);
  await page.route('**/api/**', (route) => route.abort());
  await page.goto(`/share?id=${id}`);
  await expect(page.getByText(/Could not fetch details/)).toBeVisible();
  await page.getByLabel('Your notes').fill('Offline context');
  await page.getByRole('button', { name: 'Save link', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Edit note' });
  await expect(editor.getByRole('textbox')).toContainText('Offline context');
  await page.reload();
  await expect(editor.getByRole('textbox')).toContainText('Offline context');
  await expect(page).toHaveURL(new RegExp(`note=${id}`));
});
