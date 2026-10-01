package org.iloni.catchnotes;

import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import androidx.core.content.IntentCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "IncomingShares")
public class IncomingSharesPlugin extends Plugin {
    private static final long MAX_BYTES = 100L * 1024 * 1024;
    static final String RECEIPT = "org.iloni.catchnotes.shareId";
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @Override
    public void load() { receive(getActivity().getIntent()); }

    @Override
    protected void handleOnNewIntent(Intent intent) { receive(intent); }

    private File directory() {
        File directory = new File(getContext().getFilesDir(), "incoming-shares");
        directory.mkdirs();
        return directory;
    }

    private static String uuidv7() {
        SecureRandom random = new SecureRandom();
        long most = (System.currentTimeMillis() << 16) | 0x7000L | (random.nextInt(4096));
        long least = (random.nextLong() & 0x3fffffffffffffffL) | 0x8000000000000000L;
        return new UUID(most, least).toString();
    }

    private static String text(Intent intent, String key) {
        CharSequence value = intent.getCharSequenceExtra(key);
        return value == null ? "" : value.toString();
    }

    private void receive(Intent intent) {
        if (intent == null || (!Intent.ACTION_SEND.equals(intent.getAction())
                && !Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) return;
        String existing = intent.getStringExtra(RECEIPT);
        String id = existing != null && existing.matches("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}") ? existing : uuidv7();
        intent.putExtra(RECEIPT, id);
        worker.execute(() -> {
            File folder = new File(directory(), id);
            File metadata = new File(folder, "share.json");
            try {
                if (metadata.isFile()) { notifyListeners("shareAvailable", new JSObject()); return; }
                folder.mkdirs();
                JSObject share = new JSObject();
                share.put("id", id);
                String title = text(intent, Intent.EXTRA_SUBJECT);
                share.put("title", title.isEmpty() ? text(intent, Intent.EXTRA_TITLE) : title);
                String caption = text(intent, Intent.EXTRA_TEXT);
                if (caption.isEmpty()) caption = text(intent, Intent.EXTRA_HTML_TEXT);
                JSArray files = new JSArray();
                try {
                    List<Uri> uris = new ArrayList<>();
                    if (Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction())) {
                        ArrayList<Uri> streams = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                        if (streams != null) uris.addAll(streams);
                    } else {
                        Uri stream = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
                        if (stream != null) uris.add(stream);
                    }
                    // Some senders provide only ClipData, or repeat EXTRA_STREAM in it.
                    ClipData clip = intent.getClipData();
                    if (clip != null) {
                        for (int i = 0; i < clip.getItemCount(); i++) {
                            ClipData.Item item = clip.getItemAt(i);
                            Uri uri = item.getUri();
                            if (uri != null && !uris.contains(uri)) uris.add(uri);
                            if (caption.isEmpty() && item.getText() != null) caption = item.getText().toString();
                        }
                    }
                    if (uris.size() > 20) throw new Exception("Share up to 20 files at a time.");
                    for (Uri uri : uris) files.put(copy(uri, folder, intent.getType()));
                    if (caption.trim().isEmpty() && title.trim().isEmpty() && files.length() == 0)
                        throw new Exception("The other app did not send any content.");
                } catch (Exception error) {
                    deleteContents(folder);
                    files = new JSArray();
                    share.put("error", error.getMessage() == null ? "Could not read the shared content." : error.getMessage());
                }
                share.put("text", caption);
                share.put("files", files);
                File temporary = new File(folder, "share.tmp");
                try (FileOutputStream output = new FileOutputStream(temporary)) {
                    output.write(share.toString().getBytes(StandardCharsets.UTF_8));
                    output.getFD().sync();
                }
                if (!temporary.renameTo(metadata)) throw new Exception("Could not save the shared content.");
                // Preserve the native receipt across activity recreation; normal launches
                // must not capture the same payload again after it has been acknowledged.
                getActivity().runOnUiThread(() -> {
                    if (getActivity().getIntent() == intent) {
                        getActivity().setIntent(new Intent(getActivity(), MainActivity.class).setAction(Intent.ACTION_MAIN));
                    }
                });
                notifyListeners("shareAvailable", new JSObject());
            } catch (Exception error) {
                android.util.Log.e("CatchShares", "Could not stage incoming share", error);
                deleteContents(folder);
                folder.delete();
                JSObject failure = new JSObject();
                failure.put("error", "Could not store the shared content on this device. Share it from the other app again.");
                notifyListeners("shareAvailable", failure, true);
            }
        });
    }

    private JSObject copy(Uri uri, File folder, String fallbackType) throws Exception {
        if (!"content".equals(uri.getScheme())) throw new Exception("The other app sent an unsupported file link.");
        String name = "Attachment";
        String type = getContext().getContentResolver().getType(uri);
        if (type == null && fallbackType != null && !fallbackType.contains("*")) type = fallbackType;
        try (Cursor cursor = getContext().getContentResolver().query(uri,
                new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn) && cursor.getLong(sizeColumn) > MAX_BYTES)
                    throw new Exception("Share files smaller than 100 MB.");
            }
        }
        File file = new File(folder, UUID.randomUUID().toString());
        long size = 0;
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
                FileOutputStream output = new FileOutputStream(file)) {
            if (input == null) throw new Exception("Could not read the shared file.");
            byte[] buffer = new byte[64 * 1024];
            int read;
            while ((read = input.read(buffer)) != -1) {
                size += read;
                if (size > MAX_BYTES) throw new Exception("Share files smaller than 100 MB.");
                output.write(buffer, 0, read);
            }
            output.getFD().sync();
        }
        if (size == 0) throw new Exception("The shared file is empty.");
        JSObject description = new JSObject();
        description.put("path", file.getAbsolutePath());
        description.put("name", name);
        description.put("mimeType", type == null ? "application/octet-stream" : type);
        return description;
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        worker.execute(() -> {
            try {
                JSArray shares = new JSArray();
                File[] folders = directory().listFiles();
                if (folders != null) {
                    List<File> ordered = new ArrayList<>();
                    Collections.addAll(ordered, folders);
                    ordered.sort((a, b) -> a.getName().compareTo(b.getName()));
                    for (File folder : ordered) {
                        File metadata = new File(folder, "share.json");
                        if (metadata.isFile()) {
                            try (FileInputStream input = new FileInputStream(metadata);
                                    ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                                byte[] buffer = new byte[8192];
                                int read;
                                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                                shares.put(new JSONObject(output.toString("UTF-8")));
                            }
                        }
                    }
                }
                JSObject result = new JSObject(); result.put("shares", shares); call.resolve(result);
            } catch (Exception error) { call.reject("Could not read pending shares.", error); }
        });
    }

    @PluginMethod
    public void acknowledge(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches("[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}")) {
            call.reject("Invalid share id."); return;
        }
        worker.execute(() -> {
            File folder = new File(directory(), id);
            deleteContents(folder);
            folder.delete();
            call.resolve();
        });
    }

    private static void deleteContents(File directory) {
        File[] files = directory.listFiles();
        if (files != null) for (File file : files) file.delete();
    }

    @Override
    protected void handleOnDestroy() { worker.shutdown(); }
}
