package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.app.NotificationManager;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 36})
public class ReminderAccountsTest {
    private Context context;
    private static final String NOTE = "0199a0a0-0000-7000-8000-000000000001";

    @Before
    public void setup() {
        context = RuntimeEnvironment.getApplication();
        ReminderAlarms.preferences(context).edit().clear().commit();
        context.getSystemService(NotificationManager.class).cancelAll();
    }

    private void account(String id, String server) throws Exception {
        ReminderAlarms.sync(context, id, new JSONObject().put("server", server),
                new JSONArray().put(new JSONObject().put("noteId", NOTE).put("title", id)
                        .put("times", new JSONArray()).put("timeZone", JSONObject.NULL)));
    }

    @Test
    public void identicalNotesOnDifferentServersKeepBothSnoozesAndAcknowledgeOnlyTheirOwner() throws Exception {
        account("home", "https://home.example");
        account("work", "https://work.example");
        ReminderAlarms.snooze(context, "home", NOTE, "Home", "");
        ReminderAlarms.snooze(context, "work", NOTE, "Work", "");
        assertEquals(2, ReminderAlarms.pendingSnoozes(context).length());
        ReminderAlarms.ackSnoozes(context, "home", Set.of(NOTE));
        JSONArray snoozes = ReminderAlarms.pendingSnoozes(context);
        assertEquals(1, snoozes.length());
        assertEquals("work", snoozes.getJSONObject(0).getString("account"));
        ReminderAlarms.clear(context, "home");
        assertEquals("https://work.example", ReminderAlarms.accounts(context).getJSONObject("work").getString("server"));
        assertEquals(1, ReminderAlarms.pendingSnoozes(context).length());
    }

    @Test
    public void adoptedUnownedSnoozesBelongToTheFirstAccountOnly() throws Exception {
        ReminderAlarms.preferences(context).edit().putString("snoozes", new JSONArray().put(
                new JSONObject().put("noteId", NOTE).put("until", System.currentTimeMillis() + 60000)).toString()).commit();
        account("home", "https://home.example");
        account("work", "https://work.example");
        assertEquals("home", ReminderAlarms.pendingSnoozes(context).getJSONObject(0).getString("account"));
        ReminderAlarms.ackSnoozes(context, "work", Set.of(NOTE));
        assertEquals(1, ReminderAlarms.pendingSnoozes(context).length());
        ReminderAlarms.ackSnoozes(context, "home", Set.of(NOTE));
        assertEquals(0, ReminderAlarms.pendingSnoozes(context).length());
    }

    @Test
    public void scheduledIntentsIncludeTheAccountEvenWhenNoteIdsMatch() throws Exception {
        account("home", "https://home.example");
        account("work", "https://work.example");
        ReminderAlarms.preferences(context).edit().putBoolean("enabled", true).commit();
        ReminderAlarms.snooze(context, "home", NOTE, "Home", "");
        ReminderAlarms.snooze(context, "work", NOTE, "Work", "");
        Set<String> scheduled = ReminderAlarms.preferences(context).getStringSet("scheduled", Set.of());
        assertEquals(2, scheduled.size());
        assertTrue(scheduled.contains("catch://reminder/home/" + NOTE));
        assertTrue(scheduled.contains("catch://reminder/work/" + NOTE));
    }

    @Test
    public void notificationsAndDismissalAreIsolatedByAccount() throws Exception {
        java.lang.reflect.Method ring = ReminderAlarms.class.getDeclaredMethod("ring", Context.class,
                String.class, String.class, JSONObject.class);
        ring.setAccessible(true);
        JSONObject alarm = new JSONObject().put("noteId", NOTE).put("title", "Same ID");
        ring.invoke(null, context, "home", "Home", alarm);
        ring.invoke(null, context, "work", "Work", alarm);
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        assertEquals(2, manager.getActiveNotifications().length);
        ReminderAlarms.clear(context, "home");
        StatusBarNotification[] remaining = manager.getActiveNotifications();
        assertEquals(1, remaining.length);
        assertEquals(ReminderAlarms.reminderKey("work", NOTE), remaining[0].getTag());
    }
}
