package org.iloni.catchnotes;

import android.content.Context;
import android.util.AtomicFile;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Disposable launcher data lives outside backup, separately from synced SQLite and the outbox. */
final class WidgetStore {
    private static JSONObject state;
    private static String session = "";
    private static String activeAccount = "";

    private static AtomicFile file(Context context) {
        return new AtomicFile(new File(context.getNoBackupFilesDir(), "widgets-v1.json"));
    }

    static synchronized JSONObject state(Context context) {
        if (state == null) {
            try {
                state =
                        new JSONObject(
                                new String(file(context).readFully(), StandardCharsets.UTF_8));
            } catch (Exception ignored) {
                state = new JSONObject();
            }
        }
        return state;
    }

    private static void save(Context context) {
        AtomicFile file = file(context);
        FileOutputStream stream = null;
        try {
            stream = file.startWrite();
            stream.write(state(context).toString().getBytes(StandardCharsets.UTF_8));
            file.finishWrite(stream);
        } catch (Exception error) {
            if (stream != null) file.failWrite(stream);
            throw new IllegalStateException("Could not save widgets on this device", error);
        }
    }

    static JSONObject object(JSONObject parent, String key) {
        JSONObject value = parent.optJSONObject(key);
        return value == null ? new JSONObject() : value;
    }

    static JSONArray array(JSONObject parent, String key) {
        JSONArray value = parent.optJSONArray(key);
        return value == null ? new JSONArray() : value;
    }

    static void put(JSONObject parent, String key, Object value) {
        try {
            parent.put(key, value);
        } catch (JSONException error) {
            throw new IllegalArgumentException(error);
        }
    }

    static synchronized String begin(
            Context context, String account, String server, JSONArray accounts) {
        JSONObject root = state(context);
        boolean multipleServers = accounts.length() > 0 && accounts.optJSONObject(0).has("server");
        if (!multipleServers && !server.equals(root.optString("server"))) {
            root = new JSONObject();
            state = root;
        }
        put(root, "server", server);
        JSONObject kept = new JSONObject();
        JSONObject old = object(root, "accounts");
        for (int i = 0; i < accounts.length(); i++) {
            JSONObject given = accounts.optJSONObject(i);
            if (given == null || given.optString("id").isEmpty()) continue;
            String id = given.optString("id");
            JSONObject entry = object(old, id);
            String origin = given.optString("server", server);
            if (!origin.equals(entry.optString("server", origin))) entry = new JSONObject();
            put(entry, "label", given.optString("label"));
            put(entry, "server", origin);
            put(kept, id, entry);
        }
        put(root, "accounts", kept);
        activeAccount = account;
        session = UUID.randomUUID().toString();
        save(context);
        return session;
    }

    static synchronized boolean sync(Context context, String generation, JSONObject snapshot) {
        if (generation == null || generation.isEmpty() || !generation.equals(session)) return false;
        JSONObject accounts = object(state(context), "accounts");
        JSONObject account = accounts.optJSONObject(activeAccount);
        if (account == null || snapshot.optInt("version") != 1) return false;
        // Text arrives before image reads. Keep an offline thumbnail only while its source
        // still belongs to this note; deleting/hiding/changing it must remove the old pixels.
        Map<String, JSONObject> previous = new HashMap<>();
        JSONArray oldNotes = array(object(account, "snapshot"), "notes");
        for (int i = 0; i < oldNotes.length(); i++) {
            JSONObject note = oldNotes.optJSONObject(i);
            if (note != null) previous.put(note.optString("id"), note);
        }
        JSONArray newNotes = array(snapshot, "notes");
        for (int i = 0; i < newNotes.length(); i++) {
            JSONObject note = newNotes.optJSONObject(i);
            if (note == null || note.has("image")) continue;
            JSONObject old = previous.get(note.optString("id"));
            String key = note.optString("imageKey");
            if (!key.isEmpty()
                    && old != null
                    && key.equals(old.optString("imageKey"))
                    && old.has("image")) put(note, "image", old.optString("image"));
        }
        put(account, "snapshot", snapshot);
        put(account, "updated", System.currentTimeMillis());
        save(context);
        return true;
    }

