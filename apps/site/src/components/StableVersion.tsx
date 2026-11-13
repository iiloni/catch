import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * The stable release the site describes (ADR 0020), linking to its notes. Renders nothing in
 * a build without release history, such as the development container's.
 */
export function StableVersion({
  version,
  className,
}: {
  version: string | null;
  className?: string;
}) {
  if (!version) return null;
  return (
    <Link
      href={`/changelog/${version}`}
      className={cn(
        'inline-flex h-7 items-center rounded-full border border-border px-2.5 font-medium text-muted-foreground text-xs tabular-nums transition-colors hover:text-foreground',
        className,
      )}
    >
      <span className="sr-only">Latest stable release </span>v{version}
    </Link>
  );
}
