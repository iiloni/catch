import { blocksToPlainText, type Note } from '@catch/shared';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Props = {
  note: Note;
  onTrash?: (note: Note) => void;
  className?: string;
};

export function NoteCard({ note, onTrash, className }: Props) {
  const [title = '', ...rest] = blocksToPlainText(note.content).split('\n');
  const body = rest.join('\n');

  return (
    <article
      data-note-color={note.color}
      className={cn(
        'group relative flex flex-col gap-2 rounded-lg border bg-note p-4 text-card-foreground shadow-xs',
        className,
      )}
    >
      {title && <h3 className="font-medium text-base">{title}</h3>}
      {body && <p className="whitespace-pre-wrap text-sm">{body}</p>}
      {!title && !body && <p className="text-muted-foreground text-sm">Empty note</p>}
      {onTrash && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Move to trash"
          onClick={() => onTrash(note)}
          className="absolute right-1 bottom-1 md:opacity-0 md:focus-visible:opacity-100 md:group-hover:opacity-100"
        >
          <Trash2 />
        </Button>
      )}
    </article>
  );
}
