import { createFileRoute } from '@tanstack/react-router';
import { SettingsSection } from '@/components/SettingsSection/SettingsSection';
import { ThemePicker } from '@/components/ThemePicker/ThemePicker';
import { useThemePreference } from '@/lib/theme';

export const Route = createFileRoute('/_app/settings/general')({
  component: GeneralSettings,
});

function GeneralSettings() {
  const [theme, setTheme] = useThemePreference();

  return (
    <div className="flex flex-col gap-6">
      <SettingsSection title="Appearance">
        <ThemePicker value={theme} onChange={setTheme} />
      </SettingsSection>
    </div>
  );
}
