import { type LinkIntake, linkDomain, linkIntakeSchema, normalizeUrl } from '@catch/shared';
import { Download, Link2, LoaderCircle, SquarePen, X } from 'lucide-react';
import { AnimatePresence, animate, motion, useReducedMotion } from 'motion/react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea, ScrollAreaViewport, ScrollBar } from '@/components/ui/scroll-area';
import { ApiError, api } from '@/lib/api';
import { getSignedInUser } from '@/lib/auth';
import { useBackHandler } from '@/lib/backButton';
import { loadShareCollections, useCaptureNotes, waitForWriteStored } from '@/lib/collections';
import { quickNote } from '@/lib/dockState';
import { haptics } from '@/lib/haptics';
import {
  capturedLinkContent,
  incomingLinkCaptures,
  type LinkCaptureControls,
  type LinkCaptureDraft,
  linkCaptureControls,
  linkCaptureOpen,
  linkCaptureOrigin,
  linkCaptureReturnFocus,
  matchingLinkNotes,
  removeLinkCapture,
} from '@/lib/linkCapture';
import { type LinkCapturePlacement, resolveLinkCapturePlacement } from '@/lib/linkCapturePlacement';
import { assetUrl } from '@/lib/linkPreviews';
import { springs } from '@/lib/motion';
import { createNote, hasNote, updateNote } from '@/lib/notes';
import type { Rect } from '@/lib/noteTransition';
import { useOpenNote } from '@/lib/openNote';
import { dismissLinkShare, saveLinkShare } from '@/lib/receiveShare';
import { cn } from '@/lib/utils';
import { LinkCaptureOptions } from './LinkCaptureOptions';

type FormProps = {
  initial?: Partial<LinkCaptureDraft>;
  autoFetch?: boolean;
  closing?: boolean;
  showActions?: boolean;
  onControls?: (controls: LinkCaptureControls | null) => void;
  onSaved: (id: string) => void;
  onCancel: () => void | Promise<void>;
  onOpenNote: (id: string) => void | Promise<void>;
  saveDraft?: (draft: LinkCaptureDraft, placement: LinkCapturePlacement) => Promise<string>;
  onSavingChange?: (saving: boolean) => void;
};

const fieldClass = 'min-h-11 rounded-xl border-input bg-foreground/[0.03] text-base md:text-base';
const areaClass =
  'w-full resize-y rounded-xl border border-input bg-foreground/[0.03] px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

function revealCaptureField(area: HTMLElement, field: HTMLElement) {
  const bounds = area.getBoundingClientRect();
  const focused = field.getBoundingClientRect();
  if (focused.bottom > bounds.bottom - 4) area.scrollTop += focused.bottom - bounds.bottom + 4;
  else if (focused.top < bounds.top + 4) area.scrollTop -= bounds.top + 4 - focused.top;
}

function surfaceRect(surface: HTMLElement, radius: number): Rect {
  const { x, y, width, height } = surface.getBoundingClientRect();
  return { x, y, width, height, radius };
}

function morphSurface(surface: HTMLElement, from: Rect, to: Rect, centered = true) {
  const properties = [
    'left',
    'right',
    'margin-left',
    'margin-right',
    'top',
    'width',
    'height',
    'max-width',
    'max-height',
    'border-radius',
  ];
  const previous = properties.map((property) => surface.style.getPropertyValue(property));
  const restore = () => {
    for (const [index, property] of properties.entries()) {
      const value = previous[index];
      if (value) surface.style.setProperty(property, value);
      else surface.style.removeProperty(property);
    }
  };
  // Place the handoff before paint; animating dimensions keeps text at its normal size.
  surface.style.maxWidth = 'none';
  surface.style.maxHeight = 'none';
  if (!centered) {
    surface.style.right = 'auto';
    surface.style.marginLeft = '0';
    surface.style.marginRight = '0';
  }
  surface.style.left = `${from.x + (centered ? from.width / 2 : 0)}px`;
  surface.style.top = `${from.y}px`;
  surface.style.width = `${from.width}px`;
  surface.style.height = `${from.height}px`;
  surface.style.borderRadius = `${from.radius}px`;
  const animation = animate(
    surface,
    {
      left: [from.x + (centered ? from.width / 2 : 0), to.x + (centered ? to.width / 2 : 0)],
      top: [from.y, to.y],
      width: [from.width, to.width],
      height: [from.height, to.height],
      borderRadius: [from.radius, to.radius],
    },
    { ...springs.smooth, restDelta: 1, restSpeed: 20 },
  );
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
    void animation.then(resolve);
  });
  return {
    animation,
    finished,
    restore,
    stop: () => {
      animation.stop();
      restore();
      finish();
    },
  };
}

