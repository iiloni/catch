import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  countAttachments,
  countNotes,
  dismissImport,
  importSummary,
  useImport,
} from '@/lib/imports';
import { useSyncStatus } from '@/lib/syncStatus';

/**
 * A settings row that shows work under way: what is happening, a bar, and how far it has
 * come. `total` is null while there is nothing to count yet.
 */
export function ProgressRow({
  label,
  done,
  total,
  action,
  children,
}: {
  label: string;
  done: number;
  total: number | null;
  /** A control beside the label, such as Cancel. */
  action?: ReactNode;
  /** Lines under the bar. */
  children: ReactNode;
}) {
  const percent = total ? Math.floor((done / total) * 100) : 0;
  return (
    <div className="flex flex-col gap-2 px-4 py-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="font-medium">{label}</p>
        {action ??
          (total !== null && (
            <span className="text-muted-foreground text-sm tabular-nums">{percent}%</span>
          ))}
      </div>
      <Progress aria-label={label} value={total === null ? null : percent} />
      <div className="flex flex-col gap-0.5 text-muted-foreground text-sm tabular-nums">
        {children}
      </div>
    </div>
  );
}

const numbers = new Intl.NumberFormat();

/**
 * The import the server is taking, with its progress, or a summary once it is done. It
 * follows the import from anywhere: leaving the page, or closing the app, does not stop it.
 */
export function ImportProgress() {
  const current = useImport();
  const { offline, incompatibility } = useSyncStatus();
  if (!current) return null;

  const failedLine =
    current.failed > 0 ? (
      <p>
        {countNotes(current.failed)} could not be saved. Importing the export again retries them.
      </p>
    ) : null;

  const attachmentFailedLine =
    current.attachmentFailed > 0 ? (
      <p>
        {countAttachments(current.attachmentFailed)} could not be saved. Select the export again to
        retry them.
      </p>
    ) : null;

  if (current.finished) {
    return (
      <div className="flex items-start gap-3 px-4 py-3" role="status">
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-medium text-base">
            {current.saved + current.attachmentSaved > 0
              ? `${importSummary(current)} imported from ${current.source}`
              : `Nothing was imported from ${current.source}`}
          </p>
          <div className="text-muted-foreground">
            {current.saved > 0 && (
              <p>They are in your gallery, and archived ones are in Archive.</p>
            )}
            {current.attachmentSaved > 0 && <p>Attachments are in their notes’ Media sections.</p>}
            {failedLine}
            {attachmentFailedLine}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="-mr-2 size-8 shrink-0 rounded-full"
          aria-label="Dismiss"
          onClick={dismissImport}
        >
          <X />
        </Button>
      </div>
    );
  }

  return (
    <ProgressRow
      label={`Importing from ${current.source}`}
      done={current.saved + current.failed + current.attachmentSaved + current.attachmentFailed}
      total={current.total + current.attachmentTotal}
    >
      <p>
        {numbers.format(current.saved)} of {countNotes(current.total)} saved on your server
      </p>
      {current.attachmentTotal > 0 && (
        <p>
          {numbers.format(current.attachmentSaved)} of {countAttachments(current.attachmentTotal)}{' '}
          saved on your server
        </p>
      )}
      {current.preparing > 0 && (
        <p>
          Preparing {countAttachments(current.preparing)} on this device. Keep the app open until
          preparation finishes.
        </p>
      )}
      {incompatibility ? (
        <p>
          Waiting for {incompatibility === 'client-too-old' ? 'an app' : 'a server'} update.
          Prepared files and notes stay on this device.
        </p>
      ) : offline ? (
        <p>Waiting for a connection. Prepared files and notes sync once it is back.</p>
      ) : (
        <p>You can leave this page; the import keeps going.</p>
      )}
      {failedLine}
      {attachmentFailedLine}
    </ProgressRow>
  );
}
