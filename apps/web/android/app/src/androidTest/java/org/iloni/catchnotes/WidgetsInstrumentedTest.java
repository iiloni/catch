package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.app.Activity;
import android.app.Instrumentation;
import android.content.Intent;
import android.graphics.Bitmap;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileOutputStream;

/** Run on a disposable emulator: this uses the target app's widget snapshot store. */
@RunWith(AndroidJUnit4.class)
@androidx.test.filters.SdkSuppress(minSdkVersion = 29)
public class WidgetsInstrumentedTest {
    @Test
    public void realLauncherHostRendersLightAndDarkWidgets() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        String target = instrumentation.getTargetContext().getPackageName();
        try (android.os.ParcelFileDescriptor command =
                instrumentation
                        .getUiAutomation()
                        .executeShellCommand(
                                "appwidget grantbind --package " + target + " --user 0")) {
            try (java.io.FileInputStream result =
                    new java.io.FileInputStream(command.getFileDescriptor())) {
                while (result.read() != -1) {}
            }
        }
        for (String theme : new String[] {"light", "dark"}) {
            Intent intent =
                    new Intent(instrumentation.getTargetContext(), MainActivity.class)
                            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            Activity host = instrumentation.startActivitySync(intent);
            android.appwidget.AppWidgetHost[] widgetHost = new android.appwidget.AppWidgetHost[1];
            try {
                instrumentation.runOnMainSync(
                        () -> widgetHost[0] = WidgetTestHost.render(host, theme));
                instrumentation.waitForIdleSync();
                // The collection binds asynchronously; check its actually visible row.
                awaitVisibleTitles(instrumentation, host, 2);
                long captureDeadline = android.os.SystemClock.uptimeMillis() + 10000;
                boolean[] captureReady = {false};
                while (!captureReady[0]
                        && android.os.SystemClock.uptimeMillis() < captureDeadline) {
                    instrumentation.runOnMainSync(
                            () ->
                                    captureReady[0] =
                                            findText(host.getWindow().getDecorView(), "New note")
                                                    != null);
                    if (!captureReady[0]) Thread.sleep(50);
                }
                assertTrue("Capture widget has not rendered", captureReady[0]);
                instrumentation.runOnMainSync(
                        () -> {
                            float density = host.getResources().getDisplayMetrics().density;
                            // RemoteViews are root namespaces, so locate controls inside the
                            // widget.
                            android.view.View controls =
                                    (android.view.View)
                                            findText(host.getWindow().getDecorView(), "New note")
                                                    .getParent();
                            for (int id :
                                    new int[] {
                                        R.id.widget_settings,
                                        R.id.widget_compose,
                                        R.id.widget_search
                                    }) {
                                android.view.View button = controls.findViewById(id);
                                assertNotNull("Missing capture control " + id, button);
                                // Separately rounded insets can subtract one pixel at fractional
                                // dp.
                                assertTrue(
                                        "Capture control height " + button.getHeight(),
                                        button.getHeight() >= Math.round(48 * density) - 1);
                            }
                        });
                saveScreenshot(instrumentation, host, "widgets-" + theme + ".png");
                android.content.Context targetContext = instrumentation.getTargetContext();
                WidgetStore.clear(targetContext, "widget-test");
                CatchWidgetProvider.updateAll(targetContext);
                awaitVisibleTitles(instrumentation, host, 0);
                WidgetTestHost.seed(targetContext);
                CatchWidgetProvider.updateAll(targetContext);
                awaitVisibleTitles(instrumentation, host, 2);
                int listId =
                        android.appwidget.AppWidgetManager.getInstance(targetContext)
                                .getAppWidgetIds(
                                        new android.content.ComponentName(
                                                targetContext, CatchWidgetProvider.Notes.class))[0];
                Activity configuration =
                        instrumentation.startActivitySync(
                                new Intent(targetContext, WidgetConfigurationActivity.class)
                                        .putExtra(
                                                android.appwidget.AppWidgetManager
                                                        .EXTRA_APPWIDGET_ID,
                                                listId)
                                        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
                try {
                    instrumentation.runOnMainSync(
                            () -> {
                                configuration
                                        .getWindow()
                                        .addFlags(
                                                android.view.WindowManager.LayoutParams
                                                        .FLAG_KEEP_SCREEN_ON);
                                if (android.os.Build.VERSION.SDK_INT >= 27)
                                    configuration.setShowWhenLocked(true);
                            });
                    instrumentation.waitForIdleSync();
                    saveScreenshot(instrumentation, configuration, "widget-setup.png");
                    instrumentation.runOnMainSync(
                            () ->
                                    findText(configuration.getWindow().getDecorView(), "Show\n")
                                            .performClick());
                    instrumentation.waitForIdleSync();

                    instrumentation.runOnMainSync(
                            () -> {
                                android.widget.TextView gallery = null;
                                android.widget.TextView allNotes = null;
                                for (android.view.View root :
                                        android.view.inspector.WindowInspector
                                                .getGlobalWindowViews()) {
                                    android.widget.TextView candidate = findText(root, "Gallery");
                                    if (candidate != null) gallery = candidate;
                                    candidate = findText(root, "All notes");
                                    if (candidate != null) allNotes = candidate;
                                }
                                assertNotNull(gallery);
                                assertNotNull(allNotes);
                                allNotes.performClick();
                            });
                    instrumentation.waitForIdleSync();
                    instrumentation.runOnMainSync(
                            () ->
                                    findText(
                                                    configuration.getWindow().getDecorView(),
                                                    "Save widget")
                                            .performClick());
                    assertEquals(
                            "all", WidgetStore.config(targetContext, listId).optString("filter"));
                } finally {
                    instrumentation.runOnMainSync(configuration::finish);
                }
            } finally {
                instrumentation.runOnMainSync(
                        () -> {
                            if (widgetHost[0] != null) {
                                widgetHost[0].stopListening();
                                widgetHost[0].deleteHost();
                            }
                            host.finish();
                        });
            }
        }
    }

