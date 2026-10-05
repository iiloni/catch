package org.iloni.catchnotes;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.text.format.DateFormat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** The web app's side of the phone's reminders: what to ring, and what was done about it. */
@CapacitorPlugin(
        name = "Reminders",
        permissions = @Permission(alias = "notifications", strings = Manifest.permission.POST_NOTIFICATIONS))
public class RemindersPlugin extends Plugin {

    @Override
    public void load() { opened(getActivity().getIntent()); }

    @Override
    protected void handleOnNewIntent(Intent intent) { opened(intent); }

    /** A tapped notification opens its note, once the web app is there to hear of it. */
    private void opened(Intent intent) {
        if (intent == null || !ReminderAlarms.ACTION_OPEN.equals(intent.getAction())) return;
        String noteId = intent.getStringExtra(ReminderAlarms.NOTE);
        if (noteId == null) return;
        // A rotation or a return from the background must not open it again.
        intent.setAction(Intent.ACTION_MAIN);
        ReminderAlarms.dismiss(getContext(), noteId);
        String account = intent.getStringExtra(ReminderAlarms.ACCOUNT);
        // The web app switches to the account whose note it is before opening it.
        notifyListeners("open", new JSObject().put("noteId", noteId).put("userId", account == null ? "" : account), true);
    }

    private String permission() {
        if (NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) return "granted";
        boolean askable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && getPermissionState("notifications") != PermissionState.DENIED;
        return askable ? "prompt" : "denied";
    }

    private JSObject state() {
        return new JSObject()
                .put("enabled", ReminderAlarms.enabled(getContext()))
                .put("permission", permission())
                // The system's own 12 or 24 hour switch, which a page cannot read.
                .put("hour24", DateFormat.is24HourFormat(getContext()));
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(state()); }

    @PluginMethod
    public void enable(PluginCall call) {
        if ("prompt".equals(permission())) {
            requestPermissionForAlias("notifications", call, "asked");
            return;
        }
        asked(call);
    }

    @PermissionCallback
    private void asked(PluginCall call) {
        boolean granted = "granted".equals(permission());
        ReminderAlarms.preferences(getContext()).edit().putBoolean("enabled", granted).apply();
        ReminderAlarms.schedule(getContext());
        call.resolve(state());
    }

    @PluginMethod
    public void disable(PluginCall call) {
        ReminderAlarms.preferences(getContext()).edit().putBoolean("enabled", false).apply();
        ReminderAlarms.schedule(getContext());
        call.resolve(state());
    }

    /** Everything the phone needs to ring without the app: the alarms, and where to ask for more. */
    @PluginMethod
    public void sync(PluginCall call) {
        JSArray alarms = call.getArray("alarms", new JSArray());
        String account = call.getString("account");
        if (account == null || account.isEmpty()) {
            call.reject("The reminders name no account.");
            return;
        }
        try {
            ReminderAlarms.sync(getContext(), account, new JSONObject()
                    .put("label", call.getString("label", ""))
                    .put("server", call.getString("server"))
                    .put("token", call.getString("token"))
                    .put("protocol", call.getString("protocol"))
                    // Changes still waiting on this device are ones the server cannot tell of.
                    .put("unsent", Boolean.TRUE.equals(call.getBoolean("unsent", false))),
                    new JSONArray(alarms.toString()));
        } catch (JSONException error) {
            call.reject("The reminders could not be read.");
            return;
        }
        ReminderAlarms.schedule(getContext());
        call.resolve();
    }

    @PluginMethod
    public void configure(PluginCall call) {
        Integer minutes = call.getInt("snoozeMinutes");
        if (minutes == null || minutes <= 0) {
            call.reject("The snooze length could not be read.");
            return;
        }
        ReminderAlarms.preferences(getContext()).edit().putInt("snoozeMinutes", minutes).apply();
        call.resolve();
    }

    @PluginMethod
    public void pendingSnoozes(PluginCall call) {
        call.resolve(new JSObject().put("snoozes", ReminderAlarms.pendingSnoozes(getContext())));
    }

    @PluginMethod
    public void ackSnoozes(PluginCall call) {
        Set<String> noteIds = new HashSet<>();
        JSArray given = call.getArray("noteIds", new JSArray());
        for (int index = 0; index < given.length(); index++) noteIds.add(given.optString(index));
        ReminderAlarms.ackSnoozes(getContext(), noteIds);
        call.resolve();
    }

    @PluginMethod
    public void test(PluginCall call) {
        ReminderAlarms.test(getContext());
        call.resolve();
    }

    @PluginMethod
    public void clear(PluginCall call) {
        ReminderAlarms.clear(getContext(), call.getString("account"));
        call.resolve();
    }
}
