import {
  FingerprintPattern,
  KeyRound,
  LockKeyhole,
  LockKeyholeOpen,
  RectangleEllipsis,
  Timer,
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
import {
  dismissed,
  MIN_VAULT_PASSWORD,
  newPasswordProblem,
  PinInput,
} from '@/components/VaultGate/VaultGate';
import { haptics } from '@/lib/haptics';
import {
  changeVaultPassword,
  deleteVault,
  enableVaultBiometrics,
  enterVault,
  lockVault,
  rememberVault,
  removeVaultBiometrics,
  removeVaultPin,
  setVaultPin,
  useVault,
  vaultBiometrics,
  vaultNotes,
  vaultPin,
  vaultRemembered,
} from '@/lib/vault';
import { BiometricError, biometricWords, useBiometricAvailability } from '@/lib/vaultBiometrics';
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
  const biometrics = vaultBiometrics.use();
  const availability = useBiometricAvailability();
  const words = biometricWords(availability?.kind);
  const notes = vaultNotes.use();
  const [dialog, setDialog] = useState<'password' | 'pin' | 'delete' | null>(null);
  const [enabling, setEnabling] = useState(false);
  const unlocked = status === 'unlocked';
  // Only the Android app, with a strong biometric enrolled, can turn it on; any can turn it off.
  const offersBiometrics = biometrics || availability?.available === true;

  async function enableBiometrics() {
    setEnabling(true);
    try {
      await enableVaultBiometrics({ title: `Turn on ${words.feature}`, cancel: 'Cancel' });
      haptics.success();
      toast.success(`${words.Feature} is on`);
    } catch (caught) {
      if (dismissed(caught)) return;
      toast.error(
        caught instanceof BiometricError && caught.reason === 'unavailable'
          ? `Set up ${words.name} in the phone's settings first.`
          : `Could not turn on ${words.feature}. Try again.`,
      );
    } finally {
      setEnabling(false);
    }
  }

  if (status === 'none' || status === 'loading') {
    return (
      <div className="flex flex-col gap-6">
        <VaultButtonSetting />
        <SettingsSection
          title="Vault"
          description="Notes in the vault are encrypted on your devices with a password only you know. The server holds them only as ciphertext."
        >
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
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <VaultButtonSetting />
      <SettingsSection title="This device">
        <SettingsRow
          icon={unlocked ? LockKeyholeOpen : LockKeyhole}
          label={unlocked ? 'Unlocked' : 'Locked'}
          description={
            unlocked
              ? 'Lock it on this device'
              : biometrics
                ? `Opens with your ${words.name}`
                : pin
                  ? 'Opens with your PIN'
                  : 'Opens with your password'
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
          icon={Timer}
          label="Lock automatically"
          description={
            !unlocked
              ? 'Unlock to change'
              : remembered
                ? 'Stays open on this device'
                : 'When you leave it or go idle'
          }
        >
          <Switch
            aria-label="Lock automatically"
            checked={!remembered}
            disabled={!unlocked}
            onCheckedChange={(checked) => {
              haptics.toggle();
              // A vault that never locks has nothing for a PIN or fingerprint to open, so they go.
              rememberVault(!checked).then(
                () => {
                  if (checked) return;
                  if (pin && biometrics) toast(`PIN and ${words.feature} turned off`);
                  else if (pin) toast('PIN turned off');
                  else if (biometrics) toast(`${words.Feature} turned off`);
                },
                () => toast.error('Could not change this. Try again.'),
              );
            }}
          />
        </SettingsRow>
        {/* Ways back in, which only a vault that locks needs. */}
        {!remembered && (
          <div className="flex flex-col divide-y divide-foreground/[0.06] pl-8">
            {offersBiometrics && (
              <SettingsRow
                icon={FingerprintPattern}
                label={words.unlock}
                description={
                  biometrics || unlocked
                    ? pin
                      ? 'Before the PIN'
                      : 'Instead of the password'
                    : 'Unlock to turn on'
                }
              >
                <Switch
                  aria-label={words.unlock}
                  checked={biometrics}
                  disabled={enabling || (!biometrics && !unlocked)}
                  onCheckedChange={(checked) => {
                    haptics.toggle();
                    if (checked) void enableBiometrics();
                    else
                      removeVaultBiometrics().catch(() =>
                        toast.error(`Could not turn ${words.feature} off. Try again.`),
                      );
                  }}
                />
              </SettingsRow>
            )}
            <SettingsRow
              icon={RectangleEllipsis}
              label="Unlock with a PIN"
              description={pin || unlocked ? 'Instead of the password' : 'Unlock to set one'}
            >
              <Switch
                aria-label="Unlock with a PIN"
                checked={pin !== null}
                disabled={!pin && !unlocked}
                onCheckedChange={(checked) => {
                  haptics.toggle();
                  if (checked) setDialog('pin');
                  else
                    removeVaultPin().catch(() =>
                      toast.error('Could not turn the PIN off. Try again.'),
                    );
                }}
              />
            </SettingsRow>
            {pin && unlocked && (
              <SettingsRow label={<span className="pl-8">Change PIN</span>}>
                <Button
                  variant="outline"
                  className="h-11 rounded-full"
                  onClick={() => setDialog('pin')}
                >
                  Change
                </Button>
              </SettingsRow>
            )}
          </div>
        )}
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
    <SettingsSection title="Vault button">
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
    </SettingsSection>
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
          devices that remember the vault or open it another way keep doing so.
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
          Four to eight digits, for this device only. Five wrong tries turn it off.
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
