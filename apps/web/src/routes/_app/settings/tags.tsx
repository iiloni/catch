import { createFileRoute } from '@tanstack/react-router';
import { TagSettings } from '@/components/TagSettings/TagSettings';
import { getSignedInUser } from '@/lib/auth';

export const Route = createFileRoute('/_app/settings/tags')({ component: TagsSettingsPage });
function TagsSettingsPage() {
  const user = getSignedInUser();
  return user ? <TagSettings userId={user.id} /> : null;
}
