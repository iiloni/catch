import darkInk from '../../../web/public/wordmark/catch-lockup-horizontal-stable-dark.svg';
import lightInk from '../../../web/public/wordmark/catch-lockup-horizontal-stable-light.svg';

/** The approved icon and wordmark lockup, in the ink that reads on the current theme. */
export function BrandLockup({ height = 28 }: { height?: number }) {
  const width = Math.round((height * darkInk.width) / darkInk.height);
  return (
    <>
      {/* biome-ignore lint/performance/noImgElement: a static export has no image optimizer */}
      <img src={darkInk.src} alt="Catch" width={width} height={height} className="only-light" />
      {/* biome-ignore lint/performance/noImgElement: as above */}
      <img src={lightInk.src} alt="Catch" width={width} height={height} className="only-dark" />
    </>
  );
}
