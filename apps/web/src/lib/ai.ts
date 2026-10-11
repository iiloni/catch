import {
  aiConfigurationSchema,
  aiModelsSchema,
  aiTestResultSchema,
  type EmbeddingConfiguration,
  type HybridSearch,
  hybridSearchResultSchema,
  type SaveAiConfiguration,
  searchCapabilitiesSchema,
} from '@catch/shared';
import { z } from 'zod';
import { getAuthToken } from './auth';
import { compatibleFetch } from './compatibility';
import { getServerUrl } from './serverUrl';

export class AiRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function send(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  const response = await compatibleFetch(`${getServerUrl()}/api${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${getAuthToken() ?? ''}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    const error = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new AiRequestError(
      response.status,
      error.success ? error.data.error : 'The server did not answer as expected.',
    );
  }
  return response.json();
}

type ProviderRequest = { embedding: EmbeddingConfiguration; apiKey?: string | null };
export const ai = {
  overview: async (signal?: AbortSignal) =>
    aiConfigurationSchema.parse(await send('/admin/ai', 'GET', undefined, signal)),
  save: async (input: SaveAiConfiguration) =>
    aiConfigurationSchema.parse(await send('/admin/ai', 'PUT', input)),
  models: async (input: ProviderRequest) =>
    aiModelsSchema.parse(await send('/admin/ai/models', 'POST', input)),
  test: async (input: ProviderRequest) =>
    aiTestResultSchema.parse(await send('/admin/ai/test', 'POST', input)),
  retry: async () => aiConfigurationSchema.parse(await send('/admin/ai/retry', 'POST')),
  rebuild: async () => aiConfigurationSchema.parse(await send('/admin/ai/rebuild', 'POST')),
  capabilities: async (signal?: AbortSignal) =>
    searchCapabilitiesSchema.parse(await send('/search/capabilities', 'GET', undefined, signal)),
  search: async (input: HybridSearch, signal?: AbortSignal) =>
    hybridSearchResultSchema.parse(await send('/search', 'POST', input, signal)),
};
