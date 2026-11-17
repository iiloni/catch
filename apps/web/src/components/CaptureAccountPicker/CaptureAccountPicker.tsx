import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  AccountAvatar,
  AccountOption,
  accountLabel,
} from '@/components/AccountSummary/AccountSummary';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { getAccounts, getSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';

/**
 * Which account a capture saves to, when several are signed in. The bookmarklet's window
 * starts as the account last used on the device (ADR 0019), which need not be the one the
 * user means. Choosing another loads the window again as it, so `onSwitch` must carry the draft.
 */
export function CaptureAccountPicker({
  disabled,
  onSwitch,
}: {
  disabled?: boolean;
  onSwitch: (userId: string) => void;
}) {
  const [accounts, setAccounts] = useState(getAccounts);
  useEffect(() => {
    // Another tab may add an account or sign one out.
    const refresh = (event: StorageEvent) => {
      if (event.storageArea === localStorage) setAccounts(getAccounts());
    };
    window.addEventListener('storage', refresh);
    return () => window.removeEventListener('storage', refresh);
  }, []);
  const [open, setOpen] = useState(false);
  const user = getSignedInUser();
  const current = accounts.find((account) => account.user.id === user?.id);
  if (!current || accounts.length < 2) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Account: ${accountLabel(current)}`}
          aria-description="Choose the account this link is saved to"
          className="flex h-11 min-w-0 max-w-full items-center gap-2 self-center rounded-full bg-foreground/[0.05] pr-3 pl-1.5 outline-none hover:bg-foreground/[0.08] focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <AccountAvatar {...current.user} />
          <span className="truncate font-medium text-sm">{accountLabel(current)}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="center" sideOffset={8} className="w-80 max-w-[calc(100vw-2rem)] p-2">
        <ul aria-label="Accounts" className="flex flex-col gap-1">
          {accounts.map((account) => {
            const active = account === current;
            return (
              <li key={account.user.id} className="flex">
                <AccountOption
                  account={account}
                  active={active}
                  onClick={() => {
                    setOpen(false);
                    if (active) return;
                    haptics.success();
                    onSwitch(account.user.id);
                  }}
                />
              </li>
            );
          })}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
