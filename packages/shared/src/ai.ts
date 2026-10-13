import { z } from 'zod';
import { NOTE_COLORS } from './colors';

export const AI_PROVIDERS = [
  {
    id: 'ollama',
    name: 'Ollama',
    kind: 'Local',
    url: 'http://host.docker.internal:11434',
    model: 'nomic-embed-text',
    profile: 'nomic',
  },
  {
    id: 'lm-studio',
    name: 'LM Studio',
    kind: 'Local',
    url: 'http://host.docker.internal:1234/v1',
    model: '',
    profile: 'plain',
  },
  {
    id: 'vllm',
    name: 'vLLM',
    kind: 'Local',
    url: 'http://host.docker.internal:8000/v1',
    model: '',
    profile: 'plain',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'API',
    url: 'https://api.openai.com/v1',
    model: 'text-embedding-3-small',
    profile: 'plain',
  },
  {
    id: 'google',
    name: 'Google Gemini',
    kind: 'API',
    url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-embedding-001',
    profile: 'plain',
  },
  {
    id: 'compatible',
    name: 'OpenAI-compatible',
    kind: 'Custom',
    url: '',
    model: '',
    profile: 'plain',
  },
] as const;

export const embeddingConfigurationSchema = z.object({
  provider: z.enum(['ollama', 'lm-studio', 'vllm', 'openai', 'google', 'compatible']),
  baseUrl: z
    .string()
    .trim()
    .max(2048)
    .url()
    .refine((value) => {
      // Zod also runs refinements after a URL check fails, including during form edits.
      try {
        const url = new URL(value);
        return (
          ['http:', 'https:'].includes(url.protocol) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash &&
          !/[?#]/.test(value)
        );
      } catch {
        return false;
      }
    }, 'Use an HTTP(S) endpoint without credentials, a query, or a fragment')
    .transform((value) => value.replace(/\/+$/, '')),
  model: z.string().trim().min(1).max(200),
  profile: z.enum(['plain', 'nomic', 'e5', 'bge']).default('plain'),
  // Keep existing vectors on their original format until a save starts a new generation.
  profileVersion: z.literal(2).optional(),
});
export type EmbeddingConfiguration = z.infer<typeof embeddingConfigurationSchema>;

/** Model ids commonly carry an organization, quantization suffix and Ollama tag. */
export function embeddingProfileForModel(model: string): EmbeddingConfiguration['profile'] {
  const name = model.toLowerCase();
  if (/nomic[-_](?:embed[-_])?text/.test(name)) return 'nomic';
  if (/(?:^|[/_-])e5(?:$|[-_:])/.test(name)) return 'e5';
  // Qwen3's embedding models take the same instruction on a query, and none on a document.
  if (/qwen3?[-_]embed/.test(name)) return 'e5';
  // M3 and newer BGE families do not use the English v1 retrieval instruction.
  if (/bge[-_](?:small|base|large)(?:[-_]en)?(?:$|[-_:])/.test(name) && !/[-_]zh/.test(name))
    return 'bge';
  return 'plain';
}

export function embeddingInputForModel(
  model: string,
): Pick<EmbeddingConfiguration, 'profile' | 'profileVersion'> {
  const profile = embeddingProfileForModel(model);
  return {
    profile,
    profileVersion: profile === 'e5' && /instruct|mistral|qwen/i.test(model) ? 2 : undefined,
  };
}

export function modelKindFromName(model: string): 'embedding' | 'chat' | 'unknown' | 'other' {
  const name = model.toLowerCase();
  if (/rerank|whisper|tts|text-to-speech|image-generation|embed[-_]vision/.test(name))
    return 'other';
  if (
    /embed|bge|(?:^|[/_-])e5(?:$|[-_:])|minilm|text2vec|sentence-transformers|all-mpnet|instructor|voyage|arctic|mxbai|stella|colbert|paraphrase|jina|snowflake|(?:^|[/_-])gte(?:$|[-_:])/.test(
      name,
    )
  )
    return 'embedding';
  if (
    /(?:^|[/_-])(?:gpt|claude|gemini|llama|qwen|mistral|mixtral|deepseek|phi|gemma|chat|coder|starcoder|hermes|wizard|zephyr|olmo|falcon|nemotron|smol|command|vicuna|o[134])(?:$|[\d._:-])|[-_]instruct(?:$|[-_:])/.test(
      name,
    )
  )
    return 'chat';
  return 'unknown';
}
export const DEFAULT_EMBEDDING_CONFIGURATION: EmbeddingConfiguration = {
  provider: 'ollama',
  baseUrl: AI_PROVIDERS[0].url,
  model: AI_PROVIDERS[0].model,
  profile: 'nomic',
};

export const aiProviderRequestSchema = z.object({
  embedding: embeddingConfigurationSchema,
  // Missing keeps the saved credential, null removes it, a string replaces it.
  apiKey: z.string().trim().min(1).max(4096).nullable().optional(),
});
export const saveAiConfigurationSchema = aiProviderRequestSchema.extend({
  enabled: z.boolean(),
  revision: z.string().nullable(),
});
export const aiModelDiscoveryRequestSchema = aiProviderRequestSchema.extend({
  embedding: embeddingConfigurationSchema.extend({ model: z.string().trim().max(200) }),
});
export type SaveAiConfiguration = z.infer<typeof saveAiConfigurationSchema>;
export const aiRebuildRequestSchema = z.object({ revision: z.uuid().nullable() });
export const aiTestResultSchema = z.object({
  dimensions: z.number().int().positive(),
  milliseconds: z.number().nonnegative(),
});
export const aiModelsSchema = z.object({
  models: z.array(z.string()),
  // Older servers return just model ids; clients can fall back to name hints.
  kinds: z.record(z.string(), z.enum(['embedding', 'chat', 'unknown', 'other'])).optional(),
});
export const aiProgressSchema = z.object({
  total: z.number().int().nonnegative(),
  ready: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  lastError: z.string().nullable(),
});
export const aiConfigurationSchema = z.object({
  enabled: z.boolean(),
  embedding: embeddingConfigurationSchema,
  hasApiKey: z.boolean(),
  dimensions: z.number().int().positive().nullable(),
  revision: z.string().nullable(),
  /** Below this similarity a note is left out of AI results; absent on older servers. */
  similarityFloor: z.number().nullable().optional(),
  progress: aiProgressSchema,
});
export type AiConfiguration = z.infer<typeof aiConfigurationSchema>;
export const searchCapabilitiesSchema = z.object({ enabled: z.boolean(), indexing: z.boolean() });
export const hybridSearchSchema = z.object({
  query: z.string().trim().min(1).max(1000),
  tags: z.array(z.uuid()).max(100).default([]),
  match: z.enum(['any', 'all']).default('any'),
  untagged: z.boolean().default(false),
  color: z.enum(NOTE_COLORS).nullable().default(null),
  showArchived: z.boolean().default(true),
});
export type HybridSearch = z.infer<typeof hybridSearchSchema>;
export const hybridSearchResultSchema = z.object({
  hits: z.array(z.object({ id: z.uuid(), updatedAt: z.iso.datetime(), semantic: z.boolean() })),
  indexing: z.boolean(),
});
export type HybridSearchResult = z.infer<typeof hybridSearchResultSchema>;
