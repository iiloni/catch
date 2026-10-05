import { Link } from '@tanstack/react-router';
import { Check, LogOut, Plus } from 'lucide-react';
import { animate, motion, useMotionValue } from 'motion/react';
import { type PointerEvent, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AccountAvatar } from '@/components/AccountSummary/AccountSummary';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { signOutAccount, switchAccount, unsyncedChanges } from '@/lib/accounts';
import { type Account, getAccounts, getSignedInUser } from '@/lib/auth';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { isUpdateReloadBlocked } from '@/lib/useUpdateReloadBlocked';

/** The avatar's width: how far a swipe carries it before the next account has replaced it. */
const TRAVEL = 32;
/** A press that moves less than this is still a tap. */
const SLOP = 6;

const label = ({ user }: Account) => user.name || user.email;

/** Switching reloads the page, which would drop a note or composer that is still open. */
function switchTo(account: Account) {
  if (isUpdateReloadBlocked()) {
    toast('Close the open note before switching accounts.');
    return false;
  }
  haptics.success();
  switchAccount(account.user.id);
  return true;
}

type Swipe = { axis: 'x' | 'y'; target: Account | null; from: 1 | -1 };

/**
 * The avatar in the Gallery header (ADR 0019). A swipe across it, in any direction, changes
 * to the next or previous account signed in on this device; a tap opens the list of them,
 * where accounts are added and signed out.
 */
export function AccountSwitcher() {
  const [accounts, setAccounts] = useState(getAccounts);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<{ account: Account; pending: number } | null>(null);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [swipe, setSwipe] = useState<Swipe | null>(null);
  const offset = useMotionValue(0);
  const press = useRef<{ id: number; x: number; y: number; committed: boolean } | null>(null);
  const swiped = useRef(false);

  const user = getSignedInUser();
  const index = accounts.findIndex((account) => account.user.id === user?.id);
  const current = accounts[index];
  if (!current) return null;

  /** The account a swipe leads to: forwards for up or left, back for down or right. */
  const neighbor = (step: 1 | -1) =>
    accounts.length > 1
      ? (accounts[(index + step + accounts.length) % accounts.length] ?? null)
      : null;

  function onPointerDown(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    swiped.current = false;
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, committed: false };
  }

  function onPointerMove(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (!start || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    let axis = swipe?.axis;
    if (!axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < SLOP) return;
      axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      swiped.current = true;
      // The swipe may leave the button, which is only as large as a fingertip.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const delta = axis === 'x' ? dx : dy;
    const from = delta < 0 ? 1 : -1;
    const target = neighbor(from);
    if (swipe?.axis !== axis || swipe.from !== from) setSwipe({ axis, target, from });
    // With nobody to switch to, the avatar gives a little and no more.
    offset.set(
      target ? Math.max(-TRAVEL, Math.min(TRAVEL, delta)) : delta / (1 + Math.abs(delta) / 6),
    );
    const committed = Boolean(target) && Math.abs(delta) >= TRAVEL / 2;
    if (committed !== start.committed) haptics.threshold();
    start.committed = committed;
  }

  function onPointerEnd(event: PointerEvent<HTMLButtonElement>) {
    const start = press.current;
    if (!start || event.pointerId !== start.id) return;
    press.current = null;
    if (!swipe) return;
    const target = event.type === 'pointerup' && start.committed ? swipe.target : null;
    if (target && switchTo(target)) {
      // The page is about to load again as the other account; its avatar stays in place.
      animate(offset, -swipe.from * TRAVEL, springs.snappy);
      return;
    }
    void animate(offset, 0, springs.snappy).then(() => setSwipe(null));
  }

  async function signOut(account: Account, confirmed = false) {
    if (!confirmed) {
      const pending = await unsyncedChanges(account);
      if (pending > 0) {
        setConfirming({ account, pending });
        return;
      }
    }
    setConfirming(null);
    setLeaving(account.user.id);
    try {
      // Signing out the account in use loads the page again; any other just leaves the list.
      await signOutAccount(account);
      setAccounts(getAccounts());
    } finally {
      setLeaving(null);
    }
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirming(null);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Account: ${label(current)}`}
          aria-description={accounts.length > 1 ? 'Swipe to switch accounts' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClick={(event) => {
            // Radix leaves the popover alone when the click that ends a swipe is cancelled.
            if (swiped.current) event.preventDefault();
            swiped.current = false;
          }}
          className="flex size-10 touch-none select-none items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          <span className="relative block size-8 overflow-hidden rounded-full">
            <motion.span
              className="absolute inset-0"
              style={swipe?.axis === 'x' ? { x: offset } : { y: offset }}
            >
              <AccountAvatar {...current.user} />
              {swipe?.target && (
                <AccountAvatar
                  {...swipe.target.user}
                  className="absolute"
                  // It follows the avatar from the side the swipe is pulling away from.
                  style={
                    swipe.axis === 'x'
                      ? { top: 0, left: swipe.from * TRAVEL }
                      : { left: 0, top: swipe.from * TRAVEL }
                  }
                />
              )}
            </motion.span>
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={12} className="flex w-72 flex-col gap-1 p-2">
        {confirming ? (
          <div className="flex flex-col gap-3 p-2">
            <p className="font-semibold">Sign out {label(confirming.account)}?</p>
            <p className="text-muted-foreground text-sm">
              {confirming.pending === 1
                ? 'A change on this device has not synced yet. Signing out deletes it.'
                : `${confirming.pending} changes on this device have not synced yet. Signing out deletes them.`}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" className="rounded-full" onClick={() => setConfirming(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="rounded-full"
                onClick={() => signOut(confirming.account, true)}
              >
                Sign out
              </Button>
            </div>
          </div>
        ) : (
          <>
            <ul aria-label="Accounts" className="flex flex-col gap-1">
              {accounts.map((account) => {
                const active = account === current;
                return (
                  <li key={account.user.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      aria-current={active ? 'true' : undefined}
                      disabled={leaving !== null}
                      onClick={() => (active ? setOpen(false) : switchTo(account))}
                      className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-2 text-left outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
                    >
                      <AccountAvatar {...account.user} className="size-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{label(account)}</span>
                        {account.user.name && (
                          <span className="block truncate text-muted-foreground text-sm">
                            {account.user.email}
                          </span>
                        )}
                      </span>
                      {active && <Check className="size-4 shrink-0" aria-hidden />}
                    </button>
                    <button
                      type="button"
                      aria-label={`Sign out ${account.user.email}`}
                      title="Sign out"
                      disabled={leaving !== null}
                      onClick={() => signOut(account)}
                      className="flex size-10 shrink-0 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-foreground/[0.06] hover:text-destructive focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
                    >
                      <LogOut className="size-4" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
            <Link
              to="/login"
              className="flex items-center gap-3 rounded-xl p-2 font-medium outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-foreground/[0.06]">
                <Plus className="size-5" aria-hidden />
              </span>
              Add account
            </Link>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
