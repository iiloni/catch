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
import {
  type PointerEvent as ReactPointerEvent,
  type Ref,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import { z } from 'zod';
import { AnimatedHeight } from '@/components/AnimatedHeight/AnimatedHeight';
import { IconButton } from '@/components/IconButton/IconButton';
import { Button } from '@/components/ui/button';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { Switch } from '@/components/ui/switch';
import { ApiError } from '@/lib/api';
import { useBackHandler } from '@/lib/backButton';
import { formatDateTime, useHour12 } from '@/lib/clock';
import { waitForWriteStored } from '@/lib/collections';
import { historyDockSlot } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import { historyRecordsForNote, subscribeHistoryStorage } from '@/lib/historyStorage';
import { HOLD_MS, LONG_PRESS_TOLERANCE, swallowNextClick } from '@/lib/longPress';
import { springs } from '@/lib/motion';
import {
  clearNoteHistory,
  currentHistoryKey,
  historyList,
  historyReadingKey,
  prepareHistoryRestore,
  readHistoryVersion,
  resolveHistoryRestore,
  restoreHistoryVersion,
} from '@/lib/noteHistory';
import { duplicateNotes } from '@/lib/notes';
import { usePersistentState } from '@/lib/storage';
import { useSyncStatus } from '@/lib/syncStatus';
import { cn } from '@/lib/utils';
import { openVaultHistoryNote } from '@/lib/vault';
import { HistoryChanges, useHistoryReview } from './HistoryChanges';
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
/** Whether a version is read with what it changed marked in it; this device's choice. */
const SHOW_CHANGES_KEY = 'catch-history-changes';
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

/**
 * Versions that follow each other and read the same, listed as one: saving a note that has
 * not changed, the server and this device both keeping what an edit replaced, or a save that
 * only changed what does not show (a block's id, a default the editor wrote out). Each
 * version carries a key naming how it reads, so none has to be opened to tell.
 */
const readsSame = (one: HistoryVersion, other: HistoryVersion) =>
  one.contentKey === other.contentKey ||
  (one.readingKey !== null && one.readingKey === other.readingKey);
type Snapshot = {
  id: string;
  /** The ones to read, a restorable one first; any of them is the snapshot. */
  versions: HistoryVersion[];
  /** When the note first read this way. */
  first: HistoryVersion;
  newest: HistoryVersion;
};

/**
 * The version under a point on screen, for a finger sliding up from the dock's selector. The
 * selector holds pointer capture, so this is a geometric hit test, as for Settings' pages:
 * a row takes the finger anywhere across the list's width. Rows scrolled out of the list
 * are not under it.
 */
function historyEntryAt(root: ParentNode | null, x: number, y: number): string | null {
  const list = root?.querySelector<HTMLElement>('[role=listbox]');
  if (!list) return null;
  const bounds = list.getBoundingClientRect();
  if (x < bounds.left - 24 || x > bounds.right + 24) return null;
  // The selector sits right under the list: a finger still on it is on no version.
  if (y < bounds.top - 32 || y > bounds.bottom) return null;
  let nearest: { id: string; distance: number } | null = null;
  for (const row of list.querySelectorAll<HTMLElement>('[data-history-entry]')) {
    const rect = row.getBoundingClientRect();
    const middle = (rect.top + rect.bottom) / 2;
    if (middle < bounds.top || middle > bounds.bottom) continue;
    const distance = Math.abs(y - middle);
    const id = row.dataset.historyEntry;
    if (id && (!nearest || distance < nearest.distance)) nearest = { id, distance };
  }
  return nearest?.id ?? null;
}
type Hold = {
  pointerId: number;
  x: number;
  y: number;
  timer: number;
  /** The list is open under the finger. */
  holding: boolean;
  entry: string | null;
};

/** A version keeps its files' places, not their bytes, which may since have been deleted. */
const hasFiles = (blocks: readonly Record<string, unknown>[]): boolean =>
  blocks.some(
    (block) =>
      ['image', 'video', 'audio', 'file'].includes(String(block.type)) ||
      (Array.isArray(block.children) && hasFiles(block.children)),
  );

// A dismissed list or confirmation must stop accepting clicks while it folds away.
function DockPanel(props: HTMLMotionProps<'div'>) {
  const present = useIsPresent();
  return <motion.div {...props} inert={!present} aria-hidden={!present || undefined} />;
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
  const controlId = useId();
  const [pickerOpen, setPickerOpen] = useState(false);
  // The version under a finger held on the dock's selector; the list marks it.
  const [hovered, setHovered] = useState<string | null>(null);
  const hold = useRef<Hold | null>(null);
  useEffect(() => () => window.clearTimeout(hold.current?.timer), []);
  // Beside the reader the versions are always listed, and the dock has no list to open.
  const panelOpen = pickerOpen && !wide;
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  const [entryNote] = useState(note);
  const baseline = useMemo(() => canonicalHistory(entryNote.content), [entryNote.content]);
  const currentContent = useMemo(() => canonicalHistory(note.content), [note.content]);
  const [showChanges, setShowChanges] = usePersistentState(SHOW_CHANGES_KEY, z.boolean(), true);
  const [clearContext, setClearContext] = useState<HistoryRestoreContext | null>(null);
  const [list, setList] = useState<HistoryList | null>(null);
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [available, setAvailable] = useState(new Set<string>());
  const [local, setLocal] = useState(new Set<string>());
  const [selected, setSelected] = useState<HistoryVersion | null>(null);
  const [state, setState] = useState<HistoryState | null>(null);
  // The snapshot before the one being read, to mark what changed; null when it cannot be read.
  const [earlier, setEarlier] = useState<{ id: string; state: HistoryState | null } | null>(null);
  const opened = useRef(new Map<string, HistoryState>());
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

  async function select(snapshot: Snapshot | null) {
    const generation = ++request.current;
    setContext(null);
    setSelected(snapshot?.versions[0] ?? null);
    setState(null);
    setError(null);
    if (!snapshot) return;
    setBusy(true);
    try {
      let problem: unknown;
      for (const version of snapshot.versions) {
        try {
          const content = await readHistoryVersion(note.id, version.id);
          if (generation === request.current && mounted.current) {
            setSelected(version);
            setState(content);
          }
          return;
        } catch (failed) {
          problem ??= failed;
        }
      }
      throw problem;
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
      // The confirmation takes the list's place; the list must not come back under it.
      setPickerOpen(false);
      setClearContext(null);
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
  const snapshots = useMemo(() => {
    const runs: HistoryVersion[][] = [];
    for (const version of versions) {
      const run = runs.at(-1);
      const newer = run?.at(-1);
      if (run && newer && readsSame(newer, version)) run.push(version);
      else runs.push([version]);
    }
    return runs.map((run): Snapshot => {
      const oldestFirst = [...run].reverse();
      return {
        id: oldestFirst[0]!.id,
        // A version only this device has cannot be restored until it syncs.
        versions: [
          ...oldestFirst.filter((version) => !local.has(version.id)),
          ...oldestFirst.filter((version) => local.has(version.id)),
        ],
        first: oldestFirst[0]!,
        newest: run[0]!,
      };
    });
  }, [versions, local]);
  // Opening a version caches it, which rebuilds the list; read through a ref, that does not
  // start the reads below over.
  const availableNow = useRef(available);
  availableNow.current = available;
  const readSnapshot = useCallback(
    async (snapshot: Snapshot) => {
      for (const version of snapshot.versions) {
        // The list is rebuilt as records sync; the same content must stay one object, or
        // a comparison would start over each time.
        const known = opened.current.get(version.id);
        if (known) return known;
        // Not on this device: it is tried once there is a connection to download it over.
        if (!connected && !availableNow.current.has(version.id)) continue;
        try {
          const content = await readHistoryVersion(note.id, version.id);
          opened.current.set(version.id, content);
          return content;
        } catch {}
      }
      return null;
    },
    [note.id, connected],
  );
  // Opening history saves the note as it is, so the newest snapshot is usually the note
  // itself. It is listed once, as the current note, with the time it was saved.
  const saved = useMemo(() => {
    const newest = snapshots[0]?.newest;
    if (!newest) return null;
    const reads =
      newest.readingKey !== null &&
      historyReadingKey(entryNote.id, entryNote.content) === newest.readingKey;
    return reads || currentHistoryKey(entryNote, newest.epoch) === newest.contentKey
      ? snapshots[0]!
      : null;
  }, [entryNote, snapshots]);
  const reading = selected
    ? (snapshots.find((snapshot) => snapshot.versions.some((row) => row.id === selected.id)) ??
      null)
    : null;
  const entries = [
    {
      id: 'current',
      snapshot: null,
      title: 'Current note',
      detail: saved ? `Saved ${when(saved.first)}` : 'When history opened',
    },
    ...snapshots
      .filter((snapshot) => snapshot !== saved)
      .map((snapshot) => ({
        id: snapshot.id,
        snapshot,
        title: when(snapshot.first),
        detail: detail(snapshot === reading && selected ? selected : snapshot.versions[0]!),
      })),
  ];
  const chosenId = selected ? (reading?.id ?? selected.id) : 'current';
  const chosenEntry = entries.find((entry) => entry.id === chosenId);
  // A version is read against the one before it; the current note against the newest that
  // is not the note itself.
  const before = selected
    ? reading
      ? snapshots[snapshots.indexOf(reading) + 1]
      : undefined
    : snapshots[saved ? 1 : 0];
  useEffect(() => {
    if (!before || !showChanges) return;
    let stale = false;
    const done = (state: HistoryState | null) => {
      if (stale || !mounted.current) return;
      setEarlier((was) =>
        was?.id === before.id && was.state === state ? was : { id: before.id, state },
      );
    };
    void readSnapshot(before).then(done);
    return () => {
      stale = true;
    };
  }, [before, showChanges, readSnapshot]);
  const earlierState = before && earlier?.id === before.id ? earlier.state : undefined;
  // Holding the dock's selector (or sliding off it) opens the list under the finger, and
  // letting go on a version reads it, as the dock picks a Settings page.
  function endHold() {
    window.clearTimeout(hold.current?.timer);
    hold.current = null;
    setHovered(null);
  }
  function openUnderFinger() {
    const held = hold.current;
    if (!held || held.holding) return;
    window.clearTimeout(held.timer);
    held.holding = true;
    haptics.longPress();
    setClearContext(null);
    setPickerOpen(true);
  }
  function onHoldStart(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    endHold();
    hold.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: window.setTimeout(openUnderFinger, HOLD_MS),
      holding: false,
      entry: null,
    };
  }
  function onHoldMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const held = hold.current;
    if (held?.pointerId !== event.pointerId) return;
    if (!held.holding) {
      const distance = Math.hypot(event.clientX - held.x, event.clientY - held.y);
      if (distance <= LONG_PRESS_TOLERANCE) return;
      openUnderFinger();
    }
    const entry = historyEntryAt(dock.current, event.clientX, event.clientY);
    if (entry === held.entry) return;
    held.entry = entry;
    if (entry) haptics.selection();
    setHovered(entry);
  }
  function onHoldEnd(event: ReactPointerEvent<HTMLButtonElement>) {
    const held = hold.current;
    if (held?.pointerId !== event.pointerId) return;
    endHold();
    if (!held.holding) return;
    swallowNextClick();
    // Hit-test at release too: the last move may have been dropped. Letting go anywhere
    // else leaves the list open to tap.
    const id = historyEntryAt(dock.current, event.clientX, event.clientY) ?? held.entry;
    const entry = entries.find((row) => row.id === id);
    if (!entry) return;
    setPickerOpen(false);
    void select(entry.snapshot);
  }
  const transition = reducedMotion ? { duration: 0 } : springs.snappy;
  const { review, failed: reviewFailed } = useHistoryReview(
    showChanges ? (earlierState ?? null) : null,
    selected ? state : compared,
  );
  // The changes take the version's place only once there are some to show, and without the
  // crossfade a new version gets: the text both share stays where it is.
  const changes = showChanges && !context ? review : null;
  const previewKey = showingCurrent ? 'review-current' : (selected?.id ?? 'current');
  // A confirmation is the dock's, which grows upward for it as it does for the list: the
  // version being replaced stays in view above it.
  const confirming = context ? 'restore' : clearContext && wide ? 'clear' : null;
  const dockPanel = context ? 'restore' : clearContext ? 'clear' : panelOpen ? 'versions' : null;
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
  // What a reader should know before restoring or copying this version, if anything.
  const notes = !selected
    ? []
    : [
        state && (state.files.length > 0 || hasFiles(state.content))
          ? 'File contents may no longer be available.'
          : null,
        !connected
          ? 'Restoring the original requires a connection to check for newer edits.'
          : local.has(selected.id)
            ? 'This local version can be restored after it syncs.'
            : null,
      ].filter((note) => note !== null);
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
            Read only · {snapshots.length} saved {snapshots.length === 1 ? 'version' : 'versions'}
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
                      const chosen = chosenId === entry.id;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          aria-pressed={chosen}
                          disabled={busy}
                          onClick={() => {
                            haptics.selection();
                            void select(entry.snapshot);
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
            {currentContent !== baseline && (
              <p className="shrink-0 px-5 pt-3 text-muted-foreground text-xs">
                The note changed since you opened history. Current note shows it as it was then.
              </p>
            )}
            <ScrollArea className="min-h-0 flex-1 [--scrollbar-inset:1rem]">
              <ScrollAreaViewport ref={scrollRef}>
                <section
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
                        (changes?.changes ? (
                          <HistoryChanges review={changes} />
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
                  {notes.length > 0 && !confirming && (
                    <p className="px-5 pt-6 text-muted-foreground text-xs">{notes.join(' ')}</p>
                  )}
                </section>
              </ScrollAreaViewport>
              <ScrollBar />
            </ScrollArea>
            {(selected ? state : snapshots.length > 0) && !confirming && (
              <div className="flex min-h-14 shrink-0 items-center gap-3 border-foreground/10 border-t px-5 py-2">
                <p
                  aria-live="polite"
                  className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs"
                >
                  {!showChanges ? (
                    'Changes are hidden.'
                  ) : !before ? (
                    'This is the earliest saved version.'
                  ) : earlierState === null ? (
                    connected ? (
                      'The version before this one could not be opened, so its changes cannot be shown.'
                    ) : (
                      'The version before this one is not cached. Connect to see what changed.'
                    )
                  ) : reviewFailed ? (
                    'Changes cannot be shown for this version.'
                  ) : !review ? (
                    'Finding what changed…'
                  ) : !review.changes ? (
                    'Reads the same as the version before.'
                  ) : (
                    <>
                      <span>
                        {review.changes} {review.changes === 1 ? 'change' : 'changes'} in this
                        version
                      </span>
                      <span className="flex items-center gap-2 text-foreground">
                        <ins className="review-inserted px-1.5">Added</ins>
                        <del className="review-deleted px-1.5">Removed</del>
                      </span>
                    </>
                  )}
                </p>
                <label
                  htmlFor={`${controlId}-changes`}
                  className="flex min-h-11 shrink-0 items-center gap-3 font-medium text-sm"
                >
                  Show changes
                  <Switch
                    id={`${controlId}-changes`}
                    checked={showChanges}
                    onCheckedChange={(checked) => {
                      haptics.toggle();
                      setShowChanges(checked);
                    }}
                  />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>
      {dockSlot &&
        createPortal(
          <div ref={dock} className="flex flex-col">
            <AnimatePresence initial={false}>
              {dockPanel && isPresent && (
                <DockPanel
                  key="panel"
                  className="flex flex-col justify-end overflow-hidden [&>*]:shrink-0"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reducedMotion ? { duration: 0 } : springs.smooth}
                >
                  <AnimatedHeight>
                    {dockPanel === 'restore' ? (
                      <section aria-label="Confirm restore" className="p-4 text-sm">
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
                        <div className="mt-4 flex flex-wrap items-center gap-2">
                          <Button
                            variant="ghost"
                            className="-ml-3 min-h-11 rounded-xl"
                            onClick={() => {
                              setReviewed(true);
                              setReviewCurrent(!reviewCurrent);
                            }}
                          >
                            {reviewCurrent ? 'Review selected version' : 'Review current note'}
                          </Button>
                          <div className="ml-auto flex gap-2">
                            <Button
                              variant="ghost"
                              className="min-h-11 rounded-xl"
                              disabled={busy}
                              onClick={() => setContext(null)}
                            >
                              Cancel
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
                          </div>
                        </div>
                      </section>
                    ) : dockPanel === 'clear' ? (
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
                            const chosen = chosenId === entry.id;
                            const marked = hovered ? hovered === entry.id : chosen;
                            return (
                              <button
                                key={entry.id}
                                type="button"
                                role="option"
                                data-history-entry={entry.id}
                                aria-selected={chosen}
                                disabled={busy}
                                onClick={() => {
                                  haptics.selection();
                                  setPickerOpen(false);
                                  void select(entry.snapshot);
                                }}
                                className={cn(
                                  dockButton,
                                  'flex min-h-14 shrink-0 items-center gap-3 px-4 py-2 text-left disabled:opacity-50',
                                  marked
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
                </DockPanel>
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
                  onPointerDown={onHoldStart}
                  onPointerMove={onHoldMove}
                  onPointerUp={onHoldEnd}
                  onPointerCancel={endHold}
                  onContextMenu={(event) => event.preventDefault()}
                  className={cn(
                    dockButton,
                    'flex h-full min-w-0 flex-1 touch-none select-none items-center gap-2.5 pr-2 pl-3 text-left [-webkit-touch-callout:none] disabled:opacity-50',
                    panelOpen &&
                      'bg-foreground/[0.08] shadow-[inset_0_1px_0_var(--glass-highlight)]',
                  )}
                >
                  <History className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-[0.9375rem]">
                      {chosenEntry?.title ?? (selected ? when(selected) : 'Current note')}
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
