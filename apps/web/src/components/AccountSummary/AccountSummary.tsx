import { Check } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { Account } from '@/lib/auth';
import { cn } from '@/lib/utils';

export function initials(name: string, email: string) {
  const source = name.trim() || email;
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

/** A hue that stays with an account, so the accounts on one device can be told apart. */
export function accountHue(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index++) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash % 360;
}

type AvatarProps = {
  id: string;
  name: string;
  email: string;
  className?: string;
  style?: CSSProperties;
};

/** An account's initials on its own color. */
export function AccountAvatar({ id, name, email, className, style }: AvatarProps) {
  return (
    <span
      aria-hidden
      style={{ '--avatar-hue': accountHue(id), ...style } as CSSProperties}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full bg-[oklch(0.86_0.11_var(--avatar-hue))] font-semibold text-[oklch(0.32_0.08_var(--avatar-hue))] text-sm',
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}

export const accountLabel = ({ user }: Account) => user.name || user.email;

/** An account to choose from a list of them: its avatar, name and email. */
export function AccountOption({
  account,
  active,
  disabled,
  onClick,
}: {
  account: Account;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      disabled={disabled}
      onClick={onClick}
      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <AccountAvatar {...account.user} className="size-9" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{accountLabel(account)}</span>
        {account.user.name && (
          <span className="block truncate text-muted-foreground text-sm">{account.user.email}</span>
        )}
      </span>
      {active && <Check className="size-4 shrink-0" aria-hidden />}
    </button>
  );
}

type Props = { id: string; name: string; email: string };

/** The signed-in user's avatar, name and email. */
export function AccountSummary({ id, name, email }: Props) {
  return (
    <div className="flex items-center gap-3 p-4">
      <AccountAvatar id={id} name={name} email={email} className="size-12 text-lg" />
      <div className="min-w-0">
        <p className="truncate font-medium">{name || email}</p>
        {name && <p className="truncate text-muted-foreground text-sm">{email}</p>}
      </div>
    </div>
  );
}
