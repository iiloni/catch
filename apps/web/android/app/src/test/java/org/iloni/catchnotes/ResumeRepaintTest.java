package org.iloni.catchnotes;

import static org.junit.Assert.*;
import static org.robolectric.Shadows.shadowOf;

import android.content.Context;
import android.os.Looper;
import android.webkit.WebView;
import java.util.ArrayList;
import java.util.List;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class ResumeRepaintTest {
    /** Records what the helper asks of the WebView; Robolectric's WebView draws nothing. */
    private static final class RecordingWebView extends WebView {
        int invalidations;
        final List<VisualStateCallback> frames = new ArrayList<>();

        RecordingWebView(Context context) {
            super(context);
        }

        @Override
        public void postInvalidateOnAnimation() {
            invalidations++;
        }

        @Override
        public void postVisualStateCallback(long requestId, VisualStateCallback callback) {
            frames.add(callback);
        }

        void presentFrames() {
            List<VisualStateCallback> ready = new ArrayList<>(frames);
            frames.clear();
            for (VisualStateCallback callback : ready) callback.onComplete(0);
        }
    }

    private RecordingWebView webView;
    private ResumeRepaint repaint;

    @Before
    public void setup() {
        webView = new RecordingWebView(RuntimeEnvironment.getApplication());
        repaint = new ResumeRepaint(webView);
    }

    private static void idle() {
        shadowOf(Looper.getMainLooper()).idle();
    }

    @Test
    public void aColdStartLeavesTheLaunchScreenToDrawTheFirstFrame() {
        repaint.resumed();
        repaint.focused();
        idle();
        assertEquals(0, webView.invalidations);
        assertTrue(webView.frames.isEmpty());
    }

    @Test
    public void aWarmResumeAsksForAFrameOnceTheWindowIsShownAndDrawsIt() {
        repaint.resumed();
        repaint.stopped();
        repaint.resumed();
        // The window becomes visible after onResume returns.
        assertEquals(0, webView.invalidations);
        assertTrue(webView.frames.isEmpty());

        idle();
        assertEquals(1, webView.invalidations);
        assertEquals(1, webView.frames.size());

        webView.presentFrames();
        assertEquals(2, webView.invalidations);
    }

    @Test
    public void focusAfterAWarmResumeAsksOnceMore() {
        repaint.stopped();
        repaint.resumed();
        idle();
        repaint.focused();
        assertEquals(2, webView.frames.size());

        // Later focus changes, such as closing the notification shade, leave the page alone.
        repaint.focused();
        repaint.resumed();
        idle();
        assertEquals(2, webView.frames.size());
    }

    @Test
    public void eachWarmResumeRepaints() {
        for (int round = 1; round <= 3; round++) {
            repaint.stopped();
            repaint.resumed();
            idle();
            repaint.focused();
            assertEquals(2 * round, webView.frames.size());
        }
    }

    @Test
    public void aResumeWithoutAStopDoesNotRepaint() {
        // Pausing alone (a permission dialog, split-screen focus) keeps the window shown.
        repaint.stopped();
        repaint.resumed();
        idle();
        repaint.focused();
        webView.frames.clear();
        repaint.resumed();
        repaint.focused();
        idle();
        assertTrue(webView.frames.isEmpty());
    }

    @Test
    public void nothingRunsAfterTheActivityIsDestroyed() {
        repaint.stopped();
        repaint.resumed();
        repaint.destroyed();
        idle();
        assertEquals(0, webView.invalidations);
        assertTrue(webView.frames.isEmpty());

        repaint = new ResumeRepaint(webView);
        repaint.stopped();
        repaint.resumed();
        idle();
        repaint.destroyed();
        webView.presentFrames();
        repaint.focused();
        assertEquals(1, webView.invalidations);
        assertTrue(webView.frames.isEmpty());
    }
}
