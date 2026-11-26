package org.iloni.catchnotes;

import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;

/**
 * Puts the page back on screen when the app returns from the background (a warm resume).
 *
 * While the app is hidden, Android WebView gives up the page's tiles under memory pressure.
 * Its compositor only draws when something asks it to, and on return nothing does: the window
 * shows the WebView's background until the first tap or drag makes it draw the page that was
 * there all along. A warm resume asks for a frame of the page's current state, which makes the
 * compositor commit and raster it again, and redraws the view once that frame is ready.
 *
 * A cold start has nothing to repaint; the launch screen waits for the first frame itself.
 */
final class ResumeRepaint {
    private final WebView webView;
    private final Handler mainThread = new Handler(Looper.getMainLooper());
    private final Runnable repaint = this::repaint;
    private boolean stopped;
    private boolean awaitingFocus;
    private boolean destroyed;

    ResumeRepaint(WebView webView) {
        this.webView = webView;
    }

    /** The activity stopped: its window is hidden and the page may lose its tiles. */
    void stopped() {
        stopped = true;
    }

    /** The activity resumed. Its window becomes visible once `onResume` returns. */
    void resumed() {
        if (!stopped || destroyed) return;
        stopped = false;
        awaitingFocus = true;
        mainThread.removeCallbacks(repaint);
        mainThread.post(repaint);
    }

    /**
     * The window gained focus. After a warm resume this is when the window is surely shown, so
     * it asks once more in case the first request reached the page while it was still hidden.
     */
    void focused() {
        if (!awaitingFocus || destroyed) return;
        awaitingFocus = false;
        repaint();
    }

    void destroyed() {
        destroyed = true;
        mainThread.removeCallbacks(repaint);
    }

    private void repaint() {
        if (destroyed) return;
        webView.postInvalidateOnAnimation();
        webView.postVisualStateCallback(0, new WebView.VisualStateCallback() {
            @Override
            public void onComplete(long requestId) {
                if (!destroyed) webView.postInvalidateOnAnimation();
            }
        });
    }
}
