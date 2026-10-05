package org.iloni.catchnotes;

import android.app.job.JobParameters;
import android.app.job.JobService;
import android.content.SharedPreferences;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

/**
 * Asks the server for the user's reminders now and then, so one set on another device rings
 * on a phone whose app has not been opened since. The server answers with the same alarms
 * the web app hands over when it runs (GET /api/reminders/alarms).
 */
public class ReminderRefreshService extends JobService {
    private static final int TIMEOUT_MS = 20_000;

    @Override
    public boolean onStartJob(JobParameters parameters) {
        new Thread(() -> {
            refresh();
            jobFinished(parameters, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters parameters) {
        // Nothing is half-written by stopping; the next period tries again.
        return false;
    }

    private void refresh() {
        SharedPreferences preferences = ReminderAlarms.preferences(this);
        String server = preferences.getString("server", null);
        String token = preferences.getString("token", null);
        if (server == null || token == null || !ReminderAlarms.enabled(this)) return;
        // The app closed with changes it had not sent. The server's list is older than the
        // phone's until the app runs again and sends them, and must not replace it.
        if (preferences.getBoolean("unsent", false)) return;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(server + "/api/reminders/alarms").openConnection();
            connection.setConnectTimeout(TIMEOUT_MS);
            connection.setReadTimeout(TIMEOUT_MS);
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("X-Catch-Protocol", preferences.getString("protocol", ""));
            int status = connection.getResponseCode();
            if (status == 401) {
                // The session has ended. The token is of no more use, here or to anyone else.
                if (token.equals(preferences.getString("token", null))) {
                    preferences.edit().remove("token").apply();
                    ReminderAlarms.schedule(this);
                }
                return;
            }
            // An older server, a server being restored: what the phone has stands.
            if (status != 200) return;
            ByteArrayOutputStream body = new ByteArrayOutputStream();
            try (InputStream stream = connection.getInputStream()) {
                byte[] buffer = new byte[8192];
                for (int read; (read = stream.read(buffer)) > 0; ) body.write(buffer, 0, read);
            }
            JSONObject answer = new JSONObject(new String(body.toByteArray(), StandardCharsets.UTF_8));
            // The account may have been signed out of while the request was in the air.
            if (!token.equals(preferences.getString("token", null))) return;
            if (preferences.getBoolean("unsent", false)) return;
            ReminderAlarms.store(this, answer.getJSONArray("alarms"));
            ReminderAlarms.schedule(this);
        } catch (Exception offline) {
            // No network, or an answer that is not the server's. The next period tries again.
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
