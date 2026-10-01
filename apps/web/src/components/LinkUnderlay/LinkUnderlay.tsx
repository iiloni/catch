import type { NoteColor } from '@catch/shared';
import { motion } from 'motion/react';
import { SiteIcon } from '@/components/LinkPreviewCard/LinkPreviewCard';
import { linkTitle, type ResolvedLink } from '@/lib/linkPreviews';
import { cn } from '@/lib/utils';

type Props = {
  links: ResolvedLink[];
  onOpen: () => void;
  /**
   * `card` tucks under a note card in the note's own color, a step darker; `dock` tucks
   * under the dock as thick glass, since it holds text over the note.
   */
  variant: 'card' | 'dock';
  color?: NoteColor;
  className?: string;
};

/**
 * A tab tucked under a card or the dock that names a note's first link and counts the rest.
 * Its top edge hides under whatever it is tucked under, so it reads as a card behind.
 */
export function LinkUnderlay({ links, onOpen, variant, color, className }: Props) {
  const [first] = links;
  if (!first) return null;
  const more = links.length - 1;

  return (
    <motion.button
      type="button"
      data-link-underlay
      data-note-color={variant === 'card' ? color : undefined}
      aria-label={
        links.length === 1
          ? `Link: ${linkTitle(first)}`
          : `${links.length} links, first ${linkTitle(first)}`
      }
      onClick={onOpen}
      initial={variant === 'dock' ? { opacity: 0 } : false}
      animate={variant === 'dock' ? { opacity: 1 } : undefined}
      exit={variant === 'dock' ? { opacity: 0 } : undefined}
      transition={{ duration: 0.18 }}
      className={cn(
        'flex min-w-0 items-center gap-2 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
        variant === 'card'
          ? // Tucked 12 px under the card; the visible strip is the rest.
            '-mt-3 mx-2 h-12 rounded-b-2xl border border-transparent border-t-0 bg-[color-mix(in_oklch,var(--note-bg),var(--foreground)_7%)] px-3 pt-3 text-xs data-[note-color=default]:border-border'
          : 'glass-thick mx-3 h-14 rounded-t-[var(--dock-radius)] border-b-0 px-4 pb-3 text-sm',
        className,
      )}
    >
      <SiteIcon link={first} className={variant === 'dock' ? 'size-4.5' : undefined} />
      <span className="min-w-0 flex-1 truncate font-medium">{linkTitle(first)}</span>
      {more > 0 && (
        <span className="shrink-0 font-medium text-muted-foreground tabular-nums">+{more}</span>
      )}
    </motion.button>
  );
}
