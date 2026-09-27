import { useNavigate } from '@tanstack/react-router';
import { useCallback } from 'react';

/**
 * The open note lives in the `note` search param, so the Android back button and
 * browser history close the editor, and an open note survives a reload.
 */
export function useOpenNote() {
  const navigate = useNavigate();
  const open = useCallback(
    (id: string) => navigate({ to: '.', search: (prev) => ({ ...prev, note: id }) }),
    [navigate],
  );
  const close = useCallback(
    () => navigate({ to: '.', search: (prev) => ({ ...prev, note: undefined }) }),
    [navigate],
  );
  return { open, close };
}
