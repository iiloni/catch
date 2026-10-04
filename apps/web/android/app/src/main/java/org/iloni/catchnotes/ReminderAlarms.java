package org.iloni.catchnotes;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import androidx.core.app.AlarmManagerCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Reminders on the phone (ADR 0018). The app has no Web Push, so it rings them itself: it
 * keeps each reminder's coming times, as the web app or the server last gave them, and sets
 * an alarm for the soonest of each. That works offline and with the app closed.
 */
final class ReminderAlarms {
    static final String ACTION_RING = "org.iloni.catchnotes.REMINDER_RING";
    static final String ACTION_SNOOZE = "org.iloni.catchnotes.REMINDER_SNOOZE";
    static final String ACTION_DONE = "org.iloni.catchnotes.REMINDER_DONE";
    static final String ACTION_OPEN = "org.iloni.catchnotes.OPEN_NOTE";
    static final String NOTE = "noteId";

    private static final String PREFERENCES = "reminders";
    private static final String CHANNEL = "reminders";
    private static final long SNOOZE_MS = 60L * 60 * 1000;
    private static final int REFRESH_JOB = 0x0ca7c4;
    private static final long REFRESH_MS = 60L * 60 * 1000;
    private static final int TEST_NOTIFICATION = 1;

    private ReminderAlarms() {}

