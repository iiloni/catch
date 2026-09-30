import { createFileRoute } from '@tanstack/react-router';
import { ImportProgress } from '@/components/ImportProgress/ImportProgress';
import { KeepImport } from '@/components/KeepImport/KeepImport';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { getSignedInUser } from '@/lib/auth';
import { useSyncedNotes } from '@/lib/collections';

export const Route = createFileRoute('/_app/settings/data')({
  component: DataSettings,
});

const TAKEOUT_URL = 'https://takeout.google.com/settings/takeout/custom/keep';

function DataSettings() {
  const user = getSignedInUser();
  const notesSynced = useSyncedNotes();

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection
        title="Import"
        description={
          <>
            Export Keep from{' '}
            <a
              href={TAKEOUT_URL}
              target="_blank"
              rel="noreferrer"
              className="text-[color:var(--brand-link)] underline underline-offset-2"
            >
              Google Takeout
            </a>{' '}
            as a .zip, then choose it here. Importing the same export again only adds notes that are
            new.
          </>
        }
      >
        {user && <KeepImport userId={user.id} notesSynced={notesSynced} />}
        <ImportProgress />
      </SettingsSection>
    </div>
  );
}
