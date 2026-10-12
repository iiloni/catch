import type { HybridSearch, HybridSearchResult } from '@catch/shared';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { readConfiguration } from './configuration';
import { openCredential } from './credentials';
import { embed, ProviderError } from './provider';

export async function capabilities(userId: string) {
  const config = await readConfiguration();
  const [pending] =
    await db.execute(sql`SELECT 1 FROM embedding_jobs j WHERE j.failed_at IS NULL AND (j.user_id = ${userId}
    OR EXISTS (SELECT 1 FROM shared_notes s WHERE s.user_id = ${userId} AND s.note_id = j.note_id AND s.is_available)) LIMIT 1`);
  return { enabled: !!config?.enabled && !!config.dimensions, indexing: !!pending };
}

export async function hybridSearch(
  userId: string,
  input: HybridSearch,
  signal?: AbortSignal,
): Promise<HybridSearchResult> {
  const config = await readConfiguration();
  if (!config?.enabled || !config.dimensions)
    throw new ProviderError('AI search is not enabled on this server.');
  const [vector] = await embed(
    { ...config.embedding, apiKey: openCredential(config.apiKey) },
    [input.query],
    true,
    signal,
  );
  if (vector?.length !== config.dimensions)
    throw new ProviderError(
      'The embedding model changed. Ask an admin to test and save its configuration.',
    );
  const current = await readConfiguration();
  if (!current?.enabled || current.generation !== config.generation)
    throw new ProviderError('AI configuration changed. Try searching again.');
  const hits = await rankNotes(userId, input, vector, config.generation);
  return { hits, indexing: (await capabilities(userId)).indexing };
}

/** Both candidate lists start with the same authorized, filtered notes, before either limit. */
export async function rankNotes(
  userId: string,
  input: HybridSearch,
  vector: number[],
  generation: string,
) {
  const rows = await db.execute<{ id: string; updated_at: Date; semantic: boolean }>(sql`
    WITH RECURSIVE ancestors(id, ancestor, parent, color) AS (
      SELECT id, id, parent_id, color FROM tags WHERE user_id = ${userId}
      UNION
      SELECT a.id, t.id, t.parent_id, t.color FROM ancestors a
      JOIN tags t ON t.id = a.parent AND t.user_id = ${userId}
    ), mine AS (
      SELECT n.id, n.search_text, n.search, n.updated_at, n.is_archived,
        CASE WHEN nt.primary_tag_id IS NOT NULL THEN coalesce((SELECT color FROM ancestors
          WHERE id = nt.primary_tag_id AND color IS NOT NULL LIMIT 1), 'default') ELSE n.color END AS color,
        ARRAY(SELECT DISTINCT a.ancestor::text FROM ancestors a WHERE a.id = nt.primary_tag_id
          OR nt.secondary_tag_ids ? a.id::text) AS tags
      FROM notes n LEFT JOIN note_tags nt ON nt.id = n.id AND nt.user_id = ${userId}
      WHERE n.user_id = ${userId} AND n.deleted_at IS NULL
      UNION ALL
      SELECT n.id, n.search_text, n.search, s.updated_at, s.is_archived, s.color, ARRAY[]::text[]
      FROM shared_notes s JOIN notes n ON n.id = s.note_id AND n.user_id = s.owner_id
      JOIN note_shares ns ON ns.note_id = s.note_id AND ns.token = s.token
      WHERE s.user_id = ${userId} AND s.is_available AND n.deleted_at IS NULL
    ), eligible AS MATERIALIZED (
      SELECT * FROM mine WHERE (${input.showArchived} OR NOT is_archived)
        AND (${input.color}::text IS NULL OR color = ${input.color})
        AND CASE WHEN ${input.untagged} THEN cardinality(tags) = 0
          WHEN jsonb_array_length(${JSON.stringify(input.tags)}::jsonb) = 0 THEN true
          WHEN ${input.match} = 'all' THEN tags @> ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.tags)}::jsonb))
          ELSE tags && ARRAY(SELECT jsonb_array_elements_text(${JSON.stringify(input.tags)}::jsonb)) END
    ), terms AS (SELECT jsonb_array_elements_text(${JSON.stringify(input.query.toLowerCase().split(/\s+/))}::jsonb) AS word),
    keyword_candidates AS (
      SELECT id,
        EXISTS (SELECT 1 FROM terms WHERE position(word IN lower(split_part(search_text, E'\n', 1))) > 0) AS title_hit,
        ts_rank_cd(search, plainto_tsquery('english', ${input.query})) AS relevance,
        updated_at
      FROM eligible WHERE search @@ plainto_tsquery('english', ${input.query})
        OR NOT EXISTS (SELECT 1 FROM terms WHERE position(word IN lower(search_text)) = 0)
      ORDER BY title_hit DESC, relevance DESC, updated_at DESC, id LIMIT 120
    ), keyword_rank AS (SELECT id, row_number() OVER (ORDER BY title_hit DESC, relevance DESC, updated_at DESC, id) AS rank FROM keyword_candidates),
    semantic_candidates AS (
      SELECT n.id, min(e.embedding <=> ${JSON.stringify(vector)}::vector) AS distance
      FROM eligible n JOIN note_embeddings e ON e.note_id = n.id AND e.generation = ${generation}::uuid
        AND e.content_hash = md5(n.search_text)
      GROUP BY n.id ORDER BY distance, n.id LIMIT 120
    ), semantic_rank AS (SELECT id, row_number() OVER (ORDER BY distance, id) AS rank FROM semantic_candidates),
    fused AS (
      SELECT coalesce(k.id, s.id) AS id, k.id IS NULL AS semantic,
        coalesce(1.0 / (60 + k.rank), 0) + coalesce(1.0 / (60 + s.rank), 0) AS score
      FROM keyword_rank k FULL OUTER JOIN semantic_rank s ON k.id = s.id
    ) SELECT f.id, n.updated_at, f.semantic FROM fused f JOIN eligible n ON n.id = f.id
      ORDER BY f.score DESC, n.updated_at DESC, f.id LIMIT 60
  `);
  return rows.map((row) => ({
    id: row.id,
    updatedAt: new Date(row.updated_at).toISOString(),
    semantic: row.semantic,
  }));
}
