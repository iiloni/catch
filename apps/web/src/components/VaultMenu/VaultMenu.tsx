import { EllipsisVertical, KeyRound, Lock, Smartphone, Trash2 } from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { MIN_VAULT_PASSWORD, newPasswordProblem } from '@/components/VaultGate/VaultGate';
import { haptics } from '@/lib/haptics';
import {
  changeVaultPassword,
  deleteVault,
  lockVault,
  rememberVault,
  vaultRemembered,
} from '@/lib/vault';

const failure = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';

// Above the keyboard, as the account's own password dialog sits.
const DIALOG =
  'top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto';

/** The unlocked vault's own controls, in its page header. */
export function VaultMenu({ noteCount }: { noteCount: number }) {
  const remembered = vaultRemembered.use();
  const [dialog, setDialog] = useState<'password' | 'delete' | null>(null);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Vault options"
          className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <EllipsisVertical className="size-5" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={8}>
          <DropdownMenuItem
            onSelect={() => {
              haptics.toggle();
              void lockVault();
            }}
          >
            <Lock aria-hidden />
            Lock now
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => {
              haptics.toggle();
              void rememberVault(!remembered).then(() =>
                toast(
                  remembered
                    ? 'This device will ask for the vault password'
                    : 'This device will keep the vault open',
                ),
              );
            }}
          >
            <Smartphone aria-hidden />
            {remembered ? 'Stop remembering on this device' : 'Remember on this device'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog('password')}>
            <KeyRound aria-hidden />
            Change vault password
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setDialog('delete')}>
            <Trash2 aria-hidden />
            Delete vault
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ChangeVaultPassword open={dialog === 'password'} onClose={() => setDialog(null)} />
      <DeleteVault
        open={dialog === 'delete'}
        noteCount={noteCount}
        onClose={() => setDialog(null)}
      />
    </>
  );
}

function ChangeVaultPassword({ open, onClose }: { open: boolean; onClose: () => void }) {
  const formId = useId();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setCurrent('');
    setNext('');
    setConfirmation('');
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = newPasswordProblem(next, confirmation);
    setError(problem);
    if (problem) return;
    setPending(true);
    try {
      if (!(await changeVaultPassword(current, next))) {
        setError('That is not the current vault password.');
        return;
      }
      haptics.success();
      toast.success('Vault password changed');
      setPending(false);
      close();
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setPending(false);
    }
  }

  const fields = [
    ['current', 'Current vault password', current, setCurrent, 'current-password'],
    ['new', 'New vault password', next, setNext, 'new-password'],
    ['confirm', 'Repeat the new password', confirmation, setConfirmation, 'new-password'],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent showCloseButton={!pending} className={DIALOG}>
        <DialogTitle>Change vault password</DialogTitle>
        <DialogDescription>
          Use at least {MIN_VAULT_PASSWORD} characters. Your recovery code stays the same, and
          devices that remember the vault keep it open.
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          {fields.map(([name, label, value, set, autoComplete]) => (
            <label key={name} htmlFor={`${formId}-${name}`} className="flex flex-col gap-2 text-sm">
              {label}
              <Input
                id={`${formId}-${name}`}
                type="password"
                autoComplete={autoComplete}
                required
                maxLength={256}
                value={value}
                disabled={pending}
                onChange={(event) => set(event.target.value)}
                className="h-11"
              />
            </label>
          ))}
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              className="rounded-full"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-full" disabled={pending}>
              {pending ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeleteVault({
  open,
  noteCount,
  onClose,
}: {
  open: boolean;
  noteCount: number;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);

  async function confirm() {
    if (pending) return;
    setPending(true);
    haptics.warning();
    try {
      await deleteVault();
      toast('Vault deleted');
      onClose();
    } catch (caught) {
      toast.error(failure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !pending && onClose()}>
      <DialogContent showCloseButton={!pending}>
        <DialogTitle>Delete the vault?</DialogTitle>
        <DialogDescription>
          {noteCount === 0
            ? 'The vault will be deleted from the server and every device.'
            : noteCount === 1
              ? 'The vault and the note in it will be deleted forever, from the server and every device.'
              : `The vault and all ${noteCount} notes in it will be deleted forever, from the server and every device.`}
        </DialogDescription>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-full" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            className="rounded-full"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? 'Deleting…' : 'Delete vault'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
