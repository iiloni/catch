import { attachmentId } from '@catch/shared';
import { File, Image, Mic, Video } from 'lucide-react';
import { useState } from 'react';
import { useAttachmentUrl } from '@/lib/attachmentFiles';
import { cn } from '@/lib/utils';

export function MediaPreview({
  url,
  name,
  kind,
  compact = false,
  thumbnail = false,
}: {
  url: string;
  name: string;
  kind: string;
  compact?: boolean;
  thumbnail?: boolean;
}) {
  const poster = kind === 'video' && (thumbnail || compact);
  const { source, error } = useAttachmentUrl(
    url,
    (kind === 'image' || poster) && Boolean(attachmentId(url)),
  );
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const Icon = kind === 'image' ? Image : kind === 'video' ? Video : kind === 'audio' ? Mic : File;
  if (source && failedSource !== source && (kind === 'image' || poster))
    return (
      <img
        src={source}
        alt={name}
        loading="lazy"
        onError={() => setFailedSource(source)}
        className={cn('rounded-xl object-contain', thumbnail ? 'size-full' : 'max-h-80 w-full')}
      />
    );
  if (source && !compact && !thumbnail && kind === 'video')
    return (
      // biome-ignore lint/a11y/useMediaCaption: user attachments do not include a caption track
      <video
        src={source}
        controls
        playsInline
        preload="metadata"
        aria-label={name}
        className="max-h-80 w-full rounded-xl"
      />
    );
  if (source && !compact && !thumbnail && kind === 'audio')
    return (
      // biome-ignore lint/a11y/useMediaCaption: user recordings do not include a transcript
      <audio
        src={source}
        controls
        preload="metadata"
        aria-label={name}
        className="h-10 w-full min-w-0"
      />
    );
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-2 rounded-xl bg-foreground/5 text-sm text-muted-foreground',
        thumbnail ? 'size-full' : 'px-3 py-3',
      )}
    >
      <Icon className="size-5 shrink-0" aria-hidden />
      {!thumbnail && (
        <span className="min-w-0 truncate">
          {name || (error ? 'Preview unavailable offline' : 'Attachment')}
        </span>
      )}
    </div>
  );
}
