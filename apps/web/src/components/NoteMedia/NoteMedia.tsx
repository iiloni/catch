import { type Attachment, attachmentUrl } from '@catch/shared';
import { Download, Ellipsis, HardDriveDownload, ImagePlus, Pencil, Trash2 } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { IconButton } from '@/components/IconButton/IconButton';
import { MediaPreview } from '@/components/MediaPreview/MediaPreview';
import { MediaViewer } from '@/components/MediaViewer/MediaViewer';
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
import { editorControls, editorNote } from '@/lib/dockState';
import { cn } from '@/lib/utils';

export function NoteMedia({
  noteId,
  readOnly,
  className,
  withHeading = true,
  onShowInNote,
}: {
  noteId: string;
  readOnly?: boolean;
  className?: string;
  withHeading?: boolean;
  onShowInNote?: () => void;
}) {
  const files = useNoteAttachments(noteId);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const viewing = files.find((file) => file.id === viewingId);
  if (!files.length) return null;
  return (
    <section aria-label="Media" data-note-media className={cn('flex flex-col gap-2', className)}>
      {withHeading && (
        <h2 className="px-1 text-xs font-medium text-muted-foreground">Media · {files.length}</h2>
      )}
      <ul className="flex flex-col gap-2">
        {files.map((file) => (
          <li key={file.id}>
            <AttachmentCard
              file={file}
              readOnly={readOnly}
              onView={() => setViewingId(file.id)}
              onShowInNote={onShowInNote}
            />
          </li>
        ))}
      </ul>
      {viewing && <MediaViewer file={viewing} files={files} onClose={() => setViewingId(null)} />}
    </section>
  );
}

const noSubscription = () => () => {};

function AttachmentCard({
  file,
  readOnly,
  onView,
  onShowInNote,
}: {
  file: Attachment;
  readOnly?: boolean;
  onView: () => void;
  onShowInNote?: () => void;
}) {
  const [rename, setRename] = useState(false);
  const activeNote = editorNote.use();
  const activeControls = editorControls.use();
  const controls = activeNote?.id === file.noteId ? activeControls : null;
  const state = useSyncExternalStore(
    controls?.subscribe ?? noSubscription,
    () => controls?.getState() ?? null,
  );
  const linked = state?.attachmentIds.includes(file.id) ?? false;
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
    if (!controls) return;
    if (!controls.showAttachment(file.id)) controls.attachmentInserter()([file]);
    onShowInNote?.();
  }
  return (
    <div
      className="relative flex min-w-0 items-center gap-3 rounded-2xl border border-border bg-card/60 p-2"
      data-attachment={file.id}
    >
      <button
        type="button"
        aria-label={`View ${file.name}`}
        onClick={onView}
        className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <MediaPreview
          key={file.status}
          url={attachmentUrl(file.id)}
          name={file.name}
          kind={file.kind}
          thumbnail
        />
      </button>
      <div className="flex min-w-0 flex-1 items-center gap-1">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={file.name}>
            {file.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {file.status === 'pending' ? 'Waiting to upload' : formatSize(file.size)}
            {busy ? ' · Loading…' : ''}
          </p>
        </div>
        <DropdownMenu modal={false}>
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
                <DropdownMenuItem onSelect={showInNote} disabled={!controls}>
                  <ImagePlus />
                  {linked ? 'Show in note' : 'Add to note'}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    setName(file.name);
                    setRename(true);
                  }}
                >
                  <Pencil />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => removeAttachment(file)}>
                  <Trash2 />
                  Remove attachment
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Dialog open={rename} onOpenChange={setRename}>
        <DialogContent className="z-[80]" data-attachment-menu>
          <div className="flex flex-col gap-2">
            <DialogTitle>Rename attachment</DialogTitle>
            <DialogDescription>Choose a name for this file.</DialogDescription>
          </div>
          <Input
            aria-label="File name"
            value={name}
            maxLength={255}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && name.trim()) {
                renameAttachment(file.id, name);
                setRename(false);
              }
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRename(false)}>
              Cancel
            </Button>
            <Button
              disabled={!name.trim()}
              onClick={() => {
                renameAttachment(file.id, name);
                setRename(false);
              }}
            >
              Save
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
