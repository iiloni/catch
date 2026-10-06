'use client';

import { useTheme } from 'fumadocs-ui/provider/base';
import { useEffect, useRef, useState } from 'react';
import { PhoneBody } from '@/components/Screenshot';
import { cn } from '@/lib/utils';

/** Recorded from the app by `scripts/screenshots.ts`, as `<name>-<theme>.mp4` and `.jpg`. */
const clips = [
  {
    name: 'quick-note',
    title: 'A new note flies to its place',
  },
  {
    name: 'open-note',
    title: 'A note opens out of its card',
  },
  {
    name: 'note-color',
    title: 'The dock becomes the toolbar',
  },
  {
    name: 'tabs',
    title: 'Pages slide the way you went',
  },
] as const;

export function Motion() {
  const [active, setActive] = useState(0);
  // The clips play one after another until somebody chooses one, which then repeats.
  const [chosen, setChosen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const { resolvedTheme } = useTheme();
  const video = useRef<HTMLVideoElement>(null);
  const clip = clips[active] ?? clips[0];
  const theme = resolvedTheme === 'dark' ? 'dark' : 'light';
  const source = `/recordings/${clip.name}-${theme}`;

  // The theme is only known in the browser, and a clip is only fetched once it is.
  useEffect(() => setMounted(true), []);

  // Plays while on screen, and not at all for people who ask for less motion: they get
  // the first frame and the controls.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new source is a new clip to start
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      element.controls = true;
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void element.play().catch(() => {});
        else element.pause();
      },
      { threshold: 0.4 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [source, mounted]);

  return (
    <section className="relative overflow-hidden bg-(--brand-charcoal) text-(--brand-cream)">
      <div
        aria-hidden
        className="pointer-events-none absolute -top-48 left-1/2 h-[30rem] w-[60rem] -translate-x-1/2 rounded-full bg-brand-gradient opacity-20 blur-3xl"
      />
      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-6 py-20 sm:py-28 lg:grid-cols-2">
        <div>
          <h2 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Motion that shows where things went.
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-lg text-(--brand-cream)/70">
            Recorded from the app.
          </p>
          <div role="tablist" aria-label="Recordings" className="mt-8 space-y-2">
            {clips.map((item, index) => (
              <button
                key={item.name}
                type="button"
                role="tab"
                aria-selected={index === active}
                onClick={() => {
                  setActive(index);
                  setChosen(true);
                }}
                className={cn(
                  'block w-full rounded-2xl border px-5 py-4 text-left font-display text-lg font-semibold transition-colors',
                  index === active
                    ? 'border-(--brand-amber-primary)/60 bg-white/10'
                    : 'border-white/10 hover:bg-white/5',
                )}
              >
                {item.title}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel">
          <PhoneBody className="mx-auto w-64 sm:w-80">
            {mounted && (
              <video
                key={source}
                ref={video}
                src={`${source}.mp4`}
                poster={`${source}.jpg`}
                aria-label={clip.title}
                muted
                loop={chosen}
                onEnded={() => {
                  // With less motion asked for, a clip somebody played by hand just stops.
                  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
                  setActive((active + 1) % clips.length);
                }}
                playsInline
                preload="metadata"
                className="size-full object-cover"
              />
            )}
          </PhoneBody>
        </div>
      </div>
    </section>
  );
}
