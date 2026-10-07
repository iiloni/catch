import { LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { haptics } from '@/lib/haptics';
import { springs } from '@/lib/motion';
import { enterVault, leaveVault, vaultMode } from '@/lib/vault';
import { useShowVaultButton } from '@/lib/vaultPreferences';

/**
 * Enters and leaves the vault (ADR 0020). Inside, the Gallery, the Deck and Search show the
 * vault's notes in place of the others. Entering a locked vault asks for its password first.
 */
export function VaultToggle() {
  const inside = vaultMode.use();
  const [shown] = useShowVaultButton();
  const label = inside ? 'Leave the vault' : 'Open the vault';
  const Icon = inside ? LockKeyholeOpen : LockKeyhole;

  // A reminder or Settings can still open a hidden vault; keep the way out available.
  if (!shown && !inside) return null;

  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={inside}
      onClick={() => {
        haptics.toggle();
        if (inside) leaveVault();
        else enterVault();
      }}
      whileTap={{ scale: 0.9 }}
      transition={springs.snappy}
      className="flex size-10 items-center justify-center rounded-full outline-none hover:bg-foreground/[0.06] focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-foreground/[0.08]"
    >
      <Icon className="size-[22px]" aria-hidden />
    </motion.button>
  );
}
