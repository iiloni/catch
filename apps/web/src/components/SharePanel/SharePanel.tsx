import type { Note } from '@catch/shared';
import { Copy, FileText, Link2, Link2Off, Share2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useNoteShares } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { shareOrCopy, usesSystemShare } from '@/lib/outgoingShares';
import { noteShareLink, shareNote, stopSharingNote } from '@/lib/sharing';
import { cn } from '@/lib/utils';

type Props = {
  note: Pick<Note, 'id' | 'userId' | 'content'>;
  getContent?: () => Note['content'];
  className?: string;
};

type ShareType = 'link' | 'content';

/** A live Catch link or a Markdown copy, handed to the system or copied on desktop. */
export function SharePanel({ note, getContent, className }: Props) {
  const share = useNoteShares().get(note.id);
  const [type, setType] = useState<ShareType>('link');
  const [markdown, setMarkdown] = useState<{ source: Note['content']; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = share ? noteShareLink(share.token) : null;
  const system = usesSystemShare();
  const contentReady = markdown?.source === note.content;

  useEffect(() => {
    if (type !== 'content') return;
    let cancelled = false;
    void import('@/lib/noteMarkdown')
      .then(({ noteMarkdown }) => {
        const text = noteMarkdown(getContent?.() ?? note.content);
        if (!cancelled) setMarkdown({ source: note.content, text });
      })
      .catch(() => {
        if (!cancelled) setError('Could not prepare the note content. Try reopening Share.');
      });
    return () => {
      cancelled = true;
    };
  }, [type, note.content, getContent]);

  async function send() {
    setPending(true);
    setCopied(false);
    setError(null);
    try {
      // Link creation is local and synchronous, so Web Share still runs in this tap.
      const data =
        type === 'link' ? { url: link ?? shareNote(note) } : { text: markdown?.text ?? '' };
      const result = await shareOrCopy(data);
      if (result === 'copied') setCopied(true);
      if (result !== 'cancelled') haptics.selection();
    } catch {
      setError(
        system
          ? 'Could not open the share menu. Try again.'
          : `Could not copy. Select the ${type === 'link' ? 'link' : 'content'} and copy it manually.`,
      );
    } finally {
      setPending(false);
    }
  }

  const label = system
    ? `Share ${type}`
    : copied
      ? 'Copied'
      : type === 'content'
        ? 'Copy content'
        : link
          ? 'Copy link'
          : 'Create link';
  const Icon = system ? Share2 : type === 'link' && !link ? Link2 : Copy;

  return (
    <div data-share-panel className={cn('flex flex-col gap-3 p-2', className)}>
      <h2 className="font-medium text-sm">Share this note</h2>
      <ToggleGroup
        type="single"
        aria-label="Share type"
        value={type}
        disabled={pending}
        onValueChange={(value) => {
          if (value !== 'link' && value !== 'content') return;
          haptics.selection();
          setType(value);
          setCopied(false);
          setError(null);
        }}
        className="flex w-full rounded-xl"
      >
        <ToggleGroupItem value="link" className="h-11 flex-1 rounded-lg">
          <Link2 aria-hidden />
          Catch link
        </ToggleGroupItem>
        <ToggleGroupItem value="content" className="h-11 flex-1 rounded-lg">
          <FileText aria-hidden />
          Note content
        </ToggleGroupItem>
      </ToggleGroup>
      <p className="text-muted-foreground text-sm">
        {type === 'link'
          ? 'Anyone with the link can read the note and future updates.'
          : 'A Markdown copy, without files or future updates.'}
      </p>
      {type === 'link' && link && (
        <Input
          aria-label="Share link"
          value={link}
          readOnly
          autoComplete="off"
          className="h-11 rounded-xl font-mono"
          onFocus={(event) => event.target.select()}
        />
      )}
      {type === 'content' && (
        <textarea
          aria-label="Note content"
          readOnly
          value={contentReady ? markdown.text : ''}
          placeholder={contentReady ? 'This note has no text to share.' : 'Preparing Markdown…'}
          onFocus={(event) => event.target.select()}
          className="h-32 resize-none overflow-auto rounded-xl border bg-background p-3 font-mono text-xs outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          className="h-11 flex-1 rounded-xl"
          disabled={pending || (type === 'content' && (!contentReady || !markdown.text))}
          onClick={() => void send()}
        >
          <Icon aria-hidden />
          {label}
        </Button>
        {type === 'link' && link && (
          <Button
            variant="ghost"
            className="h-11 rounded-xl text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              haptics.warning();
              setCopied(false);
              stopSharingNote(note.id);
            }}
          >
            <Link2Off aria-hidden />
            Stop sharing
          </Button>
        )}
      </div>
    </div>
  );
}
