import { Link } from '@tanstack/react-router';
import { ChevronLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useLayoutEffect } from 'react';
import { useSwipeToDismiss } from '@/components/NoteEditorOverlay/useSwipeToDismiss';
import { TabPageHeader } from '@/components/PageHeader/PageHeader';
import { UpdateDot } from '@/components/UpdateDot/UpdateDot';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { type SettingsTab, settingsSectionsFor } from '@/lib/settings';
import { settingsDragY, useSettingsSwipeY } from '@/lib/settingsSwipe';
import { cn } from '@/lib/utils';

type Props = {
  /** The open page. */
  current: SettingsTab | null;
  /** Lists the pages beside the open one; otherwise the dock picks between them. */
  wide: boolean;
  isAdmin?: boolean;
  onBack: () => void;
  children: ReactNode;
};

/**
 * Settings' frame around its open page. Wide, the pages are listed in a column beside it,
 * with a back button in the header since the dock steps aside. Narrow, the page fills the
 * screen under its own title, and the dock turns into its page picker and back button.
 */
export function SettingsLayout({ current, wide, isAdmin = false, onBack, children }: Props) {
  const swipeY = useSettingsSwipeY();
  const swipeRef = useSwipeToDismiss({
    dragY: settingsDragY,
    onDismiss: onBack,
    enabled: !wide,
    scrollElement: document.scrollingElement ?? document.documentElement,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: Switching pages or layout cancels the shared pull as well as unmounting.
  useLayoutEffect(() => {
    const reset = () => {
      settingsDragY.stop();
      settingsDragY.set(0);
    };
    reset();
    return reset;
  }, [wide, current?.path]);

  if (!wide) {
    return (
      <div ref={swipeRef} className="min-h-[calc(100dvh-var(--dock-space))]" data-settings-swipe>
        <TabPageHeader title={current?.label ?? 'Settings'} offsetY={swipeY} />
        {/* A shared offset keeps fixed chrome aligned without transforming its ancestor. */}
        <motion.div
          data-settings-content
          className="mx-auto max-w-2xl px-3 pt-4 sm:px-6"
          style={{ y: swipeY }}
        >
          {children}
        </motion.div>
      </div>
    );
  }

  return (
    <>
      <TabPageHeader title="Settings" leading={<BackButton onClick={onBack} />} />
      <div
        className={cn(
          'mx-auto grid max-w-7xl gap-8 px-4 pt-4 sm:px-6',
          current?.section === 'Admin'
            ? 'grid-cols-[15rem_minmax(0,48rem)]'
            : 'grid-cols-[15rem_minmax(0,42rem)]',
        )}
      >
        <SettingsNav current={current} isAdmin={isAdmin} />
        <div className="flex min-w-0 flex-col gap-4">
          {current && (
            <h2 className="px-1 font-display font-bold text-2xl tracking-[-0.02em]">
              {current.label}
            </h2>
          )}
          {children}
        </div>
      </div>
    </>
  );
}

/** Settings' pages as a vertical stack of tabs. */
function SettingsNav({ current, isAdmin }: { current: SettingsTab | null; isAdmin: boolean }) {
  return (
    <nav
      aria-label="Settings pages"
      className="sticky top-[calc(var(--safe-top)+var(--header-height)+1rem)] flex flex-col gap-6 self-start"
    >
      {settingsSectionsFor(isAdmin).map((section) => (
        <section key={section.label} aria-label={section.label} className="flex flex-col gap-1">
          <h2 className="px-3 pb-1 font-medium text-muted-foreground text-sm">{section.label}</h2>
          {section.tabs.map((tab) => {
            const Icon = tab.icon;
            const selected = current?.path === tab.path;
            return (
              <Link
                key={tab.path}
                to={tab.path}
                // Switching pages replaces history, so back leaves Settings in one step.
                replace
                aria-current={selected ? 'page' : undefined}
                onClick={() => {
                  if (!selected) haptics.selection();
                }}
                className={cn(
                  'relative z-0 flex h-11 items-center gap-3 rounded-xl px-3 font-medium outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring/70',
                  selected
                    ? 'text-foreground'
                    : 'text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground',
                )}
              >
                {selected && (
                  <motion.span
                    layoutId="settings-nav"
                    aria-hidden
                    className="-z-10 absolute inset-0 rounded-xl bg-foreground/[0.08]"
                    transition={springs.snappy}
                  />
                )}
                <Icon className="size-5" aria-hidden />
                {tab.label}
                {tab.path === '/settings/update' && <UpdateDot className="ml-auto" />}
              </Link>
            );
          })}
        </section>
      ))}
    </nav>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      type="button"
      aria-label="Back"
      whileTap={{ scale: 0.9 }}
      onClick={onClick}
      className="flex h-10 items-center gap-0.5 rounded-full pr-3 pl-0.5 font-medium text-[1.0625rem] outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <ChevronLeft className="size-7" aria-hidden />
      Back
    </motion.button>
  );
}
