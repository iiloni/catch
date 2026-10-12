import type {
  AcceptShare,
  AcceptShareResponse,
  AdminUser,
  AttachmentAccess,
  CreateAttachment,
  CreateBoardColumn,
  CreateInvite,
  CreateInviteResponse,
  CreateNote,
  CreateNoteShare,
  CreateNotes,
  CreateTag,
  CreateVaultNote,
  HistoryArchive,
  HistoryCapture,
  HistoryCaptureResult,
  HistoryClear,
  HistoryClearResult,
  HistoryList,
  HistoryRestore,
  HistoryRestoreContext,
  HistoryRestoreResult,
  InvitesResponse,
  LinkIntake,
  ListUsers,
  PushKey,
  PushSubscriptionInput,
  RefreshLinkPreview,
  ReleasesResponse,
  ReminderSettings,
  ReportTimeZone,
  ResetUserPasswordResponse,
  SaveReminder,
  SaveReminderSettings,
  SaveVault,
  SharedNoteView,
  TestPushResponse,
  TxidResponse,
  UpdateAttachment,
  UpdateBoardColumn,
  UpdateNote,
  UpdateNoteTags,
  UpdateSharedNote,
  UpdateTag,
  UpdateUserRole,
  UpdateVaultNote,
  UserActionResponse,
  UsersResponse,
  VersionInfo,
} from '@catch/shared';
import { getAuthToken } from './auth';
import { compatibleFetch, compatibleFetchAsOther } from './compatibility';
import { getServerUrl } from './serverUrl';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** `as` sends the request for another account signed in on this device, with its token. */
// A launch registers the browser for each account in turn; one that never answers must not
// hold up the rest, or a sign-out waiting behind it.
const PUSH_TIMEOUT = 15_000;

