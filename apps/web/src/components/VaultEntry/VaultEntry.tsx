import { useRouterState } from '@tanstack/react-router';
import { animate, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { VaultGate, VaultRecoveryCode } from '@/components/VaultGate/VaultGate';
import { useBackFallback } from '@/lib/backButton';
import { TAB_PATHS } from '@/lib/dockState';
import { springs } from '@/lib/motion';
import { noteStore } from '@/lib/noteStore';
import { useOpenNote } from '@/lib/openNote';
import { cn } from '@/lib/utils';
import {
  hasSeenVault,
  isVaultNote,
  leaveVault,
  startVault,
  vaultBiometrics,
  vaultMode,
  vaultPrompt,
  vaultPromptOrigin,
  vaultStatus,
} from '@/lib/vault';

const mix = (from: number, to: number, progress: number) => from + (to - from) * progress;

/**
 * Grows the form out of the pill a pull drew, as one surface: it starts as the pill's shape
 * where the pill was, and opens into the form while moving into place. The form's contents
 * fade in once there is room for them, and nothing scales, so the text never stretches.
 * Calls `shown` once the form is on screen in the pill's shape, for the pill to go. Returns
 * what stops it, leaving the form as it would be at rest.
 */
function growFrom(form: HTMLElement, pill: DOMRect, shown: () => void) {
  const box = form.getBoundingClientRect();
  // The pill's shape sits at the top center of the form, then widens and lengthens to it.
  const width = Math.min(pill.width, box.width);
  const height = Math.min(pill.height, box.height);
  const side = (box.width - width) / 2;
  const x = pill.left + (pill.width - width) / 2 - (box.left + side);
  const y = pill.top - box.top;
  const radius = Number.parseFloat(getComputedStyle(form).borderTopLeftRadius) || 24;
  const contents = [...form.children].filter((child) => child instanceof HTMLElement);

  function frame(progress: number) {
    const rest = 1 - progress;
    form.style.transform = `translate(${x * rest}px, ${y * rest}px)`;
    form.style.clipPath = `inset(0 ${side * rest}px ${(box.height - height) * rest}px ${side * rest}px round ${mix(height / 2, radius, progress)}px)`;
    const shown = String(Math.min(1, Math.max(0, (progress - 0.45) / 0.45)));
    for (const content of contents) content.style.opacity = shown;
  }
  function settle() {
    form.style.transform = '';
    form.style.clipPath = '';
    for (const content of contents) content.style.opacity = '';
  }

  frame(0);
  // Mounting the form makes a long frame. Started now, the spring would spend it unseen and
  // first show the form partly grown; started once the pill's shape is on screen, it does not.
  let growing: ReturnType<typeof animate> | null = null;
  let painted = requestAnimationFrame(() => {
    painted = requestAnimationFrame(() => {
      shown();
      growing = animate(0, 1, {
        ...springs.smooth,
        bounce: 0,
        onUpdate: frame,
        onComplete: settle,
      });
    });
  });
  return () => {
    cancelAnimationFrame(painted);
    growing?.stop();
    settle();
  };
}

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

  // The pages now show the other kind of note, so one left open from before (as it can be
  // in the pane beside the page) closes. A note opened by entering, from its reminder, stays.
  const mode = vaultMode.use();
  const { close } = useOpenNote();
  const previous = useRef(mode);
  useEffect(() => {
    if (previous.current === mode) return;
    previous.current = mode;
    const id = new URLSearchParams(window.location.search).get('note');
    if (!id) return;
    const belongs = mode ? isVaultNote(id) : noteStore.has(id) && !isVaultNote(id);
    if (!belongs) close();
  }, [mode, close]);

  // On the Gallery, the Deck or Search, Android's back gesture leaves the vault before it
  // would leave the app: those pages replace history, so back has nowhere nearer to go. An
  // open note, the dock's search or a menu still closes first, and Reminders, the Archive and
  // the Trash go back to the Gallery first.
  const onTab = useRouterState({
    select: ({ location }) =>
      TAB_PATHS.some((tab) => tab === location.pathname) &&
      !(location.search as { note?: string }).note,
  });
  useBackFallback(mode && onTab, leaveVault);

  const open = asked || recoveryCode !== null;

  // A pull's pill becomes the form (`growFrom`) in place of the dialog's own zoom, which is
  // left off for as long as this form is open so it cannot start again partway.
  const reducedMotion = useReducedMotion();
  const origin = vaultPromptOrigin.use();
  const grows = open && origin !== null && !reducedMotion;
  useEffect(() => {
    if (!open) vaultPromptOrigin.set(null);
  }, [open]);
  const grow = useCallback(
    (form: HTMLDivElement | null) => {
      if (!form || !origin) return;
      if (grows) return growFrom(form, origin.from, origin.shown);
      origin.shown();
    },
    [grows, origin],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        // The recovery code is dismissed with its own button, not by a stray tap.
        if (!value && recoveryCode === null) vaultPrompt.set(false);
      }}
    >
      <DialogContent
        ref={grow}
        showCloseButton={recoveryCode === null}
        className={cn(
          'top-[calc((100dvh-var(--keyboard))/2)] max-h-[calc(100dvh-var(--keyboard)-var(--safe-top)-var(--safe-bottom)-2rem)] overflow-y-auto',
          grows && 'data-[state=open]:animate-none',
        )}
        onOpenAutoFocus={(event) => {
          // The fingerprint prompt comes up at once, and would shut a keyboard raised by
          // focusing the PIN or password field; the gate focuses it if the prompt gives way.
          if (status !== 'locked' || !vaultBiometrics.get()) return;
          event.preventDefault();
          if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
        }}
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
