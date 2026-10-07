'use client';

import { useTheme } from 'fumadocs-ui/provider/base';
import { useEffect, useState } from 'react';

/** Silent app recordings with explicit playback; changing theme stops the old clip. */
export function DocsRecording({
  name,
  caption,
}: {
  name: 'quick-note' | 'note-color' | 'search-filters';
  caption: string;
}) {
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  useEffect(() => setMounted(true), []);
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const source = `/recordings/${name}-${theme}`;
  return (
    <figure className="not-prose mx-auto my-8 w-full max-w-72">
      {mounted ? (
        // biome-ignore lint/a11y/useMediaCaption: no audio; the caption and adjacent steps describe the actions
        <video
          key={source}
          controls
          playsInline
          preload="none"
          poster={`${source}.jpg`}
          aria-label={caption}
          width={360}
          height={840}
          className="m-0 h-auto w-full rounded-xl border border-fd-border"
        >
          <source src={`${source}.webm`} type="video/webm" />
          <source src={`${source}.mp4`} type="video/mp4" />
          Your browser cannot play this recording. Follow the steps on this page instead.
        </video>
      ) : (
        (['light', 'dark'] as const).map((posterTheme) => (
          // biome-ignore lint/performance/noImgElement: a static export has no image optimizer
          <img
            key={posterTheme}
            src={`/recordings/${name}-${posterTheme}.jpg`}
            alt={caption}
            width={360}
            height={840}
            loading="lazy"
            className={`m-0 h-auto w-full rounded-xl border border-fd-border only-${posterTheme}`}
          />
        ))
      )}
      <figcaption className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
        {caption} Select Play to watch the silent recording.
      </figcaption>
    </figure>
  );
}
