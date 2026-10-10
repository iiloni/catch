/**
 * Captures the app screenshots the site shows, in light and dark, from this worktree's
 * development stack: `./scripts/dev.sh screenshots`. Each run signs up a fresh account
 * and fills it with the notes below, so the pictures only change when the app does.
 * `./scripts/dev.sh screenshots site <site-url>` captures the site's link preview instead.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type Browser, type BrowserContext, chromium, devices, type Page } from '@playwright/test';
import sharp from 'sharp';

const root = path.join(import.meta.dirname, '../../..');
const output = path.join(import.meta.dirname, '../src/screenshots');
const recordings = path.join(import.meta.dirname, '../public/recordings');

function stackUrl() {
  if (process.env.E2E_BASE_URL) return process.env.E2E_BASE_URL;
  const port = readFileSync(path.join(root, '.env.worktree'), 'utf8').match(
    /^CATCH_PORT=(\d+)$/m,
  )?.[1];
  if (!port) throw new Error('No stack to capture. Run ./scripts/dev.sh up first.');
  return `http://localhost:${port}`;
}

const baseURL = stackUrl();
const themes = ['light', 'dark'] as const;
const layouts = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  // The cover screen of a Galaxy Z Fold7: 1080 by 2520 pixels, 21:9.
  phone: {
    ...devices['Pixel 7'],
    viewport: { width: 360, height: 840 },
    screen: { width: 360, height: 840 },
    deviceScaleFactor: 3,
  },
};
/**
 * The room a phone's status bar and gesture bar take. The Android app tells the page about
 * them through these properties, and the site's phone frame draws its camera and gesture
 * bar over the space they leave (`PhoneFrame`).
 */
const PHONE_INSETS = { top: 34, bottom: 18 };

async function phoneContext(
  browser: Browser,
  storageState: Awaited<ReturnType<typeof createAccount>>,
  theme: (typeof themes)[number],
) {
  const context = await browser.newContext({
    ...layouts.phone,
    baseURL,
    storageState,
    colorScheme: theme,
    locale: 'en-US',
  });
  await context.addInitScript((insets) => {
    const apply = () => {
      const style = document.documentElement.style;
      style.setProperty('--safe-area-inset-top', `${insets.top}px`);
      style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
    };
    if (document.documentElement) apply();
    document.addEventListener('DOMContentLoaded', apply);
  }, PHONE_INSETS);
  return context;
}
type Layout = keyof typeof layouts;

/** Signs up through the API and returns the storage state every context starts from. */
async function createAccount(browser: Browser) {
  const context = await browser.newContext({ baseURL });
  const response = await context.request.post('/api/auth/sign-up/email', {
    headers: { Origin: baseURL },
    data: { email: `shots-${Date.now()}@example.com`, name: 'Robin', password: 'password123' },
  });
  if (!response.ok()) throw new Error(`Sign-up failed: ${response.status()}`);
  const state = await signedInState(context, response);
  await context.close();
  return state;
}

async function signedInState(
  context: BrowserContext,
  response: Awaited<ReturnType<BrowserContext['request']['post']>>,
) {
  const { user } = (await response.json()) as { user: unknown };
  return {
    cookies: await context.cookies(),
    origins: [
      {
        origin: new URL(baseURL).origin,
        localStorage: [
          { name: 'catch-auth-token', value: response.headers()['set-auth-token'] ?? '' },
          { name: 'catch-user', value: JSON.stringify(user) },
        ],
      },
    ],
  };
}

/** Only the worktree's seeded admin is used; never pass a production URL to this script. */
async function adminAccount(browser: Browser) {
  const context = await browser.newContext({ baseURL });
  const response = await context.request.post('/api/auth/sign-in/email', {
    headers: { Origin: baseURL },
    data: { email: 'admin@example.com', password: 'adminadmin' },
  });
  if (!response.ok()) throw new Error(`Admin sign-in failed: ${response.status()}`);
  const state = await signedInState(context, response);
  await context.close();
  return state;
}

async function openApp(context: BrowserContext, route = '/') {
  const page = await context.newPage();
  await page.goto(route);
  const title = page.getByRole('heading', { level: 1 }).first();
  // The dev server sends the app unbundled, and a load now and then stalls on a busy machine.
  await title.waitFor({ timeout: 45_000 }).catch(async () => {
    await page.reload();
    await title.waitFor({ timeout: 90_000 });
  });
  return page;
}

