import type { ReminderTimes } from '@catch/shared';
import { Bell, BellRing, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { haptics } from '@/lib/haptics';
import {
  disablePush,
  enablePush,
  type PushState,
  refreshPushState,
  sendTestPush,
  usePushState,
} from '@/lib/push';
import { useReminderTimes } from '@/lib/reminders';

/** Why notifications cannot be turned on here, for the states where they cannot. */
const UNAVAILABLE: Partial<Record<PushState, string>> = {
  native:
    'The Android app does not show reminders yet. For now they reach browsers and the installed web app.',
  'needs-install':
    'On iPhone and iPad, add Catch to your Home Screen (Share, then Add to Home Screen) and turn notifications on from there.',
  unsupported: 'This browser cannot receive notifications from Catch.',
  blocked:
    'Notifications are blocked for Catch. Allow them in this browser’s site settings, then turn them on here.',
};

const TIMES: { key: keyof ReminderTimes; label: string }[] = [
  { key: 'morning', label: 'Morning' },
  { key: 'afternoon', label: 'Afternoon' },
  { key: 'evening', label: 'Evening' },
];

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Try again in a moment.';

/** Settings > Notifications: whether this device shows reminders, and the quick times. */
export function NotificationSettings() {
  const state = usePushState();
  const [busy, setBusy] = useState(false);
  const [times, setTimes] = useReminderTimes();
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
      <SettingsSection
        title="This device"
        description={
          unavailable ??
          'Your Catch server sends reminders through this browser’s push service, encrypted so only this device can read them. Each device is turned on separately.'
        }
      >
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
        title="Quick times"
        description="The times Morning, Afternoon and Evening stand for when you set a reminder, on all your devices."
      >
        {TIMES.map(({ key, label }) => (
          <SettingsRow key={key} icon={Clock} label={label}>
            <Input
              type="time"
              aria-label={`${label} time`}
              required
              value={times[key]}
              onChange={(event) => {
                if (event.target.value) setTimes({ ...times, [key]: event.target.value });
              }}
              className="h-10 w-36 text-base md:text-base"
            />
          </SettingsRow>
        ))}
      </SettingsSection>
    </div>
  );
}
