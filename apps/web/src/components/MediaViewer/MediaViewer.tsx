import { type Attachment, attachmentUrl } from '@catch/shared';
import { Download, File, X } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAttachmentUrl } from '@/lib/attachmentFiles';
import { downloadAttachment } from '@/lib/attachments';
import { useBackHandler } from '@/lib/backButton';

export function MediaViewer({ file, onClose }: { file: Attachment; onClose: () => void }) {
  const { source, error } = useAttachmentUrl(attachmentUrl(file.id));
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);
  useBackHandler(true, onClose);
  async function download() {
    setDownloading(true);
    try {
      await downloadAttachment(file);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not download attachment');
    } finally {
      setDownloading(false);
    }
  }
  const unavailable = error || failed;
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        data-media-viewer
        data-attachment-menu
        showCloseButton={false}
        overlayClassName="z-[90] bg-black/70"
        className="z-[100] gap-3 p-4 sm:max-w-5xl"
      >
        <div className="flex min-w-0 items-center gap-2">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-base" title={file.name}>
              {file.name}
            </DialogTitle>
            <DialogDescription className="mt-1">{file.mimeType}</DialogDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Download attachment"
            disabled={downloading}
            onClick={() => void download()}
          >
            <Download />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Close media viewer" onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="flex h-[min(70dvh,700px)] min-h-0 items-center justify-center overflow-hidden rounded-2xl bg-foreground/5">
          {source && !unavailable && file.kind === 'image' ? (
            <img
              src={source}
              alt={file.name}
              onError={() => setFailed(true)}
              className="size-full object-contain"
            />
          ) : source && !unavailable && file.kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: user attachments do not include a caption track
            <video
              src={source}
              controls
              playsInline
              autoPlay
              aria-label={file.name}
              onError={() => setFailed(true)}
              className="size-full object-contain"
            />
          ) : source && !unavailable && file.kind === 'audio' ? (
            // biome-ignore lint/a11y/useMediaCaption: user recordings do not include a transcript
            <audio
              src={source}
              controls
              autoPlay
              aria-label={file.name}
              onError={() => setFailed(true)}
              className="w-full max-w-lg px-4"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 px-6 text-center text-muted-foreground">
              <File className="size-12" aria-hidden />
              <p role="status">
                {unavailable
                  ? 'Preview unavailable. Download the file or try again when connected.'
                  : file.kind === 'file'
                    ? 'Download this file to open it.'
                    : 'Loading preview…'}
              </p>
              {file.kind === 'file' && (
                <Button variant="secondary" disabled={downloading} onClick={() => void download()}>
                  Download file
                </Button>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
