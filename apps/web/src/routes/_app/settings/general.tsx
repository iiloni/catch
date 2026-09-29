import { createFileRoute } from '@tanstack/react-router';
import { Link2 } from 'lucide-react';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { ThemePicker } from '@/components/ThemePicker/ThemePicker';
import { Switch } from '@/components/ui/switch';
import { haptics } from '@/lib/haptics';
import { useShowLinkPreviews } from '@/lib/linkPreviews';
import { useThemePreference } from '@/lib/theme';

export const Route = createFileRoute('/_app/settings/general')({
  component: GeneralSettings,
});

function GeneralSettings() {
  const [theme, setTheme] = useThemePreference();
  const [linkPreviews, setLinkPreviews] = useShowLinkPreviews();

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Appearance">
        <ThemePicker value={theme} onChange={setTheme} />
      </SettingsSection>
      <SettingsSection
        title="Notes"
        description="Previews are fetched by your Catch server, so the sites you link to never see this device."
      >
        <SettingsRow
          icon={Link2}
          label="Link previews"
          description="Cards with a title and image for each link"
        >
          <Switch
            aria-label="Link previews"
            checked={linkPreviews}
            onCheckedChange={(checked) => {
              haptics.toggle();
              setLinkPreviews(checked);
            }}
          />
        </SettingsRow>
      </SettingsSection>
    </div>
  );
}
