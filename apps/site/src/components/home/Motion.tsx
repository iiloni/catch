'use client';

import { useTheme } from 'fumadocs-ui/provider/base';
import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

/** Recorded from the app by `scripts/screenshots.ts`, as `<name>-<theme>.mp4` and `.jpg`. */
const clips = [
  {
    name: 'open-note',
    title: 'A note opens out of its card',
    body: 'The editor grows from the card you tapped and shrinks back into it, so you never lose your place on the wall.',
  },
  {
    name: 'note-color',
    title: 'The dock becomes the toolbar',
    body: "While a note is open, the dock holds that note's actions. Its color button grows the dock upward into a palette.",
  },
  {
    name: 'tabs',
    title: 'Pages slide the way you went',
    body: 'Deck, Gallery and Search sit side by side, and moving between them follows the direction of the tab you chose.',
  },
] as const;

export function Motion() {
  const [active, setActive] = useState(0);
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
          <p className="mb-3 text-sm font-semibold text-(--brand-amber-light)">Motion</p>
          <h2 className="text-balance text-4xl font-bold tracking-tight sm:text-5xl">
            Motion that shows where things went.
          </h2>
          <p className="mt-4 max-w-xl text-pretty text-lg text-(--brand-cream)/70">
            Things in Catch come from somewhere and go somewhere. These are recordings of the app,
            not animations made for this page.
          </p>
          <div role="tablist" aria-label="Recordings" className="mt-8 space-y-2">
            {clips.map((item, index) => (
              <button
                key={item.name}
                type="button"
                role="tab"
                aria-selected={index === active}
                onClick={() => setActive(index)}
                className={cn(
                  'block w-full rounded-2xl border p-5 text-left transition-colors',
                  index === active
                    ? 'border-(--brand-amber-primary)/60 bg-white/10'
                    : 'border-white/10 hover:bg-white/5',
                )}
              >
                <span className="block font-display text-lg font-semibold">{item.title}</span>
                <span
                  className={cn(
                    'mt-1 block text-[0.95rem] text-(--brand-cream)/70',
                    index !== active && 'hidden sm:block',
                  )}
                >
                  {item.body}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div
          role="tabpanel"
          className="mx-auto w-64 overflow-hidden rounded-[2.25rem] border-[6px] border-black bg-black shadow-2xl shadow-black/60 sm:w-80"
        >
          {/* 412 by 915, the phone the clips are recorded on. */}
          <div className="aspect-[412/915]">
            {mounted && (
              <video
                key={source}
                ref={video}
                src={`${source}.mp4`}
                poster={`${source}.jpg`}
                aria-label={clip.title}
                muted
                loop
                playsInline
                preload="metadata"
                className="size-full rounded-[1.85rem] object-cover"
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
