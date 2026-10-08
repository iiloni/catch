import { createFileRoute } from '@tanstack/react-router';
import { Link2 } from 'lucide-react';
import { BookmarkletSetup } from '@/components/BookmarkletSetup/BookmarkletSetup';
import { ClockPicker } from '@/components/ClockPicker/ClockPicker';
import { IncomingNoteSettings } from '@/components/IncomingNoteSettings/IncomingNoteSettings';
import { SettingsRow, SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { ThemePicker } from '@/components/ThemePicker/ThemePicker';
import { Switch } from '@/components/ui/switch';
import { useClockPreference } from '@/lib/clock';
import { haptics } from '@/lib/haptics';
import { useShowLinkPreviews } from '@/lib/linkPreviews';
import { useThemePreference } from '@/lib/theme';

export const Route = createFileRoute('/_app/settings/general')({
  component: GeneralSettings,
});

function GeneralSettings() {
  const [theme, setTheme] = useThemePreference();
  const [clock, setClock] = useClockPreference();
  const [linkPreviews, setLinkPreviews] = useShowLinkPreviews();

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Appearance">
        <ThemePicker value={theme} onChange={setTheme} />
      </SettingsSection>
      <SettingsSection
        title="Time format"
        description="Automatic follows this device's language, which may not match its clock setting."
      >
        <ClockPicker value={clock} onChange={setClock} />
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
      <IncomingNoteSettings />
      <BookmarkletSetup />
    </div>
  );
}
