import type { LucideIcon } from 'lucide-react';

type Props = {
  icon: LucideIcon;
  title: string;
  children?: React.ReactNode;
};

export function EmptyState({ icon: Icon, title, children }: Props) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-16 text-center">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-foreground/[0.06] text-muted-foreground">
        <Icon className="size-7" aria-hidden />
      </span>
      <p className="font-display font-semibold text-xl tracking-[-0.01em]">{title}</p>
      {children && <p className="max-w-xs text-muted-foreground text-sm">{children}</p>}
    </div>
  );
}
