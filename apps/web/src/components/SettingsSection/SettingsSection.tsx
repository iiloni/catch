import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { cn } from '@/lib/utils';

type SectionProps = {
  title: string;
  /** A line under the section, for what its settings affect. */
  description?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** A titled group of settings on one card. Rows inside it are divided by hairlines. */
export function SettingsSection({ title, description, children, className }: SectionProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-2', className)}>
      <h2 id={id} className="px-4 font-medium text-muted-foreground text-sm">
        {title}
      </h2>
      <div className="flex flex-col divide-y divide-foreground/[0.06] rounded-2xl bg-foreground/[0.05]">
        {children}
      </div>
      {description && <p className="px-4 text-muted-foreground text-xs">{description}</p>}
    </section>
  );
}

type RowProps = {
  icon?: LucideIcon;
  label: ReactNode;
  description?: ReactNode;
  /** The row's control, at its end. */
  children?: ReactNode;
};

/** One setting: its name (and a line about it) with its control at the end. */
export function SettingsRow({ icon: Icon, label, description, children }: RowProps) {
  return (
    <div className="flex min-h-14 items-center gap-3 px-4 py-3">
      {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />}
      <div className="min-w-0 flex-1">
        <p className="font-medium">{label}</p>
        {description && <p className="truncate text-muted-foreground text-sm">{description}</p>}
      </div>
      {children}
    </div>
  );
}
