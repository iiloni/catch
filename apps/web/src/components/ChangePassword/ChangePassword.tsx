import { changePasswordSchema } from '@catch/shared';
import { KeyRound } from 'lucide-react';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { authClient } from '@/lib/auth';
import { haptics } from '@/lib/haptics';

export function ChangePassword() {
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setOpen(false);
    setCurrentPassword('');
    setNewPassword('');
    setConfirmation('');
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const parsed = changePasswordSchema.safeParse({ currentPassword, newPassword });
    if (!parsed.success) {
      setError('Use a password between 8 and 128 characters.');
      return;
    }
    if (newPassword !== confirmation) {
      setError('The new passwords do not match.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await authClient.changePassword({ ...parsed.data, revokeOtherSessions: true });
      if (result.error) {
        setError(result.error.message || 'Could not change your password.');
        return;
      }
      close();
      haptics.success();
      toast.success('Password changed');
    } catch {
      setError('Could not change your password. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection title="Security">
      <SettingsRow
        icon={KeyRound}
        label="Password"
        description="Change your password and sign out other devices"
      >
        <Dialog
          open={open}
          onOpenChange={(value) => {
            if (!pending) {
              if (value) setOpen(true);
              else close();
            }
          }}
        >
          <DialogTrigger asChild>
            <Button variant="outline" className="h-11 rounded-full">
              Change password
            </Button>
          </DialogTrigger>
          <DialogContent
            showCloseButton={!pending}
            className="top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto"
            onEscapeKeyDown={(event) => {
              if (pending) event.preventDefault();
            }}
            onPointerDownOutside={(event) => {
              if (pending) event.preventDefault();
            }}
          >
            <DialogTitle>Change password</DialogTitle>
            <DialogDescription>
              Use at least 8 characters. Your other devices will be signed out.
            </DialogDescription>
            <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
              <label htmlFor={`${formId}-current`} className="flex flex-col gap-2 text-sm">
                Current password
                <Input
                  id={`${formId}-current`}
                  type="password"
                  autoComplete="current-password"
                  required
                  maxLength={128}
                  value={currentPassword}
                  disabled={pending}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  className="h-11"
                />
              </label>
              <label htmlFor={`${formId}-new`} className="flex flex-col gap-2 text-sm">
                New password
                <Input
                  id={`${formId}-new`}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={newPassword}
                  disabled={pending}
                  onChange={(event) => setNewPassword(event.target.value)}
                  className="h-11"
                />
              </label>
              <label htmlFor={`${formId}-confirm`} className="flex flex-col gap-2 text-sm">
                Confirm new password
                <Input
                  id={`${formId}-confirm`}
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  value={confirmation}
                  disabled={pending}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="h-11"
                />
              </label>
              {error && (
                <p role="alert" className="text-destructive text-sm">
                  {error}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending}
                  onClick={close}
                  className="h-11 rounded-full"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={pending} className="h-11 rounded-full">
                  {pending ? 'Saving…' : 'Save password'}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </SettingsRow>
    </SettingsSection>
  );
}
