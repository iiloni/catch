'use client';

import type { Root } from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
import { baseOptions } from '@/lib/layout.shared';

const GUIDES = [
  { label: 'User', url: '/docs/using-catch' },
  { label: 'Admin', url: '/docs/running-a-server' },
] as const;

function currentGuide(pathname: string) {
  return (
    GUIDES.find((guide) => pathname === guide.url || pathname.startsWith(`${guide.url}/`)) ??
    GUIDES[0]
  );
}

function GuideSelector() {
  const selected = currentGuide(usePathname());

  return (
    <>
      <hr className="docs-site-nav-divider" />
      <nav className="docs-guide-selector" aria-label="Documentation guide">
        {GUIDES.map((guide) => (
          <Link
            key={guide.url}
            href={guide.url}
            aria-current={guide === selected ? 'true' : undefined}
          >
            {guide.label}
          </Link>
        ))}
      </nav>
    </>
  );
}

export function DocsNavigation({ tree, children }: { tree: Root; children: ReactNode }) {
  const selected = currentGuide(usePathname());
  const guideTree = useMemo<Root>(() => {
    const folder = tree.children.find(
      (node) =>
        node.type === 'folder' &&
        node.children.some(
          (child) => child.type === 'page' && child.url.replace(/\/$/, '') === selected.url,
        ),
    );
    if (folder?.type !== 'folder') throw new Error(`Missing guide: ${selected.url}`);

    return {
      ...tree,
      $id: `${tree.$id}:${selected.url}`,
      name: folder.name,
      children: [
        { type: 'separator', name: 'Guide' },
        ...folder.children.map((node) =>
          node.type === 'page' && node.url.replace(/\/$/, '') === selected.url
            ? { ...node, name: 'Overview' }
            : node,
        ),
      ],
    };
  }, [tree, selected.url]);

  return (
    <DocsLayout
      {...baseOptions}
      tree={guideTree}
      tabs={false}
      sidebar={{ components: { Separator: GuideSelector } }}
    >
      {children}
    </DocsLayout>
  );
}
