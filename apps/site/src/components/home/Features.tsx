import {
  CalendarPlus,
  Images,
  Link2,
  MousePointerClick,
  Search,
  Share2,
  SunMoon,
  Type,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { PhoneFrame, type Shot, WindowFrame } from '@/components/Screenshot';
import { shots } from '@/lib/screenshots';
import { cn } from '@/lib/utils';

function Feature({
  title,
  children,
  shot,
  phone,
  flip,
}: {
  title: string;
  children: ReactNode;
  shot: Shot;
  phone?: boolean;
  flip?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
      <div className={cn('reveal', flip && 'lg:order-2')}>
        <h3 className="text-balance text-3xl font-bold tracking-tight sm:text-4xl">{title}</h3>
        <div className="mt-4 space-y-4 text-pretty text-lg text-muted-foreground">{children}</div>
      </div>
      <div className="reveal">
        {phone ? (
          <PhoneFrame shot={shot} className="mx-auto w-60 sm:w-72" />
        ) : (
          <WindowFrame shot={shot} />
        )}
      </div>
    </div>
  );
}

const more = [
  { icon: Images, title: 'Attachments' },
  { icon: Link2, title: 'Link previews' },
  { icon: Type, title: 'Rich text' },
  { icon: Search, title: 'Search by tag or color' },
  { icon: MousePointerClick, title: 'Select several notes' },
  { icon: CalendarPlus, title: 'Add to Google Calendar' },
  { icon: Share2, title: 'Share to Catch on Android' },
  { icon: SunMoon, title: 'Light and dark' },
];

export function Features() {
  return (
    <section
      id="features"
      className="mx-auto w-full max-w-6xl scroll-mt-24 space-y-24 px-6 py-16 sm:py-24"
    >
      <Feature title="Works offline." shot={shots.phoneGallery} phone>
        <p>Notes live on the device and sync when the signal comes back.</p>
      </Feature>
      <Feature title="A deck for notes in progress." shot={shots.desktopDeck} flip>
        <p>Give a note a status and it moves to a board: New, In progress, On hold.</p>
      </Feature>
      <Feature title="Tags that nest." shot={shots.desktopTags}>
        <p>Tags sit inside tags, and a top-level tag gives its notes a color.</p>
      </Feature>
      <Feature title="Reminders that repeat." shot={shots.phoneReminder} phone flip>
        <p>
          Every weekday, or the second Tuesday of the month. On Android they ring without a
          connection.
        </p>
      </Feature>

      <ul className="flex flex-wrap justify-center gap-3">
        {more.map(({ icon: Icon, title }) => (
          <li
            key={title}
            className="reveal flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-[0.95rem] font-medium"
          >
            <Icon className="size-4 text-brand-link" aria-hidden />
            {title}
          </li>
        ))}
      </ul>
    </section>
  );
}
