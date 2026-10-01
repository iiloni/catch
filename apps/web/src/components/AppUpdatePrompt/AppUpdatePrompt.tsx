import { useRouterState } from '@tanstack/react-router';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { haptics } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';
import { useSettingsNavigation } from '@/lib/settings';
import { usePersistentState } from '@/lib/storage';
import { useAndroidUpdateAvailable, useUpdates } from '@/lib/updates';

export function AppUpdatePrompt() {
  const available = useAndroidUpdateAvailable();
  const { app, server } = useUpdates();
  const { open } = useSettingsNavigation();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [dismissed, setDismissed] = usePersistentState(
    `catch-update-prompt:${getServerUrl()}:${app?.channel ?? ''}:${app?.version ?? ''}`,
    z.string().nullable(),
    null,
  );
  const dismiss = () => setDismissed(server?.version ?? null);
  return (
    <Dialog
      open={available && dismissed !== server?.version && pathname !== '/settings/update'}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <DialogContent>
        <DialogTitle>App update available</DialogTitle>
        <DialogDescription>
          Your server is running Catch {server?.version}. Update your Android app to match it.
        </DialogDescription>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Later
          </Button>
          <Button
            onClick={() => {
              haptics.selection();
              dismiss();
              open('/settings/update');
            }}
          >
            Go to Update
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
