package org.iloni.catchnotes;

import static org.junit.Assert.*;

import android.app.NotificationManager;
import android.app.AlarmManager;
import android.content.Intent;
import android.content.Context;
import android.service.notification.StatusBarNotification;
import java.util.Set;
import java.util.HashSet;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.Shadows;
import org.robolectric.shadows.ShadowAlarmManager;
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
        Set<String> intents = new HashSet<>();
        for (ShadowAlarmManager.ScheduledAlarm alarm : Shadows.shadowOf(context.getSystemService(AlarmManager.class)).getScheduledAlarms()) {
            Intent intent = Shadows.shadowOf(alarm.operation).getSavedIntent();
            intents.add(intent.getData().toString());
            assertEquals(NOTE, intent.getStringExtra(ReminderAlarms.NOTE));
            assertEquals(intent.getData().getPathSegments().get(0), intent.getStringExtra(ReminderAlarms.ACCOUNT));
        }
        assertEquals(scheduled, intents);
    }

    @Test
    public void missingAccountAcknowledgementCannotClearAnOwnedSnooze() throws Exception {
        account("home", "https://home.example");
        account("work", "https://work.example");
        ReminderAlarms.snooze(context, "home", NOTE, "Home", "");
        ReminderAlarms.snooze(context, "work", NOTE, "Work", "");
        ReminderAlarms.ackSnoozes(context, null, Set.of(NOTE));
        assertEquals(2, ReminderAlarms.pendingSnoozes(context).length());
        ReminderAlarms.ackSnoozes(context, "", Set.of(NOTE));
        assertEquals(2, ReminderAlarms.pendingSnoozes(context).length());
    }

    @Test
    public void bootTimeLegacyReceiptsSurviveAdoptionWithoutRingingAgain() throws Exception {
        long now = System.currentTimeMillis();
        String wall = DateTimeFormatter.ofPattern("uuuu-MM-dd'T'HH:mm").withZone(ZoneOffset.UTC).format(Instant.ofEpochMilli(now - 120000));
        JSONArray times = new JSONArray().put(wall);
        JSONArray alarms = new JSONArray().put(new JSONObject().put("noteId", NOTE).put("title", "Already rung").put("times", times).put("timeZone", "UTC"));
        ReminderAlarms.preferences(context).edit()
                .putString("alarms", alarms.toString()).putBoolean("enabled", true)
                .putString("rung", new JSONObject().put(NOTE, now - 60000).toString())
                .putString("walls", new JSONObject().put(NOTE, new JSONObject().put("wall", wall).put("times", times.toString())).toString()).commit();
        ReminderAlarms.schedule(context);
        assertTrue(new JSONObject(ReminderAlarms.preferences(context).getString("rung", "{}")).has(":" + NOTE));
        ReminderAlarms.sync(context, "home", new JSONObject(), alarms);
        ReminderAlarms.schedule(context);
        String adopted = ReminderAlarms.reminderKey("home", NOTE);
        assertTrue(new JSONObject(ReminderAlarms.preferences(context).getString("rung", "{}")).has(adopted));
        assertTrue(new JSONObject(ReminderAlarms.preferences(context).getString("walls", "{}")).has(adopted));
        assertEquals(0, context.getSystemService(NotificationManager.class).getActiveNotifications().length);
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
