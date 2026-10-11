import { expect, test } from '@playwright/test';
import { aiConfigurationSchema } from '../packages/shared/src/ai';
import { fakeEmbeddingProvider } from './fixtures/embeddingProvider';
import { bearerToken, seedNotes, signUp } from './helpers';

// Uses a real provider through Docker's host gateway; search and indexing hit the real API.
let fake: Awaited<ReturnType<typeof fakeEmbeddingProvider>>;
let token: string;
test.beforeAll(async ({ request }) => {
  fake = await fakeEmbeddingProvider('0.0.0.0');
  const auth = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost' },
    data: { email: 'admin@example.com', password: 'adminadmin' },
  });
  token = bearerToken(auth);
  const headers = { Authorization: `Bearer ${token}` };
  const saved = aiConfigurationSchema.parse(
    await (await request.get('/api/admin/ai', { headers })).json(),
  );
  const response = await request.put('/api/admin/ai', {
    headers,
    data: {
      enabled: true,
      revision: saved.revision,
      embedding: {
        provider: 'compatible',
        baseUrl: `http://host.docker.internal:${fake.port}/v1`,
        model: 'fake-embedding',
        profile: 'plain',
      },
      apiKey: null,
    },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
});
test.afterAll(async ({ request }) => {
  const headers = { Authorization: `Bearer ${token}` };
  const saved = aiConfigurationSchema.parse(
    await (await request.get('/api/admin/ai', { headers })).json(),
  );
  await request.put('/api/admin/ai', {
    headers,
    data: { enabled: false, revision: saved.revision, embedding: saved.embedding },
  });
  await fake.close();
});

