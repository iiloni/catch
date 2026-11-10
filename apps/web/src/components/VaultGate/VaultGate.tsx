import { Copy, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import {
  type FormEvent,
  type ReactNode,
  type Ref,
  type RefObject,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { haptics } from '@/lib/haptics';
import { useSyncStatus } from '@/lib/syncStatus';
import {
  createVault,
  enableVaultBiometrics,
  recoverVault,
  unlockVault,
  unlockWithBiometrics,
  unlockWithPin,
  type VaultStatus,
  vaultBiometrics,
  vaultBiometricsLost,
  vaultPin,
} from '@/lib/vault';
import {
  BiometricError,
  biometricAvailability,
  biometricWords,
  useBiometricAvailability,
} from '@/lib/vaultBiometrics';

/** The shortest vault password. It is all that stands between the server and the notes. */
export const MIN_VAULT_PASSWORD = 8;

type Props = {
  status: Exclude<VaultStatus, 'unlocked'>;
  /** A vault was just made: its recovery code, which must be shown now or never. */
  onCreated: (recoveryCode: string) => void;
};

/**
 * Focuses the PIN or password field, bringing up the keyboard. While the fingerprint prompt
 * is closing the app does not have focus yet, and a keyboard raised then is shut again, so
 * it waits for focus to come back.
 */
function focusWhenInFront(field: RefObject<HTMLInputElement | null>) {
  if (document.hasFocus()) field.current?.focus();
  else window.addEventListener('focus', () => field.current?.focus(), { once: true });
}

/** What stands in front of the vault's notes: setting it up, or unlocking it. */
export function VaultGate({ status, onCreated }: Props) {
  const [recovering, setRecovering] = useState(false);
  const [usePassword, setUsePassword] = useState(false);
  // Why a quicker way in gave way to the next, when it did so on its own.
  const [notice, setNotice] = useState<string | null>(null);
  const pin = vaultPin.use();
  const biometrics = vaultBiometrics.use();
  const words = biometricWords(useBiometricAvailability()?.kind);
  const [prompting, setPrompting] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const { offline } = useSyncStatus();
  const withPin = pin !== null && !usePassword;

  async function tryBiometrics() {
    if (prompting) return;
    setPrompting(true);
    setNotice(null);
    const fallback = withPin ? 'your PIN' : 'the vault password';
    try {
      const { result } = await unlockWithBiometrics({
        title: 'Unlock the vault',
        cancel: withPin ? 'Use PIN' : 'Use password',
      });
      if (result === 'unlocked') {
        haptics.success();
        return;
      }
      if (result === 'lockout') setNotice(`Too many tries. Use ${fallback}.`);
      else if (result === 'invalidated')
        setNotice(`${words.changed} on this phone, so ${words.feature} is off.`);
      else if (result === 'forgotten')
        setNotice(`${words.Feature} no longer works here and is off.`);
      else if (result === 'failed') setNotice(`Could not use ${words.name}. Use ${fallback}.`);
      focusWhenInFront(field);
    } catch (caught) {
      setNotice(failure(caught));
    } finally {
      setPrompting(false);
    }
  }

  // Entering asks for a fingerprint at once; the gate behind it is for when that fails. A
  // reminder can open the gate before the app is in front, so the prompt waits until it is.
  const tried = useRef(false);
  const tryOnEntering = useEffectEvent(() => {
    if (tried.current || document.visibilityState !== 'visible') return;
    tried.current = true;
    void tryBiometrics();
  });
  useEffect(() => {
    if (!biometrics || status !== 'locked' || recovering) return;
    const onVisible = () => tryOnEntering();
    onVisible();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [biometrics, status, recovering]);

  const biometricsButton = biometrics ? (
    <Button
      type="button"
      variant="ghost"
      className="rounded-xl"
      disabled={prompting}
      onClick={() => void tryBiometrics()}
    >
      {words.use}
    </Button>
  ) : null;

  if (status === 'loading') {
    return (
      <Panel icon={LockKeyhole} title="Vault">
        <p className="text-muted-foreground text-sm">
          {offline
            ? 'This device has not seen your vault yet. Connect to the server once to open it or set it up.'
            : 'Looking for your vault…'}
        </p>
      </Panel>
    );
  }
  if (status === 'none') return <SetUp onCreated={onCreated} />;
  if (recovering) return <Recover onBack={() => setRecovering(false)} />;
  if (pin && !usePassword) {
    return (
      <UnlockWithPin
        length={pin.length}
        inputRef={field}
        autoFocus={!biometrics}
        notice={notice}
        biometrics={biometricsButton}
        onPassword={() => setUsePassword(true)}
        onForgotten={(reason) =>
          setNotice(
            reason === 'locked-out'
              ? 'Too many wrong PINs. The PIN is off on this device until you set it again.'
              : 'The PIN no longer opens the vault on this device. Use the vault password.',
          )
        }
      />
    );
  }
  return (
    <Unlock
      inputRef={field}
      autoFocus={!biometrics}
      notice={notice}
      quick={pin !== null || biometrics}
      biometrics={biometricsButton}
      onForgot={() => setRecovering(true)}
      onPin={pin ? () => setUsePassword(false) : undefined}
    />
  );
}

/**
 * After the PIN or password opens a vault whose fingerprint unlock went off because the
 * phone's fingerprints changed, offers once to turn it back on.
 */
async function offerBiometricsAgain() {
  if (!vaultBiometricsLost.get()) return;
  vaultBiometricsLost.set(false);
  const available = await biometricAvailability();
  if (!available?.available) return;
  const words = biometricWords(available.kind);
  toast(`Turn ${words.feature} back on?`, {
    duration: 10_000,
    action: {
      label: 'Turn on',
      onClick: () => {
        enableVaultBiometrics({ title: `Turn on ${words.feature}`, cancel: 'Cancel' }).then(
          () => toast.success(`${words.Feature} is on`),
          (error: unknown) => {
            if (!dismissed(error)) toast.error(`Could not turn on ${words.feature}.`);
          },
        );
      },
    },
  });
}

/** Whether a fingerprint prompt was closed by the user, which needs no message. */
export const dismissed = (error: unknown) =>
  error instanceof BiometricError && (error.reason === 'canceled' || error.reason === 'fallback');

function Panel({
  icon: Icon,
  title,
  children,
}: {
  icon: typeof LockKeyhole;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-4 px-2 pt-10 text-center">
      <span className="flex size-16 items-center justify-center rounded-3xl bg-foreground/[0.06] text-muted-foreground">
        <Icon className="size-7" aria-hidden />
      </span>
      <h2 className="font-display font-semibold text-xl tracking-[-0.01em]">{title}</h2>
      {children}
    </div>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  disabled,
  autoFocus,
  inputRef,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  autoFocus?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-2 text-left text-sm">
      {label}
      <Input
        id={id}
        ref={inputRef}
        type="password"
        autoComplete={autoComplete}
        required
        maxLength={256}
        value={value}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        className="h-11"
      />
    </label>
  );
}

function RememberSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled: boolean;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-3 text-left">
      <label htmlFor={id} className="min-w-0 flex-1 text-sm">
        Remember on this device
        <span className="block text-muted-foreground text-xs">
          The vault then opens here without its password, for anyone who can open Catch.
        </span>
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

function FormError({ children }: { children: string | null }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-left text-destructive text-sm">
      {children}
    </p>
  );
}

const failure = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.';

/** Null when the pair is a usable new password, or what is wrong with it. */
export function newPasswordProblem(password: string, confirmation: string) {
  if (password.length < MIN_VAULT_PASSWORD) {
    return `Use at least ${MIN_VAULT_PASSWORD} characters.`;
  }
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}

function SetUp({ onCreated }: Pick<Props, 'onCreated'>) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = newPasswordProblem(password, confirmation);
    setError(problem);
    if (problem) return;
    setPending(true);
    try {
      onCreated(await createVault(password, remember));
      haptics.success();
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel icon={ShieldCheck} title="Set up your vault">
      <p className="text-muted-foreground text-sm">
        Notes in the vault are encrypted on your devices with a password only you know. The server,
        its admin and its backups hold them only as ciphertext. Nobody can reset this password for
        you.
      </p>
      <form onSubmit={(event) => void submit(event)} className="flex w-full flex-col gap-4">
        <PasswordField
          label="Vault password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={pending}
        />
        <PasswordField
          label="Repeat it"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          disabled={pending}
        />
        <RememberSwitch checked={remember} onChange={setRemember} disabled={pending} />
        <FormError>{error}</FormError>
        <Button type="submit" disabled={pending} className="h-11 rounded-xl">
          {pending ? 'Creating…' : 'Create vault'}
        </Button>
      </form>
    </Panel>
  );
}

function Unlock({
  notice,
  quick,
  biometrics,
  inputRef,
  autoFocus,
  onForgot,
  onPin,
}: {
  notice: string | null;
  /** Whether the device opens the vault with a PIN or fingerprint, which remembering ends. */
  quick: boolean;
  /** The button that asks for a fingerprint again, on a phone that opens the vault with one. */
  biometrics: ReactNode;
  inputRef: Ref<HTMLInputElement>;
  autoFocus: boolean;
  onForgot: () => void;
  /** Back to the PIN, on a device that has one. */
  onPin?: () => void;
}) {
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      if (await unlockVault(password, remember)) {
        haptics.success();
        void offerBiometricsAgain();
      } else {
        haptics.warning();
        setError('That is not the vault password.');
      }
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel icon={LockKeyhole} title="The vault is locked">
      <form onSubmit={(event) => void submit(event)} className="flex w-full flex-col gap-4">
        <PasswordField
          label="Vault password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={pending}
          autoFocus={autoFocus}
          inputRef={inputRef}
        />
        {/* A device with a PIN or fingerprint keeps it; remembering the vault would end it. */}
        {!quick && <RememberSwitch checked={remember} onChange={setRemember} disabled={pending} />}
        <FormError>{error ?? notice}</FormError>
        <Button type="submit" disabled={pending} className="h-11 rounded-xl">
          {pending ? 'Unlocking…' : 'Unlock'}
        </Button>
        {biometrics}
        {onPin && (
          <Button type="button" variant="ghost" className="rounded-xl" onClick={onPin}>
            Use the PIN
          </Button>
        )}
        <Button type="button" variant="ghost" className="rounded-xl" onClick={onForgot}>
          Use the recovery code
        </Button>
      </form>
    </Panel>
  );
}

