import type { ReactNode } from 'react';
import { stableVersion } from '@/lib/changelogData';
import { source } from '@/lib/source';
import { DocsNavigation } from './navigation';
import './sidebar.css';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsNavigation tree={source.getPageTree()} stableVersion={stableVersion}>
      {children}
    </DocsNavigation>
  );
}
