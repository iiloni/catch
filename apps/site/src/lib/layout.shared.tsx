import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BrandLockup } from '@/components/BrandLockup';
import { StableVersion } from '@/components/StableVersion';
import { REPOSITORY_URL } from '@/lib/site';

/**
 * What the docs layout and the marketing layout have in common: the header's contents. The
 * version is passed in rather than read here, because the docs layout is a client component
 * and reading it here would send the whole changelog to the browser. The docs layout lists
 * custom items among its page links, so it passes null and shows the version itself.
 */
export function baseOptions(stableVersion: string | null): BaseLayoutProps {
  return {
    nav: { title: <BrandLockup /> },
    githubUrl: REPOSITORY_URL,
    links: [
      { text: 'Docs', url: '/docs', active: 'nested-url' },
      { text: 'Changelog', url: '/changelog', active: 'nested-url' },
      // Secondary items sit at the header's end, just before the GitHub link.
      ...(stableVersion
        ? [
            {
              type: 'custom' as const,
              secondary: true,
              children: <StableVersion version={stableVersion} />,
            },
          ]
        : []),
    ],
  };
}
