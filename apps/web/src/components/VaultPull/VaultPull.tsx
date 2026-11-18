import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import type { ReactNode } from 'react';
import { PagePull, type PullAction } from '@/components/PagePull/PagePull';
import { usePageSurface } from '@/lib/pageSurface';
import { toggleVault, vaultMode, vaultPrompt, vaultPromptOrigin } from '@/lib/vault';
import { usePullForVault } from '@/lib/vaultPreferences';

const ENTER: PullAction = {
  icon: LockKeyhole,
  pull: 'Pull to open the vault',
  release: 'Release to open the vault',
};
const LEAVE: PullAction = {
  icon: LockKeyholeOpen,
  pull: 'Pull to leave the vault',
  release: 'Release to leave the vault',
};

/** Toggles the vault; a pull that asks for the password grows into the form asking for it. */
function release(pill: HTMLElement | null) {
  let shown = () => {};
  const replaced = new Promise<void>((resolve) => {
    shown = resolve;
  });
  // Set first: the form reads it as it opens.
  if (pill && !vaultMode.get()) {
    vaultPromptOrigin.set({ from: pill.getBoundingClientRect(), shown });
  }
  toggleVault();
  if (vaultPrompt.get() && vaultPromptOrigin.get()) return replaced;
  vaultPromptOrigin.set(null);
  return undefined;
}

/**
 * Pulling down at the top of the Gallery or the Deck enters the vault, or leaves it from
 * inside, where Settings > Vault turns it on (ADR 0020). It works whether or not the header's
 * button is shown, so a device can hide the button and keep the gesture.
 */
export function VaultPull({ disabled, children }: { disabled: boolean; children: ReactNode }) {
  const [on] = usePullForVault();
  const inside = vaultMode.use();
  const active = usePageSurface()?.active ?? true;

  return (
    <PagePull
      enabled={on && active && !disabled}
      action={inside ? LEAVE : ENTER}
      onRelease={release}
    >
      {children}
    </PagePull>
  );
}
