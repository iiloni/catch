import { expect, it } from 'vitest';
import {
  aiModelsSchema,
  DEFAULT_EMBEDDING_CONFIGURATION,
  embeddingConfigurationSchema,
  embeddingInputForModel,
  embeddingProfileForModel,
  modelKindFromName,
} from './ai';

it.each([
  'http://localhost:11434?',
  'http://localhost:11434#',
  'https://example.com/v1?key=x',
  'https://example.com/v1#part',
])('rejects query and fragment delimiters in provider endpoint %s', (baseUrl) => {
  expect(
    embeddingConfigurationSchema.safeParse({ ...DEFAULT_EMBEDDING_CONFIGURATION, baseUrl }).success,
  ).toBe(false);
});
it.each([
  ['nomic-ai/nomic-embed-text-v2-moe:latest', 'nomic'],
  ['nomic-embed-text', 'nomic'],
  ['nomic-ai/nomic-embed-vision-v1', 'plain'],
  ['intfloat/multilingual-e5-base:Q4_K_M', 'e5'],
  ['e5-mistral-7b-instruct', 'e5'],
  ['BAAI/bge-base-en-v1.5-GGUF', 'bge'],
  ['bge-large:latest', 'bge'],
  ['BAAI/bge-m3', 'plain'],
  ['BAAI/bge-base-zh-v1.5', 'plain'],
  ['text-embedding-3-small', 'plain'],
  ['my-custom-model', 'plain'],
])('chooses the format for %s', (model, profile) => {
  expect(embeddingProfileForModel(model)).toBe(profile);
});
it.each([
  ['qwen3-embedding:8b', 'embedding'],
  ['embeddinggemma:latest', 'embedding'],
  ['gemini-embedding-001', 'embedding'],
  ['sentence-transformers/all-MiniLM-L6-v2', 'embedding'],
  ['BAAI/bge-m3', 'embedding'],
  ['intfloat/e5-small-v2', 'embedding'],
  ['gpt-4o', 'chat'],
  ['llama3.2:latest', 'chat'],
  ['qwen2.5-instruct', 'chat'],
  ['chat-only', 'chat'],
  ['BAAI/bge-reranker-v2', 'other'],
  ['whisper-1', 'other'],
  ['nomic-embed-vision-v1', 'other'],
  ['an-opaque-alias', 'unknown'],
])('distinguishes %s', (model, kind) => {
  expect(modelKindFromName(model)).toBe(kind);
});
it('accepts discovery responses from servers that predate model classification', () => {
  expect(aiModelsSchema.parse({ models: ['fake-embedding'] })).toEqual({
    models: ['fake-embedding'],
  });
});
it('versions new E5 instruction formatting while accepting older stored configurations', () => {
  expect(embeddingInputForModel('e5-mistral-7b-instruct')).toEqual({
    profile: 'e5',
    profileVersion: 2,
  });
  expect(embeddingInputForModel('e5-small-v2')).toEqual({
    profile: 'e5',
    profileVersion: undefined,
  });
  const old = embeddingConfigurationSchema.parse({
    ...DEFAULT_EMBEDDING_CONFIGURATION,
    model: 'e5-mistral-7b-instruct',
    profile: 'e5',
  });
  expect(old.profileVersion).toBeUndefined();
});
it('accepts local endpoints and encoded path delimiters, and removes trailing slashes', () => {
  const result = embeddingConfigurationSchema.parse({
    ...DEFAULT_EMBEDDING_CONFIGURATION,
    baseUrl: 'http://localhost:11434/path%3F%23/',
  });
  expect(result.baseUrl).toBe('http://localhost:11434/path%3F%23');
});
