import { randomUUID } from 'node:crypto';
import {
  type AiConfiguration,
  DEFAULT_EMBEDDING_CONFIGURATION,
  embeddingInputForModel,
  type SaveAiConfiguration,
} from '@catch/shared';
import { eq, sql } from 'drizzle-orm';
import { type Db, db } from '../db/client';
import { aiConfiguration, embeddingJobs, noteEmbeddings, user } from '../db/schema';
import { openCredential, sealCredential } from './credentials';
import { embed, type Provider, ProviderError } from './provider';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export async function readConfiguration() {
  return (
    (await db.select().from(aiConfiguration).where(eq(aiConfiguration.id, 'default')))[0] ?? null
  );
}

export async function resolveProvider(
  input: Pick<SaveAiConfiguration, 'embedding' | 'apiKey'>,
): Promise<Provider> {
  const saved = await readConfiguration();
  // Never forward a saved credential to a different endpoint, including a connection test.
  const sameDestination =
    saved?.embedding.baseUrl === input.embedding.baseUrl &&
    saved?.embedding.provider === input.embedding.provider;
  const apiKey =
    input.apiKey === undefined
      ? sameDestination
        ? openCredential(saved?.apiKey ?? null)
        : null
      : input.apiKey;
  if (['openai', 'google'].includes(input.embedding.provider) && !apiKey)
    throw new ProviderError('Enter an API key for this provider.');
  return { ...input.embedding, ...embeddingInputForModel(input.embedding.model), apiKey };
}

export async function enqueueMissing(tx: Tx | Db) {
  // Also reconciles writes racing enablement, and notes from backups made before AI existed.
  await tx.execute(sql`
    INSERT INTO embedding_jobs (note_id, user_id, generation, content_hash)
    SELECT n.id, n.user_id, c.generation, md5(n.search_text)
    FROM notes n CROSS JOIN ai_configuration c
    WHERE c.id = 'default' AND c.enabled AND n.deleted_at IS NULL AND btrim(n.search_text) <> ''
      AND NOT EXISTS (SELECT 1 FROM note_embeddings e WHERE e.note_id = n.id
        AND e.generation = c.generation AND e.content_hash = md5(n.search_text))
    ON CONFLICT (note_id) DO UPDATE SET generation = EXCLUDED.generation,
      content_hash = EXCLUDED.content_hash, attempts = 0, available_at = now(),
      lease = NULL, leased_until = NULL, failed_at = NULL, error = NULL
    WHERE embedding_jobs.generation <> EXCLUDED.generation OR embedding_jobs.content_hash <> EXCLUDED.content_hash
  `);
}

export async function overview(): Promise<AiConfiguration> {
  const saved = await readConfiguration();
  const [counts] = await db.execute<{
    total: number;
    ready: number;
    pending: number;
    running: number;
    failed: number;
    last_error: string | null;
  }>(sql`
    SELECT count(*)::int AS total,
      count(*) FILTER (WHERE EXISTS (SELECT 1 FROM note_embeddings e WHERE e.note_id = n.id
        AND e.generation = ${saved?.generation ?? null}::uuid AND e.content_hash = md5(n.search_text)))::int AS ready,
      count(*) FILTER (WHERE j.failed_at IS NULL AND (j.leased_until IS NULL OR j.leased_until <= now()) AND j.note_id IS NOT NULL)::int AS pending,
      count(*) FILTER (WHERE j.leased_until > now() AND j.failed_at IS NULL)::int AS running,
      count(*) FILTER (WHERE j.failed_at IS NOT NULL)::int AS failed,
      (SELECT error FROM embedding_jobs WHERE error IS NOT NULL ORDER BY available_at DESC LIMIT 1) AS last_error
    FROM notes n LEFT JOIN embedding_jobs j ON j.note_id = n.id
    WHERE n.deleted_at IS NULL AND btrim(n.search_text) <> ''
  `);
  return {
    enabled: saved?.enabled ?? false,
    embedding: saved?.embedding ?? DEFAULT_EMBEDDING_CONFIGURATION,
    hasApiKey: !!saved?.apiKey,
    dimensions: saved?.dimensions ?? null,
    revision: saved?.revision ?? null,
    progress: {
      total: counts?.total ?? 0,
      ready: counts?.ready ?? 0,
      pending: counts?.pending ?? 0,
      running: counts?.running ?? 0,
      failed: counts?.failed ?? 0,
      lastError: counts?.last_error ?? null,
    },
  };
}

