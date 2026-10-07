import type { Note } from '@catch/shared';
import { Copy, Link2, Link2Off, Share2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useNoteShares } from '@/lib/collections';
import { haptics } from '@/lib/haptics';
import { noteShareLink, shareNote, stopSharingNote } from '@/lib/sharing';
import { cn } from '@/lib/utils';

type Props = {
  note: Pick<Note, 'id' | 'userId'>;
  className?: string;
};

const canShare = () => typeof navigator !== 'undefined' && 'share' in navigator;

/**
 * A note's share link (ADR 0021): makes it, hands it over, and ends it. Anyone with the link
 * reads the note as it is now; someone with an account here can add it to their notes.
 */
export function SharePanel({ note, className }: Props) {
  const share = useNoteShares().get(note.id);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = share ? noteShareLink(share.token) : null;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setError(null);
      haptics.selection();
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  }

  if (!link) {
    return (
      <div data-share-panel className={cn('flex flex-col gap-3 p-2', className)}>
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-sm">Share this note</h2>
          <p className="text-muted-foreground text-sm">
            Anyone with the link can read the note, and sees your changes to it. People with an
            account on this server can add it to their notes.
          </p>
        </div>
        <Button
          className="h-11 rounded-full"
          onClick={() => {
            haptics.success();
            void copy(shareNote(note));
          }}
        >
          <Link2 aria-hidden />
          Create link
        </Button>
      </div>
    );
  }

  return (
    <div data-share-panel className={cn('flex flex-col gap-3 p-2', className)}>
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-sm">Shared with a link</h2>
        <p className="text-muted-foreground text-sm">
          Anyone with this link can read the note. They cannot change it.
        </p>
      </div>
      <Input
        aria-label="Share link"
        value={link}
        readOnly
        autoComplete="off"
        className="h-11 font-mono"
        onFocus={(event) => event.target.select()}
      />
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void copy(link)} className="h-11 rounded-full">
          <Copy aria-hidden />
          {copied ? 'Copied' : 'Copy link'}
        </Button>
        {canShare() && (
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={() => {
              // Dismissing the share sheet rejects; there is nothing to report.
              navigator.share({ url: link }).catch(() => {});
            }}
          >
            <Share2 aria-hidden />
            Send
          </Button>
        )}
        <Button
          variant="ghost"
          className="ml-auto h-11 rounded-full text-destructive hover:text-destructive"
          onClick={() => {
            haptics.warning();
            setCopied(false);
            stopSharingNote(note.id);
          }}
        >
          <Link2Off aria-hidden />
          Stop sharing
        </Button>
      </div>
    </div>
  );
}
