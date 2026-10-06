import { type APIRequestContext, type APIResponse, expect, test } from '@playwright/test';
import { z } from 'zod';
import { resetUserPasswordResponseSchema, usersResponseSchema } from '../packages/shared/src/users';
import { bearerToken, signIn, signUp } from './helpers';

const authResponse = z.object({ user: z.object({ id: z.string() }) });

async function sessionOf(response: APIResponse) {
  return { ...authResponse.parse(await response.json()), token: bearerToken(response) };
}

async function passwordSignIn(request: APIRequestContext, email: string, password: string) {
  return request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost' },
    data: { email, password },
  });
}

async function directoryUser(request: APIRequestContext, token: string, email: string) {
  const response = await request.get(`/api/admin/users?search=${encodeURIComponent(email)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return usersResponseSchema.parse(await response.json()).users.find((row) => row.email === email);
}

test('password reset revokes sessions, preserves login history and protects self', {
  tag: '@api',
}, async ({ request }) => {
  const admin = await adminSession(request);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const target = await newAccount(request);
  const extra = await sessionOf(await passwordSignIn(request, target.email, 'password123'));
  const other = await newAccount(request);
  const before = await directoryUser(request, admin.token, target.email);
  expect(
    (await request.post(`/api/admin/users/${admin.user.id}/reset-password`, { headers })).status(),
  ).toBe(409);
  expect((await request.delete(`/api/admin/users/${admin.user.id}`, { headers })).status()).toBe(
    409,
  );
  expect(
    (await request.post('/api/admin/users/missing/reset-password', { headers })).status(),
  ).toBe(404);
  expect((await request.delete('/api/admin/users/missing', { headers })).status()).toBe(404);
  const response = await request.post(`/api/admin/users/${target.user.id}/reset-password`, {
    headers,
  });
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  const { temporaryPassword } = resetUserPasswordResponseSchema.parse(await response.json());
  expect((await directoryUser(request, admin.token, target.email))?.lastLoginAt).toBe(
    before?.lastLoginAt,
  );
  for (const token of [target.token, extra.token]) {
    expect(
      (
        await request.post('/api/notes', {
          headers: { Authorization: `Bearer ${token}` },
          data: {},
        })
      ).status(),
    ).toBe(401);
  }
  expect(
    (
      await request.get('/api/auth/get-session', {
        headers: { Authorization: `Bearer ${other.token}` },
      })
    ).ok(),
  ).toBeTruthy();
  expect((await passwordSignIn(request, target.email, 'password123')).status()).toBe(401);
  const login = await passwordSignIn(request, target.email, temporaryPassword);
  expect(login.ok()).toBeTruthy();
  await request.delete(`/api/admin/users/${target.user.id}`, { headers });
  await request.delete(`/api/admin/users/${other.user.id}`, { headers });
});

test('admins confirm password reset and deletion, and users can replace the temporary password', async ({
  page,
  browser,
  request,
}) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const admin = await adminSession(request);
  const target = await newAccount(request, 'Password reset user');
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await page.goto('/settings/admin/users');
  await expect(page.getByRole('button', { name: 'Actions for admin@example.com' })).toBeDisabled();
  await page.getByRole('searchbox', { name: 'Search users' }).fill(target.email);
  const actions = page.getByRole('button', { name: `Actions for ${target.email}` });
  await actions.click();
  await page.getByRole('menuitem', { name: 'Reset password' }).click();
  let dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(target.email);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(
    (
      await request.post('/api/notes', {
        headers: { Authorization: `Bearer ${target.token}` },
        data: {},
      })
    ).status(),
  ).toBe(400);
  await actions.click();
  await page.getByRole('menuitem', { name: 'Reset password' }).click();
  await dialog.getByRole('button', { name: 'Reset password' }).click();
  await expect(dialog.getByRole('textbox', { name: 'Temporary password' })).toBeVisible();
  const password = await dialog.getByRole('textbox', { name: 'Temporary password' }).inputValue();
  expect(password.length).toBeGreaterThanOrEqual(8);
  await dialog.getByRole('button', { name: 'Copy password' }).click();
  await expect(dialog.getByRole('button', { name: 'Copied' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('textbox', { name: 'Temporary password' })).toHaveCount(0);

  const context = await browser.newContext();
  try {
    const userPage = await context.newPage();
    await userPage.goto('/login');
    await userPage.getByLabel('Email').fill(target.email);
    await userPage.getByLabel('Password').fill(password);
    await userPage.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(userPage.getByRole('heading', { name: 'Gallery' })).toBeVisible();
    const oldToken = await userPage.evaluate(() => localStorage.getItem('catch-auth-token'));
    const extra = await sessionOf(await passwordSignIn(request, target.email, password));
    const before = await directoryUser(request, admin.token, target.email);
    await userPage.goto('/settings/account');
    await userPage.getByRole('button', { name: 'Change password' }).click();
    const form = userPage.getByRole('dialog');
    await form.getByLabel('Current password').fill(password);
    await form.getByLabel('New password', { exact: true }).fill('replacement-password123');
    await form.getByLabel('Confirm new password').fill('replacement-password123');
    await form.getByRole('button', { name: 'Save password' }).click();
    await expect(form).toBeHidden();
    const token = await userPage.evaluate(() => localStorage.getItem('catch-auth-token'));
    expect(token).not.toBe(oldToken);
    expect((await directoryUser(request, admin.token, target.email))?.lastLoginAt).toBe(
      before?.lastLoginAt,
    );
    for (const revoked of [oldToken, extra.token])
      expect(
        (
          await request.post('/api/notes', {
            headers: { Authorization: `Bearer ${revoked}` },
            data: {},
          })
        ).status(),
      ).toBe(401);
    expect(
      (
        await request.post('/api/notes', {
          headers: { Authorization: `Bearer ${token}` },
          data: {},
        })
      ).status(),
    ).toBe(400);
    expect((await passwordSignIn(request, target.email, password)).status()).toBe(401);
    expect(
      (await passwordSignIn(request, target.email, 'replacement-password123')).ok(),
    ).toBeTruthy();
  } finally {
    await context.close();
  }

  await actions.click();
  await page.getByRole('menuitem', { name: 'Delete user' }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('cannot be undone');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(actions).toBeVisible();
  await actions.click();
  await page.getByRole('menuitem', { name: 'Delete user' }).click();
  await dialog.getByRole('button', { name: 'Delete user' }).click();
  await expect(page.getByText('No users match this search.')).toBeVisible();
  expect(await directoryUser(request, admin.token, target.email)).toBeUndefined();
  expect((await passwordSignIn(request, target.email, 'replacement-password123')).status()).toBe(
    401,
  );
});

test('deleting a user revokes attachment access and keeps other accounts intact', {
  tag: '@api',
}, async ({ request }) => {
  const ticketHeaders = { Cookie: '' };
  const admin = await adminSession(request);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const target = await newAccount(request);
  const other = await newAccount(request);
  const picture = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1kAAAAASUVORK5CYII=',
    'base64',
  );
  async function attach(token: string) {
    const ownerHeaders = { Authorization: `Bearer ${token}` };
    const noteId = crypto.randomUUID().replace(/^(.{14})./, '$17');
    const id = crypto.randomUUID().replace(/^(.{14})./, '$17');
    expect(
      (
        await request.post('/api/notes', {
          headers: ownerHeaders,
          data: { id: noteId, content: [] },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.post('/api/attachments', {
          headers: ownerHeaders,
          data: {
            id,
            noteId,
            name: 'pixel.png',
            mimeType: 'image/png',
            size: picture.length,
            kind: 'image',
            sourceId: null,
            createdAt: new Date().toISOString(),
          },
        })
      ).status(),
    ).toBe(201);
    expect(
      (
        await request.put(`/api/attachments/${id}/content`, {
          headers: { ...ownerHeaders, 'Content-Type': 'image/png' },
          data: picture,
        })
      ).ok(),
    ).toBeTruthy();
    const access = z
      .object({ url: z.string() })
      .parse(
        await (
          await request.get(`/api/attachments/${id}/access`, { headers: ownerHeaders })
        ).json(),
      );
    const parsedUrl = new URL(access.url);
    const url = `${parsedUrl.pathname}${parsedUrl.search}`;
    expect((await request.get(url, { headers: ticketHeaders })).status()).toBe(200);
    expect((await request.get(`${url}&preview=true`, { headers: ticketHeaders })).status()).toBe(
      200,
    );
    return { url, id };
  }
  const removed = await attach(target.token);
  const kept = await attach(other.token);
  expect((await request.delete(`/api/admin/users/${target.user.id}`, { headers })).status()).toBe(
    200,
  );
  expect((await request.get(removed.url, { headers: ticketHeaders })).status()).toBe(404);
  expect(
    (await request.get(`${removed.url}&preview=true`, { headers: ticketHeaders })).status(),
  ).toBe(404);
  expect(
    (
      await request.post('/api/notes', {
        headers: { Authorization: `Bearer ${target.token}` },
        data: {},
      })
    ).status(),
  ).toBe(401);
  expect((await request.get(kept.url, { headers: ticketHeaders })).status()).toBe(200);
  expect((await request.get(`${kept.url}&preview=true`, { headers: ticketHeaders })).status()).toBe(
    200,
  );
  expect(await directoryUser(request, admin.token, target.email)).toBeUndefined();
  expect(await directoryUser(request, admin.token, other.email)).toBeDefined();
  await request.delete(`/api/admin/users/${other.user.id}`, { headers });
});

test('concurrent mutual deletions leave an administrator with current permissions', {
  tag: '@api',
}, async ({ request }) => {
  const admin = await adminSession(request);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const first = await newAccount(request);
  const second = await newAccount(request);
  for (const target of [first, second])
    expect(
      (
        await request.patch(`/api/admin/users/${target.user.id}/role`, {
          headers,
          data: { role: 'admin' },
        })
      ).ok(),
    ).toBeTruthy();
  const responses = await Promise.all([
    request.delete(`/api/admin/users/${second.user.id}`, {
      headers: { Authorization: `Bearer ${first.token}` },
    }),
    request.delete(`/api/admin/users/${first.user.id}`, {
      headers: { Authorization: `Bearer ${second.token}` },
    }),
  ]);
  expect(responses.map((response) => response.status()).sort()).toEqual([200, 403]);
  const survivors = (
    await Promise.all([
      directoryUser(request, admin.token, first.email),
      directoryUser(request, admin.token, second.email),
    ])
  ).filter((row) => row !== undefined);
  expect(survivors).toHaveLength(1);
  expect(survivors[0]?.role).toBe('admin');
  for (const target of survivors)
    await request.delete(`/api/admin/users/${target.id}`, { headers });
});

async function adminSession(request: APIRequestContext) {
  const response = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost' },
    data: { email: 'admin@example.com', password: 'adminadmin' },
  });
  expect(response.ok()).toBeTruthy();
  return sessionOf(response);
}

async function newAccount(request: APIRequestContext, name = 'Role test user') {
  const email = `roles-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const response = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: 'https://localhost' },
    data: { email, name, password: 'password123' },
  });
  expect(response.ok()).toBeTruthy();
  return { ...(await sessionOf(response)), email };
}

