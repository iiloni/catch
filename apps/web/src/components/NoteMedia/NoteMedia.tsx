import { type Attachment, attachmentUrl } from '@catch/shared';
import { Download, Ellipsis, HardDriveDownload, ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import { MediaPreview } from '@/components/MediaPreview/MediaPreview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { keepAttachmentOffline } from '@/lib/attachmentFiles';
import {
  downloadAttachment,
  removeAttachment,
  renameAttachment,
  useNoteAttachments,
} from '@/lib/attachments';
import { editorControls } from '@/lib/dockState';
import { cn } from '@/lib/utils';

export function NoteMedia({
  noteId,
  readOnly,
  className,
}: {
  noteId: string;
  readOnly?: boolean;
  className?: string;
}) {
  const files = useNoteAttachments(noteId);
  if (!files.length) return null;
  return (
    <section aria-label="Media" data-note-media className={cn('flex flex-col gap-2', className)}>
      <h2 className="px-1 text-xs font-medium text-muted-foreground">Media · {files.length}</h2>
      <ul className="flex flex-col gap-2">
        {files.map((file) => (
          <li key={file.id}>
            <AttachmentCard key={`${file.id}:${file.status}`} file={file} readOnly={readOnly} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function AttachmentCard({ file, readOnly }: { file: Attachment; readOnly?: boolean }) {
  const [dialog, setDialog] = useState<'rename' | 'remove' | null>(null);
  const [name, setName] = useState(file.name);
  const [busy, setBusy] = useState(false);
  async function run(action: () => Promise<unknown>, success?: string) {
    setBusy(true);
    try {
      await action();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load attachment');
    } finally {
      setBusy(false);
    }
  }
  function showInNote() {
    const controls = editorControls.get();
    if (controls && !controls.showAttachment(file.id)) controls.attachmentInserter()([file]);
  }
  return (
    <div
      className="overflow-hidden rounded-2xl border border-border bg-card/60 p-2"
      data-attachment={file.id}
    >
      <MediaPreview url={attachmentUrl(file.id)} name={file.name} kind={file.kind} />
      <div className="flex items-center gap-1 pt-1 pl-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {file.status === 'pending' ? 'Waiting to upload' : formatSize(file.size)}
            {busy ? ' · Loading…' : ''}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <IconButton label={`Manage ${file.name}`}>
              <Ellipsis />
            </IconButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="z-[80]" data-attachment-menu>
            <DropdownMenuItem onSelect={() => void run(() => downloadAttachment(file))}>
              <Download />
              Download
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void run(() => keepAttachmentOffline(file.id), 'Available offline')}
              disabled={file.status === 'pending'}
            >
              <HardDriveDownload />
              Keep offline
            </DropdownMenuItem>
            {!readOnly && (
              <>
                <DropdownMenuItem onSelect={showInNote}>
                  <ImagePlus />
                  Show in note
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setName(file.name);
                    setDialog('rename');
                  }}
                >
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDialog('remove')}>
                  <Trash2 />
                  Remove attachment
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent className="z-[80]" data-attachment-menu>
          <div className="flex flex-col gap-2">
            <DialogTitle>
              {dialog === 'rename' ? 'Rename attachment' : 'Remove attachment?'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'rename'
                ? 'Choose a name for this file.'
                : 'This removes the file and its inline blocks from this note on every device.'}
            </DialogDescription>
          </div>
          {dialog === 'rename' && (
            <Input
              aria-label="File name"
              value={name}
              maxLength={255}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && name.trim()) {
                  renameAttachment(file.id, name);
                  setDialog(null);
                }
              }}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button
              disabled={dialog === 'rename' && !name.trim()}
              variant={dialog === 'remove' ? 'destructive' : 'default'}
              onClick={() => {
                if (dialog === 'rename') renameAttachment(file.id, name);
                else removeAttachment(file);
                setDialog(null);
              }}
            >
              {dialog === 'rename' ? 'Save' : 'Remove attachment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
