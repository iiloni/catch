import {
  createTagSchema,
  normalizeSecondaryTags,
  type Tag,
  tagSubtreeIds,
  updateNoteTagsSchema,
  updateTagSchema,
} from '@catch/shared';
import { zValidator } from '@hono/zod-validator';
import { and, eq, inArray, isNotNull, notExists, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../context';
import { db } from '../db/client';
import { notes, noteTags, tags } from '../db/schema';
import { requireUser } from '../lib/requireUser';
import { lockTagTree } from '../lib/tagTreeLock';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const idParam = zValidator('param', z.object({ id: z.uuid({ version: 'v7' }) }));

async function txid(tx: Tx) {
  const [row] = await tx.execute<{ txid: string }>(
    sql`SELECT pg_current_xact_id()::xid::text AS txid`,
  );
  return Number(row?.txid);
}
async function userTags(tx: Tx, userId: string) {
  return (await tx.select().from(tags).where(eq(tags.userId, userId))) as Tag[];
}

class TagError extends Error {
  constructor(
    message: string,
    readonly status: 404 | 409 = 409,
  ) {
    super(message);
  }
}
function validateTag(candidate: Tag, rows: readonly Tag[]) {
  if (candidate.parentId) {
    if (!rows.some((tag) => tag.id === candidate.parentId))
      throw new TagError('Parent tag not found', 404);
    if (tagSubtreeIds(rows, candidate.id).has(candidate.parentId))
      throw new TagError('A tag cannot be moved into its own branch');
    if (candidate.color || candidate.icon)
      throw new TagError('Only top-level tags can have an icon or color');
  }
  if (
    candidate.color &&
    rows.some((tag) => tag.id !== candidate.id && tag.color === candidate.color)
  ) {
    throw new TagError('That color is already linked to another tag');
  }
}

async function tagPlainColorNotes(tx: Tx, userId: string, tag: Tag) {
  if (!tag.color) return;
  // Lock matching notes before reading their assignments; color edits and assignment
  // writes share the tree lock, while content edits can proceed independently.
  const matching = await tx
    .update(notes)
    .set({ color: 'default', updatedAt: sql`${notes.updatedAt}` })
    .where(
      and(
        eq(notes.userId, userId),
        eq(notes.color, tag.color),
        notExists(
          tx
            .select({ id: noteTags.id })
            .from(noteTags)
            .where(
              and(
                eq(noteTags.id, notes.id),
                eq(noteTags.userId, userId),
                isNotNull(noteTags.primaryTagId),
              ),
            ),
        ),
      ),
    )
    .returning({ id: notes.id });
  if (!matching.length) return;
  // Bound both the IN list and the four parameters per assignment below Postgres's limit.
  for (let offset = 0; offset < matching.length; offset += 1000) {
    const batch = matching.slice(offset, offset + 1000);
    const assignments = await tx
      .select()
      .from(noteTags)
      .where(
        and(
          eq(noteTags.userId, userId),
          inArray(
            noteTags.id,
            batch.map(({ id }) => id),
          ),
        ),
      );
    const byId = new Map(assignments.map((assignment) => [assignment.id, assignment]));
    await tx
      .insert(noteTags)
      .values(
        batch.map(({ id }) => ({
          id,
          userId,
          primaryTagId: tag.id,
          secondaryTagIds: (byId.get(id)?.secondaryTagIds ?? []).filter((id) => id !== tag.id),
        })),
      )
      .onConflictDoUpdate({
        target: noteTags.id,
        set: {
          primaryTagId: tag.id,
          secondaryTagIds: sql`excluded.secondary_tag_ids`,
        },
        setWhere: eq(noteTags.userId, userId),
      });
  }
}

export const tagRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .onError((error, c) => {
    if (error instanceof TagError) return c.json({ error: error.message }, error.status);
    throw error;
  })
  .post('/', zValidator('json', createTagSchema), async (c) => {
    const userId = c.get('user')!.id;
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      await lockTagTree(tx, userId);
      const rows = await userTags(tx, userId);
      if (rows.some((tag) => tag.id === body.id)) return null;
      validateTag({ ...body, userId }, rows);
      const inserted = await tx
        .insert(tags)
        .values({ ...body, userId })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length) throw new TagError('Tag id is taken');
      await tagPlainColorNotes(tx, userId, { ...body, userId });
      return txid(tx);
    });
    return c.json({ txid: result });
  })
  .patch('/:id', idParam, zValidator('json', updateTagSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      await lockTagTree(tx, userId);
      const rows = await userTags(tx, userId);
      const current = rows.find((tag) => tag.id === id);
      if (!current) throw new TagError('Tag not found', 404);
      const candidate = { ...current, ...body };
      validateTag(candidate, rows);
      if (!Object.keys(body).length) return null;
      await tx
        .update(tags)
        .set(body)
        .where(and(eq(tags.id, id), eq(tags.userId, userId)));
      if (body.parentId !== undefined) {
        const next = rows.map((tag) => (tag.id === id ? candidate : tag));
        const assignments = await tx.select().from(noteTags).where(eq(noteTags.userId, userId));
        for (const assignment of assignments) {
          const secondaryTagIds = normalizeSecondaryTags(next, assignment.secondaryTagIds);
          if (secondaryTagIds.length === assignment.secondaryTagIds.length) continue;
          await tx
            .update(noteTags)
            .set({ secondaryTagIds })
            .where(and(eq(noteTags.id, assignment.id), eq(noteTags.userId, userId)));
        }
      }
      if (candidate.color && candidate.color !== current.color)
        await tagPlainColorNotes(tx, userId, candidate);
      return txid(tx);
    });
    return c.json({ txid: result });
  })
  .delete('/:id', idParam, async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const result = await db.transaction(async (tx) => {
      await lockTagTree(tx, userId);
      const rows = await userTags(tx, userId);
      if (!rows.some((tag) => tag.id === id)) return null;
      const removed = tagSubtreeIds(rows, id);
      const assignments = await tx.select().from(noteTags).where(eq(noteTags.userId, userId));
      for (const assignment of assignments) {
        const secondaryTagIds = assignment.secondaryTagIds.filter((tagId) => !removed.has(tagId));
        if (
          !removed.has(assignment.primaryTagId ?? '') &&
          secondaryTagIds.length === assignment.secondaryTagIds.length
        )
          continue;
        await tx
          .update(noteTags)
          .set({
            primaryTagId: removed.has(assignment.primaryTagId ?? '')
              ? null
              : assignment.primaryTagId,
            secondaryTagIds,
          })
          .where(and(eq(noteTags.id, assignment.id), eq(noteTags.userId, userId)));
      }
      await tx.delete(tags).where(and(eq(tags.userId, userId), inArray(tags.id, [...removed])));
      return txid(tx);
    });
    return c.json({ txid: result });
  });

