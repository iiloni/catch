import type { VersionInfo } from '@catch/shared';
import { useLayoutEffect, useRef, useState } from 'react';
import { useResolvedTheme } from '@/lib/theme';
import tokens from '../../../../../branding/wordmark/catch-wordmark-tokens.json';

type Props = {
  orientation: 'horizontal' | 'stacked';
  /** CSS pixels, also density-independent pixels in the Android WebView. */
  iconSize: number;
  channel?: VersionInfo['channel'];
  /** Preserve motion marks and shadow on approved branding surfaces at smaller sizes. */
  iconDetail?: 'auto' | 'primary';
  /** Override only when the surrounding surface differs from the app theme. */
  surface?: 'light' | 'dark';
};

export function BrandLockup({
  orientation,
  iconSize,
  channel = 'stable',
  iconDetail = 'auto',
  surface,
}: Props) {
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
  // shrink can cross a detail threshold even though the requested size did not.
  // Chromium quantizes layout to 1/64 px; avoid selecting micro for a 48 px icon
  // just because the composed width rounded down by a fraction of a pixel.
  const displayedIcon = Math.round(Math.min(iconSize, width / (ratio + 2 * clearSpace)) * 64) / 64;
  const tier =
    displayedIcon >= tokens.iconTierRules.primary.minDisplayedIconPx
      ? ''
      : displayedIcon >= tokens.iconTierRules.small.minDisplayedIconPx
        ? '-small'
        : '-micro';
  const minimum =
    orientation === 'horizontal'
      ? tokens.minimumDisplay.horizontalWidthCssPx
      : tokens.minimumDisplay.stackedWidthCssPx;
  const iconOnly = displayedIcon * ratio < minimum;
  const ink = (surface ?? theme) === 'dark' ? 'light' : 'dark';
  const iconBase = channel === 'stable' ? '' : `/${channel}`;
  const lockupTier = iconDetail === 'primary' ? '' : tier;
  const source = iconOnly
    ? `${iconBase}/${tier === '' ? 'icon.svg' : tier === '-small' ? 'icon-small.svg' : 'favicon-mark.svg'}`
    : `/wordmark/catch-lockup-${orientation}-${channel}-${ink}${lockupTier}.svg`;

  return (
    <div ref={container} style={{ width: preferredWidth, maxWidth: '100%', flexShrink: 0 }}>
      <div style={{ padding: displayedIcon * clearSpace }}>
        <img
          src={source}
          alt="Catch"
          width={iconOnly ? tokens.iconSize : canvasWidth}
          height={iconOnly ? tokens.iconSize : layout.canvas[1]}
          style={{
            display: 'block',
            width: iconOnly ? displayedIcon : '100%',
            height: 'auto',
            marginInline: 'auto',
          }}
        />
      </div>
    </div>
  );
}