/** The digits of a PIN as typed, whatever else came with them. */
export const pinDigits = (value: string) => value.replace(/\D/g, '').slice(0, 8);

/** A PIN field: digits only, with the phone's number pad. */
export function PinInput({
  id,
  value,
  onChange,
  inputRef,
  readOnly,
  autoFocus,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  inputRef?: Ref<HTMLInputElement>;
  readOnly?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <Input
      id={id}
      ref={inputRef}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      required
      maxLength={8}
      value={value}
      readOnly={readOnly}
      autoFocus={autoFocus}
      onChange={(event) => onChange(pinDigits(event.target.value))}
      className="h-12 text-center font-mono text-xl tracking-[0.5em] md:text-xl"
    />
  );
}

function UnlockWithPin({
  length,
  notice,
  biometrics,
  inputRef: input,
  autoFocus,
  onPassword,
  onForgotten,
}: {
  length: number;
  notice: string | null;
  /** The button that asks for a fingerprint again, on a phone that opens the vault with one. */
  biometrics: ReactNode;
  inputRef: RefObject<HTMLInputElement | null>;
  autoFocus: boolean;
  onPassword: () => void;
  onForgotten: (reason: 'locked-out' | 'forgotten') => void;
}) {
  const id = useId();
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function attempt(candidate: string) {
    if (pending) return;
    // Only a whole PIN is tried, so a press of Unlock part way through costs no try.
    if (candidate.length !== length) {
      setError(`The PIN has ${length} digits.`);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const unlock = await unlockWithPin(candidate);
      if (unlock.result === 'unlocked') {
        haptics.success();
        void offerBiometricsAgain();
        return;
      }
      haptics.warning();
      setPin('');
      if (unlock.result === 'locked-out' || unlock.result === 'forgotten')
        onForgotten(unlock.result);
      else
        setError(
          unlock.left === 1
            ? 'That is not the PIN. One more wrong PIN turns it off on this device.'
            : `That is not the PIN. ${unlock.left} tries left.`,
        );
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setPending(false);
      input.current?.focus();
    }
  }

  return (
    <Panel icon={LockKeyhole} title="The vault is locked">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void attempt(pin);
        }}
        className="flex w-full flex-col gap-4"
      >
        <label htmlFor={id} className="flex flex-col gap-2 text-left text-sm">
          Vault PIN
          <PinInput
            id={id}
            inputRef={input}
            value={pin}
            readOnly={pending}
            autoFocus={autoFocus}
            onChange={(next) => {
              setPin(next);
              // Tried as soon as it has all its digits, as a phone's lock screen does.
              if (next.length === length) void attempt(next);
            }}
          />
        </label>
        <FormError>{error ?? notice}</FormError>
        <Button type="submit" disabled={pending} className="h-11 rounded-xl">
          {pending ? 'Unlocking…' : 'Unlock'}
        </Button>
        {biometrics}
        <Button type="button" variant="ghost" className="rounded-xl" onClick={onPassword}>
          Use the vault password
        </Button>
      </form>
    </Panel>
  );
}

