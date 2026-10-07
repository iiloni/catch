import { createFileRoute } from '@tanstack/react-router';
import { VaultSettings } from '@/components/VaultSettings/VaultSettings';

export const Route = createFileRoute('/_app/settings/vault')({
  component: VaultSettings,
});
