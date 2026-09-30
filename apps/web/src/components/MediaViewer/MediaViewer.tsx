import { type Attachment, attachmentUrl } from '@catch/shared';
import {
  AudioLines,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  HardDriveDownload,
  X,
} from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { keepAttachmentOffline, useAttachmentUrl } from '@/lib/attachmentFiles';
import { downloadAttachment } from '@/lib/attachments';
import { useBackHandler } from '@/lib/backButton';
import { cn } from '@/lib/utils';
import { DetailsSheet } from './DetailsSheet';
import { ImageStage } from './ImageStage';
import type { Size } from './transform';

export function MediaViewer({
  file,
  files = [file],
  onClose,
}: {
  file: Attachment;
  files?: Attachment[];
  onClose: () => void;
}) {
  const narrow = useSyncExternalStore(subscribeWidth, isNarrow);
  const [currentId, setCurrentId] = useState(file.id);
  const content = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const current = files.find((item) => item.id === currentId) ?? file;
  const index = files.findIndex((item) => item.id === current.id);
  const navigate = useCallback(
    (direction: number) => {
      const next = files[(index + direction + files.length) % files.length];
      if (next) setCurrentId(next.id);
    },
    [files, index],
  );
  useBackHandler(true, onClose);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (content.current?.querySelector('[data-media-stage]')) return;
      // Leave the native player's playback and seeking shortcuts intact.
      if (event.target instanceof HTMLElement && event.target.closest('video, audio')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault();
        navigate(event.key === 'ArrowLeft' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', keyboard);
    return () => window.removeEventListener('keydown', keyboard);
  }, [navigate]);

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-attachment-menu
          className="fixed inset-0 z-[90] bg-black/95 backdrop-blur-md"
        />
        <DialogPrimitive.Content
          ref={content}
          data-media-viewer
          data-attachment-menu
          className="fixed inset-0 z-[100] overflow-hidden outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            previousFocus.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null;
            content.current?.focus();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (previousFocus.current?.isConnected) previousFocus.current.focus();
          }}
        >
          <ViewerContent
            key={current.id}
            file={current}
            narrow={narrow}
            onNavigate={files.length > 1 ? navigate : undefined}
          />
          <div
            className={cn(
              'absolute top-[calc(var(--safe-top)+0.75rem)] z-20 flex items-center gap-2',
              narrow ? 'left-1/2 -translate-x-1/2' : 'right-16',
            )}
          >
            {files.length > 1 && (
              <div className="flex items-center gap-1 rounded-full glass-thick p-1 text-foreground">
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-full"
                  aria-label="Previous attachment"
                  onClick={() => navigate(-1)}
                >
                  <ChevronLeft />
                </Button>
                <span
                  className="min-w-12 text-center text-xs tabular-nums"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {index + 1} / {files.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-10 rounded-full"
                  aria-label="Next attachment"
                  onClick={() => navigate(1)}
                >
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'absolute right-3 z-30 size-11 rounded-full glass-thick text-foreground',
              narrow
                ? 'bottom-[calc(var(--safe-bottom)+1rem)]'
                : 'top-[calc(var(--safe-top)+0.75rem)]',
            )}
            aria-label="Close media viewer"
            onClick={onClose}
          >
            <X />
          </Button>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ViewerContent({
  file,
  onNavigate,
  narrow,
}: {
  file: Attachment;
  onNavigate?: (direction: number) => void;
  narrow: boolean;
}) {
  const { source, error } = useAttachmentUrl(attachmentUrl(file.id));
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState<Size | null>(null);
  const mediaRef = useCallback((node: HTMLMediaElement | null) => {
    if (!node) return;
    return () => {
      node.pause();
      node.removeAttribute('src');
      node.load();
    };
  }, []);
  const unavailable = error || failed;
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
  const download = () => run(() => downloadAttachment(file));
  const metadata = (
    <>
      <h2 className="truncate text-sm font-semibold leading-5" title={file.name}>
        {file.name}
      </h2>
      <p className="text-xs leading-5 text-muted-foreground">
        {file.mimeType} ·{' '}
        {file.size >= 1024 * 1024
          ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
          : `${Math.max(1, Math.round(file.size / 1024))} KB`}
        {size ? ` · ${size.width} × ${size.height}` : ''}
      </p>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-xs"
          aria-label="Download attachment"
          disabled={busy}
          onClick={() => void download()}
        >
          <Download className="size-3.5" />
          Download
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-9 px-2 text-xs"
          disabled={busy || file.status === 'pending'}
          onClick={() => void run(() => keepAttachmentOffline(file.id), 'Available offline')}
        >
          <HardDriveDownload className="size-3.5" />
          Keep offline
        </Button>
      </div>
    </>
  );
  return (
    <>
      <DialogTitle className="sr-only">{file.name}</DialogTitle>
      <DialogDescription className="sr-only">{file.mimeType} attachment preview</DialogDescription>
      {source && !unavailable && file.kind === 'image' ? (
        <ImageStage
          source={source}
          name={file.name}
          onError={() => setFailed(true)}
          onNavigate={onNavigate}
          onSize={setSize}
        />
      ) : source && !unavailable && file.kind === 'video' ? (
        // biome-ignore lint/a11y/useMediaCaption: user attachments do not include a caption track
        <video
          ref={mediaRef}
          src={source}
          controls
          playsInline
          autoPlay
          aria-label={file.name}
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 h-full w-full object-contain',
            narrow && 'h-[calc(100%-var(--safe-bottom)-5rem)]',
          )}
        />
      ) : source && !unavailable && file.kind === 'audio' ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-6 px-6 text-white/70">
          <AudioLines className="size-16" aria-hidden />
          {/* biome-ignore lint/a11y/useMediaCaption: user recordings do not include a transcript */}
          <audio
            ref={mediaRef}
            src={source}
            controls
            autoPlay
            aria-label={file.name}
            onError={() => setFailed(true)}
            className="w-full max-w-lg"
          />
        </div>
      ) : (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-white/70">
          <File className="size-12" aria-hidden />
          <p role="status">
            {unavailable
              ? 'Preview unavailable. Download the file or try again when connected.'
              : file.kind === 'file'
                ? 'Download this file to open it.'
                : 'Loading preview…'}
          </p>
          {file.kind === 'file' && (
            <Button variant="secondary" disabled={busy} onClick={() => void download()}>
              Download file
            </Button>
          )}
        </div>
      )}
      {narrow ? (
        <DetailsSheet>{metadata}</DetailsSheet>
      ) : (
        <div className="absolute top-[calc(var(--safe-top)+0.75rem)] left-3 z-20 w-72 max-w-[calc(100%-16rem)] rounded-2xl glass-thick px-3 py-2.5 text-foreground">
          {metadata}
        </div>
      )}
    </>
  );
}

function isNarrow() {
  return window.innerWidth < 640;
}

function subscribeWidth(callback: () => void) {
  window.addEventListener('resize', callback);
  return () => window.removeEventListener('resize', callback);
}
