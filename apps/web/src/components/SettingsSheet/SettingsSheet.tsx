import { Capacitor } from '@capacitor/core';
import { LogOut, Monitor, Moon, Server, Sun } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { BottomSheet } from '@/components/BottomSheet/BottomSheet';
import { authClient, clearAuthToken } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { getServerUrl } from '@/lib/serverUrl';
import { type ThemePreference, useThemePreference } from '@/lib/theme';
import { cn } from '@/lib/utils';

const THEMES = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const satisfies ReadonlyArray<{ value: ThemePreference; label: string; icon: unknown }>;

export function initials(name: string, email: string) {
  const source = name.trim() || email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** The avatar in the Gallery header. Opens Settings. */
export function AccountButton() {
  const { data: session } = authClient.useSession();
  const [open, setOpen] = useState(false);
  const user = session?.user;

  return (
    <>
      <motion.button
        type="button"
        aria-label="Settings"
        onClick={() => setOpen(true)}
        whileTap={{ scale: 0.9 }}
        transition={springs.snappy}
        className="flex size-9 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {user ? initials(user.name, user.email) : ''}
      </motion.button>
      <SettingsSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

function SettingsSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data: session } = authClient.useSession();
  const [theme, setTheme] = useThemePreference();
  const user = session?.user;

  async function signOut() {
    await authClient.signOut();
    clearAuthToken();
    // A full reload drops this user's synced notes from memory.
    window.location.assign('/login');
  }

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="Settings">
      <div className="flex flex-col gap-3">
        {user && (
          <section className="flex items-center gap-3 rounded-2xl bg-foreground/[0.05] p-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand font-semibold text-brand-foreground">
              {initials(user.name, user.email)}
            </span>
            <div className="min-w-0">
              <p className="truncate font-medium">{user.name || user.email}</p>
              {user.name && <p className="truncate text-muted-foreground text-sm">{user.email}</p>}
            </div>
          </section>
        )}

        <section className="rounded-2xl bg-foreground/[0.05] p-3">
          <h3 className="px-1 pb-2 font-medium text-muted-foreground text-xs">Appearance</h3>
          <fieldset className="grid min-w-0 grid-cols-3 gap-1">
            <legend className="sr-only">Theme</legend>
            {THEMES.map(({ value, label, icon: Icon }) => {
              const selected = theme === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    if (!selected) haptics.selection();
                    setTheme(value);
                  }}
                  className={cn(
                    'relative flex flex-col items-center gap-1 rounded-xl py-2.5 font-medium text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/70',
                    selected ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {selected && (
                    <motion.span
                      layoutId="theme-indicator"
                      aria-hidden
                      className="absolute inset-0 rounded-xl bg-background shadow-sm"
                      transition={springs.snappy}
                    />
                  )}
                  <Icon className="relative size-5" aria-hidden />
                  <span className="relative">{label}</span>
                </button>
              );
            })}
          </fieldset>
        </section>

        {Capacitor.isNativePlatform() && (
          <section className="flex items-center gap-3 rounded-2xl bg-foreground/[0.05] p-3 text-sm">
            <Server className="size-5 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="font-medium">Server</p>
              <p className="truncate text-muted-foreground">{getServerUrl()}</p>
            </div>
          </section>
        )}

        <button
          type="button"
          onClick={signOut}
          className="flex items-center justify-center gap-2 rounded-2xl bg-foreground/[0.05] p-3.5 font-medium text-destructive outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </button>
      </div>
    </BottomSheet>
  );
}
