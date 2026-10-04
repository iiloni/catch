import { Capacitor } from '@capacitor/core';
import type { ReminderTimes } from '@catch/shared';
import { Bell, BellRing, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { SnoozePicker } from '@/components/SnoozePicker/SnoozePicker';
import { TimePicker } from '@/components/TimePicker/TimePicker';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useHour12 } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import {
  disablePush,
  enablePush,
  type PushState,
  refreshPushState,
  sendTestPush,
  usePushState,
} from '@/lib/push';
import { formatTimeOfDay, useReminderTimes } from '@/lib/reminders';
import { useSnoozeMinutes } from '@/lib/snooze';

/** Why notifications cannot be turned on here, for the states where they cannot. */
const UNAVAILABLE: Partial<Record<PushState, string>> = {
  'needs-install':
    'On iPhone and iPad, add Catch to your Home Screen (Share, then Add to Home Screen) and turn notifications on from there.',
  unsupported: 'This browser cannot receive notifications from Catch.',
  blocked: Capacitor.isNativePlatform()
    ? 'Notifications are blocked for Catch. Allow them in Android’s settings for the app, then turn them on here.'
    : 'Notifications are blocked for Catch. Allow them in this browser’s site settings, then turn them on here.',
};

const HOW = Capacitor.isNativePlatform()
  ? 'This phone rings your reminders itself, so they arrive offline too. One set on another device arrives once the phone has been online. Each device is turned on separately.'
  : 'Your Catch server sends reminders through this browser’s push service, encrypted so only this device can read them. Each device is turned on separately.';

const TIMES: { key: keyof ReminderTimes; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Try again in a moment.';

/** One quick time, set on the same dial as a reminder's time. */
function QuickTime({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (time: string) => void;
}) {
  // Redraws the time when the clock setting changes.
  useHour12();
  // Kept until the dial closes: dragging round it passes through many times, and each
  // one saved would be a request to the server.
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? value;
  return (
    <Popover
      open={draft !== null}
      onOpenChange={(open) => {
        if (open) {
          haptics.toggle();
          setDraft(value);
          return;
        }
        if (draft !== null && draft !== value) onChange(draft);
        setDraft(null);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          aria-label={`${label} time: ${formatTimeOfDay(shown)}`}
          className="h-10 min-w-24 rounded-xl bg-foreground/[0.06] font-medium text-base tabular-nums hover:bg-foreground/[0.1] hover:text-foreground"
        >
          {formatTimeOfDay(shown)}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        aria-label={`${label} time`}
        className="w-80 max-w-[calc(100vw-2rem)] rounded-3xl"
      >
        <TimePicker value={shown} onChange={setDraft} />
      </PopoverContent>
    </Popover>
  );
}

/** Settings > Notifications: whether this device shows reminders, and the quick times. */
export function NotificationSettings() {
  const state = usePushState();
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useReminderTimes();
  const [snooze, setSnooze] = useSnoozeMinutes();
  useEffect(() => {
    void refreshPushState();
  }, []);

  const unavailable = state ? UNAVAILABLE[state] : undefined;

  async function toggle(on: boolean) {
    haptics.toggle();
    setBusy(true);
    try {
      if (on) await enablePush();
      else await disablePush();
    } catch (error) {
      toast.error(`Notifications could not be turned ${on ? 'on' : 'off'}`, {
        description: message(error),
      });
      await refreshPushState();
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    try {
      await sendTestPush();
      toast('Test notification sent');
    } catch (error) {
      toast.error('The test notification was not sent', { description: message(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="This device" description={unavailable ?? HOW}>
        <SettingsRow icon={Bell} label="Reminder notifications" description="Show reminders here">
          <Switch
            aria-label="Reminder notifications"
            checked={state === 'on'}
            disabled={busy || state === null || unavailable !== undefined}
            onCheckedChange={toggle}
          />
        </SettingsRow>
        {state === 'on' && (
          <SettingsRow icon={BellRing} label="Test" description="Send one to this device now">
            <Button variant="secondary" size="sm" disabled={busy} onClick={test}>
              Send
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
      <SettingsSection
        title="Snooze"
        description="How long Snooze puts a reminder off, on all your devices."
      >
        <SnoozePicker value={snooze} onChange={setSnooze} />
      </SettingsSection>
      <SettingsSection
        title="Quick times"
        description="The times Morning, Afternoon and Evening stand for when you set a reminder, on all your devices."
      >
        {TIMES.map(({ key, label }) => (
          <SettingsRow key={key} icon={Clock} label={label}>
            <QuickTime
              label={label}
              value={times[key]}
              onChange={(time) => setTimes({ ...times, [key]: time })}
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </div>
  );
}
