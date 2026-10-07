import { Archive, Bell, ListChecks, Palette } from 'lucide-react';
import { Section } from './Section';

const cards = [
  {
    color: 'yellow',
    icon: Palette,
    title: 'Colors and pins',
    body: 'Eighteen colors and a pinned row.',
  },
  {
    color: 'orange',
    icon: ListChecks,
    title: 'Checklists',
    body: 'Tick items off right on the card.',
  },
  {
    color: 'pink',
    icon: Bell,
    title: 'Reminders',
    body: 'Once or on a repeat.',
  },
  {
    color: 'violet',
    icon: Archive,
    title: 'Archive and trash',
    body: 'Put notes away, or get them back.',
  },
];

export function LikeKeep() {
  return (
    <Section title="If you know Keep, you know Catch.">
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(({ color, icon: Icon, title, body }) => (
          <li
            key={title}
            data-note-color={color}
            className="reveal lift rounded-3xl bg-note p-6 shadow-sm"
          >
            <Icon className="size-6 text-note-accent" aria-hidden />
            <h3 className="mt-4 text-lg font-semibold">{title}</h3>
            <p className="mt-2 text-[0.95rem] leading-relaxed text-foreground/80">{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
