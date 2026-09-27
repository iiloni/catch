import { blocksToPlainText, type NoteColor } from '@catch/shared';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { auth } from '../auth';
import { db, sql } from './client';
import { notes, user } from './schema';

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
  await db.insert(notes).values(
    DEMO_NOTES.map(({ lines, color, status, isPinned }) => {
      const content = lines.map((text, index) => ({
        type: index === 0 ? 'heading' : 'paragraph',
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
      };
    }),
  );
  console.log(`Seeded ${DEMO_NOTES.length} demo notes`);
}

if (profile === 'basic' || profile === 'demo') {
  const adminId = await ensureAccount(ACCOUNTS.admin);
  if (profile === 'demo') {
    await ensureAccount(ACCOUNTS.user);
    await ensureDemoNotes(adminId);
  }
} else if (profile !== 'none') {
  throw new Error(`Unknown CATCH_SEED_PROFILE "${profile}". Use none, basic or demo.`);
}

await sql.end();
