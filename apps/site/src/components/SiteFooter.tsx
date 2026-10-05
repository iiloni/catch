import Link from 'next/link';
import { BrandLockup } from '@/components/BrandLockup';
import { DEPLOYMENT_GUIDE_URL, RELEASES_URL, REPOSITORY_URL } from '@/lib/site';

const columns = [
  {
    title: 'Catch',
    links: [
      { text: 'Features', href: '/#features' },
      { text: 'Compare', href: '/#compare' },
      { text: 'Get started', href: '/#get-started' },
    ],
  },
  {
    title: 'Learn',
    links: [
      { text: 'Documentation', href: '/docs' },
      { text: 'Changelog', href: '/changelog' },
      { text: 'Deployment guide', href: DEPLOYMENT_GUIDE_URL },
    ],
  },
  {
    title: 'Project',
    links: [
      { text: 'GitHub', href: REPOSITORY_URL },
      { text: 'Releases', href: RELEASES_URL },
      { text: 'License (MIT)', href: `${REPOSITORY_URL}/blob/main/LICENSE` },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-6 py-12 sm:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="space-y-3">
          <BrandLockup />
          <p className="max-w-xs text-sm text-muted-foreground">
            A notes app you host yourself. Open source under the MIT license.
          </p>
        </div>
        {columns.map((column) => (
          <nav key={column.title} aria-label={column.title} className="space-y-3 text-sm">
            <p className="font-semibold">{column.title}</p>
            <ul className="space-y-2 text-muted-foreground">
              {column.links.map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className="hover:text-foreground">
                    {link.text}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
    </footer>
  );
}
