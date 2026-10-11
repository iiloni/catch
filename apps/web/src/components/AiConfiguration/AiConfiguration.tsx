import {
  AI_PROVIDERS,
  type AiConfiguration as Configuration,
  DEFAULT_EMBEDDING_CONFIGURATION,
  type EmbeddingConfiguration,
  embeddingConfigurationSchema,
} from '@catch/shared';
import { Cpu, RefreshCw } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { AiRequestError, ai } from '@/lib/ai';
import { haptics } from '@/lib/haptics';
import { useSyncStatus } from '@/lib/syncStatus';

export function AiConfiguration({ onAccessDenied }: { onAccessDenied: () => void }) {
  const [saved, setSaved] = useState<Configuration | null>(null);
  const [embedding, setEmbedding] = useState(DEFAULT_EMBEDDING_CONFIGURATION);
  const [enabled, setEnabled] = useState(false);
  const [revision, setRevision] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [removeKey, setRemoveKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { offline, incompatibility, signedOut } = useSyncStatus();
  const unavailable = offline || !!incompatibility || signedOut;
  const modelList = useId();
  const selectClass =
    'h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    let initialized = false;
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const result = await ai.overview(controller.signal);
        if (controller.signal.aborted) return;
        setSaved(result);
        if (!initialized) {
          setEmbedding(result.embedding);
          setEnabled(result.enabled);
          setRevision(result.revision);
          initialized = true;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AiRequestError && [401, 403].includes(error.status)) onAccessDenied();
        else setError('Could not load AI configuration. Check the server connection.');
      } finally {
        loading = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [unavailable, onAccessDenied]);

  function change<K extends keyof EmbeddingConfiguration>(
    field: K,
    value: EmbeddingConfiguration[K],
  ) {
    setEmbedding((old) => ({ ...old, [field]: value }));
    setMessage(null);
    setError(null);
    if (field === 'baseUrl') setModels([]);
  }

  function providerRequest() {
    return {
      embedding,
      ...(key.trim() ? { apiKey: key.trim() } : removeKey ? { apiKey: null } : {}),
    };
  }

  async function perform(operation: string) {
    setBusy(operation);
    setError(null);
    setMessage(null);
    try {
      if (operation === 'models') {
        const result = await ai.models(providerRequest());
        setModels(result.models);
        setMessage(
          result.models.length
            ? `Found ${result.models.length} models. Select an embedding model or enter its name.`
            : 'No models were listed. Enter the model name manually.',
        );
      } else if (operation === 'test') {
        if (!embeddingConfigurationSchema.safeParse(embedding).success)
          throw new Error('Enter an HTTP(S) endpoint and embedding model.');
        const result = await ai.test(providerRequest());
        setMessage(
          `Embedding verified: ${result.dimensions} dimensions · ${result.milliseconds} ms.`,
        );
      } else {
        const result =
          operation === 'save'
            ? await ai.save({ ...providerRequest(), enabled, revision })
            : operation === 'retry'
              ? await ai.retry()
              : await ai.rebuild();
        setSaved(result);
        if (operation === 'save') {
          setKey('');
          setRemoveKey(false);
          setEmbedding(result.embedding);
          setRevision(result.revision);
        }
        if (operation === 'rebuild') setRevision(result.revision);
        setMessage(
          operation === 'save'
            ? 'AI configuration saved.'
            : operation === 'retry'
              ? 'Failed tasks queued to retry.'
              : 'Embedding index queued to rebuild.',
        );
      }
    } catch (error) {
      if (error instanceof AiRequestError && [401, 403].includes(error.status)) onAccessDenied();
      else setError(error instanceof Error ? error.message : 'The request failed.');
    } finally {
      setBusy(null);
    }
  }

  const progress = saved?.progress;
  const sameDestination =
    saved?.embedding.baseUrl === embedding.baseUrl &&
    saved.embedding.provider === embedding.provider;
  const valid = embeddingConfigurationSchema.safeParse(embedding).success;
  const locked = !!busy || unavailable || !saved;

  return (
    <div className="flex flex-col gap-6">
      {unavailable && (
        <p role="status" className="px-4 text-muted-foreground text-sm">
          AI configuration requires a connection to the server.
        </p>
      )}
      <fieldset disabled={locked} className="flex min-w-0 flex-col gap-6 disabled:opacity-60">
        <SettingsSection
          title="Semantic search"
          description="Enabling indexes every user's ordinary and archived notes in the background. Note text is sent to this provider; search queries are sent when semantic search is used. Vault notes stay on the device."
        >
          <SettingsRow
            icon={Cpu}
            label="Background embeddings"
            description="Make semantic search available to everyone"
          >
            <Switch
              aria-label="Background embeddings"
              checked={enabled}
              onCheckedChange={(checked) => {
                haptics.toggle();
                setEnabled(checked);
              }}
            />
          </SettingsRow>
        </SettingsSection>
        <SettingsSection
          title="Embedding provider"
          description="Local providers must be reachable from the Catch server. In Docker, host.docker.internal reaches the host; localhost reaches Catch's own container. LAN addresses and service hostnames also work."
        >
          <div className="flex flex-col gap-4 p-4">
            <label className="flex flex-col gap-2 text-sm">
              Provider
              <select
                className={selectClass}
                value={embedding.provider}
                onChange={(event) => {
                  const preset = AI_PROVIDERS.find(
                    (provider) => provider.id === event.target.value,
                  )!;
                  setEmbedding({
                    provider: preset.id,
                    baseUrl: preset.url,
                    model: preset.model,
                    profile: preset.profile,
                  });
                  setKey('');
                  setRemoveKey(false);
                  setModels([]);
                  setMessage(null);
                  setError(null);
                }}
              >
                {AI_PROVIDERS.map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name} · {provider.kind}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${modelList}-endpoint`} className="flex flex-col gap-2 text-sm">
              Server endpoint
              <Input
                id={`${modelList}-endpoint`}
                type="url"
                value={embedding.baseUrl}
                onChange={(event) => change('baseUrl', event.target.value)}
                placeholder="https://provider.example/v1"
                autoComplete="off"
              />
            </label>
            <label htmlFor={`${modelList}-key`} className="flex flex-col gap-2 text-sm">
              API key {['openai', 'google'].includes(embedding.provider) ? '' : '(optional)'}
              <Input
                id={`${modelList}-key`}
                type="password"
                value={key}
                onChange={(event) => {
                  setKey(event.target.value);
                  setRemoveKey(false);
                  setMessage(null);
                }}
                placeholder={
                  saved?.hasApiKey && sameDestination && !removeKey
                    ? 'Saved key · leave blank to keep'
                    : 'Enter an API key'
                }
                autoComplete="new-password"
              />
            </label>
            {saved?.hasApiKey && sameDestination && (
              <Button
                type="button"
                variant="ghost"
                className="self-start"
                onClick={() => {
                  setKey('');
                  setRemoveKey(!removeKey);
                }}
              >
                {removeKey ? 'Keep saved key' : 'Remove saved key'}
              </Button>
            )}
          </div>
        </SettingsSection>
        <SettingsSection
          title="Embedding model"
          description="Model discovery may include chat models. Testing verifies that your selection generates embeddings. Changing the endpoint, model, or input format rebuilds the index."
        >
          <div className="flex flex-col gap-4 p-4">
            <label htmlFor={`${modelList}-model`} className="flex flex-col gap-2 text-sm">
              Embedding model
              <Input
                id={`${modelList}-model`}
                list={modelList}
                value={embedding.model}
                onChange={(event) => change('model', event.target.value)}
                placeholder="Select or enter a model name"
                autoComplete="off"
              />
              <datalist id={modelList}>
                {models.map((model) => (
                  <option value={model} key={model} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-2 text-sm">
              Input format
              <select
                className={selectClass}
                value={embedding.profile}
                onChange={(event) =>
                  change('profile', event.target.value as EmbeddingConfiguration['profile'])
                }
              >
                <option value="plain">Plain text</option>
                <option value="nomic">Nomic search prefixes</option>
                <option value="e5">E5 query / passage prefixes</option>
                <option value="bge">BGE query instruction</option>
              </select>
            </label>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void perform('models')}>
                Discover models
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={!valid}
                onClick={() => void perform('test')}
              >
                Test embedding
              </Button>
            </div>
          </div>
        </SettingsSection>
        <Button
          type="button"
          className="self-start"
          disabled={!valid}
          onClick={() => void perform('save')}
        >
          Save configuration
        </Button>
      </fieldset>
      {busy && (
        <p role="status" className="px-4 text-muted-foreground text-sm">
          {busy === 'models'
            ? 'Discovering models…'
            : busy === 'test' || busy === 'save'
              ? 'Checking configuration… Local models may need time to load.'
              : 'Updating background tasks…'}
        </p>
      )}
      {message && (
        <p role="status" className="px-4 text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="px-4 text-destructive text-sm">
          {error}
        </p>
      )}
      <SettingsSection
        title="Background embedding tasks"
        description={
          saved?.enabled
            ? 'Notes are indexed after saves reach the server. Keyword search remains available while indexing.'
            : 'Background indexing is paused. Enable embeddings above to begin.'
        }
      >
        <div className="flex flex-col gap-3 p-4">
          {!progress ? (
            <p className="text-muted-foreground text-sm">Loading configuration…</p>
          ) : (
            <>
              <p className="font-medium">
                {progress.ready} of {progress.total} notes indexed
              </p>
              <progress
                aria-label="Embedding progress"
                max={Math.max(1, progress.total)}
                value={progress.ready}
                className="h-2 w-full accent-primary"
              />
              <p className="text-muted-foreground text-sm">
                {progress.pending} queued · {progress.running} running · {progress.failed} failed
                {saved.dimensions ? ` · ${saved.dimensions} dimensions` : ''}
              </p>
              {progress.lastError && (
                <p className="text-destructive text-sm">{progress.lastError}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy || unavailable || !saved.enabled || progress.failed === 0}
                  onClick={() => void perform('retry')}
                >
                  <RefreshCw aria-hidden />
                  Retry failed tasks
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!busy || unavailable || !saved.enabled}
                  onClick={() => void perform('rebuild')}
                >
                  Rebuild index
                </Button>
              </div>
            </>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
