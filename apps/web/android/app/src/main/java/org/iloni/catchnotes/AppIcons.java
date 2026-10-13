package org.iloni.catchnotes;

import android.content.ComponentName;
import android.content.Context;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.drawable.Drawable;
import android.os.Build;
import android.util.Base64;
import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

final class AppIcons {
    private static final String[] ALIASES = {"StableIcon", "PreviewIcon", "DevIcon"};

    private static int iconIndex(Context context, String icon) {
        if ("stable".equals(icon)) return 0;
        if ("preview".equals(icon)) return 1;
        if ("dev".equals(icon) && context.getResources().getBoolean(R.bool.default_dev_icon)) return 2;
        throw new IllegalArgumentException("Unknown app icon.");
    }

    static String preview(Context context, String icon) throws PackageManager.NameNotFoundException {
        int selected = iconIndex(context, icon);
        PackageManager manager = context.getPackageManager();
        ComponentName component = new ComponentName(context.getPackageName(), "org.iloni.catchnotes." + ALIASES[selected]);
        // Loading the alias also works while disabled and preserves the platform's adaptive mask.
        Drawable drawable = manager.getActivityInfo(component, PackageManager.MATCH_DISABLED_COMPONENTS).loadIcon(manager);
        Bitmap bitmap = Bitmap.createBitmap(256, 256, Bitmap.Config.ARGB_8888);
        try {
            drawable.setBounds(0, 0, bitmap.getWidth(), bitmap.getHeight());
            drawable.draw(new Canvas(bitmap));
            ByteArrayOutputStream bytes = new ByteArrayOutputStream();
            if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, bytes)) {
                throw new IllegalStateException("Could not render the launcher icon.");
            }
            return "data:image/png;base64," + Base64.encodeToString(bytes.toByteArray(), Base64.NO_WRAP);
        } finally {
            bitmap.recycle();
        }
    }

    static void set(Context context, String icon) {
        boolean devBuild = context.getResources().getBoolean(R.bool.default_dev_icon);
        int selected = iconIndex(context, icon);

        PackageManager manager = context.getPackageManager();
        String[] names = ALIASES;
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
