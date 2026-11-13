import { HomeLayout } from 'fumadocs-ui/layouts/home';
import type { ReactNode } from 'react';
import { SiteFooter } from '@/components/SiteFooter';
import { stableVersion } from '@/lib/changelogData';
import { baseOptions } from '@/lib/layout.shared';

export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout {...baseOptions(stableVersion)}>
      {children}
      <SiteFooter />
    </HomeLayout>
  );
}
