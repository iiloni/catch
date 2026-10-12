package org.iloni.catchnotes;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Activity;
import android.app.Instrumentation;
import android.appwidget.AppWidgetHost;
import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.SystemClock;

import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/** Real bundled app and IME. Use only a disposable emulator or a separate test application ID. */
@RunWith(AndroidJUnit4.class)
public class WidgetInputInstrumentedTest {
    @Test
    public void freshWidgetActivitiesFocusTheirInputsAndShowIme() throws Exception {
        Instrumentation instrumentation = InstrumentationRegistry.getInstrumentation();
        Context context = instrumentation.getTargetContext();
        String server = InstrumentationRegistry.getArguments().getString("server");
        assertNotNull("Build with CATCH_DEV_SERVER_URL and pass the same server argument", server);
        HttpURLConnection connection =
                (HttpURLConnection) new URL(server + "/api/auth/sign-up/email").openConnection();
        connection.setRequestMethod("POST");
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setRequestProperty("Origin", "https://localhost");
        connection.setDoOutput(true);
        JSONObject signup =
                new JSONObject()
                        .put("name", "Widget input test")
                        .put("email", "widget-ime-" + System.currentTimeMillis() + "@example.com")
                        .put("password", "widget-input-test-password");
        try (java.io.OutputStream output = connection.getOutputStream()) {
            output.write(signup.toString().getBytes(StandardCharsets.UTF_8));
        }
        assertEquals("Fixture signup failed", 200, connection.getResponseCode());
        JSONObject user;
        try (java.io.InputStream input = connection.getInputStream()) {
            user =
                    new JSONObject(new String(readBytes(input), StandardCharsets.UTF_8))
                            .getJSONObject("user");
        }
        String token = connection.getHeaderField("set-auth-token");
        assertNotNull("Fixture signup has no bearer token", token);
        connection.disconnect();
        MainActivity setup = launch(instrumentation, null);
        await(
                instrumentation,
                setup,
                "Boolean(window.Capacitor?.Plugins?.KeyboardInsets)",
                "Bridge not ready");
        evaluate(
                instrumentation,
                setup,
                "localStorage.setItem("
                        + JSONObject.quote("catch-user:" + server)
                        + ","
                        + JSONObject.quote(user.toString())
                        + ");"
                        + "localStorage.setItem("
                        + JSONObject.quote("catch-auth-token:" + server)
                        + ","
                        + JSONObject.quote(token)
                        + ");true");
        finish(instrumentation, setup);
        WidgetStore.begin(
                context,
                user.getString("id"),
                server,
                new JSONArray()
                        .put(
                                new JSONObject()
                                        .put("id", user.getString("id"))
                                        .put("label", "Widget input test")));
        try (android.os.ParcelFileDescriptor command =
                instrumentation
                        .getUiAutomation()
                        .executeShellCommand(
                                "appwidget grantbind --package "
                                        + context.getPackageName()
                                        + " --user 0")) {
            try (FileInputStream input = new FileInputStream(command.getFileDescriptor())) {
                while (input.read() != -1) {}
            }
        }
        AppWidgetHost host = new AppWidgetHost(context, 224);
        JSONObject fixtures = new JSONObject();
        try {
            for (String kind : new String[] {"capture", "list"}) {
                int id = host.allocateAppWidgetId();
                Class<?> provider =
                        kind.equals("capture")
                                ? CatchWidgetProvider.Capture.class
                                : CatchWidgetProvider.Notes.class;
                assertTrue(
                        "Widget binding failed",
                        AppWidgetManager.getInstance(context)
                                .bindAppWidgetIdIfAllowed(
                                        id, new ComponentName(context, provider)));
                WidgetStore.configure(
                        context,
                        id,
                        new JSONObject()
                                .put("account", user.getString("id"))
                                .put("kind", kind)
                                .put("filter", "all")
                                .put("theme", "system"));
                fixtures.put(kind, id);
                if ("true"
                        .equals(InstrumentationRegistry.getArguments().getString("keepFixtures"))) {
                    try (FileOutputStream output =
                            new FileOutputStream(
                                    new File(
                                            context.getExternalFilesDir(null),
                                            "widget-input-fixtures.json"))) {
                        output.write(fixtures.toString().getBytes(StandardCharsets.UTF_8));
                    }
                }
                for (String action :
                        kind.equals("capture")
                                ? new String[] {"compose", "search"}
                                : new String[] {"compose"}) {
                    Intent tap =
                            new Intent(context, MainActivity.class)
                                    .setAction(WidgetsPlugin.ACTION)
                                    .putExtra("widgetId", id)
                                    .putExtra("command", action)
                                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    MainActivity activity = launch(instrumentation, tap);
                    try {
                        String target =
                                action.equals("search")
                                        ? "document.querySelector('input[aria-label=\"Search"
                                                + " notes\"]')"
                                        : "document.querySelector('[data-quick-note-body]"
                                                + " [contenteditable=\"true\"]')";
                        await(
                                instrumentation,
                                activity,
                                "(()=>{window.Capacitor?.Plugins?.KeyboardInsets.current().then(v=>window.__testIme=v.keyboard);const"
                                    + " target="
                                        + target
                                        + ";return !!target && target===document.activeElement &&"
                                        + " window.__testIme>100;})()",
                                "No focused input/visible native IME for " + kind + "/" + action);
                        // Use the IME contract instead of hardware key codes, whose characters
                        // depend on the device's current physical-keyboard layout.
                        instrumentation.runOnMainSync(
                                () -> {
                                    android.view.inputmethod.InputConnection input =
                                            activity.getBridge()
                                                    .getWebView()
                                                    .onCreateInputConnection(
                                                            new android.view.inputmethod
                                                                    .EditorInfo());
                                    assertNotNull("Focused WebView has no IME connection", input);
                                    assertTrue(
                                            "IME rejected text",
                                            input.commitText("Widget keyboard input", 1));
                                });
                        await(
                                instrumentation,
                                activity,
                                "(()=>{const target="
                                        + target
                                        + ";return !!target && (target.value ??"
                                        + " target.textContent).includes('Widget keyboard"
                                        + " input');})()",
                                "Input did not receive typing for " + kind + "/" + action);
                    } finally {
                        finish(instrumentation, activity);
                    }
                }
            }
            if ("true".equals(InstrumentationRegistry.getArguments().getString("keepFixtures"))) {
                try (FileOutputStream output =
                        new FileOutputStream(
                                new File(
                                        context.getExternalFilesDir(null),
                                        "widget-input-fixtures.json"))) {
                    output.write(fixtures.toString().getBytes(StandardCharsets.UTF_8));
                }
            }
        } finally {
            if (!"true".equals(InstrumentationRegistry.getArguments().getString("keepFixtures")))
                host.deleteHost();
        }
    }

