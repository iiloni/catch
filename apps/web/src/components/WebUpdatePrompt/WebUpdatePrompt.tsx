import { Capacitor } from '@capacitor/core';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { haptics } from '@/lib/haptics';
import { useSyncStatus } from '@/lib/syncStatus';
import { useUpdateReloadBlocked } from '@/lib/useUpdateReloadBlocked';
import { reloadForWebUpdate, useWebUpdates } from '@/lib/webUpdates';

export function WebUpdatePrompt() {
  const { target, reloading, error } = useWebUpdates();
  const { incompatibility } = useSyncStatus();
  const required = incompatibility === 'client-too-old';
  // A newly required update must be explained even if this build was dismissed as optional.
  const prompt = required ? `required:${target ?? ''}` : target;
  const blocked = useUpdateReloadBlocked();
  const [dismissed, setDismissed] = useState<string | null>(null);
  return (
    <Dialog
      open={
        Capacitor.getPlatform() === 'web' && Boolean(prompt) && prompt !== dismissed && !blocked
      }
      onOpenChange={(open) => {
        if (!open && !reloading) setDismissed(prompt);
      }}
    >
      <DialogContent>
        <DialogTitle>{required ? 'Update required to sync' : 'App update available'}</DialogTitle>
        <DialogDescription>
          {required
            ? 'This version of Catch can no longer sync with your server. Reload to update and resume syncing. You can keep working offline; your saved notes and queued changes will stay on this device.'
            : 'A new version of Catch is available. Reload to use it. Your saved notes and queued changes will stay on this device.'}
        </DialogDescription>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={reloading} onClick={() => setDismissed(prompt)}>
            {required ? 'Keep working offline' : 'Later'}
          </Button>
          <Button
            disabled={reloading}
            onClick={() => {
              haptics.selection();
              void reloadForWebUpdate();
            }}
          >
            {reloading ? 'Preparing update…' : 'Reload to update'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