export const noteTagRoutes = new Hono<AppEnv>()
  .use(requireUser)
  .onError((error, c) => {
    if (error instanceof TagError) return c.json({ error: error.message }, error.status);
    throw error;
  })
  .patch('/:id', idParam, zValidator('json', updateNoteTagsSchema), async (c) => {
    const userId = c.get('user')!.id;
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const result = await db.transaction(async (tx) => {
      await lockTagTree(tx, userId);
      const [note] = await tx
        .select({ id: notes.id })
        .from(notes)
        .where(and(eq(notes.id, id), eq(notes.userId, userId)));
      if (!note) throw new TagError('Note not found', 404);
      const [current] = await tx
        .select()
        .from(noteTags)
        .where(and(eq(noteTags.id, id), eq(noteTags.userId, userId)));
      const primaryTagId =
        body.primaryTagId === undefined ? (current?.primaryTagId ?? null) : body.primaryTagId;
      const rows = await userTags(tx, userId);
      const secondaryTagIds = normalizeSecondaryTags(
        rows,
        [...new Set(body.secondaryTagIds ?? current?.secondaryTagIds ?? [])].filter(
          (tagId) => tagId !== primaryTagId,
        ),
      );
      const mine = new Set(rows.map((tag) => tag.id));
      if (
        [...secondaryTagIds, ...(primaryTagId ? [primaryTagId] : [])].some(
          (tagId) => !mine.has(tagId),
        )
      )
        throw new TagError('Tag not found', 404);
      if (body.primaryTagId) {
        await tx
          .update(notes)
          .set({ color: 'default', updatedAt: sql`${notes.updatedAt}` })
          .where(and(eq(notes.id, id), eq(notes.userId, userId)));
      }
      await tx
        .insert(noteTags)
        .values({ id, userId, primaryTagId, secondaryTagIds })
        .onConflictDoUpdate({
          target: noteTags.id,
          set: { primaryTagId, secondaryTagIds },
          setWhere: eq(noteTags.userId, userId),
        });
      return txid(tx);
    });
    return c.json({ txid: result });
  });
