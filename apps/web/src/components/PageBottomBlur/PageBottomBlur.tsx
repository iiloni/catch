import { useEffect, useState } from 'react';

/** Fades the page into the dock only while there is more content below the viewport. */
export function PageBottomBlur() {
  const [hasMoreBelow, setHasMoreBelow] = useState(false);

  useEffect(() => {
    let frame = 0;
    const update = () => {
      const page = document.scrollingElement;
      setHasMoreBelow(Boolean(page && page.scrollTop + page.clientHeight < page.scrollHeight - 1));
    };
    const scheduleUpdate = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', scheduleUpdate, { passive: true });
    window.addEventListener('resize', scheduleUpdate);
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(document.body);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      observer.disconnect();
    };
  }, []);

  return (
    <div
      aria-hidden
      className="page-bottom-blur pointer-events-none fixed right-[var(--note-pane)] bottom-[var(--keyboard)] left-0 z-30 h-[calc(var(--dock-height)+var(--safe-bottom)+3rem)] transition-opacity duration-200"
      style={{ opacity: hasMoreBelow ? 1 : 0 }}
    />
  );
}
