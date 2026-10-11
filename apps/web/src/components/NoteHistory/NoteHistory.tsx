import {
  canonicalHistory,
  type HistoryList,
  type HistoryRestoreContext,
  type HistoryRestoreResult,
  type HistoryState,
  type HistoryVersion,
  type Note,
} from '@catch/shared';
import {
  Check,
  ChevronLeft,
  ChevronUp,
  Copy,
  FileText,
  Highlighter,
  History,
  RefreshCw,
  RotateCcw,
  WifiOff,
} from 'lucide-react';
import {
  AnimatePresence,
  type HTMLMotionProps,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react';
import { type Ref, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { IconButton } from '@/components/IconButton/IconButton';
import { SegmentedTabs } from '@/components/SegmentedTabs/SegmentedTabs';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { ApiError } from '@/lib/api';
import { useBackHandler } from '@/lib/backButton';
import { formatDateTime, useHour12 } from '@/lib/clock';
import { waitForWriteStored } from '@/lib/collections';
import { historyDockSlot } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { historyRecordsForNote, subscribeHistoryStorage } from '@/lib/historyStorage';
import { springs } from '@/lib/motion';
import {
  clearNoteHistory,
  historyList,
  prepareHistoryRestore,
  readHistoryVersion,
  resolveHistoryRestore,
  restoreHistoryVersion,
} from '@/lib/noteHistory';
import { duplicateNotes } from '@/lib/notes';
import { useSyncStatus } from '@/lib/syncStatus';
import { cn } from '@/lib/utils';
import { openVaultHistoryNote } from '@/lib/vault';
import { HistoryChanges } from './HistoryChanges';
import { HistoryPreview } from './HistoryPreview';

type Props = {
  note: Note;
  /** Beside the page, where the reader is a card under its toolbar as the note is. */
  split?: boolean;
  /** Room for the list of versions beside the one being read; otherwise the dock holds it. */
  wide?: boolean;
  /** The note's own header spacing, so the toolbars do not move when the reader opens. */
  headerClassName?: string;
  /** The read version's scroller, for the pull that leaves the reader. */
  scrollRef?: Ref<HTMLDivElement>;
  onClose: () => void;
  onRestored: (result: HistoryRestoreResult) => void;
};
const time = formatDateTime;
const label = (version: HistoryVersion) =>
  ({
    baseline: 'Earlier content',
    edit: 'Saved version',
    'before-restore': 'Before restore',
    restored: 'Restored version',
    recovered: 'Recovered version',
  })[version.reason];
const failure = (error: unknown) => {
  if (error instanceof ApiError) {
    if (error.status === 404) return 'This version is no longer available on the server.';
    try {
      const body: unknown = JSON.parse(error.message);
      if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string')
        return body.error;
    } catch {}
  }
  return error instanceof Error && !error.message.startsWith('{')
    ? error.message
    : 'Could not reach the server. Your selected version is still here.';
};

// A dismissed confirmation must stop accepting clicks while its surface folds away.
function HistoryConfirmation(props: HTMLMotionProps<'section'>) {
  const present = useIsPresent();
  return <motion.section {...props} inert={!present} aria-hidden={!present || undefined} />;
}

/** A separate reader: choosing a version never changes the working editor. */
export function NoteHistory({
  note,
  onClose,
  onRestored,
  split = false,
  wide = false,
  headerClassName = 'px-3 pb-1',
  scrollRef,
}: Props) {
  useHour12();
  const isPresent = useIsPresent();
  const reducedMotion = useReducedMotion();
  const root = useRef<HTMLElement>(null);
  const dockSlot = historyDockSlot.use();
  const dock = useRef<HTMLDivElement>(null);
  const tabsId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  // Beside the reader the versions are always listed, and the dock has no list to open.
  const panelOpen = pickerOpen && !wide;
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  const [entryNote] = useState(note);
  const baseline = useMemo(() => canonicalHistory(entryNote.content), [entryNote.content]);
  const currentContent = useMemo(() => canonicalHistory(note.content), [note.content]);
  const [changesOpen, setChangesOpen] = useState(false);
  const [clearContext, setClearContext] = useState<HistoryRestoreContext | null>(null);
  const [list, setList] = useState<HistoryList | null>(null);
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [available, setAvailable] = useState(new Set<string>());
  const [local, setLocal] = useState(new Set<string>());
  const [selected, setSelected] = useState<HistoryVersion | null>(null);
  const [state, setState] = useState<HistoryState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [context, setContext] = useState<HistoryRestoreContext | null>(null);
  const [reviewCurrent, setReviewCurrent] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const sync = useSyncStatus();
  const connected = online && !sync.offline && !sync.signedOut && !sync.incompatibility;
  const request = useRef(0);
  const mounted = useRef(true);
  const restored = useRef(onRestored);
  restored.current = onRestored;
  const back = useCallback(() => {
    if (busy) return;
    root.current?.focus({ preventScroll: true });
    if (clearContext) setClearContext(null);
    else if (panelOpen) setPickerOpen(false);
    else if (context) setContext(null);
    else if (selected) {
      request.current++;
      setSelected(null);
      setState(null);
      setChangesOpen(false);
      setError(null);
    } else onClose();
  }, [busy, panelOpen, context, clearContext, selected, onClose]);
  useBackHandler(isPresent, back);

  const loadRecords = useCallback(
    async (history: HistoryList | null) => {
      const records = await historyRecordsForNote(note.id);
      if (!mounted.current) return;
      const known = new Set(history?.versions.map((row) => row.id));
      const pending = records.filter(
        (row) =>
          row.capture &&
          !known.has(row.id) &&
          (row.pending ||
            row.rejected ||
            !history ||
            (!!row.version && row.epoch === history.summary.epoch)),
      );
      const rows = pending.map((row) => ({
        ...row.capture!,
        sequence: 0,
        receivedAt: row.capture!.capturedAt,
      }));
      const ids = new Set(rows.map((row) => row.id));
      setVersions([
        ...rows.reverse(),
        ...(history?.versions ?? []).filter((row) => !ids.has(row.id)),
      ]);
      setLocal(ids);
      setAvailable(
        new Set(records.filter((row) => row.capture || row.version).map((row) => row.id)),
      );
    },
    [note.id],
  );
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const history = await historyList(note.id);
      if (!mounted.current) return;
      setList(history);
      await loadRecords(history);
    } catch (problem) {
      if (mounted.current) {
        setError(failure(problem));
        await loadRecords(null);
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [note.id, loadRecords]);
  useEffect(() => {
    mounted.current = true;
    void refresh();
    void resolveHistoryRestore(note.id)
      .then((result) => {
        if (result && mounted.current) restored.current(result);
      })
      .catch(() => {
        if (mounted.current) {
          setUncertain(true);
          setError(
            'A previous restore has not been confirmed. Connect and check its result before restoring again.',
          );
        }
      });
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [note.id, refresh]);
  useEffect(
    () =>
      subscribeHistoryStorage(() => {
        void loadRecords(list);
      }),
    [list, loadRecords],
  );
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine);
    window.addEventListener('online', changed);
    window.addEventListener('offline', changed);
    return () => {
      window.removeEventListener('online', changed);
      window.removeEventListener('offline', changed);
    };
  }, []);
  useEffect(() => {
    if (!isPresent) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || root.current?.closest('[inert]')) return;
      // Opening a confirmation removes its trigger, so focus may be on the document.
      // Capture also precedes Radix's enclosing note, which consumes Escape itself.
      event.preventDefault();
      event.stopPropagation();
      back();
    };
    document.addEventListener('keydown', close, true);
    return () => document.removeEventListener('keydown', close, true);
  }, [isPresent, back]);
  // The list is a passing menu, like the note's palette: a tap outside the dock folds it.
  useEffect(() => {
    if (!panelOpen || busy) return;
    const fold = (event: PointerEvent) => {
      if (dock.current?.contains(event.target as Node)) return;
      setPickerOpen(false);
      setClearContext(null);
    };
    document.addEventListener('pointerdown', fold, true);
    return () => document.removeEventListener('pointerdown', fold, true);
  }, [panelOpen, busy]);

  async function select(version: HistoryVersion | null) {
    const generation = ++request.current;
    setContext(null);
    setChangesOpen(false);
    setSelected(version);
    setState(null);
    setError(null);
    if (!version) return;
    setBusy(true);
    try {
      const content = await readHistoryVersion(note.id, version.id);
      if (generation === request.current && mounted.current) setState(content);
    } catch (problem) {
      if (generation === request.current && mounted.current)
        setError(
          online ? failure(problem) : 'This version is not fully cached. Connect to download it.',
        );
    } finally {
      if (generation === request.current && mounted.current) setBusy(false);
    }
  }
  async function prepare() {
    setBusy(true);
    setError(null);
    try {
      const current = await prepareHistoryRestore(note.id);
      setContext(current);
      setReviewCurrent(false);
      const content =
        current.note?.content ??
        (current.vaultNote ? openVaultHistoryNote(note.id, current.vaultNote.data).content : []);
      setReviewed(canonicalHistory(content) === canonicalHistory(note.content));
    } catch (problem) {
      setError(failure(problem));
    } finally {
      setBusy(false);
    }
  }
  async function restore() {
    if (!selected || !state || !context) return;
    setBusy(true);
    setError(null);
    try {
      const result = await restoreHistoryVersion(note.id, selected, state, context);
      onRestored(result);
      toast.success(result.superseded ? 'Showing the latest note' : 'Version restored');
      onClose();
    } catch (problem) {
      setContext(null);
      try {
        const result = await resolveHistoryRestore(note.id);
        if (result) {
          onRestored(result);
          toast.success(result.superseded ? 'Showing the latest note' : 'Version restored');
          onClose();
          return;
        }
        setError(
          'The note may have changed. Review its current content and check again before restoring.',
        );
      } catch {
        setUncertain(true);
        setError(
          'The restore result is unconfirmed. Connect and check its result before restoring again.',
        );
      }
      if (!(problem instanceof Error)) setError(failure(problem));
    } finally {
      setBusy(false);
    }
  }
  async function checkRestore() {
    setBusy(true);
    try {
      const result = await resolveHistoryRestore(note.id);
      if (result) onRestored(result);
      setUncertain(false);
      setError(null);
      await refresh();
    } catch (problem) {
      setError(failure(problem));
    } finally {
      setBusy(false);
    }
  }
  async function prepareClear() {
    setBusy(true);
    setError(null);
    try {
      setClearContext(await prepareHistoryRestore(note.id));
    } catch (problem) {
      setPickerOpen(false);
      setError(failure(problem));
    } finally {
      setBusy(false);
    }
  }
  async function clear() {
    if (!clearContext) return;
    setBusy(true);
    try {
      await clearNoteHistory(note.id, clearContext);
      toast.success('History cleared');
      // Nothing is left to read, so the reader gives the note back.
      onClose();
    } catch (problem) {
      setClearContext(null);
      setPickerOpen(false);
      setError(failure(problem));
    } finally {
      setBusy(false);
    }
  }
  async function recover() {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const { transaction, attachmentsTransaction } = duplicateNotes([note], state);
      await waitForWriteStored(transaction);
      if (attachmentsTransaction) await waitForWriteStored(attachmentsTransaction);
      toast.success('Version saved as a new note', {
        description: 'The original note and its history are unchanged.',
      });
    } catch (problem) {
      setError(failure(problem));
    } finally {
      setBusy(false);
    }
  }
  const showingCurrent = reviewCurrent && !!context;
  const preview =
    showingCurrent && context
      ? (context.note?.content ??
        (context.vaultNote ? openVaultHistoryNote(note.id, context.vaultNote.data).content : []))
      : selected
        ? state?.content
        : entryNote.content;
  // One object for as long as the note is the same, or the comparison starts over each render.
  const compared = useMemo(() => ({ content: entryNote.content, files: [] }), [entryNote]);
  const when = (version: HistoryVersion) =>
    time(local.has(version.id) ? version.capturedAt : version.receivedAt);
  const detail = (version: HistoryVersion) =>
    `${label(version)} · ${local.has(version.id) ? 'On this device' : available.has(version.id) ? 'Cached' : 'Download to review'}`;
  const entries = [
    { id: 'current', version: null, title: 'Current note', detail: 'When history opened' },
    ...versions.map((version) => ({
      id: version.id,
      version,
      title: when(version),
      detail: detail(version),
    })),
  ];
  const transition = reducedMotion ? { duration: 0 } : springs.snappy;
  const previewKey = showingCurrent
    ? 'review-current'
    : `${selected?.id ?? 'current'}-${changesOpen}`;
  // In the dock a confirmation takes the list's place; beside the reader it has the page.
  const confirming = context ? 'restore' : clearContext && wide ? 'clear' : null;
  const canClear = versions.length > 0;
  const clearDisabled = !connected || busy || uncertain || !!context;
  const restoreDisabled =
    !selected ||
    !state ||
    busy ||
    !connected ||
    !!note.deletedAt ||
    local.has(selected.id) ||
    uncertain ||
    !!confirming;
  const dockButton =
    'rounded-[calc(var(--dock-radius)-0.25rem)] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70';
  const clearCopy = (
    <>
      <h3 className="font-display font-semibold text-lg">Clear all saved versions?</h3>
      <p className="mt-2 text-muted-foreground">
        Your current note stays unchanged. Cleared versions cannot be restored. Unsynced local
        versions remain available as copies.
      </p>
    </>
  );
  const clearActions = (
    <>
      <Button
        variant="destructive"
        className="min-h-11 rounded-xl"
        disabled={busy}
        onClick={() => {
          haptics.warning();
          void clear();
        }}
      >
        Clear history
      </Button>
      <Button
        variant="ghost"
        className="min-h-11 rounded-xl"
        disabled={busy}
        onClick={() => setClearContext(null)}
      >
        Cancel
      </Button>
    </>
  );
  const clearButton = canClear && (
    <Button
      variant="ghost"
      className="min-h-11 rounded-xl px-3 text-destructive hover:bg-destructive/10 hover:text-destructive"
      disabled={clearDisabled}
      onClick={() => {
        haptics.toggle();
        void prepareClear();
      }}
    >
      Clear history
    </Button>
  );

  return (
    <section
      ref={root}
      tabIndex={-1}
      inert={!isPresent}
      aria-label="Version history"
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      <header className={cn('flex shrink-0 items-center gap-2', headerClassName)}>
        <div className="glass flex shrink-0 rounded-[var(--dock-radius)] p-1">
          <IconButton
            label="Back to note"
            onClick={onClose}
            disabled={busy}
            className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-6"
          >
            <ChevronLeft />
          </IconButton>
        </div>
        <div className="flex h-[50px] min-w-0 flex-1 flex-col justify-center px-1">
          <h2 className="truncate font-display font-semibold text-lg leading-6 tracking-[-0.01em]">
            Version history
          </h2>
          <p className="truncate text-muted-foreground text-xs">
            Read only · {versions.length} saved {versions.length === 1 ? 'version' : 'versions'}
          </p>
        </div>
        <div className="glass flex shrink-0 rounded-[var(--dock-radius)] p-1">
          <IconButton
            label="Refresh history"
            onClick={() => void refresh()}
            disabled={!connected || busy || loading}
            className="size-10 rounded-[calc(var(--dock-radius)-0.25rem)] [&_svg]:size-5"
          >
            <RefreshCw className={cn(loading && 'motion-safe:animate-spin')} />
          </IconButton>
        </div>
      </header>
      <div
        data-note-history-card
        className={cn(
          'flex min-h-0 flex-1 flex-col overflow-hidden',
          // The note's card in a pane, edge for edge, above the dock.
          split &&
            'mr-3 mb-[calc(var(--dock-height)+var(--dock-bottom)+0.75rem)] rounded-3xl border border-transparent bg-note shadow-[0_1px_2px_oklch(0_0_0/0.06),0_12px_32px_-16px_oklch(0_0_0/0.18)] [[data-note-color=default]_&]:border-border',
        )}
      >
        {!connected && (
          <p className="flex shrink-0 items-center gap-2 px-5 pt-3 text-muted-foreground text-xs">
            <WifiOff className="size-4 shrink-0" /> Offline · Cached versions can be saved as new
            notes.
          </p>
        )}
        <div className="flex min-h-0 flex-1">
          {wide && (
            <nav
              aria-label="Saved versions"
              inert={!!confirming}
              className={cn(
                'flex w-52 shrink-0 flex-col border-foreground/10 border-r p-3 transition-opacity',
                confirming && 'opacity-50',
              )}
            >
              <p className="px-3 py-2 font-medium text-muted-foreground text-xs">Saved versions</p>
              <ScrollArea className="min-h-0 flex-1">
                <ScrollAreaViewport>
                  <div className="space-y-1 pr-2">
                    {entries.map((entry) => {
                      const chosen = (selected?.id ?? 'current') === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          aria-pressed={chosen}
                          disabled={busy}
                          onClick={() => {
                            haptics.selection();
                            void select(entry.version);
                          }}
                          className={cn(
                            'relative min-h-14 w-full rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors hover:bg-foreground/[0.06] focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                            chosen && 'bg-foreground/[0.06]',
                          )}
                        >
                          <span className="block font-medium">{entry.title}</span>
                          <span className="block text-muted-foreground text-xs">
                            {entry.detail}
                          </span>
                          {chosen && (
                            <motion.span
                              layoutId="history-selection"
                              className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-primary"
                              transition={transition}
                            />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </ScrollAreaViewport>
                <ScrollBar />
              </ScrollArea>
              {clearButton && (
                <div className="mt-2 flex shrink-0 border-foreground/10 border-t pt-2">
                  {clearButton}
                </div>
              )}
            </nav>
          )}
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {error && (
              <div role="alert" className="shrink-0 px-5 pt-3 text-sm">
                <p>{error}</p>
                {uncertain && (
                  <Button
                    variant="outline"
                    className="mt-2 min-h-11 rounded-xl"
                    onClick={() => void checkRestore()}
                    disabled={busy}
                  >
                    Check restore result
                  </Button>
                )}
              </div>
            )}
            <AnimatePresence initial={false}>
              {confirming && (
                <HistoryConfirmation
                  key={confirming}
                  aria-label={
                    confirming === 'restore' ? 'Confirm restore' : 'Confirm clear history'
                  }
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={transition}
                  className="max-h-[60%] shrink-0 overflow-y-auto overscroll-contain"
                >
                  <div className="glass mx-4 mt-3 rounded-2xl p-4 text-sm">
                    {confirming === 'clear' ? (
                      <>
                        {clearCopy}
                        <div className="mt-4 flex flex-wrap gap-2">{clearActions}</div>
                      </>
                    ) : (
                      <>
                        <h3 className="font-display font-semibold text-lg">
                          Replace this note’s content?
                        </h3>
                        <p className="mt-2 text-muted-foreground">
                          Current content will be kept in history. Placement, tags and reminders
                          stay as they are. Deleted files cannot be recovered.
                        </p>
                        {!reviewed && (
                          <p className="mt-3 font-medium">
                            This note has newer edits. Review them before replacing its content.
                          </p>
                        )}
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button
                            variant="ghost"
                            className="min-h-11 rounded-xl"
                            onClick={() => {
                              setReviewed(true);
                              setReviewCurrent(!reviewCurrent);
                            }}
                          >
                            {reviewCurrent ? 'Review selected version' : 'Review current note'}
                          </Button>
                          <Button
                            className="min-h-11 rounded-xl"
                            disabled={busy || !reviewed}
                            onClick={() => {
                              haptics.warning();
                              void restore();
                            }}
                          >
                            Confirm restore
                          </Button>
                          <Button
                            variant="ghost"
                            className="min-h-11 rounded-xl"
                            disabled={busy}
                            onClick={() => setContext(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                </HistoryConfirmation>
              )}
            </AnimatePresence>
            {selected && state && !confirming && (
              <div className="shrink-0 px-4 pt-3">
                <SegmentedTabs<'version' | 'changes'>
                  label="Preview mode"
                  value={changesOpen ? 'changes' : 'version'}
                  onValueChange={(mode) => {
                    haptics.selection();
                    setChangesOpen(mode === 'changes');
                  }}
                  options={[
                    {
                      value: 'version',
                      id: `${tabsId}-tab-version`,
                      controls: `${tabsId}-view`,
                      label: 'This version',
                      icon: <FileText className="relative size-4" aria-hidden />,
                    },
                    {
                      value: 'changes',
                      id: `${tabsId}-tab-changes`,
                      controls: `${tabsId}-view`,
                      label: 'What changed',
                      icon: <Highlighter className="relative size-4" aria-hidden />,
                    },
                  ]}
                />
              </div>
            )}
            {currentContent !== baseline && (
              <p className="shrink-0 px-5 pt-3 text-muted-foreground text-xs">
                The current note changed. Comparison uses the content from when you opened history.
              </p>
            )}
            <ScrollArea className="min-h-0 flex-1 [--scrollbar-inset:1rem]">
              <ScrollAreaViewport ref={scrollRef}>
                <section
                  id={`${tabsId}-view`}
                  className="min-h-full py-5"
                  aria-label={
                    showingCurrent
                      ? 'Current content'
                      : selected
                        ? 'Version preview'
                        : 'Current content'
                  }
                  aria-busy={busy && !preview}
                >
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={previewKey}
                      initial={{ opacity: 0, y: reducedMotion ? 0 : 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: reducedMotion ? 0 : -8 }}
                      transition={reducedMotion ? { duration: 0 } : { duration: 0.15 }}
                    >
                      {busy && !preview ? (
                        <p role="status" className="px-5 text-muted-foreground text-sm">
                          Opening version…
                        </p>
                      ) : (
                        preview &&
                        (changesOpen && state && !context ? (
                          <HistoryChanges before={state} after={compared} />
                        ) : (
                          <HistoryPreview content={preview} />
                        ))
                      )}
                    </motion.div>
                  </AnimatePresence>
                  {!selected && !loading && !versions.length && (
                    <p className="px-5 pt-5 text-muted-foreground text-sm">
                      Earlier content appears here as you edit this note.
                    </p>
                  )}
                  {loading && (
                    <p role="status" className="px-5 pt-5 text-muted-foreground text-sm">
                      Loading history…
                    </p>
                  )}
                  {selected && !confirming && (
                    <p className="px-5 pt-6 text-muted-foreground text-xs">
                      {label(selected)} · File contents may no longer be available.
                      {!connected &&
                        ' Restoring the original requires a connection to check for newer edits.'}
                      {local.has(selected.id) &&
                        connected &&
                        ' This local version can be restored after it syncs.'}
                    </p>
                  )}
                </section>
              </ScrollAreaViewport>
              <ScrollBar />
            </ScrollArea>
          </div>
        </div>
      </div>
      {dockSlot &&
        createPortal(
          <div ref={dock} className="flex flex-col">
            <AnimatePresence initial={false}>
              {panelOpen && isPresent && (
                <motion.div
                  key="versions"
                  className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reducedMotion ? { duration: 0 } : springs.smooth}
                >
                  <AnimatedHeight>
                    {clearContext ? (
                      <section aria-label="Confirm clear history" className="p-4 text-sm">
                        {clearCopy}
                        <div className="mt-4 flex flex-wrap justify-end gap-2">{clearActions}</div>
                      </section>
                    ) : (
                      <div className="flex flex-col px-1 pt-1">
                        <div className="flex min-h-11 items-center justify-between gap-2 pl-4">
                          <p className="font-medium text-muted-foreground text-xs">
                            Saved versions
                          </p>
                          {clearButton}
                        </div>
                        <div
                          role="listbox"
                          aria-label="Choose a version"
                          className="flex max-h-[min(50dvh,24rem)] touch-pan-y flex-col gap-1 overflow-y-auto overscroll-contain [scrollbar-width:none]"
                        >
                          {entries.map((entry) => {
                            const chosen = (selected?.id ?? 'current') === entry.id;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                role="option"
                                aria-selected={chosen}
                                disabled={busy}
                                onClick={() => {
                                  haptics.selection();
                                  setPickerOpen(false);
                                  void select(entry.version);
                                }}
                                className={cn(
                                  dockButton,
                                  'flex min-h-14 shrink-0 items-center gap-3 px-4 py-2 text-left disabled:opacity-50',
                                  chosen
                                    ? 'bg-foreground/[0.08] text-foreground shadow-[inset_0_1px_0_var(--glass-highlight)]'
                                    : 'text-foreground/80',
                                )}
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate font-medium">{entry.title}</span>
                                  <span className="block truncate text-muted-foreground text-xs">
                                    {entry.detail}
                                  </span>
                                </span>
                                {chosen && <Check className="size-5 shrink-0" aria-hidden />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </AnimatedHeight>
                </motion.div>
              )}
            </AnimatePresence>
            <div
              role="toolbar"
              aria-label="Version actions"
              className="flex h-[var(--dock-height)] items-center gap-1 p-1"
            >
              {!wide && (
                <button
                  type="button"
                  aria-label="Choose a version"
                  aria-haspopup="listbox"
                  aria-expanded={panelOpen}
                  disabled={busy || !!context}
                  onClick={() => {
                    haptics.toggle();
                    setClearContext(null);
                    setPickerOpen(!panelOpen);
                  }}
                  className={cn(
                    dockButton,
                    'flex h-full min-w-0 flex-1 items-center gap-2.5 pr-2 pl-3 text-left disabled:opacity-50',
                    panelOpen &&
                      'bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]',
                  )}
                >
                  <History className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[0.9375rem]">
                      {selected ? when(selected) : 'Current note'}
                    </span>
                    <span className="block truncate text-muted-foreground text-xs">
                      {selected ? detail(selected) : 'Choose a saved version to review'}
                    </span>
                  </span>
                  <ChevronUp
                    className={cn(
                      'size-5 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
                      panelOpen && 'rotate-180',
                    )}
                    aria-hidden
                  />
                </button>
              )}
              {wide ? (
                selected ? (
                  <>
                    <Button
                      variant="ghost"
                      className={cn(dockButton, 'h-full min-w-0 flex-1')}
                      onClick={() => void recover()}
                      disabled={!state || busy || !!confirming}
                    >
                      <Copy />
                      Save as new note
                    </Button>
                    <Button
                      className={cn(dockButton, 'h-full min-w-0 flex-1')}
                      onClick={() => void prepare()}
                      disabled={restoreDisabled}
                    >
                      <RotateCcw />
                      Restore original
                    </Button>
                  </>
                ) : (
                  <p className="flex-1 px-4 text-center text-muted-foreground text-sm">
                    Choose a version to restore it or save it as a new note.
                  </p>
                )
              ) : (
                selected && (
                  <>
                    <span aria-hidden className="h-6 w-px shrink-0 bg-foreground/15" />
                    <IconButton
                      label="Save as new note"
                      onClick={() => void recover()}
                      disabled={!state || busy || !!confirming}
                      className={cn(dockButton, 'size-12 shrink-0 [&_svg]:size-6')}
                    >
                      <Copy />
                    </IconButton>
                    <IconButton
                      label="Restore original"
                      onClick={() => void prepare()}
                      disabled={restoreDisabled}
                      className={cn(dockButton, 'size-12 shrink-0 [&_svg]:size-6')}
                    >
                      <RotateCcw />
                    </IconButton>
                  </>
                )
              )}
            </div>
          </div>,
          dockSlot,
        )}
    </section>
  );
}
