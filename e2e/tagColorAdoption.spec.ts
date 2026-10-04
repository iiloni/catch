import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { z } from 'zod';
import { MAX_NOTES_PER_REQUEST } from '../packages/shared/src/notes';
import { bearerToken } from './helpers';

const id = () => {
  const value = randomUUID();
  return `${value.slice(0, 14)}7${value.slice(15)}`;
};

test('color linking adopts more assignments than one Postgres statement can bind', {
  tag: '@api',
}, async ({ request, baseURL }) => {
  test.setTimeout(180_000);
  const response = await request.post('/api/auth/sign-up/email', {
    headers: { Origin: new URL(baseURL!).origin },
    data: { email: `large-color-${randomUUID()}@example.com`, name: '', password: 'password123' },
  });
  expect(response.ok()).toBe(true);
  const headers = { Authorization: `Bearer ${bearerToken(response)}` };
  // Four bind parameters per assignment exceeded the 65,535 limit before batching.
  const noteIds = Array.from({ length: 17_000 }, id);
  for (let offset = 0; offset < noteIds.length; offset += MAX_NOTES_PER_REQUEST) {
    const result = await request.post('/api/notes/batch', {
      headers,
      data: {
        notes: noteIds.slice(offset, offset + MAX_NOTES_PER_REQUEST).map((id) => ({
          id,
          content: [],
          color: 'blue',
        })),
      },
    });
    expect(result.status()).toBe(201);
  }
  const tagId = id();
  const result = await request.post('/api/tags', {
    headers,
    data: { id: tagId, name: 'Large account', parentId: null, color: 'blue', icon: null },
  });
  expect(result.status()).toBe(200);
  const shape = await request.get('/api/shapes/note-tags?offset=-1', { headers });
  expect(shape.status()).toBe(200);
  const entries = z
    .array(
      z.object({
        value: z.object({ id: z.string(), primary_tag_id: z.string().nullable() }).optional(),
      }),
    )
    .parse(await shape.json());
  const assignments = entries.flatMap(({ value }) => (value ? [value] : []));
  expect(new Set(assignments.map(({ id }) => id))).toEqual(new Set(noteIds));
  expect(assignments.every(({ primary_tag_id }) => primary_tag_id === tagId)).toBe(true);
});
