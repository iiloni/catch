import {
  KeyRound,
  LockKeyhole,
  LockKeyholeOpen,
  RectangleEllipsis,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { type FormEvent, useId, useState } from 'react';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { MIN_VAULT_PASSWORD, newPasswordProblem, PinInput } from '@/components/VaultGate/VaultGate';
import { haptics } from '@/lib/haptics';
import {
  changeVaultPassword,
  deleteVault,
  enterVault,
  lockVault,
  rememberVault,
  removeVaultPin,
  setVaultPin,
  useVault,
  vaultNotes,
  vaultPin,
  vaultRemembered,
} from '@/lib/vault';
import { isVaultPin } from '@/lib/vaultCrypto';
import { useShowVaultButton } from '@/lib/vaultPreferences';

const failure = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';

// Above the keyboard, as the account's own password dialog sits.
const DIALOG =
  'top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto';

/** Settings > Vault: this device's hold on the vault, its password, and its deletion. */
export function VaultSettings() {
  const status = useVault();
  const remembered = vaultRemembered.use();
  const pin = vaultPin.use();
  const notes = vaultNotes.use();
  const [dialog, setDialog] = useState<'password' | 'pin' | 'delete' | null>(null);
  const unlocked = status === 'unlocked';

  if (status === 'none' || status === 'loading') {
    return (
      <SettingsSection
        title="Vault"
        description="Notes in the vault are encrypted on your devices with a password only you know. The server holds them only as ciphertext."
      >
        <VaultButtonSetting />
        <SettingsRow
          icon={LockKeyhole}
          label={status === 'none' ? 'No vault yet' : 'Looking for your vault…'}
          description={status === 'none' ? 'Set one up to keep private notes' : undefined}
        >
          {status === 'none' && (
            <Button variant="outline" className="h-11 rounded-full" onClick={enterVault}>
              Set up
            </Button>
          )}
        </SettingsRow>
      </SettingsSection>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="This device"
        description="The vault locks when you leave it and after five minutes in the background. With a PIN it opens again with the PIN, and locks after a minute in the background or five minutes untouched. A device that remembers the vault opens it without either, for anyone who can open Catch here."
      >
        <VaultButtonSetting />
        <SettingsRow
          icon={unlocked ? LockKeyholeOpen : LockKeyhole}
          label={unlocked ? 'Unlocked' : 'Locked'}
          description={
            unlocked
              ? pin
                ? 'Lock it until the PIN is entered'
                : 'Lock it and forget its key here'
              : pin
                ? 'Enter the PIN to open it'
                : 'Enter the password to open it'
          }
        >
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={() => {
              haptics.toggle();
              if (unlocked) void lockVault();
              else enterVault();
            }}
          >
            {unlocked ? 'Lock now' : 'Unlock'}
          </Button>
        </SettingsRow>
        <SettingsRow
          icon={RectangleEllipsis}
          label="Unlock with a PIN"
          description={
            pin
              ? 'Asked for here in place of the password'
              : unlocked
                ? 'Four to eight digits, for this device only'
                : 'Unlock the vault to set one'
          }
        >
          <Switch
            aria-label="Unlock with a PIN"
            checked={pin !== null}
            disabled={!pin && !unlocked}
            onCheckedChange={(checked) => {
              haptics.toggle();
              if (checked) setDialog('pin');
              else void removeVaultPin();
            }}
          />
        </SettingsRow>
        {pin && unlocked && (
          <SettingsRow icon={RectangleEllipsis} label="Change PIN">
            <Button
              variant="outline"
              className="h-11 rounded-full"
              onClick={() => setDialog('pin')}
            >
              Change
            </Button>
          </SettingsRow>
        )}
        <SettingsRow
          icon={Smartphone}
          label="Remember on this device"
          description={
            unlocked
              ? 'Keep the vault open here, with no password or PIN'
              : 'Unlock the vault to change this'
          }
        >
          <Switch
            aria-label="Remember on this device"
            checked={remembered}
            disabled={!unlocked}
            onCheckedChange={(checked) => void rememberVault(checked)}
          />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="Vault">
        <SettingsRow
          icon={KeyRound}
          label="Vault password"
          description="Your recovery code stays the same"
        >
          <Button
            variant="outline"
            className="h-11 rounded-full"
            onClick={() => setDialog('password')}
          >
            Change
          </Button>
        </SettingsRow>
        <SettingsRow
          icon={Trash2}
          label="Delete vault"
          description="Deletes every note in it, on every device"
        >
          <Button
            variant="outline"
            className="h-11 rounded-full text-destructive"
            onClick={() => setDialog('delete')}
          >
            Delete
          </Button>
        </SettingsRow>
      </SettingsSection>
      <ChangeVaultPassword open={dialog === 'password'} onClose={() => setDialog(null)} />
      <SetVaultPin
        open={dialog === 'pin'}
        replacing={pin !== null}
        onClose={() => setDialog(null)}
      />
      <DeleteVault
        open={dialog === 'delete'}
        noteCount={unlocked ? notes.length : null}
        onClose={() => setDialog(null)}
      />
    </div>
  );
}

function VaultButtonSetting() {
  const [shown, setShown] = useShowVaultButton();

  return (
    <SettingsRow
      icon={LockKeyhole}
      label="Show vault button"
      description="Header shortcut on this device"
    >
      <Switch
        aria-label="Show vault button"
        checked={shown}
        onCheckedChange={(checked) => {
          haptics.toggle();
          setShown(checked);
        }}
      />
    </SettingsRow>
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
          devices that remember the vault or open it with a PIN keep doing so.
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
              className="rounded-xl"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl" disabled={pending}>
              {pending ? 'Changing…' : 'Change password'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Null when the pair is a usable new PIN, or what is wrong with it. */
function newPinProblem(pin: string, confirmation: string) {
  if (!isVaultPin(pin)) return 'Use four to eight digits.';
  if (pin !== confirmation) return 'The PINs do not match.';
  return null;
}

function SetVaultPin({
  open,
  replacing,
  onClose,
}: {
  open: boolean;
  /** Whether the device has a PIN already, which this one replaces. */
  replacing: boolean;
  onClose: () => void;
}) {
  const formId = useId();
  const [pin, setPin] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (pending) return;
    setPin('');
    setConfirmation('');
    setError(null);
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = newPinProblem(pin, confirmation);
    setError(problem);
    if (problem) return;
    setPending(true);
    try {
      await setVaultPin(pin);
      haptics.success();
      toast.success(replacing ? 'PIN changed' : 'PIN set');
      setPending(false);
      setPin('');
      setConfirmation('');
      onClose();
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setPending(false);
    }
  }

  const fields = [
    ['pin', 'PIN', pin, setPin],
    ['confirm', 'Repeat it', confirmation, setConfirmation],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(value) => !value && close()}>
      <DialogContent showCloseButton={!pending} className={DIALOG}>
        <DialogTitle>{replacing ? 'Change PIN' : 'Set a PIN'}</DialogTitle>
        <DialogDescription>
          This device will ask for the PIN in place of the vault password. It keeps out someone who
          picks up the device, not someone who can copy its files. Five wrong PINs in a row turn it
          off, and the vault asks for its password.
        </DialogDescription>
        <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
          {fields.map(([name, label, value, set]) => (
            <label key={name} htmlFor={`${formId}-${name}`} className="flex flex-col gap-2 text-sm">
              {label}
              <PinInput
                id={`${formId}-${name}`}
                value={value}
                readOnly={pending}
                autoFocus={name === 'pin'}
                onChange={set}
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
              className="rounded-xl"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" className="rounded-xl" disabled={pending}>
              {pending ? 'Saving…' : replacing ? 'Change PIN' : 'Set PIN'}
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
  /** Null while the vault is locked, when nothing here can count its notes. */
  noteCount: number | null;
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
          {noteCount === null
            ? 'The vault and every note in it will be deleted forever, from the server and every device. This does not need the vault password.'
            : noteCount === 0
              ? 'The vault will be deleted from the server and every device.'
              : noteCount === 1
                ? 'The vault and the note in it will be deleted forever, from the server and every device.'
                : `The vault and all ${noteCount} notes in it will be deleted forever, from the server and every device.`}
        </DialogDescription>
        <div className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button variant="ghost" className="rounded-xl" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button
            variant="destructive"
            className="rounded-xl"
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