    static synchronized void clear(Context context, String account) {
        JSONObject root = state(context);
        if (account == null) {
            put(root, "accounts", new JSONObject());
            session = "";
        } else {
            object(root, "accounts").remove(account);
            if (account.equals(activeAccount)) session = "";
        }
        JSONObject pending = object(root, "pending");
        if (account == null || account.equals(pending.optString("account"))) root.remove("pending");
        save(context);
    }

    static synchronized JSONObject account(Context context, String id) {
        return object(object(state(context), "accounts"), id);
    }

    static synchronized JSONObject config(Context context, int id) {
        return object(object(state(context), "widgets"), String.valueOf(id));
    }

    static synchronized void configure(Context context, int id, JSONObject config) {
        JSONObject widgets = object(state(context), "widgets");
        put(widgets, String.valueOf(id), config);
        put(state(context), "widgets", widgets);
        save(context);
    }

    static synchronized void delete(Context context, int id) {
        object(state(context), "widgets").remove(String.valueOf(id));
        save(context);
    }

    static synchronized JSONObject snapshot(Context context, JSONObject config) {
        return object(account(context, config.optString("account")), "snapshot");
    }

    static List<JSONObject> notes(JSONObject snapshot, JSONObject config) {
        List<JSONObject> found = new ArrayList<>();
        JSONArray notes = array(snapshot, "notes");
        String filter = config.optString("filter", "pinned");
        String target = config.optString("target");
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (note == null) continue;
            boolean matches =
                    "single".equals(config.optString("kind"))
                            ? target.equals(note.optString("id"))
                            : "all".equals(filter)
                                    ? true
                                    : "gallery".equals(filter)
                                            ? note.isNull("column")
                                            : "pinned".equals(filter)
                                                    ? note.optBoolean("pinned")
                                                    : "column".equals(filter)
                                                            ? target.equals(
                                                                    note.optString("column"))
                                                            : contains(array(note, "tags"), target);
            if (matches) found.add(note);
        }
        return found;
    }

    private static boolean contains(JSONArray values, String target) {
        for (int i = 0; i < values.length(); i++)
            if (target.equals(values.optString(i))) return true;
        return false;
    }

    static String choiceName(JSONObject snapshot, String key, String target) {
        JSONArray choices = array(snapshot, key);
        for (int i = 0; i < choices.length(); i++) {
            JSONObject choice = choices.optJSONObject(i);
            if (choice != null && target.equals(choice.optString("id")))
                return choice.optString("name");
        }
        return "";
    }

    /** A widget names only IDs; resolve actions against its current configuration and account. */
    static synchronized JSONObject launch(
            Context context, int widgetId, String action, String noteId) {
        JSONObject config = config(context, widgetId);
        String account = config.optString("account");
        if (account(context, account).length() == 0) return null;
        JSONObject snapshot = snapshot(context, config);
        JSONObject launch = new JSONObject();
        if ("note".equals(action)) {
            boolean found = false;
            for (JSONObject note : notes(snapshot, config))
                if (note.optString("id").equals(noteId)) found = true;
            if (!found) return null;
            put(launch, "noteId", noteId);
        } else if ("compose".equals(action)) {
            if ("single".equals(config.optString("kind"))) return null;
            if ("column".equals(config.optString("filter"))) {
                String column = config.optString("target");
                if (choiceName(snapshot, "columns", column).isEmpty()) return null;
                put(launch, "column", column);
            }
        } else if (!"search".equals(action) || !"capture".equals(config.optString("kind")))
            return null;
        put(launch, "id", UUID.randomUUID().toString());
        put(launch, "account", account);
        put(launch, "server", account(context, account).optString("server", state(context).optString("server")));
        put(launch, "action", action);
        put(state(context), "pending", launch);
        save(context);
        return launch;
    }

    static synchronized JSONObject pending(Context context) {
        return object(state(context), "pending");
    }

    static synchronized void acknowledge(Context context, String id) {
        if (pending(context).optString("id").equals(id)) {
            state(context).remove("pending");
            save(context);
        }
    }
}
