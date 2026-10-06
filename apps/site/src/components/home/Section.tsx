import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Section({
  id,
  title,
  lead,
  children,
  className,
}: {
  id?: string;
  title: ReactNode;
  lead?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      id={id}
      className={cn('mx-auto w-full max-w-6xl scroll-mt-24 px-6 py-16 sm:py-24', className)}
    >
      <div className="reveal mx-auto max-w-2xl text-center">
        <h2 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">{title}</h2>
        {lead && <p className="mt-4 text-pretty text-lg text-muted-foreground">{lead}</p>}
      </div>
      <div className="mt-12">{children}</div>
    </section>
  );
}