export class ConfigurationConflict extends Error {}
export class AiAccessDenied extends Error {}
export async function lockConfiguration(tx: Tx, actor: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('catch-ai-configuration'))`);
  const [admin] = await tx.select().from(user).where(eq(user.id, actor)).for('share');
  if (admin?.role !== 'admin') throw new AiAccessDenied();
}

export async function saveConfiguration(input: SaveAiConfiguration, actor: string) {
  // The server chooses retrieval formatting, including for older clients with a format picker.
  input = {
    ...input,
    embedding: { ...input.embedding, ...embeddingInputForModel(input.embedding.model) },
  };
  const provider = input.enabled ? await resolveProvider(input) : null;
  const dimensions = provider ? await testProvider(provider) : null;
  await db.transaction(async (tx) => {
    await lockConfiguration(tx, actor);
    const [previous] = await tx
      .select()
      .from(aiConfiguration)
      .where(eq(aiConfiguration.id, 'default'))
      .for('update');
    if ((previous?.revision ?? null) !== input.revision) throw new ConfigurationConflict();
    const changed =
      !previous ||
      (['provider', 'baseUrl', 'model', 'profile', 'profileVersion'] as const).some(
        (key) => previous.embedding[key] !== input.embedding[key],
      ) ||
      (dimensions !== null && dimensions !== previous.dimensions);
    const sameDestination =
      previous?.embedding.baseUrl === input.embedding.baseUrl &&
      previous?.embedding.provider === input.embedding.provider;
    const apiKey =
      input.apiKey === undefined
        ? sameDestination
          ? (previous?.apiKey ?? null)
          : null
        : sealCredential(input.apiKey);
    const values = {
      id: 'default',
      enabled: input.enabled,
      embedding: input.embedding,
      apiKey,
      dimensions: dimensions ?? (changed ? null : (previous?.dimensions ?? null)),
      generation: changed ? randomUUID() : previous!.generation,
      revision: randomUUID(),
    };
    await tx
      .insert(aiConfiguration)
      .values(values)
      .onConflictDoUpdate({ target: aiConfiguration.id, set: values });
    if (changed) {
      await tx.delete(embeddingJobs);
      await tx.delete(noteEmbeddings);
    }
    if (input.enabled) await enqueueMissing(tx);
  });
  return overview();
}

export async function restartIndex(actor: string, rebuild: boolean, revision?: string | null) {
  await db.transaction(async (tx) => {
    await lockConfiguration(tx, actor);
    if (rebuild) {
      const [current] = await tx
        .select()
        .from(aiConfiguration)
        .where(eq(aiConfiguration.id, 'default'))
        .for('update');
      if ((current?.revision ?? null) !== revision) throw new ConfigurationConflict();
      await tx
        .update(aiConfiguration)
        .set({ generation: randomUUID(), revision: randomUUID() })
        .where(eq(aiConfiguration.id, 'default'));
      await tx.delete(noteEmbeddings);
      await tx.delete(embeddingJobs);
    } else {
      await tx
        .update(embeddingJobs)
        .set({ attempts: 0, failedAt: null, error: null, availableAt: new Date() })
        .where(sql`${embeddingJobs.failedAt} IS NOT NULL`);
    }
    await enqueueMissing(tx);
  });
  return overview();
}

export async function testProvider(provider: Provider) {
  const [document] = await embed(provider, ['Catch embedding connection test']);
  const [query] = await embed(provider, ['Catch embedding connection test'], true);
  if (document!.length !== query!.length)
    throw new ProviderError('The provider returned different query and document dimensions.');
  return document!.length;
}
