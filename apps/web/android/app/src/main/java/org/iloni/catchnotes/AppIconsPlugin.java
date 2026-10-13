package org.iloni.catchnotes;

import com.getcapacitor.Plugin;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppIcons")
public class AppIconsPlugin extends Plugin {
    @PluginMethod
    public void getPreview(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("dataUrl", AppIcons.preview(getContext(), call.getString("icon")));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Could not load the app icon preview.", error);
        }
    }

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
