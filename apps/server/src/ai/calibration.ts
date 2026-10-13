import { eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { aiConfiguration } from '../db/schema';
import { readConfiguration } from './configuration';
import { openCredential } from './credentials';
import { embed, queryProvider } from './provider';

/** A library smaller than this says too little about what an unrelated note scores. */
const MIN_NOTES = 10;
const MIN_QUERIES = 5;
const MAX_QUERIES = 40;
/** How far above the typical unrelated note a match must stand, in robust standard deviations. */
const SPREAD = 1.5;

function median(values: readonly number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = (sorted.length - 1) / 2;
  return (sorted[Math.floor(middle)]! + sorted[Math.ceil(middle)]!) / 2;
}

/**
 * The similarity a note must pass to count as related. Most notes have nothing to do with a
 * given query, so each query's median score is what noise looks like for it and the median
 * deviation how far noise strays; the few related notes barely move either. The median over
 * queries then keeps one unusual query from setting the bar.
 */
export function floorFrom(samples: readonly (readonly number[])[]) {
  const floors = samples
    .filter((scores) => scores.length >= MIN_NOTES - 1)
    .map((scores) => {
      const typical = median(scores);
      const strays = median(scores.map((score) => Math.abs(score - typical)));
      return typical + SPREAD * 1.4826 * strays;
    });
  if (floors.length < MIN_QUERIES) return null;
  return Math.min(0.95, Math.max(0, median(floors)));
}

/**
 * Measures how similar this model finds notes that have nothing to do with a query, so
 * search can leave such notes out (ADR 0002). Embedding models differ widely here: one puts
 * unrelated text near 0.1 and another near 0.6, so no fixed number serves. Note titles stand
 * in for queries: they are short, in the library's own language, and already known to the
 * provider.
 */
export async function measureSimilarityFloor(signal?: AbortSignal) {
  const config = await readConfiguration();
  if (!config?.enabled || !config.dimensions) return null;
  const titles = await db.execute<{ note_id: string; user_id: string; title: string }>(sql`
    WITH libraries AS (
      SELECT user_id FROM note_embeddings WHERE generation = ${config.generation}::uuid
      GROUP BY user_id HAVING count(DISTINCT note_id) >= ${MIN_NOTES}
    ), titled AS (
      SELECT DISTINCT ON (lower(title)) n.id AS note_id, n.user_id, title
      FROM notes n JOIN libraries l ON l.user_id = n.user_id,
        LATERAL (SELECT left(btrim(split_part(btrim(n.search_text), E'\n', 1)), 120) AS title) t
      WHERE n.deleted_at IS NULL AND char_length(title) >= 3
        AND EXISTS (SELECT 1 FROM note_embeddings e WHERE e.note_id = n.id
          AND e.generation = ${config.generation}::uuid)
      ORDER BY lower(title), n.id
    ) SELECT * FROM titled ORDER BY random() LIMIT ${MAX_QUERIES}
  `);
  if (titles.length < MIN_QUERIES) return { floor: null, generation: config.generation };
  const vectors = await embed(
    queryProvider({ ...config.embedding, apiKey: openCredential(config.apiKey) }),
    titles.map((row) => row.title),
    true,
    signal,
  );
  const samples: number[][] = [];
  for (const [index, row] of titles.entries()) {
    const scores = await db.execute<{ similarity: number }>(sql`
      SELECT 1 - min(e.embedding <=> ${JSON.stringify(vectors[index])}::vector) AS similarity
      FROM note_embeddings e
      WHERE e.user_id = ${row.user_id} AND e.generation = ${config.generation}::uuid
        AND e.note_id <> ${row.note_id}::uuid
      GROUP BY e.note_id
    `);
    samples.push(scores.map((score) => Number(score.similarity)));
  }
  return { floor: floorFrom(samples), generation: config.generation };
}

/** How long a measurement stands. A growing library and a corrected query format both move it. */
const STALE_AFTER = 24 * 60 * 60 * 1000;

/**
 * Measures and saves the floor once the index is complete, and again when it has gone stale.
 * Too small a library saves none, and search then leaves nothing out.
 */
export async function calibrateSearch(signal?: AbortSignal) {
  const config = await readConfiguration();
  if (!config?.enabled || !config.dimensions) return;
  if (config.calibratedAt && Date.now() - config.calibratedAt.getTime() < STALE_AFTER) return;
  const [pending] = await db.execute(
    sql`SELECT 1 FROM embedding_jobs WHERE failed_at IS NULL LIMIT 1`,
  );
  if (pending) return;
  const measured = await measureSimilarityFloor(signal);
  if (!measured || signal?.aborted) return;
  // An index replaced meanwhile is measured on its own.
  await db
    .update(aiConfiguration)
    .set({ similarityFloor: measured.floor, calibratedAt: new Date() })
    .where(
      sql`${eq(aiConfiguration.id, 'default')} AND ${aiConfiguration.generation} = ${measured.generation}::uuid`,
    );
}
