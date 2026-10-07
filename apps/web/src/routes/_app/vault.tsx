import { createFileRoute } from '@tanstack/react-router';
import { LockKeyhole, TriangleAlert } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { EmptyState } from '@/components/EmptyState/EmptyState';
import { NoteGrid } from '@/components/NoteGrid/NoteGrid';
import { BackToGallery, TabPageHeader } from '@/components/PageHeader/PageHeader';
import { VaultGate, VaultRecoveryCode } from '@/components/VaultGate/VaultGate';
import { VaultMenu } from '@/components/VaultMenu/VaultMenu';
import { useOpenNote } from '@/lib/openNote';
import { sortNotes } from '@/lib/sortNotes';
import { PAGE_MAX, usePageGutterShift } from '@/lib/splitView';
import { useVault, vaultNotes, vaultUnreadable } from '@/lib/vault';

export const Route = createFileRoute('/_app/vault')({
  component: VaultPage,
});

/**
 * The vault (ADR 0020): notes encrypted on the device. Locked, the page is only the form
 * that unlocks it; the dock's compose button adds a note here while it is unlocked.
 */
function VaultPage() {
  const { open } = useOpenNote();
  const status = useVault();
  const notes = vaultNotes.use();
  const unreadable = vaultUnreadable.use();
  // Held here because creating the vault unlocks it, which would otherwise show the notes.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const gutterShift = usePageGutterShift(PAGE_MAX);
  const unlocked = status === 'unlocked' && recoveryCode === null;
  const sorted = sortNotes(notes);
  const pinned = sorted.filter((note) => note.isPinned);
  const others = sorted.filter((note) => !note.isPinned);

  return (
    <>
      <TabPageHeader
        title="Vault"
        leading={<BackToGallery />}
        trailing={unlocked && <VaultMenu noteCount={notes.length} />}
      />
      <motion.section
        aria-label="Vault"
        style={{ x: gutterShift }}
        className="mx-auto flex max-w-7xl flex-col gap-5 px-3 pt-3 sm:px-6"
      >
        {recoveryCode !== null ? (
          <VaultRecoveryCode code={recoveryCode} onDone={() => setRecoveryCode(null)} />
        ) : status !== 'unlocked' ? (
          <VaultGate status={status} onCreated={setRecoveryCode} />
        ) : (
          <>
            {unreadable > 0 && (
              <p
                role="status"
                className="flex items-start gap-2 rounded-2xl bg-foreground/[0.05] px-4 py-3 text-muted-foreground text-sm"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                {unreadable === 1
                  ? 'One note here could not be opened with this vault’s key.'
                  : `${unreadable} notes here could not be opened with this vault’s key.`}
              </p>
            )}
            {notes.length === 0 ? (
              <EmptyState icon={LockKeyhole} title="The vault is empty">
                Tap + to write a note only your devices can read.
              </EmptyState>
            ) : (
              [pinned, others].map(
                (group, index) =>
                  group.length > 0 && (
                    <div key={index === 0 ? 'pinned' : 'others'} className="flex flex-col gap-2">
                      {pinned.length > 0 && (
                        <h2 className="px-1 font-medium text-muted-foreground text-sm">
                          {index === 0 ? 'Pinned' : 'Others'}
                        </h2>
                      )}
                      <NoteGrid notes={group} onOpen={(note, card) => open(note.id, card)} />
                    </div>
                  ),
              )
            )}
          </>
        )}
      </motion.section>
    </>
  );
}
