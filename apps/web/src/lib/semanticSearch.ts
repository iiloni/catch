import type { HybridSearch, HybridSearchResult } from '@catch/shared';
import { useEffect, useState } from 'react';
import { AiRequestError, ai } from './ai';
import { useSyncStatus } from './syncStatus';

type Response = { key: string; result?: HybridSearchResult; error?: string; loading?: boolean };

export function useSemanticSearch(input: HybridSearch, vault: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [response, setResponse] = useState<Response | null>(null);
  const { offline, incompatibility, signedOut } = useSyncStatus();
  const connected = !offline && !incompatibility && !signedOut;
  const key = JSON.stringify(input);
  const allowed = connected && !vault && available === true;

  useEffect(() => {
    if (!connected || vault) return;
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || document.hidden) return;
      checking = true;
      try {
        const capability = await ai.capabilities(controller.signal);
        if (!controller.signal.aborted) setAvailable(capability.enabled);
      } catch (error) {
        if (!controller.signal.aborted)
          setAvailable(error instanceof AiRequestError && error.status === 404 ? false : null);
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener('focus', check);
    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener('focus', check);
    };
  }, [connected, vault]);

  useEffect(() => {
    if (!enabled || !allowed || !input.query.trim() || input.query.trim().length > 1000) return;
    const controller = new AbortController();
    setResponse({ key, loading: true });
    const timer = window.setTimeout(async () => {
      try {
        const result = await ai.search(JSON.parse(key) as HybridSearch, controller.signal);
        if (!controller.signal.aborted) setResponse({ key, result });
      } catch (error) {
        if (!controller.signal.aborted)
          setResponse({
            key,
            error:
              error instanceof AiRequestError ? error.message : 'Could not reach semantic search.',
          });
      }
    }, 500);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, allowed, key, input.query]);

  const current =
    enabled && allowed && response?.key === key && input.query.trim() ? response : null;
  const reason = vault
    ? 'Semantic search is unavailable inside the vault.'
    : !connected
      ? 'Semantic search needs a server connection.'
      : available === false
        ? 'An admin has not enabled semantic search.'
        : available === null
          ? 'Checking semantic search availability…'
          : null;
  const message =
    enabled && reason
      ? `${reason} Showing keyword results.`
      : enabled && input.query.trim().length > 1000
        ? 'Use a shorter query for semantic search. Showing keyword results.'
        : current?.error
          ? `${current.error} Showing keyword results.`
          : current?.loading
            ? 'Finding related notes…'
            : current?.result?.indexing
              ? 'Some notes are still being indexed. Keyword matches are included.'
              : null;
  return { enabled, setEnabled, available, allowed, message, result: current?.result };
}