test('semantic search starts off, finds related notes and preserves keyword fallback and pending edits', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signUp(page);
  await seedNotes(page, ['Bicycle ride', 'Milk shopping']);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  const semantic = page.getByRole('switch', { name: 'Semantic search', exact: true });
  await expect(semantic).toBeEnabled();
  await expect(semantic).not.toBeChecked();
  const field = page.getByRole('textbox', { name: 'Search notes' });
  await field.fill('cycling');
  await expect(page.getByText('No matching notes', { exact: true })).toBeVisible();
  await semantic.focus();
  await semantic.press('Space');
  // The worker runs independently of a user's toggle; wait for the durable background index.
  await expect
    .poll(
      async () => {
        const response = await page.request.get('/api/admin/ai', {
          headers: { Authorization: `Bearer ${token}` },
        });
        const progress = aiConfigurationSchema.parse(await response.json()).progress;
        return progress.ready === progress.total;
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  await expect(page.getByRole('article').filter({ hasText: 'Bicycle ride' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByText('Related meaning', { exact: true }).first()).toBeVisible();
  await page.route('**/api/search', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Provider unavailable' }),
    }),
  );
  await field.fill('Milk');
  await expect(page.getByRole('article').filter({ hasText: 'Milk shopping' })).toBeVisible();
  await expect(
    page.getByRole('status').filter({ hasText: 'Showing keyword results' }),
  ).toBeVisible();
  await page.unroute('**/api/search');
  await page.route('**/api/notes/**', (route) => route.abort());
  await page.evaluate(async () => {
    const { noteStore } = await import('/src/lib/noteStore.ts');
    const { notesCollection } = await import('/src/lib/collections.ts');
    const { write } = await import('/src/lib/collections.ts');
    const note = [...notesCollection.values()].find((n) =>
      JSON.stringify(n.content).includes('Milk shopping'),
    )!;
    write(() => {
      noteStore.update(note.id, (draft) => {
        draft.content = [{ type: 'paragraph', content: 'Pending cycling groceries' }];
        draft.updatedAt = new Date();
      });
    });
  });
  await field.fill('cycling');
  await expect(
    page.getByRole('article').filter({ hasText: 'Pending cycling groceries' }),
  ).toBeVisible();
  await page.context().setOffline(true);
  await field.fill('groceries');
  await expect(
    page.getByRole('article').filter({ hasText: 'Pending cycling groceries' }),
  ).toBeVisible();
  await page.context().setOffline(false);
});

test('an older server hides semantic mode, and vault queries issue no search requests', async ({
  page,
}) => {
  await page.route('**/api/search/capabilities', (route) =>
    route.fulfill({ status: 404, body: 'missing' }),
  );
  await signUp(page);
  await seedNotes(page, ['Local keyword note']);
  await page.getByRole('link', { name: 'Search', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Semantic search', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search notes' }).fill('keyword');
  await expect(page.getByRole('article').filter({ hasText: 'Local keyword note' })).toBeVisible();
  await page.unroute('**/api/search/capabilities');
  let searchRequests = 0;
  page.on('request', (request) => {
    if (/\/api\/search(?:\/capabilities)?$/.test(new URL(request.url()).pathname)) searchRequests++;
  });
  await page.evaluate(async () => {
    const { createVault, vaultMode } = await import('/src/lib/vault.ts');
    await createVault('a vault password', false);
    vaultMode.set(true);
  });
  await expect(page.getByRole('heading', { name: 'Search the vault' })).toBeVisible();
  const before = searchRequests;
  await page.getByRole('textbox', { name: 'Search notes' }).fill('private vault query');
  await expect(page.getByRole('switch', { name: 'Semantic search', exact: true })).toHaveCount(0);
  // Negative privacy assertion: wait beyond the semantic request debounce.
  await page.waitForTimeout(700);
  expect(searchRequests).toBe(before);
  expect(fake.calls.flatMap((call) => call.input).join(' ')).not.toContain('private vault query');
});

test('admin discovers and tests embedding models, saves, and refuses a concurrent configuration edit', async ({
  page,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gallery', exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await page.goto('/settings/admin/ai');
  const model = page.getByRole('textbox', { name: 'Embedding model', exact: true });
  await expect(model).toHaveValue('fake-embedding');
  await page.getByRole('button', { name: 'Discover models' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Found 2 models' })).toBeVisible();
  await page.getByRole('button', { name: 'Choose discovered model' }).click();
  await page.getByRole('combobox', { name: 'Search models' }).fill('chat');
  await page.getByRole('option', { name: 'chat-only', exact: true }).click();
  await page.getByRole('button', { name: 'Test embedding' }).click();
  await expect(page.getByRole('alert')).toContainText('HTTP 400');
  await model.fill('fake-embedding');
  await page.getByRole('button', { name: 'Test embedding' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Embedding verified: 3 dimensions' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'AI configuration saved' }),
  ).toBeVisible();
  await page.screenshot({ path: test.info().outputPath('ai-configuration.png'), fullPage: true });
  const headers = { Authorization: `Bearer ${token}` };
  const saved = aiConfigurationSchema.parse(
    await (await page.request.get('/api/admin/ai', { headers })).json(),
  );
  const edit = await page.request.put('/api/admin/ai', {
    headers,
    data: { enabled: false, embedding: saved.embedding, revision: saved.revision },
  });
  expect(edit.ok()).toBeTruthy();
  await model.fill('unsaved-model');
  await page.getByRole('button', { name: 'Save configuration' }).click();
  await expect(page.getByRole('alert')).toContainText('changed in another session');
});

test('AI configuration rejects a regular account on every route', { tag: '@api' }, async ({
  request,
}) => {
  const auth = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'https://localhost' },
    data: {
      email: `ai-guard-${Date.now()}@example.com`,
      password: 'password123',
      name: 'Reader',
    },
  });
  const headers = { Authorization: `Bearer ${bearerToken(auth)}` };
  for (const [path, method] of [
    ['', 'GET'],
    ['', 'PUT'],
    ['/models', 'POST'],
    ['/test', 'POST'],
    ['/retry', 'POST'],
    ['/rebuild', 'POST'],
  ]) {
    const response = await request.fetch(`/api/admin/ai${path}`, { method, headers, data: {} });
    expect(response.status()).toBe(403);
  }
});
