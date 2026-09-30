import { Lightbulb } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ProgressRow } from '@/components/ImportProgress/ImportProgress';
import { SettingsRow } from '@/components/SettingsSection/SettingsSection';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { haptics } from '@/lib/haptics';
import { countNotes, startImport, useImport } from '@/lib/imports';
import { type KeepExport, KeepImportError, readKeepExport } from '@/lib/keepImport';
import { hasNote } from '@/lib/notes';

// Android's file picker filters by MIME type, the desktop ones by extension.
const ACCEPT = 'application/zip,application/x-zip-compressed,application/json,.zip,.json';

const numbers = new Intl.NumberFormat();

const count = (value: number, one: string, many: string) =>
  `${numbers.format(value)} ${value === 1 ? one : many}`;

/** What the import leaves out, one line each. */
function leftOut(found: KeepExport, alreadyHere: number) {
  const lines: string[] = [];
  if (alreadyHere > 0) {
    lines.push(
      `${count(alreadyHere, 'note is', 'notes are')} already in Catch and stay as they are.`,
    );
  }
  if (found.trashed > 0) {
    lines.push(
      `${count(found.trashed, 'note in Keep’s trash stays', 'notes in Keep’s trash stay')} behind.`,
    );
  }
  if (found.attachments > 0 || found.mediaOnly > 0) {
    lines.push(
      found.mediaOnly > 0
        ? `Images, drawings and recordings stay behind, since Catch cannot store them yet. ${count(found.mediaOnly, 'note', 'notes')} with nothing else will not be imported.`
        : 'Images, drawings and recordings stay behind, since Catch cannot store them yet.',
    );
  }
  if (found.labelled > 0) lines.push('Labels stay behind, since Catch does not have them yet.');
  return lines;
}

/** `total` is null while the archives are still being opened. */
type Reading = { read: number; total: number | null; archive: string };

/**
 * Imports notes from a Google Takeout export of Keep: reads it on this device, says what
 * will come in, and hands the notes to `startImport`, whose progress the page shows. It
 * waits for the user's notes to sync first, to tell which notes are already here.
 */
export function KeepImport({ userId, notesSynced }: { userId: string; notesSynced: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState<Reading | null>(null);
  const [found, setFound] = useState<{ found: KeepExport; fresh: number } | null>(null);
  const controller = useRef<AbortController | null>(null);
  const running = useImport();
  const importing = running !== null && !running.finished;
  const busy = reading !== null || found !== null || importing;

  // Reading needs the files this page was given, so it stops with the page.
  useEffect(() => () => controller.current?.abort(), []);

  async function read(files: File[]) {
    const reader = new AbortController();
    controller.current = reader;
    const archive = files.length === 1 ? (files[0]?.name ?? '') : `${files.length} files`;
    setReading({ read: 0, total: null, archive });
    try {
      const result = await readKeepExport(files, userId, {
        signal: reader.signal,
        onProgress: (read, total) => setReading({ read, total, archive }),
      });
      const fresh = result.notes.filter((note) => !hasNote(note.id)).length;
      if (fresh > 0) setFound({ found: result, fresh });
      else {
        toast('Nothing new to import', {
          description:
            result.notes.length > 0
              ? 'Every note in this export is already in Catch.'
              : 'This export has no notes with text to import.',
        });
      }
    } catch (error) {
      if (reader.signal.aborted) return;
      if (!(error instanceof KeepImportError)) console.error('Google Keep import failed', error);
      toast.error('Could not import from Google Keep', {
        description:
          error instanceof KeepImportError ? error.message : 'The files could not be read.',
      });
    } finally {
      if (controller.current === reader) controller.current = null;
      setReading(null);
    }
  }

  function confirm() {
    if (!found) return;
    startImport('Google Keep', userId, found.found.notes);
    haptics.success();
    setFound(null);
  }

  return (
    <>
      <SettingsRow
        icon={Lightbulb}
        label="Google Keep"
        description={
          notesSynced ? 'From a Google Takeout export' : 'Available once your notes have synced'
        }
      >
        <Button
          variant="secondary"
          size="sm"
          className="rounded-full"
          aria-label="Import from Google Keep"
          disabled={busy || !notesSynced}
          onClick={() => input.current?.click()}
        >
          Import
        </Button>
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          multiple
          hidden
          disabled={busy || !notesSynced}
          aria-label="Google Takeout export"
          onChange={(event) => {
            const files = [...(event.target.files ?? [])];
            // Lets the same file be chosen again, after a failed or cancelled import.
            event.target.value = '';
            if (files.length > 0) void read(files);
          }}
        />
      </SettingsRow>
      {reading && (
        <ProgressRow
          label={`Reading ${reading.archive}`}
          done={reading.read}
          total={reading.total}
          action={
            <Button
              variant="ghost"
              size="sm"
              className="-mr-2 rounded-full"
              onClick={() => controller.current?.abort()}
            >
              Cancel
            </Button>
          }
        >
          <p>
            {reading.total === null
              ? 'Opening the export…'
              : `${numbers.format(reading.read)} of ${count(reading.total, 'file', 'files')} read`}
          </p>
          <p>This happens on this device. Nothing is added until you confirm.</p>
        </ProgressRow>
      )}
      <Dialog open={found !== null} onOpenChange={(open) => !open && setFound(null)}>
        <DialogContent>
          <DialogTitle>Import {countNotes(found?.fresh ?? 0)}?</DialogTitle>
          <DialogDescription>
            They keep their colors, pins, archive and dates, and go after the notes you have, newest
            first. Settings shows how the import is going, and you can leave while it runs.
          </DialogDescription>
          {found && (
            <Details lines={leftOut(found.found, found.found.notes.length - found.fresh)} />
          )}
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="ghost" className="rounded-full">
                Cancel
              </Button>
            </DialogClose>
            <Button className="rounded-full" onClick={confirm}>
              Import
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Details({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-muted-foreground text-sm">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}
