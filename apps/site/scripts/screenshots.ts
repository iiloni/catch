/**
 * Captures the app screenshots the site shows, in light and dark, from this worktree's
 * development stack: `./scripts/dev.sh screenshots`. Each run signs up a fresh account
 * and fills it with the notes below, so the pictures only change when the app does.
 */
import { execFileSync } from 'node:child_process';
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
  const { user } = (await response.json()) as { user: unknown };
  const state = {
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

const card = (page: Page, title: string) =>
  page.getByRole('article').filter({ has: page.getByRole('heading', { name: title }) });

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

/**
 * Records one interaction on the phone layout as a short silent clip, for the page's
 * motion section. Chrome's screencast gives frames at the screen's full resolution, each
 * with the time it was drawn, which FFmpeg (it must be installed) turns into a video.
 * Playwright's own recorder films at a third of that.
 */
async function record(
  browser: Browser,
  storageState: Awaited<ReturnType<typeof createAccount>>,
  theme: (typeof themes)[number],
  name: string,
  prepare: (page: Page) => Promise<void>,
  act: (page: Page) => Promise<void>,
) {
  const dir = mkdtempSync(path.join(tmpdir(), 'catch-recording-'));
  const context = await phoneContext(browser, storageState, theme);
  const page = await openApp(context);
  await card(page, 'Groceries').waitFor({ timeout: 60_000 });
  await prepare(page);
  await page.waitForTimeout(1500);

  const frames: { file: string; time: number }[] = [];
  const cdp = await context.newCDPSession(page);
  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    const file = path.join(dir, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(data, 'base64'));
    frames.push({ file, time: metadata.timestamp ?? 0 });
    void cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95, everyNthFrame: 1 });
  await act(page);
  await cdp.send('Page.stopScreencast');
  await context.close();
  if (frames.length < 2) throw new Error(`No frames were recorded for ${name}.`);

  // A frame is only sent when the screen changes, so each one lasts until the next.
  const list = path.join(dir, 'frames.txt');
  writeFileSync(
    list,
    frames
      .map(({ file, time }, index) => {
        const next = frames[index + 1]?.time ?? time + 0.4;
        return `file '${file}'\nduration ${Math.max(next - time, 0.001).toFixed(4)}`;
      })
      .join('\n'),
  );
  const file = path.join(recordings, `${name}-${theme}`);
  execFileSync('ffmpeg', [
    '-y',
    '-loglevel',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    list,
    // Two thirds of the screen's pixels: sharp at the size the page shows it, on any display.
    '-vf',
    'fps=60,scale=720:-2:flags=lanczos',
    '-an',
    // H.264 plays everywhere, and OpenH264 is the encoder a stock FFmpeg always has.
    '-c:v',
    'libopenh264',
    '-pix_fmt',
    'yuv420p',
    '-b:v',
    '5M',
    '-movflags',
    '+faststart',
    `${file}.mp4`,
  ]);
  const first = frames[0];
  if (first) await sharp(first.file).resize(720).jpeg({ quality: 82 }).toFile(`${file}.jpg`);
  rmSync(dir, { recursive: true, force: true });
  console.log(path.relative(root, `${file}.mp4`), `${frames.length} frames`);
}

const pause = (page: Page, ms: number) => page.waitForTimeout(ms);

/** The clips, in the order the page lists them. Each leaves the account as it found it. */
const clips: {
  name: string;
  prepare?: (page: Page) => Promise<void>;
  act: (page: Page) => Promise<void>;
}[] = [
  {
    name: 'open-note',
    act: async (page) => {
      await pause(page, 500);
      await card(page, 'Lisbon weekend').getByRole('button', { name: 'Open note' }).tap();
      await pause(page, 2200);
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).tap();
      await pause(page, 1600);
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
      await pause(page, 400);
      await toolbar.getByRole('button', { name: 'Background color' }).tap();
      await pause(page, 1300);
      await page.getByRole('button', { name: 'Cyan', exact: true }).tap();
      await pause(page, 1300);
      await page.getByRole('button', { name: 'Blue', exact: true }).tap();
      await pause(page, 1300);
    },
  },
  {
    name: 'tabs',
    act: async (page) => {
      await pause(page, 1200);
      await page.getByRole('link', { name: 'Deck' }).tap();
      await pause(page, 1700);
      await page.getByRole('link', { name: 'Gallery' }).tap();
      await pause(page, 1500);
    },
  },
];

mkdirSync(output, { recursive: true });
mkdirSync(recordings, { recursive: true });
const browser = await chromium.launch();
const storageState = await createAccount(browser);
{
  const context = await browser.newContext({ baseURL, storageState });
  const page = await openApp(context);
  await seed(page);
  await context.close();
}
const only = process.argv[2];
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
    await context.close();
  }
}
for (const theme of themes) {
  if (only === 'pictures') break;
  for (const clip of clips) {
    await record(
      browser,
      storageState,
      theme,
      clip.name,
      clip.prepare ?? (async () => {}),
      clip.act,
    );
  }
}
await browser.close();
