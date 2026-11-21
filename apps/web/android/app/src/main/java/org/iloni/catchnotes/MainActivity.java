package org.iloni.catchnotes;

import android.os.Bundle;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.animation.PathInterpolator;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    // Long enough for a cold WebView to open the device's notes, short enough that a page that
    // never reports (a script error, a widget reloading it for another account) is not stuck.
    private static final long LAUNCH_TIMEOUT_MS = 3000;

    private Intent initialIntent;
    private volatile boolean launching = true;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The system removes its launch screen at the window's first frame, which is an empty
        // WebView. Holding it until the page reports its first screen (LaunchScreenPlugin) shows
        // the notes instead of the shell, the page and its notes arriving one after another.
        SplashScreen splash = SplashScreen.installSplashScreen(this);
        splash.setKeepOnScreenCondition(() -> launching);
        splash.setOnExitAnimationListener((provider) -> {
            View view = provider.getView();
            view.animate()
                .alpha(0f)
                .setDuration(250)
                .setInterpolator(new PathInterpolator(0.3f, 0f, 0.2f, 1f))
                .withEndAction(provider::remove)
                .start();
        });
        new Handler(Looper.getMainLooper()).postDelayed(this::finishLaunch, LAUNCH_TIMEOUT_MS);
        initialIntent = getIntent();
        // Delivery ids are ours: another app must not choose the id of an existing note.
        // Recreation retains our marker, while a fresh external launch always gets a new one.
        if (savedInstanceState == null && initialIntent != null) initialIntent.removeExtra(IncomingSharesPlugin.RECEIPT);
        registerPlugin(HapticFeedbackPlugin.class);
        registerPlugin(AttachmentsPlugin.class);
        registerPlugin(AppUpdatesPlugin.class);
        registerPlugin(AppIconsPlugin.class);
        registerPlugin(KeyboardInsetsPlugin.class);
        registerPlugin(IncomingSharesPlugin.class);
        registerPlugin(OutgoingSharesPlugin.class);
        registerPlugin(RemindersPlugin.class);
        registerPlugin(WidgetsPlugin.class);
        registerPlugin(VaultKeyPlugin.class);
        registerPlugin(LaunchScreenPlugin.class);
        super.onCreate(savedInstanceState);
        // The page scrollbar is drawn by the WebView separately from nested CSS scrollers.
        getBridge().getWebView().setVerticalScrollBarEnabled(false);
        getBridge().getWebView().setHorizontalScrollBarEnabled(false);
    }

    /** Lets the launch screen leave. Later calls, such as from a reloaded page, do nothing. */
    void finishLaunch() {
        launching = false;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        // BridgeActivity also calls this with the initial intent during onCreate.
        if (intent != null && intent != initialIntent) intent.removeExtra(IncomingSharesPlugin.RECEIPT);
        super.onNewIntent(intent);
    }
}
