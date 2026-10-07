import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { VaultGate, VaultRecoveryCode } from '@/components/VaultGate/VaultGate';
import { hasSeenVault, startVault, vaultMode, vaultPrompt, vaultStatus } from '@/lib/vault';

/**
 * The way into the vault, for the whole app: the dialog that sets it up or unlocks it when
 * something asks to enter (`enterVault`), and then shows its notes.
 */
export function VaultEntry() {
  const asked = vaultPrompt.use();
  const status = vaultStatus.use();
  // Held here because creating the vault unlocks it, which would otherwise close the dialog
  // before its recovery code has been shown.
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);

  // A device that has seen the vault follows it from launch, so a remembered key is ready
  // and its reminders can ring. Any other waits to be asked.
  useEffect(() => {
    if (hasSeenVault()) startVault();
  }, []);

  // Unlocked (here, or by the key the device remembered arriving late): go in.
  useEffect(() => {
    if (!asked || status !== 'unlocked' || recoveryCode !== null) return;
    vaultMode.set(true);
    vaultPrompt.set(false);
  }, [asked, status, recoveryCode]);

  const open = asked || recoveryCode !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        // The recovery code is dismissed with its own button, not by a stray tap.
        if (!value && recoveryCode === null) vaultPrompt.set(false);
      }}
    >
      <DialogContent
        showCloseButton={recoveryCode === null}
        className="top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto"
        onPointerDownOutside={(event) => {
          if (recoveryCode !== null) event.preventDefault();
        }}
        onEscapeKeyDown={(event) => {
          if (recoveryCode !== null) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Vault</DialogTitle>
        <DialogDescription className="sr-only">
          Notes in the vault are encrypted on your devices.
        </DialogDescription>
        {recoveryCode !== null ? (
          <VaultRecoveryCode code={recoveryCode} onDone={() => setRecoveryCode(null)} />
        ) : status !== 'unlocked' ? (
          <VaultGate status={status} onCreated={setRecoveryCode} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
