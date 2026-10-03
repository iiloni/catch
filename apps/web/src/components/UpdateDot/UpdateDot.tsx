import { useAndroidUpdateAvailable } from '@/lib/updates';
import { cn } from '@/lib/utils';
import { useWebUpdates } from '@/lib/webUpdates';

export function UpdateDot({ className }: { className?: string }) {
  const available = useAndroidUpdateAvailable();
  const { target } = useWebUpdates();
  if (!available && !target) return null;
  return (
    <span className={cn('flex shrink-0', className)}>
      <span aria-hidden className="size-2 rounded-full bg-brand" />
      <span className="sr-only">{' Update available'}</span>
    </span>
  );
}