function Recover({ onBack }: { onBack: () => void }) {
  const codeId = useId();
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const problem = newPasswordProblem(password, confirmation);
    setError(problem);
    if (problem) return;
    setPending(true);
    try {
      if (await recoverVault(code, password, false)) {
        haptics.success();
        void offerBiometricsAgain();
        toast.success('Vault password changed');
      } else {
        haptics.warning();
        setError('That is not this vault’s recovery code.');
      }
    } catch (caught) {
      setError(failure(caught));
    } finally {
      setPending(false);
    }
  }

  return (
    <Panel icon={KeyRound} title="Recover your vault">
      <p className="text-muted-foreground text-sm">
        Enter the recovery code you saved when you set the vault up, and choose a new password.
      </p>
      <form onSubmit={(event) => void submit(event)} className="flex w-full flex-col gap-4">
        <label htmlFor={codeId} className="flex flex-col gap-2 text-left text-sm">
          Recovery code
          <Input
            id={codeId}
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            value={code}
            disabled={pending}
            onChange={(event) => setCode(event.target.value)}
            className="h-11 font-mono"
          />
        </label>
        <PasswordField
          label="New vault password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          disabled={pending}
        />
        <PasswordField
          label="Repeat it"
          value={confirmation}
          onChange={setConfirmation}
          autoComplete="new-password"
          disabled={pending}
        />
        <FormError>{error}</FormError>
        <Button type="submit" disabled={pending} className="h-11 rounded-xl">
          {pending ? 'Recovering…' : 'Unlock and change password'}
        </Button>
        <Button type="button" variant="ghost" className="rounded-xl" onClick={onBack}>
          Back
        </Button>
      </form>
    </Panel>
  );
}

/** The recovery code, shown once after setup. Nothing keeps it but the user. */
export function VaultRecoveryCode({ code, onDone }: { code: string; onDone: () => void }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      toast('Recovery code copied');
    } catch {
      toast.error('Could not copy. Write the code down instead.');
    }
  }

  return (
    <Panel icon={KeyRound} title="Save your recovery code">
      <p className="text-muted-foreground text-sm">
        If you forget the vault password, this code is the only other way in. It is shown once and
        stored nowhere. Without the password or this code, the vault’s notes cannot be read by
        anyone, including you.
      </p>
      <output className="w-full select-all break-words rounded-2xl bg-foreground/[0.06] px-4 py-3 font-mono text-base">
        {code}
      </output>
      <div className="flex w-full flex-col gap-2">
        <Button variant="outline" className="h-11 rounded-xl" onClick={() => void copy()}>
          <Copy aria-hidden />
          Copy
        </Button>
        <Button className="h-11 rounded-xl" onClick={onDone}>
          I have saved it
        </Button>
      </div>
    </Panel>
  );
}
