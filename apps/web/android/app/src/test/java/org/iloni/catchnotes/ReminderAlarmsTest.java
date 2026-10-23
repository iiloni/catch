package org.iloni.catchnotes;

import static org.junit.Assert.assertEquals;

import android.app.NotificationManager;
import android.content.Context;
import java.text.SimpleDateFormat;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowNotificationManager;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class ReminderAlarmsTest {
    private static final String NOTE = "0199a000-0000-7000-8000-000000000001";
    private static final String ACCOUNT = "alice";

    private Context context;
    private ShadowNotificationManager notifications;

    @Before
    public void setup() {
        context = RuntimeEnvironment.getApplication();
        ReminderAlarms.clear(context, null);
        ReminderAlarms.preferences(context).edit().putBoolean("enabled", true).apply();
        notifications = Shadows.shadowOf(context.getSystemService(NotificationManager.class));
    }

    /** A wall clock time in UTC, some minutes from now (or ago, when negative). */
    private static String wall(int minutes) {
        SimpleDateFormat format = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm", Locale.ROOT);
        format.setTimeZone(TimeZone.getTimeZone("UTC"));
        return format.format(System.currentTimeMillis() + minutes * 60_000L);
    }

    private static JSONArray alarms(String... times) throws Exception {
        JSONArray list = new JSONArray();
        for (String time : times) list.put(time);
        return new JSONArray().put(new JSONObject()
                .put("noteId", NOTE)
                .put("title", "Call the bank")
                .put("body", "")
                .put("times", list)
                .put("timeZone", "UTC")
                .put("snoozedUntil", JSONObject.NULL));
    }

    private void sync(JSONArray alarms) throws Exception {
        ReminderAlarms.sync(context, ACCOUNT, new JSONObject().put("label", "Alice"), alarms);
        ReminderAlarms.schedule(context);
    }

    @Test
    public void ringsADueReminderOnce() throws Exception {
        sync(alarms(wall(-2)));
        assertEquals(1, notifications.size());
        ReminderAlarms.dismiss(context, NOTE);

        sync(alarms(wall(-2)));
        assertEquals(0, notifications.size());
    }

    @Test
    public void doesNotRingAgainWhenAnOlderCopyOfTheReminderComesBack() throws Exception {
        String time = wall(-2);
        sync(alarms(time));
        assertEquals(1, notifications.size());
        // Done on the notification.
        ReminderAlarms.dismiss(context, NOTE);

        // The server moved the reminder on, and the background check brought that.
        ReminderAlarms.store(context, ACCOUNT, new JSONArray());
        ReminderAlarms.schedule(context);

        // The app opens on the reminders it kept, from before the server moved it on.
        sync(alarms(time));
        assertEquals(0, notifications.size());
    }

    @Test
    public void stillRingsTheReminderSetAgainForLater() throws Exception {
        sync(alarms(wall(-2)));
        ReminderAlarms.dismiss(context, NOTE);
        ReminderAlarms.store(context, ACCOUNT, new JSONArray());
        ReminderAlarms.schedule(context);

        sync(alarms(wall(5)));
        assertEquals(0, notifications.size());
        assertEquals(1, ReminderAlarms.preferences(context).getStringSet("scheduled", null).size());
    }
}
