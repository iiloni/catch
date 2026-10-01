import {
  type AdminUser,
  resetUserPasswordResponseSchema,
  userActionResponseSchema,
} from '@catch/shared';
import { Copy, KeyRound, MoreHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { haptics } from '@/lib/haptics';

type Props = {
  user: AdminUser;
  self: boolean;
  disabled: boolean;
  onPendingChange: (pending: boolean) => void;
  onDeleted: () => void;
  onAccessDenied: () => void;
};
type Action = { kind: 'reset' | 'delete' } | { kind: 'password'; password: string };

export function UserActions({
  user,
  self,
  disabled,
  onPendingChange,
  onDeleted,
  onAccessDenied,
}: Props) {
  const [action, setAction] = useState<Action | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function open(kind: 'reset' | 'delete') {
    setError(null);
    setCopied(false);
    setAction({ kind });
  }

  async function confirm() {
    if (!action || action.kind === 'password' || pending) return;
    setPending(true);
    onPendingChange(true);
    setError(null);
    try {
      if (action.kind === 'reset') {
        const result = resetUserPasswordResponseSchema.parse(await api.resetUserPassword(user.id));
        setAction({ kind: 'password', password: result.temporaryPassword });
      } else {
        userActionResponseSchema.parse(await api.deleteUser(user.id));
        setAction(null);
        toast.success(`${user.name || user.email} deleted`);
        onDeleted();
      }
      haptics.success();
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        setAction(null);
        onAccessDenied();
      } else {
        setError(
          failure instanceof ApiError
            ? failure.message
            : 'Could not update this user. Check your connection and try again.',
        );
      }
    } finally {
      setPending(false);
      onPendingChange(false);
    }
  }

  async function copyPassword() {
    if (action?.kind !== 'password') return;
    try {
      await navigator.clipboard.writeText(action.password);
      setCopied(true);
      setError(null);
      haptics.selection();
    } catch {
      setError('Could not copy. Select the password and copy it manually.');
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            disabled={self || disabled}
            aria-label={`Actions for ${user.email}`}
            title={self ? 'Manage your password in Account settings' : undefined}
            className="size-11 rounded-full p-0"
          >
            <MoreHorizontal className="size-5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => open('reset')} className="min-h-11">
            <KeyRound aria-hidden />
            Reset password
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => open('delete')}
            variant="destructive"
            className="min-h-11"
          >
            <Trash2 aria-hidden />
            Delete user
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog
        open={action !== null}
        onOpenChange={(value) => {
          if (!value && !pending) {
            setAction(null);
            setError(null);
          }
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          onEscapeKeyDown={(event) => {
            if (pending) event.preventDefault();
          }}
          onPointerDownOutside={(event) => {
            if (pending) event.preventDefault();
          }}
        >
          <DialogTitle>
            {action?.kind === 'password'
              ? 'Temporary password'
              : action?.kind === 'delete'
                ? 'Delete user?'
                : 'Reset password?'}
          </DialogTitle>
          <DialogDescription>
            {action?.kind === 'password'
              ? `Share this password with ${user.email}. They can replace it in Account settings. It will disappear when you close this dialog.`
              : action?.kind === 'delete'
                ? `Permanently delete ${user.name || user.email} (${user.email}), including all their notes and attachments? This cannot be undone.`
                : `Generate a temporary password for ${user.name || user.email} (${user.email})? Their current password will stop working and they will be signed out of all devices.`}
          </DialogDescription>
          {action?.kind === 'password' && (
            <Input
              aria-label="Temporary password"
              value={action.password}
              readOnly
              autoComplete="off"
              className="h-11 font-mono"
              onFocus={(event) => event.target.select()}
            />
          )}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {action?.kind === 'password' ? (
              <>
                <Button
                  variant="outline"
                  onClick={() => void copyPassword()}
                  className="h-11 rounded-full"
                >
                  <Copy aria-hidden />
                  {copied ? 'Copied' : 'Copy password'}
                </Button>
                <Button
                  onClick={() => {
                    setAction(null);
                    setError(null);
                  }}
                  className="h-11 rounded-full"
                >
                  Done
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  disabled={pending}
                  onClick={() => setAction(null)}
                  className="h-11 rounded-full"
                >
                  Cancel
                </Button>
                <Button
                  variant={action?.kind === 'delete' ? 'destructive' : 'default'}
                  disabled={pending}
                  onClick={() => void confirm()}
                  className="h-11 rounded-full"
                >
                  {pending
                    ? 'Updating…'
                    : action?.kind === 'delete'
                      ? 'Delete user'
                      : 'Reset password'}
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
