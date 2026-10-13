package org.iloni.catchnotes;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppIcons")
public class AppIconsPlugin extends Plugin {
    @PluginMethod
    public void setIcon(PluginCall call) {
        try {
            AppIcons.set(getContext(), call.getString("icon"));
            call.resolve();
        } catch (RuntimeException error) {
            call.reject("Could not change the app icon.", error);
        }
    }
}
