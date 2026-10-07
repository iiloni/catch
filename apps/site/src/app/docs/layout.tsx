import type { ReactNode } from 'react';
import { source } from '@/lib/source';
import { DocsNavigation } from './navigation';
import './sidebar.css';

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsNavigation tree={source.getPageTree()}>{children}</DocsNavigation>;
}
