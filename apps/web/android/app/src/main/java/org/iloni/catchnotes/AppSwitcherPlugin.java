package org.iloni.catchnotes;

import android.app.Activity;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Keeps the app's picture out of the recent apps screen while the vault is open (ADR 0020).
 *
 * Android 13 and later can leave out just that picture, so screenshots still work. Earlier
 * versions can only mark the whole window secure, which also blocks screenshots and screen
 * recording until the vault is left.
 */
@CapacitorPlugin(name = "AppSwitcher")
public class AppSwitcherPlugin extends Plugin {
    @PluginMethod
    public void setHidden(PluginCall call) {
        boolean hidden = Boolean.TRUE.equals(call.getBoolean("hidden", false));
        getBridge()
            .executeOnMainThread(() -> {
                Activity activity = getActivity();
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    activity.setRecentsScreenshotEnabled(!hidden);
                } else if (hidden) {
                    activity.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
                } else {
                    activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
                }
                call.resolve();
            });
    }
}