/** Writes the demo notes with the app's own actions, as the E2E helpers do. */
async function seed(page: Page) {
  await page.evaluate(async () => {
    const load = (file: string) => import(/* @vite-ignore */ `/src/lib/${file}.ts`);
    const { createNote, setNotePinned } = await load('notes');
    const { createTag, setPrimaryTag, setSecondaryTag } = await load('tags');
    const { setReminder, deviceTimeZone } = await load('reminders');
    const { getSignedInUser } = await load('auth');
    const userId = getSignedInUser().id;
    const pending: Promise<unknown>[] = [];
    const wait = (transaction: { isPersisted: { promise: Promise<unknown> } } | undefined) => {
      if (transaction) pending.push(transaction.isPersisted.promise);
    };

    const text = (value: string, bold = false) => ({
      type: 'text',
      text: value,
      styles: bold ? { bold: true } : {},
    });
    const heading = (value: string) => ({ type: 'heading', props: { level: 3 }, content: value });
    const paragraph = (...content: unknown[]) => ({ type: 'paragraph', content });
    const check = (value: string, checked = false) => ({
      type: 'checkListItem',
      props: { checked },
      content: value,
    });
    const bullet = (value: string) => ({ type: 'bulletListItem', content: value });

    const tag = (name: string, icon: string | null, color: string | null, parentId?: string) => {
      const created = createTag(userId, { name, icon, color, parentId: parentId ?? null });
      wait(created.transaction);
      return created.id as string;
    };
    const home = tag('Home', 'house', 'yellow');
    const kitchen = tag('Kitchen', null, null, home);
    const health = tag('Health', 'dumbbell', 'green');
    const travel = tag('Travel', 'plane', 'orange');
    const lisbon = tag('Lisbon', null, null, travel);
    const friends = tag('Friends', 'users', 'pink');
    const reading = tag('Reading', 'book-open', 'violet');
    const work = tag('Work', 'briefcase', 'teal');

    const at = (daysAhead: number, time: string) => {
      const day = new Date();
      day.setDate(day.getDate() + daysAhead);
      const pad = (value: number) => String(value).padStart(2, '0');
      return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}T${time}`;
    };

    type Demo = {
      content: unknown[];
      color?: string;
      status?: string;
      pinned?: boolean;
      primary?: string;
      secondary?: string[];
      reminder?: { startsAt: string; recurrence?: unknown };
    };
    // Listed as they should read on the page; each new note lands first, so they are
    // written last to first.
    const notes: Demo[] = [
      {
        pinned: true,
        primary: home,
        secondary: [kitchen, health],
        reminder: { startsAt: at(1, '10:00') },
        content: [
          heading('Groceries'),
          check('Oat milk', true),
          check('Eggs', true),
          check('Sourdough starter flour'),
          check('Lemons'),
          check('Coffee beans'),
          check('Olive oil'),
        ],
      },
      {
        pinned: true,
        primary: travel,
        secondary: [lisbon, friends],
        content: [
          heading('Lisbon weekend'),
          paragraph(
            text('Friday', true),
            text(': land around noon, drop bags, pastéis de nata at Manteigaria.'),
          ),
          paragraph(text('Saturday', true), text(': tram 28 early, then the Alfama on foot.')),
          paragraph(text('Sunday', true), text(': train to Sintra, Pena Palace first thing.')),
          paragraph(text('Pack', true)),
          check('Walking shoes', true),
          check('Light jacket'),
          check('Travel adapter'),
          paragraph(text('Background: '), {
            type: 'link',
            href: 'https://en.wikipedia.org/wiki/Lisbon',
            content: [text('Lisbon on Wikipedia')],
          }),
        ],
      },
      {
        pinned: true,
        color: 'red',
        reminder: { startsAt: at(1, '15:00') },
        content: [
          heading('Dentist'),
          paragraph(text('Check-up at 3pm. Bring the insurance card.')),
        ],
      },
      {
        pinned: true,
        primary: reading,
        content: [
          heading('Books to read'),
          check('The Dispossessed', true),
          check('Piranesi', true),
          check('A Psalm for the Wild-Built'),
          check('The Left Hand of Darkness'),
          check('Stoner'),
        ],
      },
      {
        primary: health,
        reminder: {
          startsAt: at(1, '07:00'),
          recurrence: {
            frequency: 'weekly',
            interval: 1,
            weekdays: [1, 3, 5],
            weekdayOfMonth: null,
            until: null,
          },
        },
        content: [
          heading('Morning run'),
          paragraph(text('5 km loop by the river. Monday, Wednesday, Friday.')),
        ],
      },
      {
        color: 'blue',
        content: [
          heading('Gift ideas'),
          bullet('Mum: the ceramics class she mentioned'),
          bullet('Sam: record player needle'),
          bullet('Noor: that cookbook from the market'),
        ],
      },
      {
        primary: home,
        content: [
          heading('Wifi for guests'),
          paragraph(text('Network: '), text('Fig Tree', true)),
          paragraph(text('The password is on the fridge.')),
        ],
      },
      {
        color: 'mint',
        content: [
          heading('Sourdough timings'),
          paragraph(text('Feed at 8, mix at noon, fold every 30 minutes until 3.')),
          paragraph(text('Shape, then overnight in the fridge. Bake at 240°C.')),
        ],
      },
      {
        color: 'purple',
        primary: friends,
        content: [heading("Noor's birthday"), paragraph(text('Table for six, Saturday at 8.'))],
      },
      {
        status: 'new',
        primary: work,
        content: [
          heading('Talk outline'),
          bullet('Why offline first'),
          bullet('What sync taught us'),
          bullet('Demo'),
        ],
      },
      {
        status: 'new',
        color: 'cyan',
        content: [heading('Balcony planters'), paragraph(text('Measure the railing first.'))],
      },
      {
        status: 'in_progress',
        primary: travel,
        content: [
          heading('Book the Sintra train'),
          check('Check the timetable', true),
          check('Buy tickets'),
        ],
      },
      {
        status: 'in_progress',
        primary: home,
        content: [
          heading('Repaint the hallway'),
          check('Pick a white', true),
          check('Tape the skirting', true),
          check('Second coat'),
        ],
      },
      {
        status: 'hold',
        color: 'gray',
        content: [heading('Bike service'), paragraph(text('Waiting for the part to arrive.'))],
      },
    ];

    for (const note of notes.toReversed()) {
      const created = createNote({
        userId,
        content: note.content,
        color: note.color,
        status: note.status,
      });
      wait(created.transaction);
      if (note.pinned) wait(setNotePinned(created.id, true));
      if (note.primary) wait(setPrimaryTag(created.id, note.primary, 'default'));
      for (const id of note.secondary ?? []) wait(setSecondaryTag(created.id, id, true));
      if (note.reminder) {
        wait(
          setReminder(
            { id: created.id, userId },
            {
              startsAt: note.reminder.startsAt,
              timeZone: deviceTimeZone(),
              floating: false,
              recurrence: note.reminder.recurrence ?? null,
            },
          ),
        );
      }
    }
    await Promise.all(pending);
  });
}

async function save(page: Page, name: string, theme: string) {
  // Springs and view transitions outlast the state that started them.
  await page.mouse.move(0, 0);
  await page.waitForTimeout(3000);
  const file = path.join(output, `${name}-${theme}.webp`);
  await sharp(await page.screenshot())
    .webp({ quality: 86 })
    .toFile(file);
  console.log(path.relative(root, file));
}

async function captureSite(browser: Browser, url: string) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1100 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
  });
  try {
    const page = await context.newPage();
    await page.goto(url);
    const heading = page.getByRole('heading', { name: "Catch it before it's gone.", exact: true });
    await heading.waitFor();
    await page.evaluate(async () => {
      await document.fonts.ready;
      const hero = document.querySelector('main section');
      if (!hero) throw new Error('The site hero is missing.');
      await Promise.all(
        [...hero.querySelectorAll('img')]
          .filter((img) => getComputedStyle(img).display !== 'none')
          .map((img) => img.decode()),
      );
    });
    const title = await heading.boundingBox();
    if (!title) throw new Error('The site headline is missing.');
    const file = path.join(output, 'site-hero-light.png');
    // Start above the headline to leave the navigation out of the link card.
    await page.screenshot({
      path: file,
      clip: { x: 0, y: title.y - 32, width: 1280, height: 900 },
      animations: 'disabled',
    });
    console.log(path.relative(root, file));
  } finally {
    await context.close();
  }
}

const card = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });

async function captureCapabilities(context: BrowserContext, theme: string) {
  const vault = await openApp(context);
  await card(vault, 'Groceries').waitFor({ timeout: 60_000 });
  await vault.getByRole('button', { name: 'Open the vault', exact: true }).click();
  await vault.getByRole('heading', { name: 'Set up your vault', exact: true }).waitFor();
  await save(vault, 'phone-vault', theme);
  await vault.close();

  const sharing = await openApp(context);
  const groceries = card(sharing, 'Groceries');
  await groceries.waitFor({ timeout: 60_000 });
  await groceries.getByRole('button', { name: 'Open note', exact: true }).click();
  const editor = sharing.getByRole('dialog');
  await editor.getByRole('textbox').waitFor();
  await editor.getByRole('button', { name: 'Share', exact: true }).click();
  await sharing.getByRole('heading', { name: 'Share this note', exact: true }).waitFor();
  await save(sharing, 'phone-sharing', theme);
  await sharing.close();
}

async function capture(context: BrowserContext, layout: Layout, theme: string) {
  const page = await openApp(context);
  await card(page, 'Groceries').waitFor({ timeout: 60_000 });

  if (layout === 'phone') await save(page, 'phone-gallery', theme);
  await card(page, 'Lisbon weekend').getByRole('button', { name: 'Open note' }).click();
  await page.getByRole('dialog').getByRole('textbox').waitFor();
  // The preview is fetched by the server after the note is first written.
  await page
    .getByText('Lisbon - Wikipedia')
    .first()
    .waitFor({ timeout: 30_000 })
    .catch(() => {});
  await save(page, layout === 'phone' ? 'phone-note' : 'desktop-gallery', theme);
  await page.close();

  if (layout === 'phone') {
    const note = await openApp(context);
    await card(note, 'Groceries').getByRole('button', { name: 'Open note' }).click();
    await note.getByRole('dialog').getByRole('textbox').waitFor();
    await note
      .getByRole('toolbar', { name: 'Note actions' })
      .getByRole('button', { name: 'Reminder' })
      .click();
    await save(note, 'phone-reminder', theme);
    await note.close();

    const search = await openApp(context);
    await search.getByRole('link', { name: 'Search' }).click();
    await search.getByLabel('Search notes').fill('lisbon');
    await card(search, 'Lisbon weekend').waitFor();
    await save(search, 'phone-search', theme);
    await search.close();
  } else {
    const tags = await openApp(context, '/settings/tags');
    await tags.getByText('Kitchen').first().waitFor();
    await save(tags, 'desktop-tags', theme);
    await tags.close();
  }

  const deck = await openApp(context, '/deck');
  await deck.getByRole('heading', { name: 'Talk outline' }).waitFor({ timeout: 60_000 });
  await save(deck, `${layout}-deck`, theme);
  await deck.close();
}

/** Docs captures use the same real app and seeded notes as the marketing pictures. */
async function captureDocs(context: BrowserContext, theme: string, only?: string) {
  const scenes: { name: string; route?: string; prepare?: (page: Page) => Promise<void> }[] = [
    {
      name: 'docs-quick-note',
      prepare: async (page) => {
        await card(page, 'Groceries').waitFor({ timeout: 60_000 });
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        const editor = page
          .getByRole('region', { name: 'New note', exact: true })
          .getByRole('textbox');
        await editor.waitFor();
        await editor.click();
        await page.keyboard.type('Call the plumber');
        await page.keyboard.press('Enter');
        await page.keyboard.type('Kitchen tap, before Friday');
        const formatting = page.getByRole('button', { name: 'Formatting', exact: true });
        if (await formatting.isVisible()) await formatting.click();
      },
    },
    ...(
      [
        ['docs-primary-tags', 'Background color'],
        ['docs-secondary-tags', 'Tags'],
        ['docs-attachments', 'Attach files'],
        ['docs-move-note', 'Move note'],
      ] as const
    ).map(([name, action]) => ({
      name,
      prepare: async (page: Page) => {
        await card(page, 'Groceries').getByRole('button', { name: 'Open note' }).click();
        await page.getByRole('dialog').getByRole('textbox').waitFor();
        await page
          .getByRole('toolbar', { name: 'Note actions' })
          .getByRole('button', { name: action, exact: true })
          .click();
      },
    })),
    { name: 'docs-import', route: '/settings/data' },
    { name: 'docs-settings', route: '/settings/general' },
    {
      name: 'docs-link-capture',
      prepare: async (page) => {
        await card(page, 'Groceries').waitFor({ timeout: 60_000 });
        await page.getByRole('button', { name: 'New note', exact: true }).click();
        // Save link lives in the quick note's formatting toolbar.
        const formatting = page.getByRole('button', { name: 'Formatting', exact: true });
        if (await formatting.isVisible()) await formatting.click();
        await page.getByRole('button', { name: 'Save link', exact: true }).click();
        await page.getByRole('heading', { name: 'Add Rich Link' }).waitFor();
        await page.getByLabel('URL', { exact: true }).fill('https://en.wikipedia.org/wiki/Lisbon');
        await page.getByRole('button', { name: 'Fetch details' }).click();
        await page.getByLabel('Title', { exact: true }).waitFor({ timeout: 45_000 });
      },
    },
  ];
  for (const scene of scenes) {
    if (only && !scene.name.startsWith(only)) continue;
    const page = await openApp(context, scene.route);
    await scene.prepare?.(page);
    await save(page, scene.name, theme);
    await page.close();
  }

  if (!only || only.startsWith('docs-offline')) {
    const page = await openApp(context);
    // A wider phone keeps the full save-status label visible alongside the note actions.
    await page.setViewportSize({ width: 430, height: 840 });
    await card(page, 'Groceries').waitFor({ timeout: 60_000 });
    const noteId = await card(page, 'Groceries').getAttribute('data-note-card');
    if (!noteId) throw new Error('The offline demo note is missing.');
    const original = await page.evaluate(async (id) => {
      const file = 'notes';
      const { getNote } = await import(/* @vite-ignore */ `/src/lib/${file}.ts`);
      return getNote(id);
    }, noteId);
    if (!original) throw new Error('The offline demo note is missing.');
    await card(page, 'Groceries').getByRole('button', { name: 'Open note' }).click();
    const editor = page.getByRole('dialog').getByRole('textbox');
    await editor.waitFor();
    // Load the editor online first: Vite has no service worker for loading code offline.
    await context.setOffline(true);
    try {
      await page.getByRole('dialog').getByText('Olive oil', { exact: true }).click();
      await page.keyboard.press('End');
      await page.keyboard.type(' (check the pantry)');
      await page.getByText('Saved on this device', { exact: true }).waitFor();
      await save(page, 'docs-offline-save', theme);
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: /^Offline, .* waiting$/ }).click();
      await page.getByText(/saved on this device will sync/).waitFor();
      await save(page, 'docs-offline-queue', theme);
    } finally {
      await context.setOffline(false);
      await page.waitForFunction(async () => {
        const file = 'syncStatus';
        const { getSyncStatus } = await import(/* @vite-ignore */ `/src/lib/${file}.ts`);
        return getSyncStatus().pending === 0;
      });
      await page.evaluate(async (note) => {
        const file = 'notes';
        const { updateNote } = await import(/* @vite-ignore */ `/src/lib/${file}.ts`);
        await updateNote(note.id, { content: note.content }).isPersisted.promise;
      }, original);
      await page.close();
    }
  }
}

async function captureAdmin(context: BrowserContext, theme: string, only?: string) {
  if (!only || only === 'docs-users') {
    const page = await openApp(context, '/settings/admin/users');
    // Keep the capture focused on the two named seed accounts, not capture-run accounts.
    await page.getByLabel('Search users').fill('user@example.com');
    await page.getByRole('button', { name: 'Role for user@example.com: User' }).waitFor();
    await page.getByRole('region', { name: 'Invites' }).waitFor();
    await save(page, 'docs-users', theme);
    await page.close();
  }
  if (only && !['docs-backups', 'docs-restore'].includes(only)) return;
  const page = await openApp(context, '/settings/admin/backups');
  await page.getByRole('button', { name: 'Back up now', disabled: false }).waitFor();
  // Capture a real completed full backup, not a fabricated list. Runs only on the dev stack.
  if (!(await page.getByText(/Made by hand/).count())) {
    await page.getByRole('button', { name: 'Back up now' }).click();
    await page
      .getByText(/Made by hand/)
      .first()
      .waitFor({ timeout: 120_000 });
  }
  const schedule = await page.evaluate(async () => {
    const file = 'serverBackups';
    const { serverBackups } = await import(/* @vite-ignore */ `/src/lib/${file}.ts`);
    return (await serverBackups.overview()).schedule;
  });
  try {
    // Show all scheduling fields, then restore the existing worktree setting in finally.
    if (!schedule.enabled) {
      await page.getByRole('switch', { name: 'Back up every day' }).click();
      await page.getByLabel('Backups to keep').waitFor();
    }
    if (!only || only === 'docs-backups') await save(page, 'docs-backups', theme);
    if (!only || only === 'docs-restore') {
      await page
        .getByRole('button', { name: /Manage the backup from/ })
        .first()
        .click();
      await page.getByRole('menuitem', { name: 'Restore', exact: true }).click();
      await page.getByRole('heading', { name: 'Restore this backup?' }).waitFor();
      await save(page, 'docs-restore', theme);
      // Never confirm: documenting restore does not restore the development database.
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    }
  } finally {
    await page.evaluate(async (original) => {
      const file = 'serverBackups';
      const { serverBackups } = await import(/* @vite-ignore */ `/src/lib/${file}.ts`);
      await serverBackups.saveSchedule(original);
    }, schedule);
    await page.close();
  }
}

/**
 * Native-only views: run `./scripts/dev.sh android --usb` first, then
 * `./scripts/dev.sh screenshots android-docs` with the cover screen active and unlocked.
 * ADB photographs the real display, including its system keyboard and Share menu.
 */
async function captureAndroid() {
  const adb = (...args: string[]) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
  const pid = adb('shell', 'pidof', 'org.iloni.catchnotes.dev');
  if (!/^\d+$/.test(pid)) throw new Error('Open Catch Dev on one connected Android device first.');
  const port = '29223';
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const help = spawnSync('adb', ['shell', 'screencap', '--help'], { encoding: 'utf8' });
  const display = `${help.stdout}${help.stderr}`.match(/defaults to (\d+)/)?.[1];
  if (!display) throw new Error('Could not determine the active Android display.');
  const night = adb('shell', 'cmd', 'uimode', 'night').match(/Night mode: (\w+)/)?.[1];
  if (!night) throw new Error('Could not read the phone’s appearance setting.');
  const browser = await chromium.connectOverCDP(`http://localhost:${port}`);
  const context = browser.contexts()[0];
  const page = context?.pages().find((candidate) => candidate.url().startsWith(baseURL));
  if (!context || !page) throw new Error('Catch Dev must load this worktree’s live-reload URL.');
  const preference = await page.evaluate(() => localStorage.getItem('catch-theme'));
  const email = `android-shots-${Date.now()}@example.com`;
  const response = await context.request.post(`${baseURL}/api/auth/sign-up/email`, {
    headers: { Origin: baseURL },
    data: { email, name: 'Robin', password: 'password123' },
  });
  if (!response.ok()) throw new Error(`Native capture sign-up failed: ${response.status()}`);
  await page.goto(`${baseURL}/login`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('password123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.getByRole('heading', { name: 'Gallery', exact: true }).waitFor({ timeout: 60_000 });
  await seed(page);

  const photograph = async (name: string, theme: string) => {
    await page.waitForTimeout(2000);
    const file = path.join(output, `${name}-${theme}.webp`);
    await sharp(
      execFileSync('adb', ['exec-out', 'screencap', '-p', '-d', display ?? ''], {
        maxBuffer: 16 * 1024 * 1024,
      }),
    )
      .webp({ quality: 86 })
      .toFile(file);
    console.log(path.relative(root, file));
  };

  try {
    for (const theme of themes) {
      adb('shell', 'cmd', 'uimode', 'night', theme === 'dark' ? 'yes' : 'no');
      await page.goto(`${baseURL}/settings/general`);
      await page
        .getByRole('button', { name: theme === 'dark' ? 'Dark' : 'Light', exact: true })
        .click();
      await page.goto(`${baseURL}/setup`);
      await page.getByRole('heading', { name: 'Connect to your server' }).waitFor();
      await photograph('docs-android-setup', theme);

      await page.goto(baseURL);
      await card(page, 'Groceries').getByRole('button', { name: 'Open note' }).click();
      const editor = page.getByRole('dialog').getByRole('textbox');
      await editor.waitFor({ timeout: 60_000 });
      const item = editor.getByText('Olive oil', { exact: true });
      const box = await item.boundingBox();
      if (!box) throw new Error('The native note editor is not visible.');
      const ratio = await page.evaluate(() => devicePixelRatio);
      // A real touch raises Android’s keyboard; a DOM focus alone does not always do so.
      adb(
        'shell',
        'input',
        'tap',
        String(Math.round((box.x + box.width / 2) * ratio)),
        String(Math.round((box.y + box.height / 2) * ratio)),
      );
      await page.waitForFunction(
        () => Number.parseFloat(document.documentElement.style.getPropertyValue('--keyboard')) > 40,
      );
      await page.getByRole('button', { name: 'Bold', exact: true }).waitFor();
      await photograph('docs-android-keyboard', theme);
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();

      // The shell’s real ACTION_SEND opens Android’s resolver with example text.
      // Quotes must survive adb’s shell argument joining.
      adb(
        'shell',
        'am',
        'start',
        '--user',
        '0',
        '-a',
        'android.intent.action.SEND',
        '-t',
        'text/plain',
        '--es',
        'android.intent.extra.TEXT',
        "'Weekend packing list: walking shoes, jacket, travel adapter.'",
      );
      await photograph('docs-android-share', theme);
      adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    }
  } finally {
    adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
    adb('shell', 'cmd', 'uimode', 'night', night);
    await page.goto(`${baseURL}/settings/general`);
    const label = preference === '"dark"' ? 'Dark' : preference === '"light"' ? 'Light' : 'System';
    await page.getByRole('button', { name: label, exact: true }).click();
    await page.goto(baseURL);
    adb('forward', '--remove', `tcp:${port}`);
    await browser.close();
  }
}

const FPS = 60;
// How much slower than life a clip is filmed. Chrome photographs a screen of this size only
// five or six times a second, so the page runs slowly while it is filmed and the clip is
// sped back up: every frame of an animation is in it.
const SLOW = 14;

/**
 * Slows the page's own clocks, which run the animations written in script. `slowPage` turns
 * it on once the page is ready; animations in CSS are slowed through Chrome instead.
 */
declare global {
  interface Window {
    slowPage(rate: number): void;
  }
}

function dilateTime() {
  const realNow = performance.now.bind(performance);
  const realDate = Date.now.bind(Date);
  let rate = 1;
  let since = realNow();
  let base = since;
  let dateSince = realDate();
  let dateBase = dateSince;
  const now = () => base + (realNow() - since) / rate;
  performance.now = now;
  Date.now = () => Math.round(dateBase + (realDate() - dateSince) / rate);
  const frame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (callback) => frame(() => callback(now()));
  for (const name of ['setTimeout', 'setInterval'] as const) {
    const real = window[name].bind(window) as (
      handler: TimerHandler,
      ms?: number,
      ...rest: unknown[]
    ) => number;
    Object.assign(window, {
      [name]: (handler: TimerHandler, ms?: number, ...rest: unknown[]) =>
        real(handler, (ms ?? 0) * rate, ...rest),
    });
  }
  Object.assign(window, {
    slowPage: (next: number) => {
      base = now();
      dateBase = Date.now();
      since = realNow();
      dateSince = realDate();
      rate = next;
    },
  });
}

/**
 * Records one interaction on the phone layout as a short silent clip, for the page's
 * motion section. FFmpeg (it must be installed) turns the frames into the videos.
 */
async function record(
  browser: Browser,
  storageState: Awaited<ReturnType<typeof createAccount>>,
  theme: (typeof themes)[number],
  name: string,
  prepare: (page: Page) => Promise<void>,
  act: (page: Page) => Promise<void>,
  restore: (page: Page) => Promise<void>,
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'catch-recording-'));
  const context = await phoneContext(browser, storageState, theme);
  await context.addInitScript(dilateTime);
  const page = await openApp(context);
  await card(page, 'Groceries').waitFor({ timeout: 60_000 });
  await prepare(page);
  await page.waitForTimeout(1500);

  const frames: { file: string; time: number }[] = [];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Animation.enable');
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 / SLOW });
  await page.evaluate((rate) => window.slowPage(rate), SLOW);
  // Photographs one after another: unlike a screencast, they have every pixel of the screen.
  let filming = true;
  const filmed = (async () => {
    while (filming) {
      const asked = performance.now();
      // The clip is measured from the top of the document, and a page may be scrolled.
      const { cssVisualViewport: view } = await cdp.send('Page.getLayoutMetrics');
      const { data } = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        optimizeForSpeed: true,
        // Without a scale Chrome answers in CSS pixels, a third of the screen's.
        clip: {
          x: view.pageX,
          y: view.pageY,
          ...layouts.phone.viewport,
          scale: layouts.phone.deviceScaleFactor,
        },
      });
      const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.png`);
      writeFileSync(file, data, 'base64');
      frames.push({ file, time: (asked + performance.now()) / 2000 });
    }
  })();
  await act(page);
  filming = false;
  await filmed;
  await cdp.send('Animation.setPlaybackRate', { playbackRate: 1 });
  await page.evaluate(() => window.slowPage(1));
  await restore(page);
  await context.close();
  if (frames.length < 2) throw new Error(`No frames were recorded for ${name}.`);

  // Each frame lasts until the next was taken.
  const list = path.join(dir, 'frames.txt');
  writeFileSync(
    list,
    frames
      .map(({ file, time }, index) => {
        const next = frames[index + 1]?.time ?? time + 0.05 * SLOW;
        return `file '${file}'\nduration ${Math.max((next - time) / SLOW, 0.0005).toFixed(5)}`;
      })
      .join('\n'),
  );
  const file = path.join(recordings, `${name}-${theme}`);
  const input = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list];
  // VP9 at the screen's own size for the browsers that play it, which is nearly all of them.
  execFileSync('ffmpeg', [
    ...input,
    '-vf',
    `fps=${FPS}`,
    '-an',
    '-c:v',
    'libvpx-vp9',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '24',
    '-b:v',
    '0',
    '-row-mt',
    '1',
    '-cpu-used',
    '3',
    `${file}.webm`,
  ]);
  // H.264 for the rest. OpenH264 is the encoder a stock FFmpeg always has.
  execFileSync('ffmpeg', [
    ...input,
    '-vf',
    `fps=${FPS},scale=720:-2:flags=lanczos`,
    '-an',
    '-c:v',
    'libopenh264',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '6M',
    '-movflags',
    '+faststart',
    `${file}.mp4`,
  ]);
  const first = frames[0];
  if (first) await sharp(first.file).resize(720).jpeg({ quality: 82 }).toFile(`${file}.jpg`);
  rmSync(dir, { recursive: true, force: true });
  console.log(path.relative(root, `${file}.webm`), `${frames.length} frames`);
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);
/** A pause of this long in the finished clip. */
const roll = (page: Page, ms: number) => page.waitForTimeout(ms * SLOW);
const quickNote = { title: 'Call the plumber', body: 'Kitchen tap, before Friday' };

/** The clips, in the order the page lists them. Each leaves the account as it found it. */
const clips: {
  name: string;
  prepare?: (page: Page) => Promise<void>;
  act: (page: Page) => Promise<void>;
  restore?: (page: Page) => Promise<void>;
}[] = [
  {
    name: 'quick-note',
    // A new note lands first among the unpinned ones, which start below the first screen.
    prepare: async (page) => {
      const others = page.getByText('Others', { exact: true });
      // Twice: the header folds away on the first scroll and moves the page under it.
      for (let pass = 0; pass < 2; pass++) {
        await others.evaluate((heading) => {
          window.scrollBy({ top: heading.getBoundingClientRect().top - 130 });
        });
        await pause(page, 600);
      }
    },
    act: async (page) => {
      const editor = page
        .getByRole('region', { name: 'New note', exact: true })
        .getByRole('textbox');
      await roll(page, 500);
      await page.getByRole('button', { name: 'New note' }).tap();
      await editor.waitFor();
      await roll(page, 700);
      await page.keyboard.type(quickNote.title, { delay: 55 * SLOW });
      await page.keyboard.press('Enter');
      await page.keyboard.type(quickNote.body, { delay: 45 * SLOW });
      await roll(page, 600);
      await page.getByRole('button', { name: 'Save note' }).tap();
      await roll(page, 2400);
    },
    // The next recording starts from the same wall, so the note written here goes again.
    restore: async (page) => {
      const id = await card(page, quickNote.title).getAttribute('data-note-card');
      if (!id) throw new Error('The quick note was not saved.');
      await page.evaluate(async (noteId) => {
        const file = 'notes';
        const { deleteNoteForever } = await import(/* @vite-ignore */ `/src/lib/${file}.ts`);
        await deleteNoteForever(noteId).isPersisted.promise;
      }, id);
    },
  },
  {
    name: 'open-note',
    act: async (page) => {
      await roll(page, 500);
      await card(page, 'Lisbon weekend').getByRole('button', { name: 'Open note' }).tap();
      await roll(page, 2200);
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).tap();
      await roll(page, 1600);
    },
  },
  {
    name: 'note-color',
    prepare: async (page) => {
      await card(page, 'Gift ideas').getByRole('button', { name: 'Open note' }).tap();
      await page.getByRole('dialog').getByRole('textbox').waitFor();
    },
    act: async (page) => {
      const toolbar = page.getByRole('toolbar', { name: 'Note actions' });
      await roll(page, 400);
      await toolbar.getByRole('button', { name: 'Background color' }).tap();
      await roll(page, 1300);
      await page.getByRole('button', { name: 'Cyan', exact: true }).tap();
      await roll(page, 1300);
      await page.getByRole('button', { name: 'Blue', exact: true }).tap();
      await roll(page, 1300);
    },
  },
  {
    name: 'search-filters',
    prepare: async (page) => {
      await page.getByRole('link', { name: 'Search' }).tap();
      await page.getByRole('region', { name: 'Browse tags' }).waitFor();
    },
    act: async (page) => {
      const tag = (name: string) => page.getByRole('checkbox', { name, exact: true });
      await roll(page, 600);
      await page.getByRole('button', { name: 'Filter notes' }).tap();
      await roll(page, 1300);
      await page.getByRole('tab', { name: 'Tags' }).tap();
      await roll(page, 1300);
      await tag('Travel').tap();
      await roll(page, 1500);
      await tag('Home').tap();
      await roll(page, 1800);
    },
  },
];

// `docs [scene-name]` captures only guide assets, leaving marketing assets untouched.
mkdirSync(output, { recursive: true });
mkdirSync(recordings, { recursive: true });
if (process.argv[2] === 'android-docs') {
  await captureAndroid();
  process.exit(0);
}
const browser = await chromium.launch();
if (process.argv[2] === 'site') {
  try {
    const url = process.argv[3];
    if (!url) throw new Error('Usage: ./scripts/dev.sh screenshots site <site-url>');
    await captureSite(browser, url);
  } finally {
    await browser.close();
  }
  process.exit(0);
}
const storageState = await createAccount(browser);
{
  const context = await browser.newContext({ baseURL, storageState });
  const page = await openApp(context);
  await seed(page);
  await context.close();
}
const only = process.argv[2];
if (only === 'capabilities') {
  for (const theme of themes) {
    const context = await phoneContext(browser, storageState, theme);
    await captureCapabilities(context, theme);
    await context.close();
  }
  await browser.close();
  process.exit(0);
}
if (only === 'docs') {
  const admin = await adminAccount(browser);
  for (const theme of themes) {
    const context = await phoneContext(browser, storageState, theme);
    await captureDocs(context, theme, process.argv[3]);
    await context.close();
    if (!process.argv[3] || process.argv[3] === 'docs-sign-in') {
      const signedOut = await phoneContext(browser, { cookies: [], origins: [] }, theme);
      const page = await signedOut.newPage();
      await page.goto('/login');
      await page.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
      // Clear Vite's seeded credentials by using the form, as a visitor can.
      await page.getByLabel('Email', { exact: true }).fill('');
      await page.getByLabel('Password', { exact: true }).fill('');
      await page.getByLabel('Password', { exact: true }).blur();
      await save(page, 'docs-sign-in', theme);
      await signedOut.close();
    }
    const adminContext = await browser.newContext({
      ...layouts.desktop,
      baseURL,
      storageState: admin,
      colorScheme: theme,
      locale: 'en-US',
    });
    await captureAdmin(adminContext, theme, process.argv[3]);
    await adminContext.close();
  }
  await browser.close();
  process.exit(0);
}
for (const layout of Object.keys(layouts) as Layout[]) {
  if (only === 'recordings') break;
  for (const theme of themes) {
    const context =
      layout === 'phone'
        ? await phoneContext(browser, storageState, theme)
        : await browser.newContext({
            ...layouts[layout],
            baseURL,
            storageState,
            colorScheme: theme,
            locale: 'en-US',
          });
    await capture(context, layout, theme);
    if (layout === 'phone') await captureCapabilities(context, theme);
    await context.close();
  }
}
for (const theme of themes) {
  if (only === 'pictures') break;
  for (const clip of clips) {
    if (process.argv[3] && clip.name !== process.argv[3]) continue;
    await record(
      browser,
      storageState,
      theme,
      clip.name,
      clip.prepare ?? (async () => {}),
      clip.act,
      clip.restore ?? (async () => {}),
    );
  }
}
await browser.close();
