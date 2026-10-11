import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { aiConfiguration, embeddingJobs, noteEmbeddings, notes } from '../db/schema';
import { enqueueMissing, readConfiguration } from './configuration';
import { openCredential } from './credentials';
import { chunkText, embed, ProviderError } from './provider';

let paused = false;
let active: Promise<void> | null = null;
let controller: AbortController | null = null;

export async function processEmbeddingJob(signal?: AbortSignal) {
  const config = await readConfiguration();
  if (!config?.enabled || !config.dimensions || signal?.aborted) return false;
  const lease = randomUUID();
  const [job] = await db.execute<{
    note_id: string;
    user_id: string;
    content_hash: string;
    attempts: number;
    search_text: string;
  }>(sql`
    WITH candidate AS (
      SELECT j.note_id FROM embedding_jobs j JOIN notes n ON n.id = j.note_id
      WHERE j.generation = ${config.generation}::uuid AND j.failed_at IS NULL
        AND j.available_at <= now() AND (j.leased_until IS NULL OR j.leased_until <= now())
        AND n.deleted_at IS NULL
      ORDER BY j.available_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED
    ), claimed AS (
      UPDATE embedding_jobs j SET lease = ${lease}::uuid, leased_until = now() + interval '5 minutes', attempts = attempts + 1
      FROM candidate c WHERE j.note_id = c.note_id RETURNING j.*
    ) SELECT c.*, n.search_text FROM claimed c JOIN notes n ON n.id = c.note_id
  `);
  if (!job) return false;
  try {
    const chunks = chunkText(job.search_text);
    const vectors: number[][] = [];
    const provider = { ...config.embedding, apiKey: openCredential(config.apiKey) };
    for (let offset = 0; offset < chunks.length; offset += 8) {
      if (signal?.aborted) return false;
      // An admin may disable indexing or change destinations while the previous batch runs.
      const current = await readConfiguration();
      if (!current?.enabled || current.revision !== config.revision) return false;
      vectors.push(...(await embed(provider, chunks.slice(offset, offset + 8), false, signal)));
      // Bound the full job even for a cold local model and a very long note.
      if (offset + 8 < chunks.length)
        await db
          .update(embeddingJobs)
          .set({ leasedUntil: new Date(Date.now() + 300_000) })
          .where(and(eq(embeddingJobs.noteId, job.note_id), eq(embeddingJobs.lease, lease)));
    }
    if (vectors.some((vector) => vector.length !== config.dimensions))
      throw new ProviderError(
        'The model dimensions changed. Test and save the AI configuration to rebuild the index.',
      );
    if (signal?.aborted) return false;
    await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(aiConfiguration)
        .where(eq(aiConfiguration.id, 'default'))
        .for('share');
      if (!current?.enabled || current.revision !== config.revision) return;
      const [note] = await tx
        .select()
        .from(notes)
        .where(and(eq(notes.id, job.note_id), eq(notes.userId, job.user_id)))
        .for('update');
      if (!note || note.deletedAt || note.searchText !== job.search_text) return;
      const [claimed] = await tx
        .select()
        .from(embeddingJobs)
        .where(and(eq(embeddingJobs.noteId, job.note_id), eq(embeddingJobs.lease, lease)))
        .for('update');
      if (!claimed || claimed.contentHash !== job.content_hash) return;
      await tx.delete(noteEmbeddings).where(eq(noteEmbeddings.noteId, job.note_id));
      if (vectors.length)
        await tx.insert(noteEmbeddings).values(
          vectors.map((embedding, chunk) => ({
            noteId: job.note_id,
            userId: job.user_id,
            generation: config.generation,
            contentHash: job.content_hash,
            chunk,
            embedding,
          })),
        );
      await tx.delete(embeddingJobs).where(eq(embeddingJobs.noteId, job.note_id));
    });
  } catch (error) {
    if (!signal?.aborted)
      await db
        .update(embeddingJobs)
        .set({
          error:
            error instanceof ProviderError
              ? error.message
              : 'Indexing failed. Retry the pending tasks.',
          failedAt: job.attempts >= 5 ? new Date() : null,
          availableAt: new Date(Date.now() + Math.min(900_000, 10_000 * 2 ** job.attempts)),
        })
        .where(and(eq(embeddingJobs.noteId, job.note_id), eq(embeddingJobs.lease, lease)));
  } finally {
    await db
      .update(embeddingJobs)
      .set({ lease: null, leasedUntil: null })
      .where(and(eq(embeddingJobs.noteId, job.note_id), eq(embeddingJobs.lease, lease)));
  }
  return true;
}

export async function pauseEmbeddingWorker() {
  paused = true;
  controller?.abort();
  await active;
}
export function resumeEmbeddingWorker() {
  paused = false;
}

export function startEmbeddingWorker() {
  let lastReconcile = 0;
  const tick = () => {
    if (paused || active) return;
    controller = new AbortController();
    const signal = controller.signal;
    active = (async () => {
      if (Date.now() - lastReconcile > 30_000) {
        await enqueueMissing(db);
        lastReconcile = Date.now();
      }
      for (let batch = 0; batch < 8 && !signal.aborted; batch++) {
        if (!(await processEmbeddingJob(signal))) break;
      }
    })()
      .catch(() => console.error('Embedding worker could not access its queue.'))
      .finally(() => {
        active = null;
        controller = null;
      });
  };
  setInterval(tick, 2000).unref();
  tick();
}
