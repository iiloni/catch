import { Capacitor } from '@capacitor/core';
import {
  type BackupItem,
  type BackupOverview,
  type BackupSchedule,
  backupAccessSchema,
  backupItemSchema,
  backupOverviewSchema,
} from '@catch/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { getAuthToken } from './auth';
import {
  compatibleFetch,
  ensureCompatible,
  observeProtocolResponse,
  protocolHeaders,
} from './compatibility';
import { getServerUrl } from './serverUrl';

/**
 * The server's backups, for its admins (ADR 0012). These are plain requests rather than
 * queued writes: a backup or a restore is something to do now, with the server answering.
 */
export class BackupRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const errorSchema = z.object({ error: z.string() });
const url = (path: string) => `${getServerUrl()}/api/admin/backups${path}`;
const authorization = () => ({ Authorization: `Bearer ${getAuthToken() ?? ''}` });

function failure(status: number, body: string) {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // Not from the API: a proxy's error page.
  }
  const error = errorSchema.safeParse(parsed);
  return new BackupRequestError(
    status,
    error.success ? error.data.error : 'The server did not answer as expected.',
  );
}

async function send(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await compatibleFetch(url(path), {
    method,
    headers: {
      ...authorization(),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw failure(response.status, await response.text());
  return response.json();
}

const name = (backup: string) => `/${encodeURIComponent(backup)}`;

export const serverBackups = {
  overview: async () => backupOverviewSchema.parse(await send('')),
  create: (includeAttachments: boolean) => send('', 'POST', { includeAttachments }),
  saveSchedule: (schedule: BackupSchedule) => send('/schedule', 'PUT', schedule),
  remove: (backup: string) => send(name(backup), 'DELETE'),
  restore: (backup: string) => send(`${name(backup)}/restore`, 'POST'),
  /**
   * Saves a backup through a plain link, so the browser streams it to disk whatever its
   * size. The link carries a short-lived ticket in place of the bearer token.
   */
  download: async (backup: string) => {
    const { access } = backupAccessSchema.parse(await send(`${name(backup)}/access`));
    const href = url(`${name(backup)}/download?access=${encodeURIComponent(access)}`);
    // The Android app hands a link to another origin to the system browser, which downloads it.
    if (Capacitor.isNativePlatform()) {
      window.open(href, '_blank');
      return;
    }
    const link = document.createElement('a');
    link.href = href;
    link.download = backup;
    link.click();
  },
  /** Sends an archive to the server, which checks it and adds it to the list. */
  upload: async (file: Blob, onProgress: (sent: number, total: number) => void) => {
    await ensureCompatible();
    return new Promise<BackupItem>((resolve, reject) => {
      // XMLHttpRequest rather than fetch, which cannot report how much has been sent.
      const request = new XMLHttpRequest();
      request.open('POST', url('/upload'));
      request.setRequestHeader('Authorization', authorization().Authorization);
      request.setRequestHeader('Content-Type', 'application/octet-stream');
      for (const [key, value] of Object.entries(protocolHeaders))
        request.setRequestHeader(key, value);
      request.upload.onprogress = (event) => onProgress(event.loaded, event.total);
      request.onerror = () => reject(new BackupRequestError(0, 'The upload was interrupted.'));
      request.onload = async () => {
        if (request.status === 426) {
          try {
            await observeProtocolResponse(new Response(request.responseText, { status: 426 }));
          } catch (error) {
            reject(error);
          }
          return;
        }
        if (request.status < 200 || request.status >= 300) {
          reject(failure(request.status, request.responseText));
          return;
        }
        try {
          resolve(backupItemSchema.parse(JSON.parse(request.responseText)));
        } catch {
          reject(new BackupRequestError(request.status, 'The server did not answer as expected.'));
        }
      };
      request.send(file);
    });
  },
};

export type ServerBackupsState =
  | { status: 'loading' }
  /** The server could not be reached, or did not answer as expected. */
  | { status: 'unavailable' }
  /** The server is replacing its data and answers nothing else until it is done. */
  | { status: 'restoring' }
  | { status: 'ready'; overview: BackupOverview };

const POLL_MS = 1500;

/**
 * The backups page's view of the server. It polls while a backup or restore runs, and while
 * the server is refusing requests during a restore. `onAccessDenied` runs when the server
 * no longer takes this session for an admin's.
 */
export function useServerBackups(onAccessDenied: () => void) {
  const [state, setState] = useState<ServerBackupsState>({ status: 'loading' });
  const timer = useRef<number | undefined>(undefined);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    window.clearTimeout(timer.current);
    let next: ServerBackupsState;
    let again = false;
    try {
      const overview = await serverBackups.overview();
      next = { status: 'ready', overview };
      again = overview.running !== null;
    } catch (error) {
      const status = error instanceof BackupRequestError ? error.status : 0;
      if (status === 401 || status === 403) {
        if (mounted.current) onAccessDenied();
        return;
      }
      // The server turns everyone away during a restore.
      next = status === 503 ? { status: 'restoring' } : { status: 'unavailable' };
      again = status === 503;
    }
    if (!mounted.current) return;
    setState(next);
    if (again) timer.current = window.setTimeout(() => void refresh(), POLL_MS);
  }, [onAccessDenied]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
      window.clearTimeout(timer.current);
    };
  }, [refresh]);

  /** Shows a restore as under way at once, before the next poll finds the server busy. */
  const expectRestore = useCallback(() => {
    setState({ status: 'restoring' });
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void refresh(), POLL_MS);
  }, [refresh]);

  return { state, refresh, expectRestore };
}