export function LinkCaptureForm({
  initial,
  autoFetch = false,
  closing = false,
  showActions = true,
  onControls,
  onSaved,
  onCancel,
  onOpenNote,
  onSavingChange,
  saveDraft,
}: FormProps) {
  const id = useId();
  const [placement, setPlacement] = useState<LinkCapturePlacement>({
    status: null,
    color: 'default',
    primaryTagId: null,
    secondaryTagIds: [],
  });
  const reduceMotion = useReducedMotion();
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState<LinkCaptureDraft>(() => ({
    url: initial?.url ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    notes: initial?.notes ?? '',
  }));
  const latest = useRef(draft);
  latest.current = draft;
  const edited = useRef({ title: false, description: false });
  const request = useRef<AbortController | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const saveErrorElement = useRef<HTMLParagraphElement>(null);
  const savedId = useRef<string | null>(null);
  const savingNow = useRef(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [metadata, setMetadata] = useState<LinkIntake | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const notes = useCaptureNotes();
  const url = normalizeUrl(draft.url);
  const matches = matchingLinkNotes(notes, draft.url).filter((note) => note.id !== savedId.current);
  const commands = useRef({ cancel: () => void leave(onCancel) });
  commands.current = { cancel: () => void leave(onCancel) };

  useLayoutEffect(() => {
    onControls?.({
      canSave: Boolean(url),
      busy: saving || leaving || closing,
      saving,
      save: () => form.current?.requestSubmit(),
      cancel: () => commands.current.cancel(),
    });
  }, [onControls, url, saving, leaving, closing]);
  useLayoutEffect(() => () => onControls?.(null), [onControls]);

  const fetchDetails = useCallback(async () => {
    const url = normalizeUrl(latest.current.url);
    if (!url) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setFetchError(null);
    try {
      const result = linkIntakeSchema.parse(
        await api.linkIntake(
          { url },
          AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]),
        ),
      );
      if (controller.signal.aborted || request.current !== controller) return;
      setMetadata(result);
      setDraft((draft) => ({
        ...draft,
        title: edited.current.title ? draft.title : (result.title ?? draft.title),
        description: edited.current.description
          ? draft.description
          : (result.description ?? draft.description),
      }));
    } catch (error) {
      if (controller.signal.aborted || request.current !== controller) return;
      setFetchError(
        error instanceof ApiError && error.status === 404
          ? 'Update your Catch server to fetch details here. You can still save the link.'
          : 'Could not fetch details. You can edit the fields and save the link, or try again.',
      );
    } finally {
      if (request.current === controller) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (autoFetch) void fetchDetails();
    return () => request.current?.abort();
  }, [autoFetch, fetchDetails]);

  useEffect(() => {
    const area = scrollArea.current;
    if (!area) return;
    let frame = 0;
    // The keyboard overlays the viewport; reveal focus again as the scroll area shrinks.
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const focused = document.activeElement;
        if (focused instanceof HTMLElement && area.contains(focused))
          revealCaptureField(area, focused);
      });
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  useEffect(() => {
    if (saveError) saveErrorElement.current?.scrollIntoView({ block: 'nearest' });
  }, [saveError]);

  function changeUrl(value: string) {
    request.current?.abort();
    request.current = null;
    setLoading(false);
    setMetadata(null);
    setFetchError(null);
    const next = {
      ...latest.current,
      url: value,
      title: edited.current.title ? latest.current.title : '',
      description: edited.current.description ? latest.current.description : '',
    };
    latest.current = next;
    setDraft(next);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!url || savingNow.current || closing) return;
    const user = getSignedInUser();
    if (!user) return;
    savingNow.current = true;
    request.current?.abort();
    setLoading(false);
    setSaving(true);
    onSavingChange?.(true);
    setSaveError(null);
    try {
      if (saveDraft) {
        const id = await saveDraft({ ...draft, url: draft.url.trim() }, placement);
        haptics.success();
        onSaved(id);
        return;
      }
      await loadShareCollections();
      // Reuse the id if admission failed: retrying must not create a second note.
      const content = capturedLinkContent({ ...draft, url: draft.url.trim() });
      const existing = savedId.current;
      const saved =
        existing && hasNote(existing)
          ? { id: existing, transaction: updateNote(existing, { content }) }
          : createNote({
              id: existing ?? undefined,
              userId: user.id,
              content,
              ...resolveLinkCapturePlacement(placement),
            });
      savedId.current = saved.id;
      await waitForWriteStored(saved.transaction);
      haptics.success();
      onSaved(saved.id);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save the link. Try again.');
    } finally {
      savingNow.current = false;
      setSaving(false);
      onSavingChange?.(false);
    }
  }

  async function leave(action: () => void | Promise<void>) {
    if (savingNow.current || closing) return;
    savingNow.current = true;
    // Keep the focused input enabled so the Android keyboard stays up during the return.
    setLeaving(true);
    onSavingChange?.(true);
    setSaveError(null);
    try {
      await action();
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : 'Could not close this capture. Try again.',
      );
    } finally {
      savingNow.current = false;
      setLeaving(false);
      onSavingChange?.(false);
    }
  }

  return (
    <form ref={form} onSubmit={save} className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden">
      <ScrollArea className="flex flex-1 flex-col [--scrollbar-edge:0.25rem] [--scrollbar-inset:0.5rem]">
        <ScrollAreaViewport
          ref={scrollArea}
          className="h-auto min-h-0 flex-1 px-1 pr-4 pb-1"
          onFocusCapture={(event) => {
            const area = event.currentTarget;
            const target = event.target;
            // A picker's portal bubbles through this form, but has its own scroll area.
            if (!(target instanceof HTMLElement) || !area.contains(target)) return;
            requestAnimationFrame(() => revealCaptureField(area, target));
          }}
        >
          <fieldset disabled={saving} className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-col gap-2">
              <label htmlFor={`${id}-url`} className="font-medium text-sm">
                URL
              </label>
              <div className="flex gap-2">
                <Input
                  id={`${id}-url`}
                  inputMode="url"
                  autoComplete="url"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  maxLength={2048}
                  placeholder="https://…"
                  value={draft.url}
                  onChange={(event) => changeUrl(event.target.value)}
                  onPaste={(event) => {
                    const text = event.clipboardData.getData('text/plain');
                    if (!text) return;
                    event.preventDefault();
                    const input = event.currentTarget;
                    const start = input.selectionStart ?? input.value.length;
                    const end = input.selectionEnd ?? start;
                    const value = input.value.slice(0, start) + text + input.value.slice(end);
                    changeUrl(value);
                    if (normalizeUrl(value)) void fetchDetails();
                    requestAnimationFrame(() =>
                      input.setSelectionRange(start + text.length, start + text.length),
                    );
                  }}
                  className={fieldClass}
                />
                <Button
                  type="button"
                  variant="secondary"
                  aria-label="Fetch details"
                  title="Fetch details"
                  disabled={!url || loading || leaving || closing}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => void fetchDetails()}
                  className="size-11 rounded-xl"
                >
                  {loading ? (
                    <LoaderCircle className="animate-spin" aria-hidden />
                  ) : (
                    <Download aria-hidden />
                  )}
                </Button>
              </div>
              {draft.url && !url && (
                <p className="text-destructive text-sm">Enter a complete http or https URL.</p>
              )}
              {loading && (
                <p role="status" className="text-muted-foreground text-sm">
                  Fetching page details…
                </p>
              )}
              {fetchError && (
                <p role="status" className="text-muted-foreground text-sm">
                  {fetchError}
                </p>
              )}
            </div>
            {matches.length > 0 && (
              <details className="rounded-xl bg-foreground/[0.05] px-3 py-2 text-sm">
                <summary className="cursor-pointer py-1 font-medium">
                  Already in {matches.length} {matches.length === 1 ? 'note' : 'notes'}
                </summary>
                <div className="flex flex-col items-start gap-1 pt-2">
                  <p className="text-muted-foreground">
                    You can open an existing note or save another copy.
                  </p>
                  {matches.slice(0, 5).map((note, index) => (
                    <Button
                      key={note.id}
                      type="button"
                      variant="link"
                      className="h-auto whitespace-normal px-0 py-2 text-left"
                      disabled={leaving || closing}
                      onClick={() => void leave(() => onOpenNote(note.id))}
                    >
                      Open {note.isArchived ? 'archived ' : ''}note
                      {matches.length > 1 ? ` ${index + 1}` : ''}
                    </Button>
                  ))}
                </div>
              </details>
            )}
            <AnimatePresence initial={false}>
              {url && (metadata || fetchError) && (
                <motion.div
                  key="details"
                  data-link-details
                  className="flex flex-col gap-4 overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={reduceMotion ? { duration: 0 } : springs.smooth}
                >
                  {metadata && (
                    <div className="flex items-center gap-3 rounded-xl bg-foreground/[0.04] p-3">
                      {metadata.imageHash ? (
                        <img
                          src={assetUrl(metadata.imageHash)}
                          alt="Page preview"
                          className="h-16 w-24 shrink-0 rounded-lg object-cover"
                        />
                      ) : (
                        <Link2 className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <div className="min-w-0 text-sm">
                        <p className="truncate font-medium">
                          {metadata.siteName ?? linkDomain(draft.url)}
                        </p>
                        <p className="text-muted-foreground">Page details fetched</p>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`${id}-title`} className="font-medium text-sm">
                      Title
                    </label>
                    <Input
                      id={`${id}-title`}
                      maxLength={300}
                      placeholder="Give this link a title"
                      value={draft.title}
                      onChange={(event) => {
                        edited.current.title = true;
                        setDraft({ ...draft, title: event.target.value });
                      }}
                      className={fieldClass}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`${id}-description`} className="font-medium text-sm">
                      Description
                    </label>
                    <textarea
                      id={`${id}-description`}
                      rows={3}
                      maxLength={2000}
                      placeholder="A little context from the page"
                      value={draft.description}
                      onChange={(event) => {
                        edited.current.description = true;
                        setDraft({ ...draft, description: event.target.value });
                      }}
                      className={areaClass}
                    />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor={`${id}-notes`} className="font-medium text-sm">
                      Your notes
                    </label>
                    <textarea
                      id={`${id}-notes`}
                      rows={3}
                      maxLength={10000}
                      placeholder="Why are you saving this?"
                      value={draft.notes}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      className={areaClass}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
            <LinkCaptureOptions value={placement} onChange={setPlacement} />
          </fieldset>
          {saveError && (
            <p ref={saveErrorElement} role="alert" className="pt-4 text-destructive text-sm">
              {saveError}
            </p>
          )}
        </ScrollAreaViewport>
        <ScrollBar />
      </ScrollArea>
      {showActions && (
        <div data-capture-actions className="flex shrink-0 justify-end">
          <Button
            type={url ? 'submit' : 'button'}
            variant="ghost"
            aria-label={url ? 'Save link' : 'Close link capture'}
            title={url ? 'Save link' : 'Close link capture'}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => {
              if (!url) void leave(onCancel);
            }}
            disabled={saving || leaving || closing}
            className={cn(
              'size-11 rounded-xl',
              url &&
                'bg-[image:var(--brand-gradient)] text-brand-foreground shadow-[0_8px_24px_-6px_rgb(213_123_20/0.4)]',
            )}
          >
            {saving ? (
              <LoaderCircle className="animate-spin" aria-hidden />
            ) : url ? (
              <SquarePen aria-hidden />
            ) : (
              <X aria-hidden />
            )}
          </Button>
        </div>
      )}
    </form>
  );
}

/** The app and bookmarklet share the same form; the app keeps its current page behind it. */
export function LinkCapture() {
  const manual = linkCaptureOpen.use();
  const source = linkCaptureOrigin.use();
  const origin = manual ? source : null;
  const reduceMotion = useReducedMotion();
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  const pending = incomingLinkCaptures.use();
  const quickNoteState = quickNote.use();
  const incoming = manual || quickNoteState === 'open' ? undefined : pending[0];
  const open = manual || Boolean(incoming);
  const [saving, setSaving] = useState(false);
  const [returning, setReturning] = useState(false);
  const returningNow = useRef(false);
  const preserveEditorFocus = useRef(false);
  const stopAnimation = useRef<(() => void) | null>(null);
  const stopReturnAnimation = useRef<(() => void) | null>(null);
  const { open: openNote } = useOpenNote();

  useEffect(() => {
    if (!manual) {
      linkCaptureOrigin.set(null);
      linkCaptureReturnFocus.set(null);
    }
    if (manual || incoming) {
      returningNow.current = false;
      setReturning(false);
    }
  }, [manual, incoming]);

  useEffect(
    () => () => {
      stopAnimation.current?.();
      stopReturnAnimation.current?.();
    },
    [],
  );

  useLayoutEffect(() => {
    if (quickNoteState === 'open') return;
    stopReturnAnimation.current?.();
    stopReturnAnimation.current = null;
  }, [quickNoteState]);

  useEffect(() => {
    if (!open) return;
    const body = document.body;
    const html = document.documentElement;
    const previousBody = body.style.overflow;
    const previousHtml = html.style.overflow;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previousBody;
      html.style.overflow = previousHtml;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!surface || !origin || reduceMotion) return;
    stopReturnAnimation.current?.();
    const target = surfaceRect(surface, 28);
    const growth = morphSurface(surface, origin, target);
    const body = surface.querySelector<HTMLDivElement>('[data-link-capture-body]');
    const previousOpacity = body?.style.opacity ?? '';
    if (body) body.style.opacity = '0';
    const reveal = body ? animate(body, { opacity: [0, 1] }, { duration: 0.2, delay: 0.12 }) : null;
    let cancelled = false;
    void growth.animation.then(() => {
      if (!cancelled) growth.restore();
    });
    const stop = () => {
      cancelled = true;
      growth.stop();
      reveal?.stop();
      if (body) body.style.opacity = previousOpacity;
    };
    stopAnimation.current = stop;
    return () => {
      stopAnimation.current?.();
      stopAnimation.current = null;
      stop();
    };
  }, [surface, origin, reduceMotion]);
  const close = async () => {
    if (incoming) {
      await dismissLinkShare(incoming.id);
      removeLinkCapture(incoming.id);
    } else {
      if (quickNote.get() === 'capture') quickNote.set('closed');
      linkCaptureOpen.set(false);
    }
  };
  const cancel = async () => {
    if (manual && returningNow.current) return;
    const popup = document.querySelector<HTMLElement>('[aria-label="New note"][data-note-color]');
    if (incoming || !origin || !popup || quickNote.get() !== 'capture') return close();
    returningNow.current = true;
    setReturning(true);
    const from = surface ? surfaceRect(surface, 28) : null;
    const target = surfaceRect(popup, 28);
    stopAnimation.current?.();
    // The retained editor is ready now. Hand focus over before removing the link field,
    // then animate this popup so its content appears during the morph, not after it.
    flushSync(() => quickNote.set('open'));
    preserveEditorFocus.current = true;
    const restoreFocus = linkCaptureReturnFocus.get();
    if (restoreFocus) restoreFocus();
    else
      popup.querySelector<HTMLElement>('[contenteditable="true"]')?.focus({ preventScroll: true });
    if (from && !reduceMotion) {
      const shrink = morphSurface(popup, from, target, false);
      const body = popup.querySelector<HTMLElement>('[data-quick-note-body]');
      if (body) body.style.opacity = '0';
      const reveal = body ? animate(body, { opacity: [0, 1] }, { duration: 0.12 }) : null;
      const stop = () => {
        shrink.stop();
        reveal?.stop();
        if (body) body.style.opacity = '';
      };
      stopReturnAnimation.current = stop;
      linkCaptureOpen.set(false);
      await shrink.finished;
      if (stopReturnAnimation.current === stop) {
        shrink.restore();
        if (body) body.style.opacity = '';
        stopReturnAnimation.current = null;
      }
    } else {
      linkCaptureOpen.set(false);
    }
  };
  const dismiss = () => {
    if (saving) return;
    setSaving(true);
    void cancel()
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : 'Could not close this capture. Try again.',
        );
      })
      .finally(() => setSaving(false));
  };
  useBackHandler(open, dismiss);
  return (
    <DialogPrimitive.Root
      modal={false}
      open={open}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <AnimatePresence>
        {open && (
          <motion.div
            aria-hidden
            data-link-scrim
            className="fixed inset-0 z-[65] touch-none bg-black/25"
            initial={{ opacity: origin ? 1 : 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: returning ? 0 : 0.2 }}
            onPointerDown={(event) => event.preventDefault()}
            onClick={dismiss}
          />
        )}
      </AnimatePresence>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          ref={setSurface}
          data-link-overlay
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            if (!preserveEditorFocus.current) return;
            preserveEditorFocus.current = false;
            event.preventDefault();
          }}
          data-note-color="default"
          onInteractOutside={(event) => event.preventDefault()}
          className={cn(
            'fixed left-1/2 bottom-[calc(var(--dock-bottom)+var(--dock-height)+0.75rem)] z-[70] flex w-[calc(100%-1.5rem)] max-w-md max-h-[calc(100dvh-var(--safe-top)-var(--dock-bottom)-var(--dock-height)-2rem)] -translate-x-1/2 flex-col gap-4 rounded-[28px] bg-note p-4 text-card-foreground shadow-[0_24px_60px_-12px_oklch(0_0_0/0.45)] outline-none',
          )}
        >
          <div data-link-capture-body className="flex min-h-0 flex-1 flex-col gap-5">
            <div className="flex shrink-0 flex-col gap-1">
              <DialogTitle className="text-center font-display text-2xl">Add Rich Link</DialogTitle>
            </div>
            <LinkCaptureForm
              key={incoming?.id ?? 'manual'}
              initial={incoming?.draft}
              autoFetch={Boolean(incoming)}
              closing={manual && returning}
              showActions={false}
              onControls={linkCaptureControls.set}
              saveDraft={
                incoming
                  ? (draft, placement) => saveLinkShare(incoming.id, draft, placement)
                  : undefined
              }
              onCancel={cancel}
              onSavingChange={setSaving}
              onOpenNote={async (id) => {
                await close();
                openNote(id);
              }}
              onSaved={(id) => {
                if (incoming) removeLinkCapture(incoming.id);
                else {
                  if (quickNote.get() === 'capture') quickNote.set('closed');
                  linkCaptureOpen.set(false);
                }
                toast('Link saved', {
                  action: { label: 'Open note', onClick: () => openNote(id) },
                });
              }}
            />
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
