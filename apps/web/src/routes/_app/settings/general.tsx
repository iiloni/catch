import { createFileRoute } from '@tanstack/react-router';
import { Link2 } from 'lucide-react';
import { AppIconPicker } from '@/components/AppIconPicker/AppIconPicker';
import { BookmarkletSetup } from '@/components/BookmarkletSetup/BookmarkletSetup';
import { ClockPicker } from '@/components/ClockPicker/ClockPicker';
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
      <AppIconPicker />
      <SettingsSection
        title="Time format"
        description="Automatic uses this device's language to choose 12- or 24-hour time."
      >
        <ClockPicker value={clock} onChange={setClock} />
      </SettingsSection>
      <SettingsSection
        title="Notes"
        description="Only your Catch server contacts linked sites to fetch previews."
      >
        <SettingsRow icon={Link2} label="Link previews">
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
      <BookmarkletSetup />
    </div>
  );
}
