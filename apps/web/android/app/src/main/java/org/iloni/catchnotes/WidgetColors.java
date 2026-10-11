package org.iloni.catchnotes;

import android.content.Context;
import android.content.res.Configuration;

/** Explicit appearance choices use the same palette resources as the system appearance. */
final class WidgetColors {
    static int surface(Context context, String color, boolean dark) {
        Configuration configuration = new Configuration(context.getResources().getConfiguration());
        configuration.uiMode =
                (configuration.uiMode & ~Configuration.UI_MODE_NIGHT_MASK)
                        | (dark ? Configuration.UI_MODE_NIGHT_YES : Configuration.UI_MODE_NIGHT_NO);
        Context themed = context.createConfigurationContext(configuration);
        int resource =
                context.getResources()
                        .getIdentifier(
                                "widget_surface_" + color.replace('-', '_'),
                                "color",
                                context.getPackageName());
        return themed.getResources()
                .getColor(
                        resource == 0 ? R.color.widget_surface_default : resource,
                        themed.getTheme());
    }
}
