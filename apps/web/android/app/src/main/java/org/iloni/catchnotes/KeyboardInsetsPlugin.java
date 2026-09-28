package org.iloni.catchnotes;

import android.view.View;
import android.view.animation.Interpolator;
import androidx.annotation.NonNull;
import androidx.core.graphics.Insets;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsAnimationCompat;
import androidx.core.view.WindowInsetsCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.List;
import java.util.Locale;

/**
 * Owns the window insets so the page can animate with the keyboard.
 *
 * The WebView is never resized for the keyboard (resizing jumps once the keyboard has finished
 * moving). Instead, each keyboard animation is reported to the page once, as its start and end
 * heights, duration and sampled easing curve, and the page animates its own UI in step with it.
 * System bar insets are injected as the same --safe-area-inset-* variables Capacitor's
 * SystemBars plugin would set; that plugin's inset handling is disabled in capacitor.config.ts.
 */
@CapacitorPlugin(name = "KeyboardInsets")
public class KeyboardInsetsPlugin extends Plugin {

    private static final int CURVE_SAMPLES = 24;
    private static final int TYPES_BARS = WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout();

    private float keyboardHeight = 0;
    private Insets lastBars = Insets.NONE;
    private boolean animating = false;
    private float animationStart = 0;

    @Override
    public void load() {
        View decor = getActivity().getWindow().getDecorView();

        ViewCompat.setOnApplyWindowInsetsListener(decor, (view, insets) -> {
            Insets bars = insets.getInsets(TYPES_BARS);
            if (!bars.equals(lastBars)) {
                lastBars = bars;
                injectSafeArea(bars);
            }

            // Keyboard changes without an animation (e.g. a hardware keyboard toggling it) jump.
            float height = imeHeight(insets);
            if (!animating && height != keyboardHeight) {
                keyboardHeight = height;
                notifyKeyboard(height, height, 0, null);
            }

            // Hide the keyboard from the WebView so it keeps its size.
            WindowInsetsCompat withoutIme = new WindowInsetsCompat.Builder(insets)
                .setInsets(WindowInsetsCompat.Type.ime(), Insets.NONE)
                .build();
            return ViewCompat.onApplyWindowInsets(view, withoutIme);
        });

        // On the WebView rather than the decor view: before API 30 the compat implementation
        // installs its own insets listener on the view it is given, which would replace ours.
        ViewCompat.setWindowInsetsAnimationCallback(
            getBridge().getWebView(),
            new WindowInsetsAnimationCompat.Callback(WindowInsetsAnimationCompat.Callback.DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                @Override
                public void onPrepare(@NonNull WindowInsetsAnimationCompat animation) {
                    if (isIme(animation)) {
                        animating = true;
                        animationStart = keyboardHeight;
                    }
                }

                @NonNull
                @Override
                public WindowInsetsAnimationCompat.BoundsCompat onStart(
                    @NonNull WindowInsetsAnimationCompat animation,
                    @NonNull WindowInsetsAnimationCompat.BoundsCompat bounds
                ) {
                    if (isIme(animation)) {
                        WindowInsetsCompat end = ViewCompat.getRootWindowInsets(decor);
                        float target = end == null ? 0 : imeHeight(end);
                        keyboardHeight = target;
                        notifyKeyboard(animationStart, target, animation.getDurationMillis(), animation.getInterpolator());
                    }
                    return bounds;
                }

                @NonNull
                @Override
                public WindowInsetsCompat onProgress(
                    @NonNull WindowInsetsCompat insets,
                    @NonNull List<WindowInsetsAnimationCompat> running
                ) {
                    return insets;
                }

                @Override
                public void onEnd(@NonNull WindowInsetsAnimationCompat animation) {
                    if (isIme(animation)) animating = false;
                }
            }
        );

        ViewCompat.requestApplyInsets(decor);
    }

    /** Current insets, for the page to read when it loads (injected values do not survive a reload). */
    @PluginMethod
    public void current(PluginCall call) {
        float d = density();
        JSObject result = new JSObject();
        result.put("top", lastBars.top / d);
        result.put("right", lastBars.right / d);
        result.put("bottom", lastBars.bottom / d);
        result.put("left", lastBars.left / d);
        result.put("keyboard", keyboardHeight);
        call.resolve(result);
    }

    private static boolean isIme(WindowInsetsAnimationCompat animation) {
        return (animation.getTypeMask() & WindowInsetsCompat.Type.ime()) != 0;
    }

    private float imeHeight(WindowInsetsCompat insets) {
        if (!insets.isVisible(WindowInsetsCompat.Type.ime())) return 0;
        return insets.getInsets(WindowInsetsCompat.Type.ime()).bottom / density();
    }

    private float density() {
        return getActivity().getResources().getDisplayMetrics().density;
    }

    private void notifyKeyboard(float from, float to, long durationMs, Interpolator interpolator) {
        JSObject data = new JSObject();
        data.put("from", from);
        data.put("to", to);
        data.put("duration", durationMs);
        JSArray curve = new JSArray();
        for (int i = 0; i <= CURVE_SAMPLES; i++) {
            float t = (float) i / CURVE_SAMPLES;
            // put(Object) rather than put(double), which declares a JSONException for NaN.
            curve.put(Double.valueOf(interpolator == null ? t : interpolator.getInterpolation(t)));
        }
        data.put("curve", curve);
        notifyListeners("keyboard", data, true);
    }

    private void injectSafeArea(Insets bars) {
        float d = density();
        String script = String.format(
            Locale.US,
            "(()=>{const s=document.documentElement.style;" +
            "s.setProperty('--safe-area-inset-top','%.1fpx');" +
            "s.setProperty('--safe-area-inset-right','%.1fpx');" +
            "s.setProperty('--safe-area-inset-bottom','%.1fpx');" +
            "s.setProperty('--safe-area-inset-left','%.1fpx');})()",
            bars.top / d,
            bars.right / d,
            bars.bottom / d,
            bars.left / d
        );
        getBridge().executeOnMainThread(() -> {
            if (getBridge().getWebView() != null) getBridge().getWebView().evaluateJavascript(script, null);
        });
    }
}
