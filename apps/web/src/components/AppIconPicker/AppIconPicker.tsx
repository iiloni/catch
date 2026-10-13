import { motion } from 'motion/react';
import { useState } from 'react';
import { toast } from 'sonner';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { type AppIcon, setNativeAppIcon, useAppIconPreference } from '@/lib/appIcon';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { useUpdates } from '@/lib/updates';
import { cn } from '@/lib/utils';

export function AppIconPicker() {
  const { android, server } = useUpdates();
  const [value, setValue] = useAppIconPreference();
  const [pending, setPending] = useState(false);
  if (server?.channel !== 'preview') return null;

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
      <fieldset className="grid min-w-0 grid-cols-2 gap-1 p-1.5" disabled={pending}>
        <legend className="sr-only">App icon</legend>
        {(['stable', 'preview'] as const).map((icon) => {
          const selected = value === icon;
          return (
            <button
              key={icon}
              type="button"
              aria-pressed={selected}
              onClick={() => void choose(icon)}
              className={cn(
                'relative flex flex-col items-center gap-2 rounded-xl py-3 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-60',
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
              <img
                src={icon === 'preview' ? '/preview/icon-small.svg' : '/icon-small.svg'}
                alt=""
                className="relative size-12"
              />
              <span className="relative">{icon === 'preview' ? 'Preview' : 'Stable'}</span>
            </button>
          );
        })}
      </fieldset>
    </SettingsSection>
  );
}
