import { DEPLOYMENT_GUIDE_URL, RELEASES_URL } from '@/lib/site';
import { Section } from './Section';

const download = `mkdir catch && cd catch
curl -fsSLO https://raw.githubusercontent.com/iiloni/catch/main/docker-compose.yml
curl -fsSL -o .env https://raw.githubusercontent.com/iiloni/catch/main/.env.example
chmod 600 .env`;

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-3 overflow-x-auto rounded-2xl bg-(--brand-charcoal) p-4 text-sm leading-relaxed text-(--brand-cream)">
      <code>{children}</code>
    </pre>
  );
}

export function GetStarted() {
  return (
    <Section
      id="get-started"
      title="Run your own Catch."
      lead="You need Docker and an HTTPS address."
    >
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <ol className="reveal min-w-0 space-y-7 rounded-3xl border border-border bg-card p-7">
          <li>
            <h3 className="text-lg font-semibold">1. Download the two files</h3>
            <Code>{download}</Code>
          </li>
          <li>
            <h3 className="text-lg font-semibold">2. Fill in four settings</h3>
            <p className="mt-2 text-muted-foreground">
              In <code>.env</code>: your address (<code>BETTER_AUTH_URL</code>) and three secrets (
              <code>BETTER_AUTH_SECRET</code>, <code>POSTGRES_PASSWORD</code>,{' '}
              <code>ELECTRIC_SECRET</code>). This makes one:
            </p>
            <Code>openssl rand -hex 32</Code>
          </li>
          <li>
            <h3 className="text-lg font-semibold">3. Start it</h3>
            <Code>docker compose up -d</Code>
            <p className="mt-3 text-muted-foreground">
              Point your reverse proxy at port 3000. The first account you create is the admin.
            </p>
          </li>
        </ol>

        <div className="min-w-0 space-y-6">
          <div className="reveal rounded-3xl bg-brand-gradient p-7 text-brand-foreground">
            <h3 className="text-xl font-semibold">The full guide</h3>
            <p className="mt-2">Settings, invites, backups and updates.</p>
            <a
              href={DEPLOYMENT_GUIDE_URL}
              className="mt-5 inline-flex h-11 items-center rounded-xl bg-(--brand-charcoal) px-5 font-semibold text-(--brand-cream)"
            >
              Read the deployment guide
            </a>
          </div>
          <div className="reveal glass rounded-3xl p-7">
            <h3 className="text-xl font-semibold">Someone runs a server for you?</h3>
            <p className="mt-2 text-muted-foreground">
              Open its address and sign in with your invite. On Android, enter the address on first
              launch.
            </p>
            <a
              href={`${RELEASES_URL}/latest`}
              className="mt-4 inline-block font-semibold text-brand-link underline underline-offset-4"
            >
              Get the Android app
            </a>
          </div>
        </div>
      </div>
    </Section>
  );
}
