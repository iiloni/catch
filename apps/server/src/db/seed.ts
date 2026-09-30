import { blocksToPlainText, type NoteColor, positionBetween } from '@catch/shared';
import { eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { auth } from '../auth';
import { fetchPreviewsNow, trackNoteLinks } from '../linkPreviews';
import { sql as connection, db } from './client';
import { linkPreviews, notes, user } from './schema';

/**
 * Idempotent development fixtures. `basic` creates the admin account; `demo`
 * adds a regular user and sample notes. Never overwrites existing data.
 */
const profile = process.env.CATCH_SEED_PROFILE ?? 'none';

const ACCOUNTS = {
  admin: { name: 'Admin', email: 'admin@example.com', password: 'adminadmin' },
  user: { name: 'Demo User', email: 'user@example.com', password: 'userpassword' },
};

const DEMO_NOTES: { lines: string[]; color: NoteColor; status?: string; isPinned?: boolean }[] = [
  { lines: ['Groceries', 'Oat milk', 'Eggs', 'Coffee'], color: 'yellow', isPinned: true },
  { lines: ['Ideas for Catch', 'Board view', 'Link previews'], color: 'default', status: 'new' },
  { lines: ['Books to read', 'The Dispossessed'], color: 'teal' },
  { lines: ['Trip packing list', 'Charger', 'Passport'], color: 'purple', status: 'in_progress' },
  { lines: ['Dentist Tuesday 3pm'], color: 'red' },
];

type Block = Record<string, unknown>;

const text = (value: string) => ({ type: 'text', text: value, styles: {} });
const link = (href: string, label: string) => ({ type: 'link', href, content: [text(label)] });
const heading = (value: string): Block => ({
  type: 'heading',
  props: { level: 3 },
  content: [text(value)],
});
const paragraph = (...content: Array<string | Block>): Block => ({
  type: 'paragraph',
  content: content.map((item) => (typeof item === 'string' ? text(item) : item)),
});
const bullet = (...content: Array<string | Block>): Block => ({
  ...paragraph(...content),
  type: 'bulletListItem',
});

/**
 * Notes that show off link previews: a note that is only a link, a list of links, a bare URL
 * in text, and a note long enough that its links scroll out of view.
 */
const LINK_NOTES: { content: Block[]; color: NoteColor; isPinned?: boolean }[] = [
  {
    content: [
      heading('Lisbon weekend'),
      ...[
        'Friday: land around noon, drop bags, pastéis de nata at Manteigaria.',
        'Friday evening: sunset from the Miradouro da Senhora do Monte.',
        'Saturday: tram 28 early, before the crowds, then the Alfama on foot.',
        'Saturday lunch: grilled sardines anywhere with a queue of locals.',
        'Saturday afternoon: the tile museum, then a ferry across to Cacilhas.',
        'Saturday night: dinner in the Bairro Alto, fado if we can get in.',
        'Sunday: train to Sintra, Pena Palace first thing, then the Moorish castle.',
        'Sunday evening: back for a last dinner by the river in Cais do Sodré.',
        'Pack: good walking shoes (the hills), a light jacket, the adapter.',
      ].map((line) => paragraph(line)),
      paragraph(
        'Background: ',
        link('https://en.wikipedia.org/wiki/Lisbon', 'Lisbon on Wikipedia'),
        ', and what’s on that weekend: https://www.timeout.com/lisbon',
      ),
    ],
    color: 'amber',
  },
  {
    content: [
      paragraph(
        'Could notes have sketches? tldraw looks like a good fit: https://github.com/tldraw/tldraw',
      ),
    ],
    color: 'teal',
  },
  {
    content: [
      heading('Local-first reading'),
      paragraph('How the sync in Catch works, and why.'),
      bullet(link('https://www.inkandswitch.com/essay/local-first/', 'Local-first software')),
      bullet(link('https://electric-sql.com/', 'Electric')),
      bullet(link('https://tanstack.com/db', 'TanStack DB')),
      bullet(link('https://blocknotejs.org/', 'BlockNote')),
    ],
    color: 'default',
    isPinned: true,
  },
  {
    content: [
      paragraph(
        link(
          'https://www.youtube.com/watch?v=jNQXAC9IVRw',
          'https://www.youtube.com/watch?v=jNQXAC9IVRw',
        ),
      ),
    ],
    color: 'default',
  },
];

async function ensureAccount(account: (typeof ACCOUNTS)[keyof typeof ACCOUNTS]) {
  const [existing] = await db.select().from(user).where(eq(user.email, account.email));
  if (existing) return existing.id;
  const result = await auth.api.signUpEmail({ body: account });
  console.log(`Seeded account ${account.email} / ${account.password}`);
  return result.user.id;
}

async function ensureDemoNotes(userId: string) {
  const [existing] = await db.select({ id: notes.id }).from(notes).where(eq(notes.userId, userId));
  if (existing) return;
  let position: string | null = null;
  await db.insert(notes).values(
    DEMO_NOTES.map(({ lines, color, status, isPinned }) => {
      position = positionBetween(position, null);
      const content = lines.map((text, index) => ({
        type: index === 0 ? 'heading' : 'paragraph',
        ...(index === 0 ? { props: { level: 3 } } : {}),
        content: [{ type: 'text', text, styles: {} }],
      }));
      return {
        id: uuidv7(),
        userId,
        content,
        searchText: blocksToPlainText(content),
        color,
        status: status ?? null,
        isPinned: isPinned ?? false,
        position,
      };
    }),
  );
  console.log(`Seeded ${DEMO_NOTES.length} demo notes`);
}

/**
 * Adds the link notes and fetches their previews. Skipped once the account has any previews,
 * so it runs once on existing databases too. Pages that cannot be reached (offline, say)
 * leave previews that failed, which are tried again when their notes are saved.
 */
async function ensureLinkNotes(userId: string) {
  const [existing] = await db
    .select({ url: linkPreviews.url })
    .from(linkPreviews)
    .where(eq(linkPreviews.userId, userId))
    .limit(1);
  if (existing) return;
  // Ahead of the other demo notes, in the order listed.
  const [first] = await db
    .select({ position: notes.position })
    .from(notes)
    .where(eq(notes.userId, userId))
    .orderBy(sql`${notes.position} collate "C"`)
    .limit(1);
  let position: string | null = null;
  const urls = await db.transaction(async (tx) => {
    const found: string[] = [];
    for (const { content, color, isPinned } of LINK_NOTES) {
      position = positionBetween(position, first?.position ?? null);
      await tx.insert(notes).values({
        id: uuidv7(),
        userId,
        content,
        searchText: blocksToPlainText(content),
        color,
        isPinned: isPinned ?? false,
        position,
      });
      found.push(...(await trackNoteLinks(tx, userId, [content])));
    }
    return found;
  });
  console.log(`Seeded ${LINK_NOTES.length} notes with links; fetching ${urls.length} previews`);
  await fetchPreviewsNow(userId, urls);
}

if (profile === 'basic' || profile === 'demo') {
  const adminId = await ensureAccount(ACCOUNTS.admin);
  if (profile === 'demo') {
    await ensureAccount(ACCOUNTS.user);
    await ensureDemoNotes(adminId);
    await ensureLinkNotes(adminId);
  }
} else if (profile !== 'none') {
  throw new Error(`Unknown CATCH_SEED_PROFILE "${profile}". Use none, basic or demo.`);
}

await connection.end();
