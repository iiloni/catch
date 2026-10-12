import {
  type AiConfiguration as Configuration,
  DEFAULT_EMBEDDING_CONFIGURATION,
} from '@catch/shared';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ai } from '@/lib/ai';
import { updateSyncStatus } from '@/lib/syncStatus';
import { AiConfiguration } from './AiConfiguration';

vi.mock('@/lib/ai', () => ({
  AiRequestError: class extends Error {},
  ai: { overview: vi.fn(), save: vi.fn(), rebuild: vi.fn(), models: vi.fn() },
}));
vi.mock('@/lib/haptics', () => ({ haptics: { toggle: vi.fn() } }));
const saved: Configuration = {
  enabled: false,
  embedding: DEFAULT_EMBEDDING_CONFIGURATION,
  hasApiKey: false,
  revision: '0199a0a0-0000-7000-8000-000000000001',
  dimensions: null,
  progress: { total: 10, ready: 1, pending: 9, running: 0, failed: 0, lastError: null },
};
beforeEach(() => {
  vi.clearAllMocks();
  updateSyncStatus({ offline: false, signedOut: false, incompatibility: null });
  vi.mocked(ai.overview).mockResolvedValue(saved);
});
afterEach(() => {
  vi.useRealTimers();
});
it('keeps invalid endpoint edits in the form and re-enables actions after correcting them', async () => {
  render(<AiConfiguration onAccessDenied={() => {}} />);
  const endpoint = await screen.findByLabelText('Server endpoint');
  await waitFor(() => expect(endpoint).toHaveValue(saved.embedding.baseUrl));
  for (const value of ['', 'http://', 'http://host.docker.000/v1']) {
    fireEvent.change(endpoint, { target: { value } });
    expect(endpoint).toHaveValue(value);
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Test embedding' })).toBeDisabled();
  }
  fireEvent.change(endpoint, { target: { value: 'http://host.docker.internal:11434' } });
  expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Test embedding' })).toBeEnabled();
  expect(ai.save).not.toHaveBeenCalled();
  expect(ai.models).not.toHaveBeenCalled();
});
it('polls progress without replacing unsaved fields or the form revision, including reconnection', async () => {
  render(<AiConfiguration onAccessDenied={() => {}} />);
  await waitFor(() =>
    expect(screen.getByLabelText('Embedding model', { selector: 'input' })).toHaveValue(
      saved.embedding.model,
    ),
  );
  fireEvent.change(screen.getByLabelText('Embedding model', { selector: 'input' }), {
    target: { value: 'unsaved-model' },
  });
  const newer = {
    ...saved,
    revision: '0199a0a0-0000-7000-8000-000000000002',
    progress: { ...saved.progress, ready: 5 },
  };
  vi.mocked(ai.overview).mockRejectedValueOnce(new Error('server restarting'));
  act(() => updateSyncStatus({ offline: true }));
  act(() => updateSyncStatus({ offline: false }));
  await screen.findByText('Could not load AI configuration. Check the server connection.');
  vi.mocked(ai.overview).mockResolvedValue(newer);
  act(() => updateSyncStatus({ offline: true }));
  act(() => updateSyncStatus({ offline: false }));
  await waitFor(() => expect(screen.getByText(/5 of 10 notes indexed/)).toBeVisible());
  expect(
    screen.queryByText('Could not load AI configuration. Check the server connection.'),
  ).not.toBeInTheDocument();
  expect(screen.getByLabelText('Embedding model', { selector: 'input' })).toHaveValue(
    'unsaved-model',
  );
  vi.mocked(ai.save).mockRejectedValue(new Error('configuration conflict'));
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
  await waitFor(() =>
    expect(ai.save).toHaveBeenCalledWith(
      expect.objectContaining({
        revision: saved.revision,
        embedding: expect.objectContaining({ model: 'unsaved-model' }),
      }),
    ),
  );
  await screen.findByRole('alert');
});
it('chooses a format when a model is entered, without showing a format picker', async () => {
  vi.mocked(ai.save).mockResolvedValue(saved);
  render(<AiConfiguration onAccessDenied={() => {}} />);
  const model = await screen.findByRole('textbox', { name: 'Embedding model' });
  await waitFor(() => expect(model).toHaveValue(saved.embedding.model));
  expect(screen.queryByRole('button', { name: 'Input format' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'AI setup guide' })).toHaveAttribute(
    'href',
    'https://catchnotes.site/docs/running-a-server/ai-configuration',
  );
  fireEvent.change(model, { target: { value: 'intfloat/e5-small-v2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));
  await waitFor(() =>
    expect(ai.save).toHaveBeenCalledWith(
      expect.objectContaining({
        embedding: expect.objectContaining({ model: 'intfloat/e5-small-v2', profile: 'e5' }),
      }),
    ),
  );
});
it.each([false, true])(
  'filters discovered chat models, with metadata present: %s',
  async (metadata) => {
    vi.mocked(ai.models).mockResolvedValue({
      models: ['fake-embedding', 'chat-only', 'private-alias', 'qwen-custom'],
      ...(metadata ? { kinds: { 'qwen-custom': 'embedding' as const } } : {}),
    });
    render(<AiConfiguration onAccessDenied={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Embedding model' })).toHaveValue(
        saved.embedding.model,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discover models' }));
    await screen.findByText(`Found ${metadata ? 3 : 2} models.`);
    fireEvent.click(screen.getByRole('button', { name: 'Choose discovered model' }));
    expect(await screen.findByRole('option', { name: 'fake-embedding' })).toBeVisible();
    expect(screen.getByRole('option', { name: 'private-alias' })).toBeVisible();
    expect(screen.queryByRole('option', { name: 'chat-only' })).not.toBeInTheDocument();
    expect(!!screen.queryByRole('option', { name: 'qwen-custom' })).toBe(metadata);
  },
);
