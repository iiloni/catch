import type { EmbeddingConfiguration } from '@catch/shared';
import { z } from 'zod';

export class ProviderError extends Error {}
export type Provider = EmbeddingConfiguration & { apiKey: string | null };
const vectorSchema = z.array(z.number().finite()).min(1).max(16000);
const openAiResponse = z.object({
  data: z.array(z.object({ index: z.number().int().nonnegative(), embedding: vectorSchema })),
});
const ollamaResponse = z.object({ embeddings: z.array(vectorSchema) });

export function formatInput(text: string, profile: Provider['profile'], query: boolean) {
  switch (profile) {
    case 'nomic':
      return `${query ? 'search_query: ' : 'search_document: '}${text}`;
    case 'e5':
      return `${query ? 'query: ' : 'passage: '}${text}`;
    case 'bge':
      return query ? `Represent this sentence for searching relevant passages: ${text}` : text;
    default:
      return text;
  }
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
  const input = texts.map((text) => formatInput(text, provider.profile, query));
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
        .object({ models: z.array(z.object({ name: z.string().max(200) })).max(10000) })
        .safeParse(response)
    : z
        .object({ data: z.array(z.object({ id: z.string().max(200) })).max(10000) })
        .safeParse(response);
  if (!parsed.success)
    throw new ProviderError('Could not list models. Enter the model name manually.');
  return (
    'models' in parsed.data
      ? parsed.data.models.map((model) => model.name)
      : parsed.data.data.map((model) => model.id)
  ).sort();
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
