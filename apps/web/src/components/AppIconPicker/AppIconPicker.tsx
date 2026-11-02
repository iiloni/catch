import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import {
  type AppIcon,
  getNativeAppIconPreview,
  setNativeAppIcon,
  useAppIconOptions,
  useAppIconPreference,
} from '@/lib/appIcon';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { useUpdates } from '@/lib/updates';
import { cn } from '@/lib/utils';

export function AppIconPicker() {
  const { android } = useUpdates();
  const { devBuild, serverChannel } = useAppIconOptions();
  const [value, setValue] = useAppIconPreference();
  const [pending, setPending] = useState(false);
  const available = devBuild || serverChannel === 'preview';
  const [nativePreview, setNativePreview] = useState<{
    icon: AppIcon;
    attempt: number;
    src: string | null;
  } | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  useEffect(() => {
    if (!android || !available) return;
    let stopped = false;
    void getNativeAppIconPreview(value).then(
      (src) => {
        if (!stopped) setNativePreview({ icon: value, attempt: previewAttempt, src });
      },
      () => {
        if (!stopped) setNativePreview({ icon: value, attempt: previewAttempt, src: null });
      },
    );
    return () => {
      stopped = true;
    };
  }, [android, available, value, previewAttempt]);
  if (!available) return null;
  const currentPreview =
    nativePreview?.icon === value && nativePreview.attempt === previewAttempt
      ? nativePreview
      : null;
  const previewSrc = android
    ? currentPreview?.src
    : `${value === 'stable' ? '' : `/${value}`}/pwa-512x512.png`;
  const previewFailed = android && currentPreview?.src === null;
  const choices: AppIcon[] = devBuild ? ['stable', 'preview', 'dev'] : ['stable', 'preview'];

  async function choose(icon: AppIcon) {
    if (icon === value || pending) return;
    haptics.selection();
    setPending(true);
    try {
      await setNativeAppIcon(icon);
      setValue(icon);
    } catch {
      toast.error('Could not change the app icon. Try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection
      title="App icon"
      description={
        android
          ? 'Choose an icon for this device.'
          : 'Choose an icon for this device. Installed web apps may ask you to approve the change.'
      }
    >
      <div className="flex min-h-30 items-center justify-center px-4 pt-6 pb-4">
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={`${value === 'dev' ? 'Dev' : value === 'preview' ? 'Preview' : 'Stable'} app icon`}
            className="size-20"
          />
        ) : previewFailed ? (
          <div className="flex flex-col items-center gap-2 text-center text-sm">
            <p role="status">Could not load the app icon preview.</p>
            <button
              type="button"
              className="rounded-lg px-3 py-2 text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
              onClick={() => {
                setPreviewAttempt((attempt) => attempt + 1);
              }}
            >
              Retry preview
            </button>
          </div>
        ) : (
          <div role="status" className="size-20 rounded-2xl bg-foreground/5">
            <span className="sr-only">Loading app icon preview…</span>
          </div>
        )}
      </div>
      <fieldset
        className={cn('grid min-w-0 gap-1 p-1.5', devBuild ? 'grid-cols-3' : 'grid-cols-2')}
        disabled={pending}
      >
        <legend className="sr-only">App icon</legend>
        {choices.map((icon) => {
          const selected = value === icon;
          return (
            <button
              key={icon}
              type="button"
              aria-pressed={selected}
              onClick={() => void choose(icon)}
              className={cn(
                'relative rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-60',
                selected ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="app-icon-indicator"
                  aria-hidden
                  className="absolute inset-0 rounded-xl bg-background shadow-sm"
                  transition={springs.snappy}
                />
              )}
              <span className="relative">
                {icon === 'dev' ? 'Dev' : icon === 'preview' ? 'Preview' : 'Stable'}
              </span>
            </button>
          );
        })}
      </fieldset>
    </SettingsSection>
  );
}
