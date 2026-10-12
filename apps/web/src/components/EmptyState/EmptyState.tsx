import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { useEntryMotion } from '@/lib/entryMotion';

type Props = {
  icon: LucideIcon;
  title?: string;
  /** Work is under way: the icon pulses and the state is announced. */
  busy?: boolean;
  children?: React.ReactNode;
};

export function EmptyState({ icon: Icon, title, busy, children }: Props) {
  const entry = useEntryMotion(`empty:${title}`, true, 60);
  return (
    <motion.div
      style={entry}
      role={busy ? 'status' : undefined}
      className="flex flex-col items-center gap-3 px-6 pt-16 text-center"
    >
      <span className="flex size-16 items-center justify-center rounded-3xl bg-foreground/[0.06] text-muted-foreground">
        <Icon className={busy ? 'size-7 motion-safe:animate-pulse' : 'size-7'} aria-hidden />
      </span>
      {title && <p className="font-display font-semibold text-xl tracking-[-0.01em]">{title}</p>}
      {children && <p className="max-w-xs text-muted-foreground text-sm">{children}</p>}
    </motion.div>
  );
}
