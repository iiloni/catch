import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { fakeEmbeddingProvider } from '../../../../e2e/fixtures/embeddingProvider';
import { chunkText, embed, formatInput, listModels, type Provider } from './provider';

let fake: Awaited<ReturnType<typeof fakeEmbeddingProvider>>;
let provider: Provider;
beforeAll(async () => {
  fake = await fakeEmbeddingProvider();
  provider = {
    provider: 'compatible',
    baseUrl: fake.url,
    model: 'fake-embedding',
    profile: 'plain',
    apiKey: 'secret',
  };
});
afterAll(async () => {
  await fake.close();
});
afterEach(() => {
  vi.unstubAllGlobals();
  fake.state.fail = false;
});

describe('embedding adapters', () => {
  it('uses real compatible and native endpoints, batches and profiles', async () => {
    expect(await embed(provider, ['bike', 'milk'])).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ]);
    expect(fake.calls.at(-1)).toMatchObject({
      path: '/v1/embeddings',
      authorization: 'Bearer secret',
    });
    expect(
      await embed({ ...provider, provider: 'ollama', profile: 'nomic' }, ['bike'], true),
    ).toEqual([[1, 0, 0]]);
    expect(fake.calls.at(-1)).toMatchObject({ path: '/api/embed', input: ['search_query: bike'] });
    expect(formatInput('a', 'e5', false)).toBe('passage: a');
    expect(formatInput('a', 'e5', true)).toBe('query: a');
    expect(formatInput('a', 'bge', false)).toBe('a');
    expect(formatInput('a', 'bge', true)).toContain('Represent');
  });
  it('discovery is not an embedding test', async () => {
    expect(await listModels(provider)).toContain('chat-only');
    await expect(embed({ ...provider, model: 'chat-only' }, ['a'])).rejects.toThrow('HTTP 400');
  });
  it('sanitizes upstream failures and honors cancellation', async () => {
    fake.state.fail = true;
    await expect(embed(provider, ['private'])).rejects.toThrow('HTTP 400');
    const controller = new AbortController();
    controller.abort();
    await expect(embed(provider, ['a'], false, controller.signal)).rejects.toThrow('cancelled');
  });
  it.each([
    { data: [{ index: 0, embedding: [0, 0] }] },
    { data: [{ index: 1, embedding: [1, 0] }] },
    { data: [{ index: 0, embedding: [1, null] }] },
    { data: [] },
    {
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 1, embedding: [1] },
      ],
    },
  ])('rejects invalid vectors or indices: %j', async (response) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json(response)),
    );
    await expect(embed(provider, ['a'])).rejects.toThrow(/invalid|mismatched/);
  });
  it('normalizes vectors and restores their input order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          data: [
            { index: 1, embedding: [0, 3] },
            { index: 0, embedding: [3, 4] },
          ],
        }),
      ),
    );
    expect(await embed(provider, ['a', 'b'])).toEqual([
      [0.6, 0.8],
      [0, 1],
    ]);
  });
  it('overlaps Unicode chunks, rejects excessive text, and skips empty notes', () => {
    const chunks = chunkText('🚲'.repeat(2100));
    expect(Array.from(chunks[0]!)).toHaveLength(2000);
    expect(Array.from(chunks[1]!)).toHaveLength(300);
    expect(chunkText('  ')).toEqual([]);
    expect(() => chunkText('x'.repeat(120001))).toThrow('too long');
  });
});
