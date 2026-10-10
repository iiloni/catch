import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/figtree';
import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { brandVariables } from '@/lib/brand';
import { sitePreview } from '@/lib/screenshots';
import { SITE_URL } from '@/lib/site';
import favicon from '../../../web/public/favicon-mark.svg';

const previewImage = {
  url: sitePreview.image.src,
  width: sitePreview.image.width,
  height: sitePreview.image.height,
  alt: sitePreview.alt,
};

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Catch: notes like Keep, on a server you own', template: '%s | Catch' },
  description:
    'Catch is a notes app in the spirit of Google Keep that you host yourself. It works offline, in the browser and on Android.',
  icons: { icon: favicon.src },
  openGraph: {
    type: 'website',
    siteName: 'Catch',
    images: [previewImage],
  },
  twitter: {
    card: 'summary_large_image',
    images: [previewImage],
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" style={brandVariables} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col">
        {/* A static export has no search server: the index is a file the browser searches. */}
        <RootProvider search={{ options: { type: 'static' } }}>{children}</RootProvider>
      </body>
    </html>
  );
}
