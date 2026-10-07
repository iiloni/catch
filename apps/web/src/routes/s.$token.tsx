import {
  resolveAttachmentBlocks,
  type SharedAttachment,
  type SharedNoteView,
  sharedAttachmentPath,
  sharedNoteViewSchema,
  shareLink,
  shareTokenSchema,
} from '@catch/shared';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { Download, FileText } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { BrandLockup } from '@/components/BrandLockup/BrandLockup';
import { NotePreview } from '@/components/NotePreview/NotePreview';
import { Button } from '@/components/ui/button';
import { ApiError, api } from '@/lib/api';
import { canOfferApp, openInAppLink } from '@/lib/appLinks';
import { currentPath, getAuthToken } from '@/lib/auth';
import { getServerUrl } from '@/lib/serverUrl';

/**
 * What a share link opens (ADR 0020): the note as it is now, to read. It asks for no
 * account, so nothing here may assume one; someone signed in can add the note to their
 * gallery, where it keeps following its owner's changes.
 */
export const Route = createFileRoute('/s/$token')({
  component: SharedNotePage,
});

type State =
  | { status: 'loading' }
  | { status: 'ready'; note: SharedNoteView }
  | { status: 'missing' }
  | { status: 'failed' };

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function SharedNotePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` asks for the note again
  useEffect(() => {
    if (!shareTokenSchema.safeParse(token).success) {
      setState({ status: 'missing' });
      return;
    }
    const controller = new AbortController();
    setState({ status: 'loading' });
    api.sharedNote(token, controller.signal).then(
      (body) => {
        const parsed = sharedNoteViewSchema.safeParse(body);
        setState(parsed.success ? { status: 'ready', note: parsed.data } : { status: 'failed' });
      },
      (failure: unknown) => {
        if (controller.signal.aborted) return;
        const gone = failure instanceof ApiError && [400, 404].includes(failure.status);
        setState({ status: gone ? 'missing' : 'failed' });
      },
    );
    return () => controller.abort();
  }, [token, attempt]);

  const fileUrl = (id: string) => `${getServerUrl()}${sharedAttachmentPath(token, id)}`;
  const note = state.status === 'ready' ? state.note : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `fileUrl` follows the token
  const content = useMemo(
    () => (note ? resolveAttachmentBlocks(note.content, fileUrl) : []),
    [note, token],
  );

  const openInNotes = (noteId: string) => navigate({ to: '/', search: { note: noteId } });

  async function add() {
    setAdding(true);
    setError(null);
    try {
      const { noteId } = await api.acceptShare(token);
      await openInNotes(noteId);
    } catch (failure) {
      setError(
        failure instanceof ApiError && failure.status === 404
          ? 'This note is no longer shared.'
          : 'Could not add the note. Try again.',
      );
      setAdding(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 px-4 pt-[calc(var(--safe-top)+1rem)] pb-[calc(var(--safe-bottom)+2rem)]">
      <header className="flex items-center justify-between gap-3">
        <Link to="/" aria-label="Catch" className="shrink-0">
          <BrandLockup orientation="horizontal" iconSize={32} />
        </Link>
        {note && (
          <SharedNoteAction
            viewer={note.viewer}
            adding={adding}
            onAdd={() => void add()}
            onOpen={() => void openInNotes(note.noteId)}
          />
        )}
      </header>
      {note && canOfferApp() && (
        // The phone's browser opens a link even with the app installed (see `appLinks.ts`).
        <Button asChild variant="outline" className="rounded-full">
          <a href={openInAppLink(shareLink(getServerUrl(), token))}>Open in the Catch app</a>
        </Button>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {state.status === 'loading' && (
        <p className="pt-16 text-center text-muted-foreground text-sm">Loading note…</p>
      )}
      {state.status === 'missing' && (
        <div className="flex flex-col items-center gap-2 pt-16 text-center">
          <h1 className="font-display font-semibold text-xl">This note is not shared</h1>
          <p className="max-w-sm text-muted-foreground text-sm">
            The link may be incomplete, or its owner stopped sharing the note or deleted it.
          </p>
        </div>
      )}
      {state.status === 'failed' && (
        <div className="flex flex-col items-center gap-3 pt-16 text-center">
          <h1 className="font-display font-semibold text-xl">Could not load this note</h1>
          <Button variant="outline" onClick={() => setAttempt((count) => count + 1)}>
            Try again
          </Button>
        </div>
      )}
      {note && (
        <>
          <article
            aria-label="Shared note"
            data-note-color={note.color}
            className="rounded-2xl border border-transparent bg-note px-1 py-2 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/0.06)] data-[note-color=default]:border-border"
          >
            <NotePreview
              content={content}
              maxBlocks={Number.POSITIVE_INFINITY}
              variant="editor"
              reading
            />
            <SharedFiles files={note.attachments} url={fileUrl} />
          </article>
          <p className="text-center text-muted-foreground text-xs">
            {note.ownerName ? `Shared by ${note.ownerName}` : 'Shared note'} · Edited{' '}
            <time dateTime={note.updatedAt.toISOString()}>{dateFormat.format(note.updatedAt)}</time>
          </p>
        </>
      )}
    </main>
  );
}

function SharedNoteAction({
  viewer,
  adding,
  onAdd,
  onOpen,
}: {
  viewer: SharedNoteView['viewer'];
  adding: boolean;
  onAdd: () => void;
  onOpen: () => void;
}) {
  // A session that ended reads as a guest's to the server while the device still holds it.
  if (viewer === 'guest') {
    return (
      <Button asChild variant="outline" className="rounded-full">
        <Link to="/login" search={{ redirect: currentPath() }}>
          {getAuthToken() ? 'Sign in again to add' : 'Sign in to add to your notes'}
        </Link>
      </Button>
    );
  }
  if (viewer === 'user') {
    return (
      <Button className="rounded-full" disabled={adding} onClick={onAdd}>
        {adding ? 'Adding…' : 'Add to my notes'}
      </Button>
    );
  }
  return (
    <Button variant="outline" className="rounded-full" onClick={onOpen}>
      {viewer === 'owner' ? 'Open your note' : 'Open in my notes'}
    </Button>
  );
}

const sizeFormat = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${sizeFormat.format(bytes / 1024)} KB`;
  return `${sizeFormat.format(bytes / (1024 * 1024))} MB`;
}

/** Every file of the note, to download: some sit in its text, and some only come with it. */
function SharedFiles({
  files,
  url,
}: {
  files: readonly SharedAttachment[];
  url: (id: string) => string;
}) {
  if (!files.length) return null;
  return (
    <section aria-label="Files" className="flex flex-col gap-2 px-3 pt-5 pb-2">
      <h2 className="px-1 font-medium text-muted-foreground text-xs">
        {files.length === 1 ? 'File' : `Files · ${files.length}`}
      </h2>
      <ul className="flex flex-col gap-2">
        {files.map((file) => (
          <li key={file.id}>
            <a
              href={`${url(file.id)}?download=true`}
              download={file.name}
              className="flex min-h-12 items-center gap-3 rounded-xl bg-foreground/5 px-3 py-2 text-sm outline-none hover:bg-foreground/10 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.name}</span>
              <span className="shrink-0 text-muted-foreground text-xs">{fileSize(file.size)}</span>
              <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
