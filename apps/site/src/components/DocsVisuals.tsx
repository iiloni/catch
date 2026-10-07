import type { ReactNode } from 'react';
import { docShots } from '@/lib/screenshots';
import { cn } from '@/lib/utils';

/** Keep paired controls beside each other when the article has enough room. */
export function DocsVisuals({ children }: { children: ReactNode }) {
  return <div className="not-prose my-8 flex flex-wrap justify-center gap-6">{children}</div>;
}

export function DocsScreenshot({
  name,
  caption,
}: {
  name: keyof typeof docShots;
  caption: string;
}) {
  const shot = docShots[name];
  return (
    <figure
      className={cn(
        'not-prose mx-auto my-8 min-w-0 [&_img]:m-0',
        name.startsWith('desktop') ? 'w-full' : 'w-full max-w-72',
        '[.not-prose>&]:mx-0 [.not-prose>&]:my-0',
      )}
    >
      <div className="overflow-hidden rounded-xl border border-fd-border">
        {(['light', 'dark'] as const).map((theme) => (
          <a
            key={theme}
            href={shot[theme].src}
            target="_blank"
            rel="noreferrer"
            aria-label={`Open full-size screenshot: ${shot.alt}`}
            className={`block only-${theme}`}
          >
            {/* biome-ignore lint/performance/noImgElement: a static export has no image optimizer */}
            <img
              src={shot[theme].src}
              width={shot[theme].width}
              height={shot[theme].height}
              alt={shot.alt}
              loading="lazy"
              decoding="async"
              className="block h-auto w-full"
            />
          </a>
        ))}
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
        {caption} Select the image to enlarge.
      </figcaption>
    </figure>
  );
}
