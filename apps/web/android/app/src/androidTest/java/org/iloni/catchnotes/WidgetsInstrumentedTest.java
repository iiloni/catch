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
                saveScreenshot(instrumentation, host, "widgets-" + theme + ".png").recycle();
                for (int id :
                        new int[] {R.id.widget_settings, R.id.widget_compose, R.id.widget_search}) {
                    assertPressedFeedback(
                            instrumentation,
                            host,
                            () ->
                                    ((android.view.View)
                                                    findText(
                                                                    host.getWindow().getDecorView(),
                                                                    "New note")
                                                            .getParent())
                                            .findViewById(id),
                            "capture-"
                                    + host.getResources().getResourceEntryName(id)
                                    + "-"
                                    + theme);
                }
                assertPressedFeedback(
                        instrumentation,
                        host,
                        () ->
                                ((android.widget.ListView)
                                                findById(
                                                        host.getWindow().getDecorView(),
                                                        R.id.widget_note))
                                        .getChildAt(0),
                        "single-" + theme);
                assertPressedFeedback(
                        instrumentation,
                        host,
                        () ->
                                ((android.view.View)
                                                findList(host.getWindow().getDecorView())
                                                        .getParent())
                                        .findViewById(R.id.widget_compose),
                        "fab-" + theme);
                assertPressedFeedback(
                        instrumentation,
                        host,
                        () -> findList(host.getWindow().getDecorView()).getChildAt(0),
                        "card-" + theme);

                instrumentation.runOnMainSync(
                        () -> {
                            android.widget.ListView list =
                                    findList(host.getWindow().getDecorView());
                            assertNotNull(list);
                            assertEquals(3, list.getCount());
                            list.setSelection(list.getCount() - 1);
                        });
                instrumentation.waitForIdleSync();
                instrumentation.runOnMainSync(
                        () -> {
                            android.widget.ListView list =
                                    findList(host.getWindow().getDecorView());
                            assertEquals(list.getCount() - 1, list.getLastVisiblePosition());
                            android.view.View last = list.getChildAt(list.getChildCount() - 1);
                            android.view.View fab =
                                    ((android.view.View) list.getParent())
                                            .findViewById(R.id.widget_compose);
                            assertTrue(last.getBottom() + list.getTop() <= fab.getTop());
                        });
                instrumentation.runOnMainSync(
                        () -> {
                            android.widget.ListView single =
                                    (android.widget.ListView)
                                            findById(
                                                    host.getWindow().getDecorView(),
                                                    R.id.widget_note);
                            assertEquals(2, single.getCount());
                            android.widget.ImageView photo =
                                    single.getChildAt(0).findViewById(R.id.widget_image);
                            assertEquals(android.view.View.VISIBLE, photo.getVisibility());
                            assertTrue(photo.getHeight() > 0);
                        });
                instrumentation.waitForIdleSync();
                for (int swipe = 0; swipe < 9; swipe++) swipeSingleNote(instrumentation, host);
                instrumentation.runOnMainSync(
                        () -> {
                            android.widget.TextView tail =
                                    findText(
                                            host.getWindow().getDecorView(),
                                            "Final line: remember the basket");
                            assertNotNull(tail);
                            assertTrue(tail.getGlobalVisibleRect(new android.graphics.Rect()));
                        });
                saveScreenshot(instrumentation, host, "widgets-scrolled-" + theme + ".png")
                        .recycle();
                instrumentation.runOnMainSync(
                        () -> {
                            ((android.widget.ListView)
                                            findById(
                                                    host.getWindow().getDecorView(),
                                                    R.id.widget_note))
                                    .setSelection(0);
                            findList(host.getWindow().getDecorView()).setSelection(0);
                        });
                instrumentation.waitForIdleSync();
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
                    saveScreenshot(instrumentation, configuration, "widget-setup.png").recycle();
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

    private static void swipeSingleNote(Instrumentation instrumentation, Activity host)
            throws Exception {
        android.widget.ListView[] list = new android.widget.ListView[1];
        instrumentation.runOnMainSync(
                () ->
                        list[0] =
                                (android.widget.ListView)
                                        findById(
                                                host.getWindow().getDecorView(), R.id.widget_note));
        long down = android.os.SystemClock.uptimeMillis();
        for (int step = 0; step <= 12; step++) {
            final int frame = step;
            instrumentation.runOnMainSync(
                    () -> {
                        float x = list[0].getWidth() / 2f;
                        float y = 16 + (list[0].getHeight() - 32) * (1 - frame / 12f);
                        android.view.MotionEvent event =
                                android.view.MotionEvent.obtain(
                                        down,
                                        android.os.SystemClock.uptimeMillis(),
                                        frame == 0
                                                ? android.view.MotionEvent.ACTION_DOWN
                                                : frame == 12
                                                        ? android.view.MotionEvent.ACTION_UP
                                                        : android.view.MotionEvent.ACTION_MOVE,
                                        x,
                                        y,
                                        0);
                        list[0].dispatchTouchEvent(event);
                        event.recycle();
                    });
            Thread.sleep(20);
        }
        Thread.sleep(100);
    }

    private static void assertPressedFeedback(
            Instrumentation instrumentation,
            Activity activity,
            java.util.function.Supplier<android.view.View> target,
            String name)
            throws Exception {
        android.graphics.Rect bounds = new android.graphics.Rect();
        long down = android.os.SystemClock.uptimeMillis();
        instrumentation.runOnMainSync(
                () -> {
                    android.view.View control = target.get();
                    assertNotNull(control);
                    assertTrue(control.getGlobalVisibleRect(bounds));
                });
        Bitmap before = saveScreenshot(instrumentation, activity, "feedback-before.png");
        instrumentation.runOnMainSync(
                () -> {
                    android.view.MotionEvent event =
                            android.view.MotionEvent.obtain(
                                    down,
                                    down,
                                    android.view.MotionEvent.ACTION_DOWN,
                                    bounds.centerX(),
                                    bounds.centerY(),
                                    0);
                    activity.dispatchTouchEvent(event);
                    event.recycle();
                });
        // Hold the finger through Android's list tap timeout and the ripple's first painted frames.
        Thread.sleep(180);
        Bitmap pressed =
                saveScreenshot(instrumentation, activity, "widget-pressed-" + name + ".png");
        instrumentation.runOnMainSync(
                () -> {
                    android.view.MotionEvent event =
                            android.view.MotionEvent.obtain(
                                    down,
                                    android.os.SystemClock.uptimeMillis(),
                                    android.view.MotionEvent.ACTION_CANCEL,
                                    bounds.centerX(),
                                    bounds.centerY(),
                                    0);
                    activity.dispatchTouchEvent(event);
                    event.recycle();
                });
        int changed = 0;
        for (int y = Math.max(0, bounds.top); y < Math.min(before.getHeight(), bounds.bottom); y++)
            for (int x = Math.max(0, bounds.left);
                    x < Math.min(before.getWidth(), bounds.right);
                    x++) if (before.getPixel(x, y) != pressed.getPixel(x, y)) changed++;
        before.recycle();
        pressed.recycle();
        assertTrue("No painted pressed feedback for " + name + ": " + changed, changed > 20);
        Thread.sleep(250);
    }

    private static android.view.View findById(android.view.View root, int id) {
        if (root.getId() == id) return root;
        if (root instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) root;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.view.View found = findById(group.getChildAt(i), id);
                if (found != null) return found;
            }
        }
        return null;
    }

    private static Bitmap saveScreenshot(
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
        return screenshot;
    }

    private static android.widget.ListView findList(android.view.View view) {
        if (view instanceof android.widget.ListView && view.getId() == R.id.widget_list)
            return (android.widget.ListView) view;
        if (view instanceof android.view.ViewGroup) {
            android.view.ViewGroup group = (android.view.ViewGroup) view;
            for (int i = 0; i < group.getChildCount(); i++) {
                android.widget.ListView found = findList(group.getChildAt(i));
                if (found != null) return found;
            }
        }
        return null;
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
        if (!ready[0]) saveScreenshot(instrumentation, host, "widgets-failed.png").recycle();
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
