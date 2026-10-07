import { z } from 'zod';
import { usePersistentState } from './storage';

/** Whether this device shows the button for entering the vault. */
export function useShowVaultButton() {
  return usePersistentState('catch-show-vault-button', z.boolean(), true);
}
