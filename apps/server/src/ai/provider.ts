import {
  type EmbeddingConfiguration,
  embeddingInputForModel,
  modelKindFromName,
} from '@catch/shared';
import { z } from 'zod';

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}
export type Provider = EmbeddingConfiguration & { apiKey: string | null };
const vectorSchema = z.array(z.number().finite()).min(1).max(16000);
const openAiResponse = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: vectorSchema })),
});
const ollamaResponse = z.object({ embeddings: z.array(vectorSchema) });

export function formatInput(
  text: string,
  profile: Provider['profile'],
  query: boolean,
  version = 1,
) {
  switch (profile) {
    case 'nomic':
      return `${query ? 'search_query: ' : 'search_document: '}${text}`;
    case 'e5':
      if (version === 2)
        return query
          ? `Instruct: Given a search query, retrieve relevant notes that answer the query.\nQuery: ${text}`
          : text;
      return `${query ? 'query: ' : 'passage: '}${text}`;
    case 'bge':
      return query ? `Represent this sentence for searching relevant passages: ${text}` : text;
    default:
      return text;
  }
}

/**
 * The provider as queries should address it. A model's query format can be corrected after
 * its notes were indexed (Qwen's instruction was), and where its notes are formatted the same
 * either way, searches use the corrected one without waiting for an admin to save again.
 */
export function queryProvider<T extends EmbeddingConfiguration>(provider: T): T {
  const current = { ...provider, ...embeddingInputForModel(provider.model) };
  return sameDocumentFormat(provider, current) ? current : provider;
}

/** Whether notes indexed with one format still match the other. */
export function sameDocumentFormat(
  a: Pick<EmbeddingConfiguration, 'profile' | 'profileVersion'>,
  b: Pick<EmbeddingConfiguration, 'profile' | 'profileVersion'>,
) {
  return (
    formatInput('', a.profile, false, a.profileVersion) ===
    formatInput('', b.profile, false, b.profileVersion)
  );
}

export function sameQueryFormat(
  a: Pick<EmbeddingConfiguration, 'profile' | 'profileVersion'>,
  b: Pick<EmbeddingConfiguration, 'profile' | 'profileVersion'>,
) {
  return (
    formatInput('', a.profile, true, a.profileVersion) ===
    formatInput('', b.profile, true, b.profileVersion)
  );
}

/** Admin-selected destinations may be on a private network; user-controlled note URLs cannot. */
async function request(
  provider: Provider,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const base =
    provider.provider === 'ollama' ? provider.baseUrl.replace(/\/v1$/, '') : provider.baseUrl;
  try {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(60_000), ...(signal ? [signal] : [])]),
      headers: {
        ...(provider.apiKey ? { Authorization: `Bearer ${provider.apiKey}` } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderError(
        response.status === 401 || response.status === 403
          ? 'The provider rejected the API key.'
          : response.status === 429
            ? 'The provider rate limit was reached. Try again later.'
            : `The provider returned HTTP ${response.status}. Check the endpoint and model.`,
        response.status,
      );
    }
    // Bound even chunked responses, and never expose provider bodies that might echo notes or keys.
    const reader = response.body?.getReader();
    if (!reader) throw new ProviderError('The provider returned an empty response.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 16 * 1024 * 1024) throw new ProviderError('The provider response is too large.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      signal?.aborted
        ? 'The request was cancelled.'
        : 'Could not read a response from the provider. Check its address and availability.',
    );
  }
}

