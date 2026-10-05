import type { StaticImageData } from 'next/image';
import { cn } from '@/lib/utils';

export type Shot = { light: StaticImageData; dark: StaticImageData; alt: string };

/** An app screenshot that follows the site's theme. */
export function Screenshot({
  shot,
  eager,
  className,
}: {
  shot: Shot;
  eager?: boolean;
  className?: string;
}) {
  return (
    <>
      {(['light', 'dark'] as const).map((theme) => (
        // biome-ignore lint/performance/noImgElement: a static export has no image optimizer
        <img
          key={theme}
          src={shot[theme].src}
          width={shot[theme].width}
          height={shot[theme].height}
          alt={shot.alt}
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          className={cn('block h-auto w-full', `only-${theme}`, className)}
        />
      ))}
    </>
  );
}

export function PhoneFrame({ shot, eager, className }: Parameters<typeof Screenshot>[0]) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[2.25rem] border-[6px] border-(--brand-charcoal) bg-(--brand-charcoal) shadow-2xl shadow-black/25',
        className,
      )}
    >
      <Screenshot shot={shot} eager={eager} className="rounded-[1.85rem]" />
    </div>
  );
}

export function WindowFrame({ shot, eager, className }: Parameters<typeof Screenshot>[0]) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-border shadow-2xl shadow-black/15',
        className,
      )}
    >
      <Screenshot shot={shot} eager={eager} />
    </div>
  );
}
