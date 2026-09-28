import { ChevronLeft } from 'lucide-react';
import { motion, useScroll, useTransform } from 'motion/react';
import type { ReactNode } from 'react';
import { useGalleryPages } from '@/lib/galleryPages';

type Props = {
  title: string;
  /** Controls on the large title's line, at its right edge (such as sorting). */
  titleAccessory?: ReactNode;
  /** Controls at the bar's left edge, such as a back button. */
  leading?: ReactNode;
  /** Controls at the bar's right edge. */
  trailing?: ReactNode;
};

/**
 * iOS-style large title. The bar above it starts transparent and turns to frosted glass,
 * with a small centered title, once the large title scrolls under it.
 */
export function PageHeader({ title, titleAccessory, leading, trailing }: Props) {
  const { scrollY } = useScroll();
  const barOpacity = useTransform(scrollY, [8, 40], [0, 1]);
  const smallTitleOpacity = useTransform(scrollY, [36, 56], [0, 1]);
  const smallTitleY = useTransform(scrollY, [36, 56], [6, 0]);
  const largeTitleOpacity = useTransform(scrollY, [0, 40], [1, 0]);

  return (
    <>
      <header className="fixed inset-x-0 top-0 z-30 pt-[var(--safe-top)]">
        <motion.div
          aria-hidden
          className="glass-bar absolute inset-0"
          style={{ opacity: barOpacity }}
        />
        <div className="relative mx-auto flex h-[var(--header-height)] max-w-7xl items-center gap-1 px-2 sm:px-4">
          <div className="flex min-w-11 items-center">{leading}</div>
          <motion.span
            aria-hidden
            className="flex-1 truncate text-center font-semibold text-[1.0625rem]"
            style={{ opacity: smallTitleOpacity, y: smallTitleY }}
          >
            {title}
          </motion.span>
          <div className="flex min-w-11 items-center justify-end gap-1">{trailing}</div>
        </div>
      </header>
      <motion.div
        className="mx-auto flex max-w-7xl items-center justify-between gap-2 px-4 pt-[calc(var(--safe-top)+var(--header-height))] sm:px-6"
        style={{ opacity: largeTitleOpacity }}
      >
        <h1 className="min-w-0 truncate font-display font-extrabold text-[2.25rem] leading-tight tracking-[-0.03em]">
          {title}
        </h1>
        {titleAccessory && <div className="-mr-2 flex items-center gap-1">{titleAccessory}</div>}
      </motion.div>
    </>
  );
}

/** Returns to the Gallery, the parent of every page that shows one. */
export function BackToGallery() {
  const goToGalleryPage = useGalleryPages();
  return (
    <motion.button
      type="button"
      aria-label="Back to Gallery"
      whileTap={{ scale: 0.9 }}
      onClick={() => goToGalleryPage('/')}
      className="flex h-10 items-center gap-0.5 rounded-full pr-2 font-medium text-[1.0625rem] outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-7" aria-hidden />
      Gallery
    </motion.button>
  );
}
