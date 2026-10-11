import type { VersionInfo } from '@catch/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, useState } from 'react';
import { useResolvedTheme } from '@/lib/theme';
import tokens from '../../../../../branding/wordmark/catch-wordmark-tokens.json';

type Props = {
  orientation: 'horizontal' | 'stacked';
  /** CSS pixels, also density-independent pixels in the Android WebView. */
  iconSize: number;
  channel?: VersionInfo['channel'];
  /** Override only when the surrounding surface differs from the app theme. */
  surface?: 'light' | 'dark';
};

export function BrandLockup({ orientation, iconSize, channel = 'stable', surface }: Props) {
  const theme = useResolvedTheme();
  const container = useRef<HTMLDivElement>(null);
  const layout = tokens.layouts[orientation];
  const canvasWidth = layout.canvas[0]!;
  const ratio = canvasWidth / tokens.iconSize;
  const clearSpace = tokens.clearSpace.iconFraction;
  const preferredWidth = iconSize * (ratio + 2 * clearSpace);
  const [width, setWidth] = useState(preferredWidth);

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Measure the entire available box, including reserved clear space. A responsive
  // shrink can cross an icon-only detail threshold or the lockup minimum.
  // Chromium quantizes layout to 1/64 px; avoid selecting micro for a 48 px icon
  // just because the composed width rounded down by a fraction of a pixel.
  const fitted = (span: number) =>
    Math.round(Math.min(iconSize, width / (span + 2 * clearSpace)) * 64) / 64;
  const minimum =
    orientation === 'horizontal'
      ? tokens.minimumDisplay.horizontalWidthCssPx
      : tokens.minimumDisplay.stackedWidthCssPx;
  const iconOnly = fitted(ratio) * ratio < minimum;
  // Alone, the icon has the width the wordmark gave up, so it returns to the size asked for
  // instead of keeping the one the squeezed lockup had reached.
  const displayedIcon = fitted(iconOnly ? 1 : ratio);
  const tier =
    displayedIcon >= tokens.iconTierRules.primary.minDisplayedIconPx
      ? ''
      : displayedIcon >= tokens.iconTierRules.small.minDisplayedIconPx
        ? '-small'
        : '-micro';
  const ink = (surface ?? theme) === 'dark' ? 'light' : 'dark';
  const iconBase = channel === 'stable' ? '' : `/${channel}`;
  const lockupTier = tokens.lockupIconTier === 'primary' ? '' : `-${tokens.lockupIconTier}`;
  const source = iconOnly
    ? `${iconBase}/${tier === '' ? 'icon.svg' : tier === '-small' ? 'icon-small.svg' : 'favicon-mark.svg'}`
    : `/wordmark/catch-lockup-${orientation}-${channel}-${ink}${lockupTier}.svg`;

  return (
    <div ref={container} style={{ width: preferredWidth, maxWidth: '100%', flexShrink: 0 }}>
      <div style={{ position: 'relative', padding: displayedIcon * clearSpace }}>
        {/* The outgoing artwork fades over the incoming one, so the icon they share never blinks. */}
        <AnimatePresence initial={false} mode="popLayout">
          <motion.img
            key={iconOnly ? 'icon' : 'lockup'}
            src={source}
            alt="Catch"
            width={iconOnly ? tokens.iconSize : canvasWidth}
            height={iconOnly ? tokens.iconSize : layout.canvas[1]}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            style={{
              display: 'block',
              width: iconOnly ? displayedIcon : '100%',
              height: 'auto',
              // A horizontal lockup starts with its icon, which stays where it was.
              marginInline: orientation === 'stacked' ? 'auto' : 0,
            }}
          />
        </AnimatePresence>
      </div>
    </div>
  );
}