export async function embed(
  provider: Provider,
  texts: string[],
  query = false,
  signal?: AbortSignal,
): Promise<number[][]> {
  const input = texts.map((text) =>
    formatInput(text, provider.profile, query, provider.profileVersion),
  );
  const native = provider.provider === 'ollama';
  const response = await request(
    provider,
    native ? '/api/embed' : '/embeddings',
    {
      model: provider.model,
      input,
      ...(native ? { truncate: false } : { encoding_format: 'float' }),
    },
    signal,
  );
  let vectors: number[][];
  if (native) {
    const parsed = ollamaResponse.safeParse(response);
    if (!parsed.success) throw new ProviderError('The provider returned invalid embeddings.');
    vectors = parsed.data.embeddings;
  } else {
    const parsed = openAiResponse.safeParse(response);
    if (!parsed.success) throw new ProviderError('The provider returned invalid embeddings.');
    const rows = parsed.data.data.sort((a, b) => a.index - b.index);
    if (rows.some((row, index) => row.index !== index))
      throw new ProviderError('The provider returned mismatched embedding indices.');
    vectors = rows.map((row) => row.embedding);
  }
  if (
    vectors.length !== input.length ||
    vectors.some((vector) => vector.length !== vectors[0]?.length)
  ) {
    throw new ProviderError('The provider returned mismatched embeddings.');
  }
  return vectors.map((vector) => {
    const norm = Math.hypot(...vector);
    if (!Number.isFinite(norm) || norm === 0)
      throw new ProviderError('The provider returned an invalid vector.');
    return vector.map((value) => value / norm);
  });
}

export async function listModels(provider: Provider) {
  const native = provider.provider === 'ollama';
  const response = await request(provider, native ? '/api/tags' : '/models');
  const parsed = native
    ? z
        .object({
          models: z.array(modelMetadataSchema.extend({ name: z.string().max(200) })).max(10000),
        })
        .safeParse(response)
    : z
        .object({
          data: z.array(modelMetadataSchema.extend({ id: z.string().max(200) })).max(10000),
        })
        .safeParse(response);
  if (!parsed.success)
    throw new ProviderError('Could not list models. Enter the model name manually.');
  const models = (
    'models' in parsed.data
      ? parsed.data.models.map((model) => ({ ...model, id: model.name }))
      : parsed.data.data
  ).map((model) => ({
    id: model.id,
    kind: kindFromMetadata(model) ?? modelKindFromName(model.id),
  }));
  if (native) {
    // /tags omits capabilities. Inspect a bounded number without loading or running a model.
    const deadline = AbortSignal.timeout(20_000);
    const pending = models.slice(0, 24);
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        for (let model = pending.shift(); model; model = pending.shift()) {
          try {
            const details = await request(
              provider,
              '/api/show',
              { model: model.id },
              AbortSignal.any([deadline, AbortSignal.timeout(3000)]),
            );
            model.kind = kindFromMetadata(details) ?? model.kind;
          } catch {
            // Older servers may lack /show or capabilities; names remain a useful hint.
          }
        }
      }),
    );
  }
  // Unknown aliases remain selectable and must pass the real embedding test before enablement.
  const eligible = models.filter((model) => ['embedding', 'unknown'].includes(model.kind));
  return {
    models: [...new Set(eligible.map((model) => model.id))].sort(),
    kinds: Object.fromEntries(eligible.map((model) => [model.id, model.kind])),
  };
}

const modelMetadataSchema = z.object({
  type: z.unknown().optional(),
  capabilities: z.unknown().optional(),
});

function kindFromMetadata(value: unknown): ReturnType<typeof modelKindFromName> | null {
  const parsed = modelMetadataSchema.safeParse(value);
  if (!parsed.success) return null;
  const capabilities = z.array(z.string()).safeParse(parsed.data.capabilities);
  const type = z.string().safeParse(parsed.data.type);
  const labels = [
    ...(capabilities.success ? capabilities.data : []),
    ...(type.success ? [type.data] : []),
  ].map((label) => label.toLowerCase());
  if (labels.some((label) => ['embedding', 'embeddings', 'text-embedding'].includes(label)))
    return 'embedding';
  if (labels.some((label) => ['completion', 'chat', 'llm'].includes(label))) return 'chat';
  if (labels.some((label) => ['reranker', 'rerank', 'image', 'audio', 'tts'].includes(label)))
    return 'other';
  return null;
}

export function chunkText(text: string): string[] {
  const characters = Array.from(text.trim());
  if (characters.length > 120_000)
    throw new ProviderError(
      'This note is too long to index (maximum 120,000 characters). Keyword search still works.',
    );
  const chunks: string[] = [];
  // Overlap keeps a phrase crossing a chunk boundary searchable. No silent truncation.
  for (let start = 0; start < characters.length; start += 1800) {
    const chunk = characters
      .slice(start, start + 2000)
      .join('')
      .trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}