    private static void saveScreenshot(
            Instrumentation instrumentation, Activity activity, String name) throws Exception {
        // Capture only this app window, never a keyguard, notification or another overlay.
        android.view.View decor = activity.getWindow().getDecorView();
        Bitmap screenshot =
                Bitmap.createBitmap(decor.getWidth(), decor.getHeight(), Bitmap.Config.ARGB_8888);
        java.util.concurrent.CountDownLatch copied = new java.util.concurrent.CountDownLatch(1);
        int[] result = {-1};
        android.view.PixelCopy.request(
                activity.getWindow(),
                screenshot,
                value -> {
                    result[0] = value;
                    copied.countDown();
                },
                new android.os.Handler(android.os.Looper.getMainLooper()));
        assertTrue(copied.await(5, java.util.concurrent.TimeUnit.SECONDS));
        assertEquals(android.view.PixelCopy.SUCCESS, result[0]);
        try (FileOutputStream stream =
                new FileOutputStream(
                        new File(
                                instrumentation.getTargetContext().getExternalFilesDir(null),
                                name))) {
            screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream);
        }
    }

    private static android.widget.TextView findText(android.view.View view, String prefix) {
        if (view instanceof android.widget.TextView
                && ((android.widget.TextView) view).getText().toString().startsWith(prefix))
            return (android.widget.TextView) view;
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.widget.TextView found = findText(group.getChildAt(i), prefix);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static void awaitVisibleTitles(
            Instrumentation instrumentation, Activity host, int expected) throws Exception {
        long deadline = android.os.SystemClock.uptimeMillis() + 10000;
        boolean[] ready = new boolean[1];
        int[] actual = new int[1];
        while (!ready[0] && android.os.SystemClock.uptimeMillis() < deadline) {
            instrumentation.runOnMainSync(
                    () -> {
                        actual[0] = countText(host.getWindow().getDecorView(), "Saturday market");
                        ready[0] = expected == 0 ? actual[0] == 0 : actual[0] >= expected;
                    });
            if (!ready[0]) Thread.sleep(50);
        }
        if (!ready[0]) saveScreenshot(instrumentation, host, "widgets-failed.png");
        assertTrue("Expected " + expected + " visible note titles, found " + actual[0], ready[0]);
    }

    private static int countText(android.view.View view, String text) {
        if (view.getVisibility() != android.view.View.VISIBLE) return 0;
        int count =
                view instanceof android.widget.TextView
                                && text.contentEquals(((android.widget.TextView) view).getText())
                        ? 1
                        : 0;
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++)
                count += countText(group.getChildAt(i), text);
        }
        return count;
    }
}