    static SharedPreferences preferences(Context context) {
        return context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE);
    }

    static boolean enabled(Context context) {
        return preferences(context).getBoolean("enabled", false);
    }

    private static JSONArray array(Context context, String key) {
        try {
            return new JSONArray(preferences(context).getString(key, "[]"));
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    private static JSONObject object(Context context, String key) {
        try {
            return new JSONObject(preferences(context).getString(key, "{}"));
        } catch (JSONException error) {
            return new JSONObject();
        }
    }

    /**
     * Replaces the reminders the phone knows. A snooze taken from a notification the web app
     * has not heard of yet is laid over them: neither it nor the server knows to keep it.
     */
    static synchronized void store(Context context, JSONArray alarms) {
        JSONArray snoozes = array(context, "snoozes");
        long now = System.currentTimeMillis();
        for (int each = 0; each < snoozes.length(); each++) {
            JSONObject snooze = snoozes.optJSONObject(each);
            if (snooze == null || snooze.optLong("until") <= now) continue;
            try {
                JSONObject alarm = null;
                for (int index = 0; index < alarms.length() && alarm == null; index++) {
                    JSONObject candidate = alarms.optJSONObject(index);
                    if (candidate != null && candidate.optString(NOTE).equals(snooze.optString(NOTE))) alarm = candidate;
                }
                if (alarm == null) {
                    // A reminder that rang its last time has no alarm left to carry the snooze.
                    alarm = new JSONObject()
                            .put(NOTE, snooze.optString(NOTE))
                            .put("title", snooze.optString("title", "Reminder"))
                            .put("body", snooze.optString("body"))
                            .put("times", new JSONArray())
                            .put("timeZone", JSONObject.NULL);
                    alarms.put(alarm);
                }
                alarm.put("snoozedUntil", snooze.optLong("until"));
            } catch (JSONException ignored) {
                // Text and numbers cannot fail to be put.
            }
        }
        preferences(context).edit().putString("alarms", alarms.toString()).apply();
    }

    private static PendingIntent broadcast(Context context, String action, String noteId, int flags) {
        Intent intent = new Intent(context, ReminderReceiver.class)
                .setAction(action)
                // The data makes each note's intent its own; extras alone would share one.
                .setData(Uri.parse("catch://reminder/" + noteId))
                .putExtra(NOTE, noteId);
        return PendingIntent.getBroadcast(context, 0, intent, flags | PendingIntent.FLAG_IMMUTABLE);
    }

    private static List<String> times(JSONObject alarm) {
        List<String> times = new ArrayList<>();
        JSONArray array = alarm.optJSONArray("times");
        for (int index = 0; array != null && index < array.length(); index++) times.add(array.optString(index));
        return times;
    }

    private static TimeZone zone(JSONObject alarm) {
        String zone = alarm.isNull("timeZone") ? "" : alarm.optString("timeZone");
        // A reminder that follows the user is read in whichever zone the phone is in now.
        return zone.isEmpty() ? TimeZone.getDefault() : TimeZone.getTimeZone(zone);
    }

    /**
     * Rings what has come due and sets an alarm for what each reminder waits for next. Run
     * whenever anything changes: the reminders, the clock, the zone, a restart, an alarm.
     */
    static synchronized void schedule(Context context) {
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        SharedPreferences preferences = preferences(context);
        for (String noteId : preferences.getStringSet("scheduled", new HashSet<>())) {
            PendingIntent pending = broadcast(context, ACTION_RING, noteId, PendingIntent.FLAG_NO_CREATE);
            if (pending != null) manager.cancel(pending);
        }
        Set<String> scheduled = new HashSet<>();
        boolean enabled = enabled(context);
        if (enabled) {
            JSONArray alarms = array(context, "alarms");
            JSONObject rung = object(context, "rung");
            JSONObject kept = new JSONObject();
            long now = System.currentTimeMillis();
            for (int index = 0; index < alarms.length(); index++) {
                JSONObject alarm = alarms.optJSONObject(index);
                if (alarm == null) continue;
                String noteId = alarm.optString(NOTE);
                long snoozedUntil = alarm.isNull("snoozedUntil") ? 0 : alarm.optLong("snoozedUntil");
                long after = Math.max(rung.optLong(noteId), now - ReminderTimes.LATE_MS);
                long next = ReminderTimes.next(times(alarm), snoozedUntil, zone(alarm), after);
                if (next >= 0 && next <= now) {
                    ring(context, alarm);
                    after = now;
                    next = ReminderTimes.next(times(alarm), snoozedUntil, zone(alarm), after);
                }
                try {
                    // Only what is still a reminder is remembered, so the record cannot grow.
                    if (after > now - ReminderTimes.LATE_MS) kept.put(noteId, after);
                } catch (JSONException ignored) {
                    // A number cannot fail to be put.
                }
                if (next < 0) continue;
                PendingIntent pending = broadcast(context, ACTION_RING, noteId, PendingIntent.FLAG_UPDATE_CURRENT);
                // Exact where the system allows it; otherwise it may ring some minutes late.
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms()) {
                    AlarmManagerCompat.setExactAndAllowWhileIdle(manager, AlarmManager.RTC_WAKEUP, next, pending);
                } else {
                    manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pending);
                }
                scheduled.add(noteId);
            }
            preferences.edit().putString("rung", kept.toString()).apply();
        }
        preferences.edit().putStringSet("scheduled", scheduled).apply();
        refreshInBackground(context, enabled && preferences.getString("token", null) != null);
    }

    /** Reminders set on another device reach a phone whose app stays closed this way. */
    private static void refreshInBackground(Context context, boolean wanted) {
        JobScheduler jobs = (JobScheduler) context.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if (!wanted) {
            jobs.cancel(REFRESH_JOB);
            return;
        }
        // Scheduling it again would start its hour over each time the reminders change.
        if (jobs.getPendingJob(REFRESH_JOB) != null) return;
        jobs.schedule(new JobInfo.Builder(REFRESH_JOB, new ComponentName(context, ReminderRefreshService.class))
                .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
                .setPeriodic(REFRESH_MS)
                .setPersisted(true)
                .build());
    }

    private static void channel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel =
                new NotificationChannel(CHANNEL, "Reminders", NotificationManager.IMPORTANCE_HIGH);
        channel.setDescription("Reminders set on notes");
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    private static PendingIntent open(Context context, String noteId) {
        Intent intent = new Intent(context, MainActivity.class)
                .setAction(ACTION_OPEN)
                .setData(Uri.parse("catch://reminder/" + noteId))
                .putExtra(NOTE, noteId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(
                context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static void post(Context context, int id, NotificationCompat.Builder builder) {
        channel(context);
        try {
            NotificationManagerCompat.from(context).notify(id, builder.build());
        } catch (SecurityException denied) {
            // Notifications were turned off for the app since it last asked.
        }
    }

    private static NotificationCompat.Builder notification(Context context, String title, String body) {
        return new NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_reminder)
                .setContentTitle(title)
                .setContentText(body.isEmpty() ? null : body)
                .setStyle(body.isEmpty() ? null : new NotificationCompat.BigTextStyle().bigText(body))
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setDefaults(NotificationCompat.DEFAULT_ALL)
                .setAutoCancel(true);
    }

    private static void ring(Context context, JSONObject alarm) {
        String noteId = alarm.optString(NOTE);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        String title = alarm.optString("title", "Reminder");
        String body = alarm.optString("body");
        Intent snooze = new Intent(context, ReminderReceiver.class)
                .setAction(ACTION_SNOOZE)
                .setData(Uri.parse("catch://reminder/" + noteId))
                .putExtra(NOTE, noteId)
                .putExtra("title", title)
                .putExtra("body", body);
        post(context, noteId.hashCode(), notification(context, title, body)
                .setContentIntent(open(context, noteId))
                .addAction(0, "Snooze (1hr)", PendingIntent.getBroadcast(context, 0, snooze, flags | PendingIntent.FLAG_IMMUTABLE))
                .addAction(0, "Done", broadcast(context, ACTION_DONE, noteId, flags)));
    }

    static void test(Context context) {
        post(context, TEST_NOTIFICATION, notification(context, "Catch notifications are on", "Reminders will show up here."));
    }

    static void dismiss(Context context, String noteId) {
        NotificationManagerCompat.from(context).cancel(noteId.hashCode());
    }

    /**
     * Puts a reminder off from its notification. The phone rings it again itself; the web app
     * is told when it next runs, and passes it on to the server and the user's other devices.
     */
    static synchronized void snooze(Context context, String noteId, String title, String body) {
        long until = System.currentTimeMillis() + SNOOZE_MS;
        try {
            JSONArray snoozes = new JSONArray();
            JSONArray before = array(context, "snoozes");
            for (int index = 0; index < before.length(); index++) {
                JSONObject snooze = before.optJSONObject(index);
                if (snooze != null && !snooze.optString(NOTE).equals(noteId)) snoozes.put(snooze);
            }
            snoozes.put(new JSONObject().put(NOTE, noteId).put("until", until).put("title", title).put("body", body));
            preferences(context).edit().putString("snoozes", snoozes.toString()).apply();
        } catch (JSONException ignored) {
            // Text and a number cannot fail to be put.
        }
        store(context, array(context, "alarms"));
        dismiss(context, noteId);
        schedule(context);
    }

    /** The snoozes taken from notifications since the web app last asked. */
    static synchronized JSONArray takeSnoozes(Context context) {
        JSONArray snoozes = array(context, "snoozes");
        preferences(context).edit().remove("snoozes").apply();
        return snoozes;
    }

    /** Signing out: nothing of the account is left to ring or to ask the server with. */
    static synchronized void clear(Context context) {
        preferences(context).edit().remove("alarms").remove("snoozes").remove("rung")
                .remove("token").remove("server").remove("protocol").putBoolean("enabled", false).apply();
        schedule(context);
    }
}
