package org.iloni.catchnotes;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import java.util.List;

final class AppIcons {
    static void set(Context context, String icon) {
        if (!"stable".equals(icon) && !"preview".equals(icon)) {
            throw new IllegalArgumentException("Unknown app icon.");
        }
        PackageManager manager = context.getPackageManager();
        ComponentName stable = new ComponentName(context.getPackageName(), "org.iloni.catchnotes.StableIcon");
        ComponentName preview = new ComponentName(context.getPackageName(), "org.iloni.catchnotes.PreviewIcon");
        ComponentName chosen = "preview".equals(icon) ? preview : stable;
        ComponentName other = "preview".equals(icon) ? stable : preview;
        int chosenBefore = manager.getComponentEnabledSetting(chosen);
        int otherBefore = manager.getComponentEnabledSetting(other);
        if (enabled(chosenBefore, chosen.equals(stable)) && !enabled(otherBefore, other.equals(stable))) return;
        int on = PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
        int off = PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        int flags = PackageManager.DONT_KILL_APP;
        if (Build.VERSION.SDK_INT >= 33) {
            manager.setComponentEnabledSettings(List.of(
                    new PackageManager.ComponentEnabledSetting(chosen, on, flags),
                    new PackageManager.ComponentEnabledSetting(other, off, flags)));
        } else {
            // Enable first so the launcher always has an entry; never disable MainActivity.
            manager.setComponentEnabledSetting(chosen, on, flags);
            try {
                manager.setComponentEnabledSetting(other, off, flags);
            } catch (RuntimeException error) {
                manager.setComponentEnabledSetting(chosen, chosenBefore, flags);
                manager.setComponentEnabledSetting(other, otherBefore, flags);
                throw error;
            }
        }
    }

    private static boolean enabled(int setting, boolean defaultEnabled) {
        return setting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                || (setting == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && defaultEnabled);
    }
}
