import { createFileRoute } from '@tanstack/react-router';
import { NotificationSettings } from '@/components/NotificationSettings/NotificationSettings';

export const Route = createFileRoute('/_app/settings/notifications')({
  component: NotificationSettings,
});
