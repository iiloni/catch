import type { StaticImageData } from 'next/image';
import type { ReactNode } from 'react';
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

/**
 * A phone with the proportions of a Galaxy Z Fold7's cover screen (21:9, thin even bezels,
 * a centered camera), which is the screen `scripts/screenshots.ts` captures. Sizes are in
 * `cqw`, so the frame keeps its shape at any width. The captures leave room for the status
 * and gesture bars, where the camera and the gesture bar are drawn.
 */
export function PhoneBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('@container', className)}>
      <div className="relative rounded-[5.6cqw] bg-[#18191b] p-[2.2cqw] shadow-2xl shadow-black/30 ring-1 ring-white/15 ring-inset">
        <div className="relative aspect-[360/840] overflow-hidden rounded-[3.4cqw] bg-black">
          {children}
          <span
            aria-hidden
            className="absolute top-[2.6cqw] left-1/2 size-[3.6cqw] -translate-x-1/2 rounded-full bg-black ring-1 ring-white/10"
          />
          <span
            aria-hidden
            className="absolute bottom-[1.6cqw] left-1/2 h-[1.1cqw] w-[30cqw] -translate-x-1/2 rounded-full bg-foreground/45"
          />
        </div>
      </div>
    </div>
  );
}

export function PhoneFrame({ shot, eager, className }: Parameters<typeof Screenshot>[0]) {
  return (
    <PhoneBody className={className}>
      <Screenshot shot={shot} eager={eager} />
    </PhoneBody>
  );
}

export function WindowFrame({ shot, eager, className }: Parameters<typeof Screenshot>[0]) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-lg border border-border shadow-2xl shadow-black/15',
        className,
      )}
    >
      <Screenshot shot={shot} eager={eager} />
    </div>
  );
}
