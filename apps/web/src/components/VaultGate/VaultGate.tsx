import { Copy, KeyRound, LockKeyhole, ShieldCheck } from 'lucide-react';
import { type FormEvent, type ReactNode, useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { haptics } from '@/lib/haptics';
import { useSyncStatus } from '@/lib/syncStatus';
import { createVault, recoverVault, unlockVault, type VaultStatus } from '@/lib/vault';

/** The shortest vault password. It is all that stands between the server and the notes. */
export const MIN_VAULT_PASSWORD = 8;

type Props = {
  status: Exclude<VaultStatus, 'unlocked'>;
  /** A vault was just made: its recovery code, which must be shown now or never. */
  onCreated: (recoveryCode: string) => void;
};

/** What stands in front of the vault's notes: setting it up, or unlocking it. */
export function VaultGate({ status, onCreated }: Props) {
  const [recovering, setRecovering] = useState(false);
  const { offline } = useSyncStatus();

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
  return <Unlock onForgot={() => setRecovering(true)} />;
}

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
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex flex-col gap-2 text-left text-sm">
      {label}
      <Input
        id={id}
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

function Unlock({ onForgot }: { onForgot: () => void }) {
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
      if (await unlockVault(password, remember)) haptics.success();
      else {
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
          autoFocus
        />
        <RememberSwitch checked={remember} onChange={setRemember} disabled={pending} />
        <FormError>{error}</FormError>
        <Button type="submit" disabled={pending} className="h-11 rounded-xl">
          {pending ? 'Unlocking…' : 'Unlock'}
        </Button>
        <Button type="button" variant="ghost" className="rounded-xl" onClick={onForgot}>
          Use the recovery code
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
