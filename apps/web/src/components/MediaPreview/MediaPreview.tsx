import { attachmentId } from '@catch/shared';
import { File, Image, Mic, Video } from 'lucide-react';
import { useState } from 'react';
import { useAttachmentUrl } from '@/lib/attachmentFiles';

export function MediaPreview({
  url,
  name,
  kind,
  compact = false,
}: {
  url: string;
  name: string;
  kind: string;
  compact?: boolean;
}) {
  const { source, error } = useAttachmentUrl(url, kind === 'image' && Boolean(attachmentId(url)));
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const Icon = kind === 'image' ? Image : kind === 'video' ? Video : kind === 'audio' ? Mic : File;
  if (source && failedSource !== source && kind === 'image')
    return (
      <img
        src={source}
        alt={name}
        loading="lazy"
        onError={() => setFailedSource(source)}
        className="max-h-80 w-full rounded-xl object-contain"
      />
    );
  if (source && !compact && kind === 'video')
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
  if (source && !compact && kind === 'audio')
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
    <div className="flex items-center gap-2 rounded-xl bg-foreground/5 px-3 py-3 text-sm text-muted-foreground">
      <Icon className="size-5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {name || (error ? 'Preview unavailable offline' : 'Attachment')}
      </span>
    </div>
  );
}