test('admins can open Users from either settings navigation and edit roles', async ({
  page,
  request,
  isMobile,
}) => {
  const target = await newAccount(request);
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  // With nowhere to return to, signing in opens the gallery.
  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  if (isMobile) await page.getByRole('button', { name: 'Settings page: General' }).click();
  const nav = page.getByRole('navigation', { name: 'Settings pages' });
  await expect(nav.getByRole('region', { name: 'User', exact: true })).toBeVisible();
  const admins = nav.getByRole('region', { name: 'Admin', exact: true });
  await expect(admins).toBeVisible();
  await admins.getByRole(isMobile ? 'button' : 'link', { name: 'Users', exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/admin\/users$/);
  const table = page.getByRole('table', { name: 'Users' });
  await expect(table).toBeVisible();
  await expect(
    table.getByRole('button', { name: 'Role for admin@example.com: Admin' }),
  ).toBeDisabled();

  await page.getByRole('searchbox', { name: 'Search users' }).fill(target.email);
  const role = table.getByRole('button', { name: `Role for ${target.email}` });
  await expect(role).toHaveText('User');
  await role.click();
  await page.getByRole('menuitemradio', { name: 'Admin' }).click();
  await expect(role).toHaveText('Admin');
  await expect(role).toBeEnabled();
  await page.reload();
  await page.getByRole('searchbox', { name: 'Search users' }).fill(target.email);
  await expect(role).toHaveText('Admin');
  await role.click();
  await expect(page.getByRole('menuitemradio', { name: 'Admin' })).toBeChecked();
  await page.getByRole('menuitemradio', { name: 'User' }).click();
  await expect(role).toHaveText('User');
  await page.getByRole('searchbox', { name: 'Search users' }).fill('no-such-user@example.invalid');
  await expect(page.getByText('No users match this search.')).toBeVisible();
});

test('regular users cannot see Admin or access its pages and APIs', async ({
  page,
  request,
  isMobile,
}) => {
  await signUp(page);
  await page.goto('/settings/general');
  if (isMobile) await page.getByRole('button', { name: 'Settings page: General' }).click();
  const nav = page.getByRole('navigation', { name: 'Settings pages' });
  await expect(nav.getByRole('region', { name: 'User', exact: true })).toBeVisible();
  await expect(nav.getByRole('region', { name: 'Admin', exact: true })).toHaveCount(0);
  await expect(nav.getByText('Users', { exact: true })).toHaveCount(0);
  await page.goto('/settings/admin/users');
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByRole('table', { name: 'Users' })).toHaveCount(0);
  await page.goto('/settings/admin/backups');
  await expect(page).toHaveURL(/\/settings\/general$/);
  await expect(page.getByText('Server backups')).toBeHidden();
  const token = await page.evaluate(() => localStorage.getItem('catch-auth-token'));
  const headers = { Authorization: `Bearer ${token}` };
  const backup = 'catch-backup-2026-10-01_03-04-05-manual.zip';
  expect((await request.get('/api/admin/backups', { headers })).status()).toBe(403);
  expect((await request.post('/api/admin/backups', { headers, data: {} })).status()).toBe(403);
  expect((await request.post(`/api/admin/backups/${backup}/restore`, { headers })).status()).toBe(
    403,
  );
  // Downloads take a ticket rather than a session, and this request has none.
  expect((await request.get(`/api/admin/backups/${backup}/download`, { headers })).status()).toBe(
    401,
  );
  expect((await request.get('/api/admin/users', { headers })).status()).toBe(403);
  expect(
    (await request.post('/api/admin/users/anything/reset-password', { headers })).status(),
  ).toBe(403);
  expect((await request.delete('/api/admin/users/anything', { headers })).status()).toBe(403);
  expect(
    (
      await request.patch('/api/admin/users/anything/role', { headers, data: { role: 'admin' } })
    ).status(),
  ).toBe(403);
});

