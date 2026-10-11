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
                Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
                assertNotNull(screenshot);
                File file =
                        new File(
                                instrumentation.getTargetContext().getExternalFilesDir(null),
                                "widgets-" + theme + ".png");
                try (FileOutputStream stream = new FileOutputStream(file)) {
                    screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream);
                }
                android.content.Context targetContext = instrumentation.getTargetContext();
                WidgetStore.clear(targetContext, "widget-test");
                CatchWidgetProvider.updateAll(targetContext);
                awaitVisibleTitles(instrumentation, host, 0);
                WidgetTestHost.seed(targetContext);
                CatchWidgetProvider.updateAll(targetContext);
                awaitVisibleTitles(instrumentation, host, 2);
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
        if (!ready[0]) {
            Bitmap screenshot = instrumentation.getUiAutomation().takeScreenshot();
            if (screenshot != null) {
                try (FileOutputStream stream =
                        new FileOutputStream(
                                new File(
                                        instrumentation
                                                .getTargetContext()
                                                .getExternalFilesDir(null),
                                        "widgets-failed.png"))) {
                    screenshot.compress(Bitmap.CompressFormat.PNG, 100, stream);
                }
            }
        }
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
