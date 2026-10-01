import type {
  AdminUser,
  AttachmentAccess,
  CreateAttachment,
  CreateBoardColumn,
  CreateNote,
  CreateNotes,
  ListUsers,
  RefreshLinkPreview,
  ReleasesResponse,
  ResetUserPasswordResponse,
  TxidResponse,
  UpdateAttachment,
  UpdateBoardColumn,
  UpdateNote,
  UpdateUserRole,
  UserActionResponse,
  UsersResponse,
  VersionInfo,
} from '@catch/shared';
import { getAuthToken } from './auth';
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
  const response = await fetch(`${getServerUrl()}/api${path}`, {
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
};