test('administrative APIs validate roles, protect self, paginate and revoke stale privileges', {
  tag: '@api',
}, async ({ request }) => {
  const admin = await adminSession(request);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const target = await newAccount(request, 'Literal %_ search');
  const targetPath = `/api/admin/users/${target.user.id}/role`;
  expect(
    (
      await request.patch(`/api/admin/users/${admin.user.id}/role`, {
        headers,
        data: { role: 'user' },
      })
    ).status(),
  ).toBe(409);
  expect((await request.patch(targetPath, { headers, data: { role: 'owner' } })).status()).toBe(
    400,
  );
  expect(
    (
      await request.patch(targetPath, {
        headers,
        data: { role: 'admin', email: 'other@example.com' },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.patch('/api/admin/users/missing-user/role', {
        headers,
        data: { role: 'admin' },
      })
    ).status(),
  ).toBe(404);
  expect((await request.get('/api/admin/users?limit=101', { headers })).status()).toBe(400);
  expect((await request.get('/api/admin/users?offset=-1', { headers })).status()).toBe(400);

  const first = usersResponseSchema.parse(
    await (await request.get('/api/admin/users?limit=1', { headers })).json(),
  );
  const second = usersResponseSchema.parse(
    await (await request.get('/api/admin/users?limit=1&offset=1', { headers })).json(),
  );
  expect(first.users).toHaveLength(1);
  expect(second.users).toHaveLength(1);
  expect(first.users[0]?.id).not.toBe(second.users[0]?.id);
  const literal = usersResponseSchema.parse(
    await (await request.get('/api/admin/users?search=%25_', { headers })).json(),
  );
  expect(literal.users.length).toBeGreaterThan(0);
  expect(
    literal.users.every((user) => user.name.includes('%_') || user.email.includes('%_')),
  ).toBeTruthy();

  expect((await request.patch(targetPath, { headers, data: { role: 'admin' } })).ok()).toBeTruthy();
  const staleHeaders = { Authorization: `Bearer ${target.token}` };
  expect((await request.get('/api/admin/users', { headers: staleHeaders })).status()).toBe(200);
  expect((await request.patch(targetPath, { headers, data: { role: 'user' } })).ok()).toBeTruthy();
  expect((await request.get('/api/admin/users', { headers: staleHeaders })).status()).toBe(403);
  expect(
    (
      await request.patch(`/api/admin/users/${admin.user.id}/role`, {
        headers: staleHeaders,
        data: { role: 'user' },
      })
    ).status(),
  ).toBe(403);
});

test('concurrent mutual demotions leave an administrator', { tag: '@api' }, async ({ request }) => {
  const seed = await adminSession(request);
  const headers = { Authorization: `Bearer ${seed.token}` };
  const first = await newAccount(request);
  const second = await newAccount(request);
  for (const account of [first, second]) {
    expect(
      (
        await request.patch(`/api/admin/users/${account.user.id}/role`, {
          headers,
          data: { role: 'admin' },
        })
      ).ok(),
    ).toBeTruthy();
  }
  const results = await Promise.all([
    request.patch(`/api/admin/users/${second.user.id}/role`, {
      headers: { Authorization: `Bearer ${first.token}` },
      data: { role: 'user' },
    }),
    request.patch(`/api/admin/users/${first.user.id}/role`, {
      headers: { Authorization: `Bearer ${second.token}` },
      data: { role: 'user' },
    }),
  ]);
  expect(results.map((response) => response.status()).sort()).toEqual([200, 403]);
  for (const account of [first, second]) {
    expect(
      (
        await request.patch(`/api/admin/users/${account.user.id}/role`, {
          headers,
          data: { role: 'user' },
        })
      ).ok(),
    ).toBeTruthy();
  }
});

test('a demoted admin loses the open Users page and its navigation', async ({
  page,
  request,
  isMobile,
}) => {
  const target = await newAccount(request);
  const admin = await adminSession(request);
  const headers = { Authorization: `Bearer ${admin.token}` };
  const path = `/api/admin/users/${target.user.id}/role`;
  expect((await request.patch(path, { headers, data: { role: 'admin' } })).ok()).toBeTruthy();
  await signIn(page, target.email);
  await page.goto('/settings/admin/users');
  await expect(page.getByRole('table', { name: 'Users' })).toBeVisible();
  expect((await request.patch(path, { headers, data: { role: 'user' } })).ok()).toBeTruthy();
  await page.getByRole('button', { name: 'Refresh users' }).click();
  await expect(page).toHaveURL(/\/settings\/general$/);
  if (isMobile) await page.getByRole('button', { name: 'Settings page: General' }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Settings pages' })
      .getByRole('region', { name: 'Admin', exact: true }),
  ).toHaveCount(0);
  await page.goto('/settings/admin/users');
  await expect(page).toHaveURL(/\/settings\/general$/);
});

test('last login advances on successful sign-in but not on failure or session reads', {
  tag: '@api',
}, async ({ request }) => {
  const admin = await adminSession(request);
  const target = await newAccount(request);
  const headers = { Authorization: `Bearer ${admin.token}` };
  async function lastLogin() {
    const response = await request.get(
      `/api/admin/users?search=${encodeURIComponent(target.email)}`,
      { headers },
    );
    expect(response.ok()).toBeTruthy();
    const { users } = usersResponseSchema.parse(await response.json());
    expect(users).toHaveLength(1);
    return users[0]!.lastLoginAt;
  }
  const first = await lastLogin();
  expect(first).not.toBeNull();
  const failed = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost' },
    data: { email: target.email, password: 'incorrect-password' },
  });
  expect(failed.status()).toBe(401);
  expect(await lastLogin()).toBe(first);
  expect(
    (
      await request.get('/api/auth/get-session', {
        headers: { Authorization: `Bearer ${target.token}` },
      })
    ).ok(),
  ).toBeTruthy();
  expect(await lastLogin()).toBe(first);
  const signedIn = await request.post('/api/auth/sign-in/email', {
    headers: { Origin: 'https://localhost' },
    data: { email: target.email, password: 'password123' },
  });
  expect(signedIn.ok()).toBeTruthy();
  const latest = await lastLogin();
  expect(Date.parse(latest!)).toBeGreaterThan(Date.parse(first!));
});