async function request<T>(path: string, init: RequestInit & { as?: string }): Promise<T> {
  const { as, ...options } = init;
  const own = getAuthToken();
  const token = as ?? own;
  const fetcher =
    path === '/updates' || path === '/updates/releases'
      ? fetch
      : as !== undefined && as !== own
        ? compatibleFetchAsOther
        : compatibleFetch;
  const response = await fetcher(`${getServerUrl()}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}

export const api = {
  history: (id: string, cursor?: number, signal?: AbortSignal) =>
    request<HistoryList>(`/note-history/${id}${cursor ? `?cursor=${cursor}` : ''}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    }),
  historyVersion: (id: string, versionId: string, signal?: AbortSignal) =>
    request<HistoryArchive>(`/note-history/${id}/versions/${versionId}`, {
      method: 'GET',
      cache: 'no-store',
      signal,
    }),
  captureHistory: (id: string, body: HistoryCapture) =>
    request<HistoryCaptureResult>(`/note-history/${id}/captures`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  clearHistory: (id: string, body: HistoryClear) =>
    request<HistoryClearResult>(`/note-history/${id}/clear`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    }),
  historyRestoreContext: (id: string) =>
    request<HistoryRestoreContext>(`/note-history/${id}/restore-context`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    }),
  restoreHistory: (id: string, body: HistoryRestore) =>
    request<HistoryRestoreResult>(`/note-history/${id}/restore`, {
      method: 'POST',
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    }),
  historyRestoreReceipt: (id: string, operationId: string) =>
    request<HistoryRestoreResult>(`/note-history/${id}/restores/${operationId}`, {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    }),
  createTag: (body: CreateTag) =>
    request<TxidResponse>('/tags', { method: 'POST', body: JSON.stringify(body) }),
  updateTag: (id: string, body: UpdateTag) =>
    request<TxidResponse>(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTag: (id: string) => request<TxidResponse>(`/tags/${id}`, { method: 'DELETE' }),
  updateNoteTags: (id: string, body: UpdateNoteTags) =>
    request<TxidResponse>(`/note-tags/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  versionInfo: () =>
    request<VersionInfo>('/updates', {
      method: 'GET',
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    }),
  releases: () =>
    request<ReleasesResponse>('/updates/releases', {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    }),
  resetUserPassword: (id: string) =>
    request<ResetUserPasswordResponse>(`/admin/users/${encodeURIComponent(id)}/reset-password`, {
      method: 'POST',
    }),
  deleteUser: (id: string) =>
    request<UserActionResponse>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listUsers: (query: ListUsers, signal?: AbortSignal) =>
    request<UsersResponse>(
      `/admin/users?${new URLSearchParams({ search: query.search, offset: String(query.offset), limit: String(query.limit) })}`,
      { method: 'GET', signal },
    ),
  updateUserRole: (id: string, body: UpdateUserRole) =>
    request<AdminUser>(`/admin/users/${encodeURIComponent(id)}/role`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  listInvites: () => request<InvitesResponse>('/admin/invites', { method: 'GET' }),
  createInvite: (body: CreateInvite) =>
    request<CreateInviteResponse>('/admin/invites', { method: 'POST', body: JSON.stringify(body) }),
  deleteInvite: (id: string) =>
    request<UserActionResponse>(`/admin/invites/${id}`, { method: 'DELETE' }),
  createAttachment: (body: CreateAttachment) =>
    request<TxidResponse>('/attachments', { method: 'POST', body: JSON.stringify(body) }),
  uploadAttachment: (id: string, blob: Blob) =>
    request<TxidResponse>(`/attachments/${id}/content`, {
      method: 'PUT',
      body: blob,
      headers: { 'Content-Type': 'application/octet-stream' },
    }),
  updateAttachment: (id: string, body: UpdateAttachment) =>
    request<TxidResponse>(`/attachments/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  attachmentAccess: (id: string) =>
    request<AttachmentAccess>(`/attachments/${id}/access`, { method: 'GET' }),
  createNote: (body: CreateNote) =>
    request<TxidResponse>('/notes', { method: 'POST', body: JSON.stringify(body) }),
  createNotes: (body: CreateNotes) =>
    request<TxidResponse>('/notes/batch', { method: 'POST', body: JSON.stringify(body) }),
  updateNote: (id: string, body: UpdateNote) =>
    request<TxidResponse>(`/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteNote: (id: string) => request<TxidResponse>(`/notes/${id}`, { method: 'DELETE' }),
  createBoardColumn: (body: CreateBoardColumn) =>
    request<TxidResponse>('/board-columns', { method: 'POST', body: JSON.stringify(body) }),
  updateBoardColumn: (id: string, body: UpdateBoardColumn) =>
    request<TxidResponse>(`/board-columns/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteBoardColumn: (id: string) =>
    request<TxidResponse>(`/board-columns/${id}`, { method: 'DELETE' }),
  createVault: (body: SaveVault) =>
    request<TxidResponse>('/vault', { method: 'POST', body: JSON.stringify(body) }),
  saveVault: (body: SaveVault) =>
    request<TxidResponse>('/vault', { method: 'PUT', body: JSON.stringify(body) }),
  deleteVault: () => request<TxidResponse>('/vault', { method: 'DELETE' }),
  createVaultNote: (body: CreateVaultNote) =>
    request<TxidResponse>('/vault/notes', { method: 'POST', body: JSON.stringify(body) }),
  updateVaultNote: (id: string, body: UpdateVaultNote) =>
    request<TxidResponse>(`/vault/notes/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteVaultNote: (id: string) =>
    request<TxidResponse>(`/vault/notes/${id}`, { method: 'DELETE' }),
  saveReminder: (noteId: string, body: SaveReminder) =>
    request<TxidResponse>(`/reminders/${noteId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteReminder: (noteId: string) =>
    request<TxidResponse>(`/reminders/${noteId}`, { method: 'DELETE' }),
  createNoteShare: (noteId: string, body: CreateNoteShare) =>
    request<TxidResponse>(`/note-shares/${noteId}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteNoteShare: (noteId: string) =>
    request<TxidResponse>(`/note-shares/${noteId}`, { method: 'DELETE' }),
  updateSharedNote: (noteId: string, body: UpdateSharedNote) =>
    request<TxidResponse>(`/shared-notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
  deleteSharedNote: (noteId: string) =>
    request<TxidResponse>(`/shared-notes/${noteId}`, { method: 'DELETE' }),
  // What a share link shows. It needs no account, and says what the reader may do if they have one.
  sharedNote: (token: string, signal?: AbortSignal) =>
    request<SharedNoteView>(`/shares/${token}`, { method: 'GET', cache: 'no-store', signal }),
  acceptShare: (token: string, body: AcceptShare = {}) =>
    request<AcceptShareResponse>(`/shares/${token}/accept`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  reportTimeZone: (body: ReportTimeZone) =>
    request<{ timeZone: string }>('/reminders/time-zone', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  reminderSettings: () => request<ReminderSettings>('/reminders/settings', { method: 'GET' }),
  saveReminderSettings: (body: SaveReminderSettings) =>
    request<{ ok: true }>('/reminders/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  pushKey: () =>
    request<PushKey>('/push/key', { method: 'GET', signal: AbortSignal.timeout(PUSH_TIMEOUT) }),
  // A browser rings for every account signed in on it, so these name whose token to send
  // rather than always acting for the account in use.
  savePushSubscription: (body: PushSubscriptionInput, token: string) =>
    request<{ ok: true }>('/push/subscriptions', {
      method: 'POST',
      as: token,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(PUSH_TIMEOUT),
    }),
  deletePushSubscription: (endpoint: string, token: string, signal?: AbortSignal) =>
    request<{ ok: true }>('/push/subscriptions', {
      method: 'DELETE',
      as: token,
      body: JSON.stringify({ endpoint }),
      signal: signal ?? AbortSignal.timeout(PUSH_TIMEOUT),
    }),
  testPush: (endpoint: string) =>
    request<TestPushResponse>('/push/test', { method: 'POST', body: JSON.stringify({ endpoint }) }),
  refreshLinkPreview: (body: RefreshLinkPreview) =>
    request<TxidResponse>('/link-previews/refresh', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  linkIntake: (body: RefreshLinkPreview, signal?: AbortSignal) =>
    request<LinkIntake>('/link-previews/intake', {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    }),
};
