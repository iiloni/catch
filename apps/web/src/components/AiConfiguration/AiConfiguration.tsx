import {
  AI_PROVIDERS,
  type AiConfiguration as Configuration,
  DEFAULT_EMBEDDING_CONFIGURATION,
  type EmbeddingConfiguration,
  embeddingConfigurationSchema,
  embeddingInputForModel,
  modelKindFromName,
} from '@catch/shared';
import { ChevronDown, Cpu, RefreshCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Combobox } from '@/components/Combobox/Combobox';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const initialized = useRef(false);
  const { offline, incompatibility, signedOut } = useSyncStatus();
  const unavailable = offline || !!incompatibility || signedOut;
  const modelList = useId();

  useEffect(() => {
    if (unavailable) return;
    const controller = new AbortController();
    let loading = false;
    const refresh = async () => {
      if (loading || document.hidden) return;
      loading = true;
      try {
        const result = await ai.overview(controller.signal);
        if (controller.signal.aborted) return;
        setSaved(result);
        setConnectionError(null);
        if (!initialized.current) {
          setEmbedding(result.embedding);
          setEnabled(result.enabled);
          setRevision(result.revision);
          initialized.current = true;
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof AiRequestError && [401, 403].includes(error.status)) onAccessDenied();
        else setConnectionError('Could not load AI configuration. Check the server connection.');
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
    setEmbedding((old) => ({
      ...old,
      [field]: value,
      ...(field === 'model' && typeof value === 'string' ? embeddingInputForModel(value) : {}),
    }));
    setMessage(null);
    setError(null);
    if (field === 'baseUrl') setModels([]);
  }

  function providerRequest() {
    return {
      embedding: { ...embedding, ...embeddingInputForModel(embedding.model) },
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
        const discovered = result.models.filter(
          (model) => !['chat', 'other'].includes(result.kinds?.[model] ?? modelKindFromName(model)),
        );
        setModels(discovered);
        setMessage(
          discovered.length
            ? `Found ${discovered.length} ${discovered.length === 1 ? 'model' : 'models'}.`
            : 'No embedding models found. Enter a model name to test it.',
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
              : await ai.rebuild(revision);
        setSaved(result);
        if (operation === 'save') {
          setKey('');
          setRemoveKey(false);
          setEmbedding(result.embedding);
          setRevision(result.revision);
        }
        if (operation === 'rebuild' && saved?.revision === revision) setRevision(result.revision);
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

  const visibleError = error ?? connectionError;
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
          description="Sends ordinary notes and semantic queries to this provider. Vault notes stay private."
        >
          <SettingsRow
            icon={Cpu}
            label="Background embeddings"
            description="Index all users’ notes"
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
        <SettingsSection title="Embedding provider">
          <div className="flex flex-col gap-4 p-4">
            <Choice
              label="Provider"
              value={embedding.provider}
              options={AI_PROVIDERS.map((provider) => ({
                value: provider.id,
                label: `${provider.name} · ${provider.kind}`,
              }))}
              onChange={(value) => {
                const preset = AI_PROVIDERS.find((provider) => provider.id === value)!;
                setEmbedding({
                  provider: preset.id,
                  baseUrl: preset.url,
                  model: preset.model,
                  ...embeddingInputForModel(preset.model),
                });
                setKey('');
                setRemoveKey(false);
                setModels([]);
                setMessage(null);
                setError(null);
              }}
            />
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
            {/* Beside its label, not inside: the list's button would otherwise join the field's name. */}
            <div className="flex flex-col gap-2 text-sm">
              <label htmlFor={`${modelList}-model`}>Embedding model</label>
              <Combobox
                id={`${modelList}-model`}
                value={embedding.model}
                onChange={(value) => change('model', value)}
                options={models}
                listLabel="Discovered models"
                placeholder="Select or enter a model name"
              />
            </div>
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
              ? 'Checking configuration…'
              : 'Updating background tasks…'}
        </p>
      )}
      {message && (
        <p role="status" className="px-4 text-sm">
          {message}
        </p>
      )}
      {visibleError && (
        <p role="alert" className="px-4 text-destructive text-sm">
          {visibleError}
        </p>
      )}
      <SettingsSection title="Indexing">
        <div className="flex flex-col gap-3 p-4">
          {!progress ? (
            <p className="text-muted-foreground text-sm">Loading configuration…</p>
          ) : (
            <>
              <p className="font-medium">
                {progress.ready} of {progress.total} notes indexed
                {!saved.enabled && ' · Paused'}
              </p>
              <progress
                aria-label="Embedding progress"
                max={Math.max(1, progress.total)}
                value={progress.ready}
                className="h-2 w-full appearance-none overflow-hidden rounded-full bg-foreground/10 [&::-moz-progress-bar]:bg-primary [&::-webkit-progress-bar]:bg-foreground/10 [&::-webkit-progress-value]:bg-primary"
              />
              <p className="text-muted-foreground text-sm">
                {progress.pending} queued · {progress.running} running · {progress.failed} failed
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
      <a
        href="https://catchnotes.site/docs/running-a-server/ai-configuration"
        target="_blank"
        rel="noreferrer"
        className="self-start px-4 text-sm text-muted-foreground underline underline-offset-4"
      >
        AI setup guide
      </a>
    </div>
  );
}

function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <span>{label}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            aria-label={label}
            className="h-10 w-full justify-between font-normal"
          >
            {options.find((option) => option.value === value)?.label}
            <ChevronDown aria-hidden className="size-4 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
        >
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(chosen) => {
              const option = options.find((option) => option.value === chosen);
              if (option) {
                haptics.toggle();
                onChange(option.value);
              }
            }}
          >
            {options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-11">
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
