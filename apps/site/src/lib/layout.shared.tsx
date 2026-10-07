import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { BrandLockup } from '@/components/BrandLockup';
import { REPOSITORY_URL } from '@/lib/site';

/** What the docs layout and the marketing layout have in common: the header's contents. */
export const baseOptions: BaseLayoutProps = {
  nav: { title: <BrandLockup /> },
  githubUrl: REPOSITORY_URL,
  links: [
    { text: 'Docs', url: '/docs', active: 'nested-url' },
    { text: 'Changelog', url: '/changelog', active: 'nested-url' },
  ],
};
