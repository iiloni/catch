'use client';

import type { Root } from 'fumadocs-core/page-tree';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useMemo } from 'react';
import { StableVersion } from '@/components/StableVersion';
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

export function DocsNavigation({
  tree,
  stableVersion,
  children,
}: {
  tree: Root;
  stableVersion: string | null;
  children: ReactNode;
}) {
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

  const base = baseOptions(null);
  return (
    <DocsLayout
      {...base}
      nav={{
        ...base.nav,
        children: <StableVersion version={stableVersion} className="ms-2 me-1 self-center" />,
      }}
      tree={guideTree}
      tabs={false}
      sidebar={{ components: { Separator: GuideSelector } }}
    >
      {children}
    </DocsLayout>
  );
}
