package org.iloni.catchnotes;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * An alarm coming due, a tap on a notification's buttons, and whatever moves the alarms:
 * a restart (which drops them), an update of the app, a change of clock or zone.
 */
public class ReminderReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        String noteId = intent.getStringExtra(ReminderAlarms.NOTE);
        if (ReminderAlarms.ACTION_SNOOZE.equals(action) && noteId != null) {
            String title = intent.getStringExtra("title");
            String body = intent.getStringExtra("body");
            String account = intent.getStringExtra(ReminderAlarms.ACCOUNT);
            ReminderAlarms.snooze(
                    context, account == null ? "" : account, noteId, title == null ? "Reminder" : title, body == null ? "" : body);
        } else if (ReminderAlarms.ACTION_DONE.equals(action) && noteId != null) {
            ReminderAlarms.dismiss(context, noteId);
        } else {
            ReminderAlarms.schedule(context);
        }
    }
}
