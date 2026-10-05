import { DatabaseBackup, RefreshCw, Users } from 'lucide-react';
import { Section } from './Section';

const points = [
  {
    icon: Users,
    title: 'Room for your people',
    body: 'The first account is the admin, who invites everyone else with a link. Each person sees only their own notes.',
  },
  {
    icon: DatabaseBackup,
    title: 'Backups built in',
    body: 'Back up and restore the whole server, notes and attachments, from Settings. By hand, or every day on a schedule.',
  },
  {
    icon: RefreshCw,
    title: 'Updates you choose',
    body: 'Follow stable releases, try previews first, or stay on one version. The server backs itself up before an update changes its data.',
  },
];

export function YoursToRun() {
  return (
    <Section
      eyebrow="For whoever runs the server"
      title="Yours to run."
      lead="Catch is one Docker Compose file on a home server or a small VPS. It is built to be looked after by one person for a household or a group of friends."
    >
      <ul className="grid gap-4 md:grid-cols-3">
        {points.map(({ icon: Icon, title, body }) => (
          <li key={title} className="reveal lift glass rounded-3xl p-7">
            <Icon className="size-6 text-brand-link" aria-hidden />
            <h3 className="mt-4 text-xl font-semibold">{title}</h3>
            <p className="mt-2 leading-relaxed text-muted-foreground">{body}</p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
