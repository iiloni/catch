import type {
  AdminUser,
  AttachmentAccess,
  CreateAttachment,
  CreateBoardColumn,
  CreateInvite,
  CreateInviteResponse,
  CreateNote,
  CreateNotes,
  CreateTag,
  InvitesResponse,
  LinkIntake,
  ListUsers,
  RefreshLinkPreview,
  ReleasesResponse,
  ResetUserPasswordResponse,
  TxidResponse,
  UpdateAttachment,
  UpdateBoardColumn,
  UpdateNote,
  UpdateNoteTags,
  UpdateTag,
  UpdateUserRole,
  UserActionResponse,
  UsersResponse,
  VersionInfo,
} from '@catch/shared';
import { getAuthToken } from './auth';
import { compatibleFetch } from './compatibility';
import { getServerUrl } from './serverUrl';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit): Promise<T> {
  const token = getAuthToken();
  const fetcher = path === '/updates' || path === '/updates/releases' ? fetch : compatibleFetch;
  const response = await fetcher(`${getServerUrl()}/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) throw new ApiError(response.status, await response.text());
  return response.json() as Promise<T>;
}

export const api = {
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