test('an admin invites someone, and the link makes one account', async ({
  page,
  browser,
  request,
}) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('admin@example.com');
  await page.getByLabel('Password').fill('adminadmin');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Gallery' })).toBeVisible({ timeout: 30_000 });
  await page.goto('/settings/admin/users');
  const who = `Invitee ${Date.now()}`;
  await page.getByLabel('Who the invite is for').fill(who);
  await page.getByRole('button', { name: 'Create invite' }).click();
  const link = await page.getByRole('textbox', { name: 'Invite link' }).inputValue();
  expect(link).toMatch(/\/login#invite=[\w-]{43}$/);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toHaveCount(0);

  const email = `invited-${Date.now()}@example.com`;
  async function join(address: string) {
    const context = await browser.newContext();
    const guest = await context.newPage();
    await guest.goto(link);
    await expect(guest.getByText('You have been invited to this Catch server.')).toBeVisible();
    await guest.getByLabel('Name').fill('Invited');
    await guest.getByLabel('Email').fill(address);
    await guest.getByLabel('Password').fill('password123');
    await guest.getByRole('button', { name: 'Create account' }).click();
    return { context, guest };
  }

  const first = await join(email);
  try {
    await expect(first.guest.getByRole('heading', { name: 'Gallery' })).toBeVisible({
      timeout: 30_000,
    });
    // The spent token does not linger in the address bar.
    expect(first.guest.url()).not.toContain('invite=');
  } finally {
    await first.context.close();
  }

  const second = await join(`again-${email}`);
  try {
    await expect(second.guest.getByText('This invite has been used or has expired.')).toBeVisible();
  } finally {
    await second.context.close();
  }

  await page.reload();
  await expect(page.getByText(`by ${email}`)).toBeVisible();
  await page.getByRole('button', { name: `Remove invite for ${who}` }).click();
  await expect(page.getByText(who)).toHaveCount(0);

  const admin = await adminSession(request);
  const invited = await directoryUser(request, admin.token, email);
  expect(invited).toBeDefined();
  expect(await directoryUser(request, admin.token, `again-${email}`)).toBeUndefined();
  await request.delete(`/api/admin/users/${invited!.id}`, {
    headers: { Authorization: `Bearer ${admin.token}` },
  });
});