    private static byte[] readBytes(java.io.InputStream input) throws java.io.IOException {
        java.io.ByteArrayOutputStream output = new java.io.ByteArrayOutputStream();
        byte[] buffer = new byte[4096];
        int count;
        while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
        return output.toByteArray();
    }

    private static MainActivity launch(Instrumentation instrumentation, Intent intent) {
        MainActivity activity =
                (MainActivity)
                        instrumentation.startActivitySync(
                                intent != null
                                        ? intent
                                        : new Intent(
                                                        instrumentation.getTargetContext(),
                                                        MainActivity.class)
                                                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(
                () ->
                        activity.getWindow()
                                .addFlags(
                                        android.view.WindowManager.LayoutParams
                                                .FLAG_KEEP_SCREEN_ON));
        return activity;
    }

    private static void finish(Instrumentation instrumentation, Activity activity)
            throws Exception {
        instrumentation.runOnMainSync(activity::finish);
        long deadline = SystemClock.uptimeMillis() + 10000;
        while (!activity.isDestroyed() && SystemClock.uptimeMillis() < deadline) Thread.sleep(50);
        assertTrue("Previous widget activity has not been destroyed", activity.isDestroyed());
    }

    private static String evaluate(
            Instrumentation instrumentation, MainActivity activity, String script)
            throws Exception {
        CountDownLatch done = new CountDownLatch(1);
        String[] result = {"null"};
        instrumentation.runOnMainSync(
                () ->
                        activity.getBridge()
                                .getWebView()
                                .evaluateJavascript(
                                        script,
                                        value -> {
                                            result[0] = value;
                                            done.countDown();
                                        }));
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return result[0];
    }

    private static void await(
            Instrumentation instrumentation, MainActivity activity, String script, String failure)
            throws Exception {
        long deadline = SystemClock.uptimeMillis() + 45000;
        do {
            if ("true".equals(evaluate(instrumentation, activity, script))) return;
            Thread.sleep(100);
        } while (SystemClock.uptimeMillis() < deadline);
        throw new AssertionError(
                failure
                        + " "
                        + evaluate(
                                instrumentation,
                                activity,
                                "JSON.stringify({path:location.pathname,windowFocused:document.hasFocus(),activeTag:document.activeElement?.tagName,label:document.activeElement?.getAttribute('aria-label'),height:window.__testIme})"));
    }
}
