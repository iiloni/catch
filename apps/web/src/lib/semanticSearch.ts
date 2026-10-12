import type { HybridSearch, HybridSearchResult } from '@catch/shared';
import { useEffect, useRef, useState } from 'react';
import { AiRequestError, ai } from './ai';
import { useSyncStatus } from './syncStatus';

// Long enough to skip a request per keystroke, short enough that a pause feels immediate.
const TYPING_DELAY = 150;
// A fast answer replaces what is on screen directly; only a slow one is worth a placeholder.
const SLOW_AFTER = 300;

type Response = {
  key: string;
  result?: HybridSearchResult;
  error?: string;
  loading?: boolean;
  /** The last answer, kept on screen while the next one is fetched. */
  stale?: HybridSearchResult;
};

export function useSemanticSearch(input: HybridSearch, vault: boolean) {
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [response, setResponse] = useState<Response | null>(null);
  const [slow, setSlow] = useState(false);
  const { offline, incompatibility, signedOut } = useSyncStatus();
  const connected = !offline && !incompatibility && !signedOut;
  const key = JSON.stringify(input);
  const allowed = connected && !vault && available === true;
  const typed = useRef(input.query);

  useEffect(() => {
    if (vault) {
      // A query typed in the vault must not be sent when the user returns to ordinary search.
      setEnabled(false);
      setResponse(null);
    }
  }, [vault]);

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
    const typing = typed.current !== input.query;
    typed.current = input.query;
    if (!enabled || !allowed || !input.query.trim() || input.query.trim().length > 1000) {
      // A recent-search replay must not briefly reuse a response from before AI was switched off.
      setResponse(null);
      return;
    }
    const controller = new AbortController();
    setResponse((last) => ({ key, loading: true, stale: last?.result ?? last?.stale }));
    setSlow(false);
    const delay = typing ? TYPING_DELAY : 0;
    const waiting = window.setTimeout(() => setSlow(true), delay + SLOW_AFTER);
    let timer: number;
    let retryDelay = 10_000;
    const run = async () => {
      try {
        const result = await ai.search(JSON.parse(key) as HybridSearch, controller.signal);
        if (!controller.signal.aborted) {
          retryDelay = 10_000;
          clearTimeout(waiting);
          setResponse({ key, result });
          if (result.indexing) timer = window.setTimeout(() => void run(), 10_000);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          clearTimeout(waiting);
          setResponse({
            key,
            error: error instanceof AiRequestError ? error.message : 'Could not reach AI search.',
          });
          if (
            error instanceof TypeError ||
            (error instanceof AiRequestError &&
              (error.status === 408 || error.status === 429 || error.status >= 500))
          ) {
            timer = window.setTimeout(() => void run(), retryDelay);
            retryDelay = Math.min(60_000, retryDelay * 2);
          }
        }
      }
    };
    // Only typing is worth waiting out: a switch, filter or recent search is one deliberate act.
    timer = window.setTimeout(() => void run(), delay);
    return () => {
      clearTimeout(timer);
      clearTimeout(waiting);
      controller.abort();
    };
  }, [enabled, allowed, key, input.query]);

  const searching = enabled && allowed && !!input.query.trim() && input.query.trim().length <= 1000;
  const current = searching && response?.key === key ? response : null;
  // The effect has not caught up with a new query for one render; that is loading too.
  const loading = searching && (!current || !!current.loading);
  const result = current?.result ?? (loading ? (response?.result ?? response?.stale) : undefined);
  const reason = vault
    ? 'AI search is unavailable inside the vault.'
    : !connected
      ? 'AI search needs a server connection.'
      : available === false
        ? 'An admin has not enabled AI search.'
        : available === null
          ? 'Checking AI search availability…'
          : null;
  const message =
    enabled && reason
      ? `${reason} Showing keyword results.`
      : enabled && input.query.trim().length > 1000
        ? 'Use a shorter query for AI search. Showing keyword results.'
        : current?.error
          ? `${current.error} Showing keyword results.`
          : current?.result?.indexing
            ? 'Some notes are still being indexed. Keyword matches are included.'
            : null;
  return {
    enabled,
    setEnabled,
    available,
    allowed,
    message,
    /** Nothing has answered this query yet; `result` may still hold the previous answer. */
    loading,
    /** Loading has gone on long enough to say so. */
    slow: loading && slow,
    result,
  };
}
