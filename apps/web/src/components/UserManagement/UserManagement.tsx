import {
  type AdminUser,
  adminUserSchema,
  type UserRole,
  type UsersResponse,
  userRoleSchema,
  usersResponseSchema,
} from '@catch/shared';
import { ChevronLeft, ChevronRight, RefreshCw, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { UserActions } from '@/components/UserActions/UserActions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError, api } from '@/lib/api';
import { formatDateTime, formatTime, useHour12 } from '@/lib/clock';
import { haptics } from '@/lib/haptics';

const PAGE_SIZE = 25;

type Props = {
  currentUserId: string;
  onAccessDenied: () => void;
};

export function UserManagement({ currentUserId, onAccessDenied }: Props) {
  const [query, setQuery] = useState({ search: '', offset: 0 });
  const [data, setData] = useState<UsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setData(null);
    setError(null);
    const timer = window.setTimeout(
      async () => {
        try {
          const result = usersResponseSchema.parse(
            await api.listUsers({ ...query, limit: PAGE_SIZE }, controller.signal),
          );
          if (!controller.signal.aborted) setData(result);
        } catch (failure) {
          if (controller.signal.aborted) return;
          if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
            onAccessDenied();
            return;
          }
          setError('Could not load users. Check your connection and try again.');
        } finally {
          if (!controller.signal.aborted) setLoading(false);
        }
      },
      query.search ? 200 : 0,
    );
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, onAccessDenied]);

  async function changeRole(account: AdminUser, role: UserRole) {
    setSaving(account.id);
    setError(null);
    try {
      const updated = adminUserSchema.parse(await api.updateUserRole(account.id, { role }));
      setData(
        (current) =>
          current && {
            ...current,
            users: current.users.map((row) => (row.id === updated.id ? updated : row)),
          },
      );
      haptics.success();
      toast.success(
        `${account.name || account.email} is now ${role === 'admin' ? 'an admin' : 'a user'}`,
      );
    } catch (failure) {
      if (failure instanceof ApiError && (failure.status === 401 || failure.status === 403)) {
        setData(null);
        onAccessDenied();
        return;
      }
      setError('Could not change the role. Refresh the list and try again.');
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="@container flex flex-col gap-6">
      <div className="relative">
        <Search
          className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="Search users"
          placeholder="Search by name or email"
          maxLength={200}
          value={query.search}
          disabled={saving !== null}
          onChange={(event) => setQuery({ search: event.target.value, offset: 0 })}
          className="h-11 rounded-xl pl-10"
        />
      </div>
      {error && (
        <p role="alert" className="px-1 text-destructive text-sm">
          {error}
        </p>
      )}
      {saving && (
        <p role="status" className="px-1 text-muted-foreground text-sm">
          Updating user…
        </p>
      )}
      <SettingsSection
        title="Server accounts"
        description="Manage roles, reset passwords and delete accounts. Manage your own password in Account settings."
      >
        <SettingsRow
          label={data ? `${data.total} ${data.total === 1 ? 'user' : 'users'}` : 'Users'}
          description={query.search ? 'Matching your search' : 'Everyone on this Catch server'}
        >
          <Button
            variant="ghost"
            aria-label="Refresh users"
            disabled={loading || saving !== null}
            onClick={() => setQuery((current) => ({ ...current }))}
            className="size-11 rounded-full p-0"
          >
            <RefreshCw className="size-4" aria-hidden />
          </Button>
        </SettingsRow>
        {loading ? (
          <p role="status" className="px-4 py-8 text-center text-muted-foreground text-sm">
            Loading users…
          </p>
        ) : data ? (
          data.users.length > 0 ? (
            <table aria-label="Users" className="w-full table-fixed text-left text-sm">
              <thead className="border-b border-foreground/[0.06] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Name
                  </th>
                  <th scope="col" className="hidden w-[28%] px-4 py-3 font-medium @2xl:table-cell">
                    Email
                  </th>
                  <th scope="col" className="w-28 px-3 py-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="hidden w-24 px-3 py-3 font-medium @lg:table-cell">
                    Joined
                  </th>
                  <th scope="col" className="hidden w-28 px-3 py-3 font-medium @md:table-cell">
                    Last login
                  </th>
                  <th scope="col" className="w-14 px-1 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-foreground/[0.06]">
                {data.users.map((account) => {
                  const self = account.id === currentUserId;
                  return (
                    <tr key={account.id}>
                      <td className="px-4 py-3 [overflow-wrap:anywhere]">
                        <span className="font-medium">{account.name || 'Unnamed user'}</span>
                        {self && <span className="ml-2 text-muted-foreground text-xs">You</span>}
                        <span className="mt-0.5 block text-muted-foreground text-xs @2xl:hidden">
                          {account.email}
                        </span>
                        <span className="mt-1 block text-muted-foreground text-xs @md:hidden">
                          Last login: <LastLogin value={account.lastLoginAt} />
                        </span>
                      </td>
                      <td className="hidden px-4 py-3 text-muted-foreground [overflow-wrap:anywhere] @2xl:table-cell">
                        {account.email}
                      </td>
                      <td className="px-3 py-3">
                        <select
                          aria-label={`Role for ${account.email}`}
                          value={account.role}
                          disabled={self || saving !== null}
                          title={self ? 'You cannot change your own role' : undefined}
                          onChange={(event) => {
                            const role = userRoleSchema.parse(event.target.value);
                            haptics.selection();
                            void changeRole(account, role);
                          }}
                          className="h-11 w-full rounded-lg border border-input bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:opacity-50"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td className="hidden px-3 py-3 text-muted-foreground text-xs @lg:table-cell">
                        <time
                          dateTime={account.createdAt}
                          title={formatDateTime(new Date(account.createdAt))}
                        >
                          {new Date(account.createdAt).toLocaleDateString(undefined, {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })}
                        </time>
                      </td>
                      <td className="hidden px-3 py-3 text-muted-foreground text-xs @md:table-cell">
                        <LastLogin value={account.lastLoginAt} />
                      </td>
                      <td className="px-1 py-3">
                        <UserActions
                          user={account}
                          self={self}
                          disabled={saving !== null}
                          onPendingChange={(pending) => setSaving(pending ? account.id : null)}
                          onAccessDenied={onAccessDenied}
                          onDeleted={() =>
                            setQuery((current) => ({
                              ...current,
                              offset:
                                data.users.length === 1
                                  ? Math.max(0, current.offset - PAGE_SIZE)
                                  : current.offset,
                            }))
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <p role="status" className="px-4 py-8 text-center text-muted-foreground text-sm">
              {query.search
                ? 'No users match this search.'
                : 'No users on this page. Go back or refresh the list.'}
            </p>
          )
        ) : (
          <p className="px-4 py-6 text-center text-muted-foreground text-sm">
            Refresh to try again.
          </p>
        )}
      </SettingsSection>
      {data && (data.total > PAGE_SIZE || query.offset > 0) && (
        <nav aria-label="Users pagination" className="flex items-center justify-between gap-2 px-1">
          <Button
            variant="ghost"
            disabled={query.offset === 0 || saving !== null}
            onClick={() =>
              setQuery((current) => ({
                ...current,
                offset: Math.max(0, current.offset - PAGE_SIZE),
              }))
            }
            className="h-11 rounded-full"
          >
            <ChevronLeft aria-hidden />
            Previous
          </Button>
          <span className="text-muted-foreground text-xs">
            Page {Math.floor(query.offset / PAGE_SIZE) + 1} of{' '}
            {Math.max(1, Math.ceil(data.total / PAGE_SIZE))}
          </span>
          <Button
            variant="ghost"
            disabled={query.offset + PAGE_SIZE >= data.total || saving !== null}
            onClick={() =>
              setQuery((current) => ({ ...current, offset: current.offset + PAGE_SIZE }))
            }
            className="h-11 rounded-full"
          >
            Next
            <ChevronRight aria-hidden />
          </Button>
        </nav>
      )}
    </div>
  );
}

function LastLogin({ value }: { value: AdminUser['lastLoginAt'] }) {
  // Redraws the time below when the clock setting changes.
  useHour12();
  if (!value) return <span title="No recorded login">—</span>;
  const date = new Date(value);
  return (
    <time dateTime={value} title={formatDateTime(date)}>
      {date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}{' '}
      <span className="@md:block">{formatTime(date)}</span>
    </time>
  );
}
