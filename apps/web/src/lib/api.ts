import type {
  AttachmentAccess,
  CreateAttachment,
  CreateBoardColumn,
  CreateNote,
  CreateNotes,
  RefreshLinkPreview,
  TxidResponse,
  UpdateAttachment,
  UpdateBoardColumn,
  UpdateNote,
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
