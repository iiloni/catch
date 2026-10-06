import { ArrowDown } from 'lucide-react';
import { PhoneFrame, WindowFrame } from '@/components/Screenshot';
import { shots } from '@/lib/screenshots';
import { REPOSITORY_URL } from '@/lib/site';

export function Hero() {
  // Starts under the floating header, so the glow runs behind it instead of ending at its edge.
  return (
    <section className="relative -mt-17 overflow-hidden pt-17">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 mx-auto h-[36rem] max-w-5xl rounded-full bg-brand-gradient opacity-25 blur-3xl"
      />
      <div className="relative mx-auto max-w-6xl px-6 pt-16 pb-12 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-balance text-5xl font-extrabold tracking-tight sm:text-7xl">
            Catch it before it's gone.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
            Quick, colorful notes for the browser and Android. They work offline and sync through
            your own server. There is no hosted Catch.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#get-started"
              className="inline-flex h-12 items-center gap-2 rounded-2xl bg-brand-gradient px-6 font-semibold text-brand-foreground shadow-lg shadow-(--glass-shadow) transition-transform hover:-translate-y-0.5"
            >
              Get started
              <ArrowDown className="size-4" aria-hidden />
            </a>
            <a
              href={REPOSITORY_URL}
              className="glass inline-flex h-12 items-center rounded-2xl px-6 font-semibold transition-transform hover:-translate-y-0.5"
            >
              View on GitHub
            </a>
          </div>
          <p className="mt-5 text-sm text-muted-foreground">
            Open source. Imports from Google Keep.
          </p>
        </div>

        <div className="relative mx-auto mt-14 max-w-5xl pb-10 sm:mt-20">
          <WindowFrame shot={shots.desktopGallery} eager className="drop-in" />
          <PhoneFrame
            shot={shots.phoneGallery}
            eager
            className="drop-in drop-in-late absolute -bottom-2 right-2 w-[30%] sm:-right-6 sm:w-[24%]"
          />
        </div>
      </div>
    </section>
  );
}
