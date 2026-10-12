import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '../db/client';
import { aiConfiguration, embeddingJobs, noteEmbeddings, notes } from '../db/schema';
import { enqueueMissing, readConfiguration } from './configuration';
import { openCredential } from './credentials';
import { chunkText, embed, formatInput, ProviderError } from './provider';

const MAX_INPUTS = 50;
const MAX_INPUT_BYTES = 64 * 1024;
let batchLimit = { revision: '', inputs: MAX_INPUTS };
let paused = false;
let active: Promise<void> | null = null;
let controller: AbortController | null = null;

class Superseded extends Error {}
type Job = {
  note_id: string;
  user_id: string;
  content_hash: string;
  attempts: number;
  search_text: string;
};
type Work = { job: Job; chunks: string[]; vectors: (number[] | undefined)[]; error?: unknown };
type Input = { work: Work; chunk: number; text: string };

// Retained for isolated per-note work and the existing race tests.
export function processEmbeddingJob(signal?: AbortSignal) {
  return processEmbeddingBatch(signal, 1);
}

export async function processEmbeddingBatch(signal?: AbortSignal, maxNotes = MAX_INPUTS) {
  const config = await readConfiguration();
  if (!config?.enabled || !config.dimensions || signal?.aborted) return false;
  if (batchLimit.revision !== config.revision)
    batchLimit = {
      revision: config.revision,
      // Leave room below the adapter's 16 MiB response bound for wide vectors and metadata.
      inputs: Math.min(
        MAX_INPUTS,
        Math.max(1, Math.floor((15 * 1024 * 1024) / (config.dimensions * 32))),
      ),
    };
  const lease = randomUUID();
  const jobs = await db.execute<Job>(sql`
    WITH candidates AS (
      SELECT j.note_id, j.available_at, n.search_text FROM embedding_jobs j JOIN notes n ON n.id = j.note_id
      WHERE j.generation = ${config.generation}::uuid AND j.failed_at IS NULL
        AND j.available_at <= now() AND (j.leased_until IS NULL OR j.leased_until <= now())
        AND n.deleted_at IS NULL
      ORDER BY j.available_at, j.note_id LIMIT ${maxNotes} FOR UPDATE OF j SKIP LOCKED
    ), sized AS (
      SELECT note_id,
        sum(ceil(greatest(1, char_length(btrim(search_text))) / 1800.0))
          OVER (ORDER BY available_at, note_id) AS inputs,
        row_number() OVER (ORDER BY available_at, note_id) AS ordinal
      FROM candidates
    ), claimed AS (
      UPDATE embedding_jobs j SET lease = ${lease}::uuid, leased_until = now() + interval '5 minutes', attempts = attempts + 1
      FROM sized c WHERE j.note_id = c.note_id AND (c.inputs <= ${MAX_INPUTS} OR c.ordinal = 1)
      RETURNING j.*
    ) SELECT c.*, n.search_text FROM claimed c JOIN notes n ON n.id = c.note_id
  `);
  if (!jobs.length) return false;
  const work: Work[] = jobs.map((job) => {
    try {
      const chunks = chunkText(job.search_text);
      return { job, chunks, vectors: Array.from({ length: chunks.length }) };
    } catch (error) {
      return { job, chunks: [], vectors: [], error };
    }
  });
  const provider = { ...config.embedding, apiKey: null as string | null };
  const stillCurrent = async () => {
    if (signal?.aborted) throw new Superseded();
    const current = await readConfiguration();
    if (!current?.enabled || current.revision !== config.revision) throw new Superseded();
  };
  // Check every request, including smaller requests after a provider rejects a batch.
  const send = async (inputs: Input[]): Promise<void> => {
    await stillCurrent();
    const live = await db.execute<{ note_id: string }>(sql`
      SELECT j.note_id FROM embedding_jobs j JOIN notes n ON n.id = j.note_id AND n.user_id = j.user_id
      WHERE j.lease = ${lease}::uuid AND n.deleted_at IS NULL AND j.content_hash = md5(n.search_text)
    `);
    const ids = new Set(live.map((row) => row.note_id));
    inputs = inputs.filter((input) => ids.has(input.work.job.note_id) && !input.work.error);
    if (!inputs.length) return;
    if (inputs.length > batchLimit.inputs) {
      for (let offset = 0; offset < inputs.length; ) {
        const part = inputs.slice(offset, offset + batchLimit.inputs);
        offset += part.length;
        await send(part);
      }
      return;
    }
    await db
      .update(embeddingJobs)
      .set({ leasedUntil: new Date(Date.now() + 300_000) })
      .where(eq(embeddingJobs.lease, lease));
    try {
      const vectors = await embed(
        provider,
        inputs.map((input) => input.text),
        false,
        signal,
      );
      inputs.forEach((input, index) => {
        input.work.vectors[input.chunk] = vectors[index];
      });
    } catch (error) {
      if (
        error instanceof ProviderError &&
        [400, 413].includes(error.status ?? 0) &&
        inputs.length > 1
      ) {
        const middle = Math.ceil(inputs.length / 2);
        if (error.status === 413) batchLimit.inputs = Math.min(batchLimit.inputs, middle);
        await send(inputs.slice(0, middle));
        await send(inputs.slice(middle));
      } else {
        for (const input of inputs) input.work.error = error;
        // A local server may fail a large batch under memory pressure. Retry smaller after backoff.
        if (error instanceof ProviderError && [500, 504].includes(error.status ?? 0))
          batchLimit.inputs = Math.min(
            batchLimit.inputs,
            Math.max(1, Math.floor(inputs.length / 2)),
          );
        // Rate limits, auth and outages affect the destination; do not fan out more requests.
        if (!(error instanceof ProviderError) || ![400, 413].includes(error.status ?? 0))
          throw error;
      }
    }
    await db
      .update(embeddingJobs)
      .set({ leasedUntil: new Date(Date.now() + 300_000) })
      .where(eq(embeddingJobs.lease, lease));
  };
  try {
    provider.apiKey = openCredential(config.apiKey);
    const inputs = work.flatMap((item) =>
      item.chunks.map((text, chunk) => ({ work: item, text, chunk })),
    );
    for (let offset = 0; offset < inputs.length; ) {
      const batch: Input[] = [];
      let bytes = 0;
      while (offset < inputs.length && batch.length < batchLimit.inputs) {
        const input = inputs[offset]!;
        const size = Buffer.byteLength(
          formatInput(input.text, provider.profile, false, provider.profileVersion),
        );
        if (batch.length && bytes + size > MAX_INPUT_BYTES) break;
        batch.push(input);
        bytes += size;
        offset++;
      }
      await send(batch);
    }
  } catch (error) {
    if (error instanceof Superseded || signal?.aborted) {
      await release();
      return false;
    }
    for (const item of work) {
      if (item.vectors.some((vector) => !vector)) item.error ??= error;
    }
  }
  try {
    for (const item of work) {
      const { job } = item;
      if (
        !item.error &&
        item.vectors.some((vector) => vector && vector.length !== config.dimensions)
      )
        item.error = new ProviderError(
          'The model dimensions changed. Test and save the AI configuration to rebuild the index.',
        );
      if (item.error) {
        await db
          .update(embeddingJobs)
          .set({
            error:
              item.error instanceof ProviderError
                ? item.error.message
                : 'Indexing failed. Retry the pending tasks.',
            failedAt: job.attempts >= 5 ? new Date() : null,
            availableAt: new Date(Date.now() + Math.min(900_000, 10_000 * 2 ** job.attempts)),
          })
          .where(
            and(
              eq(embeddingJobs.noteId, job.note_id),
              eq(embeddingJobs.userId, job.user_id),
              eq(embeddingJobs.lease, lease),
              sql`EXISTS (SELECT 1 FROM ai_configuration c WHERE c.id = 'default'
              AND c.enabled AND c.revision = ${config.revision}::uuid)`,
            ),
          );
        continue;
      }
      if (signal?.aborted || item.vectors.some((vector) => !vector)) continue;
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
        if (item.vectors.length)
          await tx.insert(noteEmbeddings).values(
            item.vectors.map((embedding, chunk) => ({
              noteId: job.note_id,
              userId: job.user_id,
              generation: config.generation,
              contentHash: job.content_hash,
              chunk,
              embedding: embedding!,
            })),
          );
        await tx.delete(embeddingJobs).where(eq(embeddingJobs.noteId, job.note_id));
      });
    }
  } finally {
    await release();
  }
  return true;

  async function release() {
    await db
      .update(embeddingJobs)
      .set({ lease: null, leasedUntil: null })
      .where(eq(embeddingJobs.lease, lease));
  }
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
        if (!(await processEmbeddingBatch(signal))) break;
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
