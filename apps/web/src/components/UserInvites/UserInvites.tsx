import {
  createInviteResponseSchema,
  INVITE_DAYS,
  type Invite,
  inviteLink,
  invitesResponseSchema,
} from '@catch/shared';
import { Copy, X } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { haptics } from '@/lib/haptics';
import { getServerUrl } from '@/lib/serverUrl';

type Props = { onAccessDenied: () => void };

const day = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

function status(invite: Invite, now: number) {
  if (invite.usedAt) {
    return `Used ${day(invite.usedAt)}${invite.usedBy ? ` by ${invite.usedBy.email}` : ''}`;
  }
  return new Date(invite.expiresAt).getTime() <= now
    ? `Expired ${day(invite.expiresAt)}`
    : `Waiting, until ${day(invite.expiresAt)}`;
}

/** Links that each let one person make an account while sign-up is closed (ADR 0015). */
export function UserInvites({ onAccessDenied }: Props) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [label, setLabel] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  // An invite that runs out while the page is open should stop reading as waiting.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const fail = useCallback(
    (failure: unknown, message: string) => {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        onAccessDenied();
        return;
      }
      setError(message);
    },
    [onAccessDenied],
  );

  const load = useCallback(async () => {
    try {
      setInvites(invitesResponseSchema.parse(await api.listInvites()).invites);
    } catch (failure) {
      // A server from before invites has no such route, and nothing here would work.
      if (failure instanceof ApiError && failure.status === 404) {
        setUnsupported(true);
        return;
      }
      fail(failure, 'Could not load invites. Check your connection and try again.');
    }
  }, [fail]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const made = createInviteResponseSchema.parse(await api.createInvite({ label }));
      setInvites((current) => [made.invite, ...(current ?? [])]);
      setLabel('');
      setCopied(false);
      setLink(inviteLink(getServerUrl(), made.token));
      haptics.success();
    } catch (failure) {
      fail(
        failure,
        failure instanceof ApiError && failure.status === 409
          ? 'There are too many unused invites. Remove some before making more.'
          : 'Could not make the invite. Try again.',
      );
    } finally {
      setPending(false);
    }
  }

  async function remove(invite: Invite) {
    setError(null);
    try {
      await api.deleteInvite(invite.id);
      setInvites((current) => current?.filter((row) => row.id !== invite.id) ?? null);
      haptics.selection();
    } catch (failure) {
      fail(failure, 'Could not remove the invite. Try again.');
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      haptics.selection();
    } catch {
      setError('Could not copy. Select the link and copy it manually.');
    }
  }

  if (unsupported) return null;
  return (
    <>
      <SettingsSection
        title="Invites"
        description={`Each link lets one person make an account, for ${INVITE_DAYS} days. Sign-up stays closed to everyone else.`}
      >
        <form onSubmit={create} className="flex flex-wrap items-center gap-2 px-4 py-3">
          <Input
            aria-label="Who the invite is for"
            placeholder="Who is it for? (optional)"
            maxLength={100}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="h-11 min-w-40 flex-1 rounded-xl"
          />
          {/* Until the list has loaded, its answer would replace an invite made meanwhile. */}
          <Button
            type="submit"
            disabled={pending || invites === null}
            className="h-11 rounded-full"
          >
            Create invite
          </Button>
        </form>
        {invites?.map((invite) => (
          <SettingsRow
            key={invite.id}
            label={invite.label || 'Invite'}
            description={status(invite, now)}
          >
            <Button
              variant="ghost"
              aria-label={`Remove invite${invite.label ? ` for ${invite.label}` : ''}`}
              onClick={() => void remove(invite)}
              className="size-11 rounded-full p-0"
            >
              <X className="size-4" aria-hidden />
            </Button>
          </SettingsRow>
        ))}
      </SettingsSection>
      {error && !link && (
        <p role="alert" className="px-1 text-destructive text-sm">
          {error}
        </p>
      )}
      <Dialog open={link !== null} onOpenChange={(open) => !open && setLink(null)}>
        <DialogContent>
          <DialogTitle>Invite link</DialogTitle>
          <DialogDescription>
            Send this link to the person you are inviting. It makes one account and works for{' '}
            {INVITE_DAYS} days. It will disappear when you close this dialog.
          </DialogDescription>
          <Input
            aria-label="Invite link"
            value={link ?? ''}
            readOnly
            autoComplete="off"
            className="h-11 font-mono"
            onFocus={(event) => event.target.select()}
          />
          {error && (
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => void copy()} className="h-11 rounded-full">
              <Copy aria-hidden />
              {copied ? 'Copied' : 'Copy link'}
            </Button>
            <Button
              onClick={() => {
                setLink(null);
                setError(null);
              }}
              className="h-11 rounded-full"
            >
              Done
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
