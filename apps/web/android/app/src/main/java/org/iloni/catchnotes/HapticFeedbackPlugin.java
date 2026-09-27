package org.iloni.catchnotes;

import android.os.Build;
import android.view.HapticFeedbackConstants;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * System haptics through View.performHapticFeedback. Unlike raw vibration patterns, these use
 * the device's tuned effects and respect the user's touch feedback setting.
 */
@CapacitorPlugin(name = "HapticFeedback")
public class HapticFeedbackPlugin extends Plugin {

    @PluginMethod
    public void perform(PluginCall call) {
        int constant = constantFor(call.getString("effect", "tick"));
        getActivity().runOnUiThread(() -> getBridge().getWebView().performHapticFeedback(constant));
        call.resolve();
    }

    private static int constantFor(String effect) {
        boolean api30 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R;
        boolean api34 = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE;
        switch (effect) {
            case "light":
                return HapticFeedbackConstants.VIRTUAL_KEY;
            case "medium":
                return HapticFeedbackConstants.LONG_PRESS;
            case "success":
                return api30 ? HapticFeedbackConstants.CONFIRM : HapticFeedbackConstants.VIRTUAL_KEY;
            case "warning":
                return api30 ? HapticFeedbackConstants.REJECT : HapticFeedbackConstants.LONG_PRESS;
            case "threshold":
                return api34 ? HapticFeedbackConstants.GESTURE_THRESHOLD_ACTIVATE : HapticFeedbackConstants.CLOCK_TICK;
            case "tick":
            default:
                return api34 ? HapticFeedbackConstants.SEGMENT_TICK : HapticFeedbackConstants.CLOCK_TICK;
        }
    }
}
