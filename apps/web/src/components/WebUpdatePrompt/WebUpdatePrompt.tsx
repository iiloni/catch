import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { haptics } from '@/lib/haptics';
import { useUpdateReloadBlocked } from '@/lib/useUpdateReloadBlocked';
import { reloadForWebUpdate, useWebUpdates } from '@/lib/webUpdates';

export function WebUpdatePrompt() {
  const { target, reloading, error } = useWebUpdates();
  const blocked = useUpdateReloadBlocked();
  const [dismissed, setDismissed] = useState<string | null>(null);
  return (
    <Dialog
      open={Boolean(target) && target !== dismissed && !blocked}
      onOpenChange={(open) => {
        if (!open && !reloading) setDismissed(target);
      }}
    >
      <DialogContent>
        <DialogTitle>App update available</DialogTitle>
        <DialogDescription>
          A new version of Catch is available. Reload to use it. Your saved notes and queued changes
          will stay on this device.
        </DialogDescription>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" disabled={reloading} onClick={() => setDismissed(target)}>
            Later
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
