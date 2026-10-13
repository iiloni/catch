package org.iloni.catchnotes;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.os.Build;
import java.util.ArrayList;
import java.util.List;

final class AppIcons {
    static void set(Context context, String icon) {
        boolean devBuild = context.getResources().getBoolean(R.bool.default_dev_icon);
        int selected;
        if ("stable".equals(icon)) selected = 0;
        else if ("preview".equals(icon)) selected = 1;
        else if ("dev".equals(icon) && devBuild) selected = 2;
        else throw new IllegalArgumentException("Unknown app icon.");

        PackageManager manager = context.getPackageManager();
        String[] names = {"StableIcon", "PreviewIcon", "DevIcon"};
        ComponentName[] components = new ComponentName[names.length];
        int[] previous = new int[names.length];
        boolean changed = false;
        for (int i = 0; i < names.length; i++) {
            components[i] = new ComponentName(context.getPackageName(), "org.iloni.catchnotes." + names[i]);
            previous[i] = manager.getComponentEnabledSetting(components[i]);
            boolean defaultEnabled = devBuild ? i == 2 : i == 0;
            if (enabled(previous[i], defaultEnabled) != (i == selected)) changed = true;
        }
        if (!changed) return;

        int on = PackageManager.COMPONENT_ENABLED_STATE_ENABLED;
        int off = PackageManager.COMPONENT_ENABLED_STATE_DISABLED;
        int flags = PackageManager.DONT_KILL_APP;
        if (Build.VERSION.SDK_INT >= 33) {
            List<PackageManager.ComponentEnabledSetting> settings = new ArrayList<>();
            for (int i = 0; i < components.length; i++) {
                settings.add(new PackageManager.ComponentEnabledSetting(components[i], i == selected ? on : off, flags));
            }
            manager.setComponentEnabledSettings(settings);
        } else {
            // Enable first so the launcher always has an entry; never disable MainActivity.
            manager.setComponentEnabledSetting(components[selected], on, flags);
            try {
                for (int i = 0; i < components.length; i++) {
                    if (i != selected) manager.setComponentEnabledSetting(components[i], off, flags);
                }
            } catch (RuntimeException error) {
                // Restore the old entry before removing the one we just enabled.
                for (int i = 0; i < components.length; i++) {
                    if (enabled(previous[i], devBuild ? i == 2 : i == 0)) {
                        manager.setComponentEnabledSetting(components[i], previous[i], flags);
                    }
                }
                for (int i = 0; i < components.length; i++) {
                    manager.setComponentEnabledSetting(components[i], previous[i], flags);
                }
                throw error;
            }
        }
    }

    private static boolean enabled(int setting, boolean defaultEnabled) {
        return setting == PackageManager.COMPONENT_ENABLED_STATE_ENABLED
                || (setting == PackageManager.COMPONENT_ENABLED_STATE_DEFAULT && defaultEnabled);
    }
}
