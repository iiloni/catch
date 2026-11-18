import { z } from 'zod';
import { usePersistentState } from './storage';
import { vaultMode } from './vault';

/** Whether this device shows the button for entering the vault. */
export function useShowVaultButton() {
  return usePersistentState('catch-show-vault-button', z.boolean(), true);
}

/**
 * Whether the vault's buttons show here: as chosen, but always inside the vault, so there is
 * a way back to ordinary notes even when a reminder or Settings opened a hidden one.
 */
export function useVaultButtonShown() {
  const [shown] = useShowVaultButton();
  return vaultMode.use() || shown;
}

/** Whether pulling down at the top of the Gallery or Deck enters and leaves the vault. */
export function usePullForVault() {
  return usePersistentState('catch-pull-for-vault', z.boolean(), false);
}
