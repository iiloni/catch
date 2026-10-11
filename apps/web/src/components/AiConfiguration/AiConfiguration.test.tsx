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
  ai: { overview: vi.fn(), save: vi.fn(), rebuild: vi.fn() },
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
  await waitFor(() => expect(screen.getByText('5 of 10 notes indexed')).toBeVisible());
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
