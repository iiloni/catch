import type { Note } from '@catch/shared';
import { and, eq, isNull, useLiveQuery } from '@tanstack/react-db';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { LogOut } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { uuidv7 } from 'uuidv7';
import { NoteCard } from '@/components/NoteCard/NoteCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { authClient, clearAuthToken, getAuthToken } from '@/lib/auth';
import { notesCollection } from '@/lib/collections';
import { needsServerUrl } from '@/lib/serverUrl';

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    if (needsServerUrl()) throw redirect({ to: '/setup' });
    if (!getAuthToken()) throw redirect({ to: '/login' });
  },
  component: NotesPage,
});

function NotesPage() {
  const { data: session } = authClient.useSession();
  const { data: notes = [], isLoading } = useLiveQuery((q) =>
    q
      .from({ note: notesCollection })
      .where(({ note }) => and(isNull(note.deletedAt), eq(note.isArchived, false)))
      .orderBy(({ note }) => note.isPinned, 'desc')
      .orderBy(({ note }) => note.updatedAt, 'desc'),
  );

  async function signOut() {
    await authClient.signOut();
    clearAuthToken();
    window.location.assign('/login');
  }

  function trash(note: Note) {
    notesCollection.update(note.id, (draft) => {
      draft.deletedAt = new Date();
    });
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-6xl flex-col gap-6 p-4">
      <header className="flex items-center justify-between">
        <h1 className="font-bold text-2xl">Catch</h1>
        <Button variant="ghost" size="icon" aria-label="Sign out" onClick={signOut}>
          <LogOut />
        </Button>
      </header>
      {session && <QuickAdd userId={session.user.id} />}
      {isLoading ? (
        <p className="text-muted-foreground">Loading notes…</p>
      ) : (
        <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 xl:columns-4 [&>*]:mb-4 [&>*]:break-inside-avoid">
          {notes.map((note) => (
            <NoteCard key={note.id} note={note} onTrash={trash} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Placeholder until the BlockNote editor lands: one line becomes one paragraph block. */
function QuickAdd({ userId }: { userId: string }) {
  const [text, setText] = useState('');

  function submit(event: FormEvent) {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    const now = new Date();
    notesCollection.insert({
      id: uuidv7(),
      userId,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: value, styles: {} }] }],
      color: 'default',
      status: null,
      isPinned: false,
      isArchived: false,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    setText('');
  }

  return (
    <form onSubmit={submit} className="mx-auto w-full max-w-xl">
      <Input
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="Take a note…"
        aria-label="New note"
        className="h-12 bg-card"
      />
    </form>
  );
}
