import { expect, it } from 'vitest';
import { DEFAULT_EMBEDDING_CONFIGURATION, embeddingConfigurationSchema } from './ai';

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
it('accepts local endpoints and encoded path delimiters, and removes trailing slashes', () => {
  const result = embeddingConfigurationSchema.parse({
    ...DEFAULT_EMBEDDING_CONFIGURATION,
    baseUrl: 'http://localhost:11434/path%3F%23/',
  });
  expect(result.baseUrl).toBe('http://localhost:11434/path%3F%23');
});
