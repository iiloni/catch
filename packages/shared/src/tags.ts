import { z } from 'zod';
import { NOTE_COLORS, type NoteColor } from './colors';

export const TAG_ICONS = [
  'tag',
  'briefcase',
  'house',
  'heart',
  'book-open',
  'graduation-cap',
  'lightbulb',
  'plane',
  'map-pin',
  'globe',
  'car',
  'bike',
  'train',
  'utensils',
  'coffee',
  'shopping-cart',
  'gift',
  'wallet',
  'landmark',
  'chart-no-axes-combined',
  'code',
  'laptop',
  'smartphone',
  'camera',
  'image',
  'music',
  'film',
  'gamepad-2',
  'palette',
  'paintbrush',
  'pen',
  'notebook',
  'calendar',
  'clock',
  'check',
  'list-todo',
  'target',
  'flag',
  'star',
  'sparkles',
  'rocket',
  'flask-conical',
  'wrench',
  'hammer',
  'key-round',
  'shield',
  'stethoscope',
  'pill',
  'dumbbell',
  'footprints',
  'leaf',
  'flower-2',
  'trees',
  'sun',
  'moon',
  'cloud',
  'paw-print',
  'baby',
  'users',
  'message-circle',
  'mail',
  'archive',
  'folder',
  'building-2',
] as const;

export const tagSchema = z.object({
  id: z.uuid({ version: 'v7' }),
  userId: z.string(),
  name: z.string().trim().min(1).max(100),
  parentId: z.uuid({ version: 'v7' }).nullable(),
  icon: z.enum(TAG_ICONS).nullable(),
  color: z.enum(NOTE_COLORS).exclude(['default']).nullable(),
});
export type Tag = z.infer<typeof tagSchema>;
export type TagIconName = (typeof TAG_ICONS)[number];
export const createTagSchema = tagSchema
  .omit({ userId: true })
  .refine(
    (tag) => tag.parentId === null || (tag.icon === null && tag.color === null),
    'Only top-level tags can have an icon or color',
  );
export type CreateTag = z.infer<typeof createTagSchema>;
export const updateTagSchema = tagSchema.omit({ id: true, userId: true }).partial();
export type UpdateTag = z.infer<typeof updateTagSchema>;

export const noteTagsSchema = z.object({
  /** One assignment row per note; its key is the note's UUID. */
  id: z.uuid({ version: 'v7' }),
  userId: z.string(),
  primaryTagId: z.uuid({ version: 'v7' }).nullable(),
  secondaryTagIds: z.array(z.uuid({ version: 'v7' })),
});
export type NoteTags = z.infer<typeof noteTagsSchema>;
export const updateNoteTagsSchema = noteTagsSchema
  .pick({ primaryTagId: true, secondaryTagIds: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'Select an assignment to change');
export type UpdateNoteTags = z.infer<typeof updateNoteTagsSchema>;

/** Iterative and defensive: very deep trees and a partial sync never recurse forever. */
export function tagPath(tags: readonly Tag[], id: string): Tag[] {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const seen = new Set<string>();
  const path: Tag[] = [];
  let current = byId.get(id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.push(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path.reverse();
}

export function tagColor(tags: readonly Tag[], id: string | null): NoteColor {
  return id ? (tagPath(tags, id)[0]?.color ?? 'default') : 'default';
}

/** Secondary ancestors add no detail beyond an assigned descendant. Primaries are independent. */
export function secondaryTagAncestors(
  tags: readonly Tag[],
  ids: readonly string[],
): Map<string, string> {
  const byId = new Map(tags.map((tag) => [tag.id, tag]));
  const ancestors = new Map<string, string>();
  for (const id of ids) {
    const seen = new Set([id]);
    let parent = byId.get(id)?.parentId;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      ancestors.set(parent, id);
      parent = byId.get(parent)?.parentId;
    }
  }
  return ancestors;
}

export function normalizeSecondaryTags(tags: readonly Tag[], ids: readonly string[]): string[] {
  const ancestors = secondaryTagAncestors(tags, ids);
  return [...new Set(ids)].filter((id) => !ancestors.has(id));
}

export function tagSubtreeIds(tags: readonly Tag[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const tag of tags) {
    if (!tag.parentId) continue;
    const siblings = children.get(tag.parentId) ?? [];
    siblings.push(tag.id);
    children.set(tag.parentId, siblings);
  }
  const found = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const next = pending.pop();
    if (!next || found.has(next)) continue;
    found.add(next);
    pending.push(...(children.get(next) ?? []));
  }
  return found;
}

export function tagTree(tags: readonly Tag[]): { tag: Tag; depth: number }[] {
  const children = new Map<string | null, Tag[]>();
  for (const tag of tags) {
    const siblings = children.get(tag.parentId) ?? [];
    siblings.push(tag);
    children.set(tag.parentId, siblings);
  }
  for (const siblings of children.values()) siblings.sort((a, b) => a.name.localeCompare(b.name));
  const pending = [...(children.get(null) ?? [])].reverse().map((tag) => ({ tag, depth: 0 }));
  const rows: { tag: Tag; depth: number }[] = [];
  const seen = new Set<string>();
  while (pending.length) {
    const row = pending.pop();
    if (!row || seen.has(row.tag.id)) continue;
    seen.add(row.tag.id);
    rows.push(row);
    pending.push(
      ...[...(children.get(row.tag.id) ?? [])]
        .reverse()
        .map((tag) => ({ tag, depth: row.depth + 1 })),
    );
  }
  return rows;
}
