package org.iloni.catchnotes;

import android.Manifest;
import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.database.Cursor;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import androidx.activity.result.PickVisualMediaRequest;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.OutputStream;
import java.io.InputStream;
import java.util.UUID;

@CapacitorPlugin(name = "Attachments", permissions = {
    @Permission(alias = "microphone", strings = { Manifest.permission.RECORD_AUDIO })
})
public class AttachmentsPlugin extends Plugin {
    private static final long MAX_BYTES = 100L * 1024 * 1024;
    private MediaRecorder recorder;
    private File recording;
    private File cameraOutput;
    private boolean picking;
    private File exporting;

    private File directory() {
        File directory = new File(getContext().getCacheDir(), "attachments");
        directory.mkdirs();
        return directory;
    }

    @PluginMethod
    public void pick(PluginCall call) {
        if (picking) { call.reject("A picker is already open"); return; }
        String kind = call.getString("kind", "files");
        Intent intent;
        if ("media".equals(kind)) {
            PickVisualMediaRequest request = new PickVisualMediaRequest.Builder()
                .setMediaType(ActivityResultContracts.PickVisualMedia.ImageAndVideo.INSTANCE).build();
            intent = new ActivityResultContracts.PickMultipleVisualMedia(20).createIntent(getContext(), request);
        } else if ("camera".equals(kind)) {
            boolean video = call.getBoolean("video", false);
            cameraOutput = new File(directory(), UUID.randomUUID() + (video ? ".mp4" : ".jpg"));
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", cameraOutput);
            intent = new Intent(video ? MediaStore.ACTION_VIDEO_CAPTURE : MediaStore.ACTION_IMAGE_CAPTURE);
            intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
            intent.putExtra(MediaStore.EXTRA_SIZE_LIMIT, MAX_BYTES);
            intent.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.setClipData(ClipData.newRawUri("Capture", uri));
        } else {
            intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        }
        try { picking = true; startActivityForResult(call, intent, "picked"); }
        catch (Exception error) { picking = false; call.reject("No app is available to handle this selection", error); }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        picking = false;
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            if (cameraOutput != null) { cameraOutput.delete(); cameraOutput = null; }
            JSObject value = new JSObject(); value.put("files", new JSArray()); call.resolve(value); return;
        }
        // Reading cloud-backed document URIs can take time; keep it off the UI thread.
        getBridge().execute(() -> {
            JSArray files = new JSArray();
            try {
                Intent data = result.getData();
                if ("camera".equals(call.getString("kind")) && cameraOutput != null) {
                    File output = cameraOutput; cameraOutput = null;
                    if (output.length() > 0) {
                        if (output.length() > MAX_BYTES) { output.delete(); throw new Exception("Choose a file smaller than 100 MB"); }
                        boolean video = call.getBoolean("video", false);
                        files.put(describe(output, video ? "Video.mp4" : "Photo.jpg", video ? "video/mp4" : "image/jpeg"));
                    } else {
                        output.delete();
                        if (data != null && data.getData() != null) files.put(copy(data.getData()));
                        else throw new Exception("The camera did not save a file");
                    }
                } else if (data != null && data.getClipData() != null) {
                    ClipData selected = data.getClipData();
                    for (int i = 0; i < selected.getItemCount(); i++) files.put(copy(selected.getItemAt(i).getUri()));
                } else if (data != null && data.getData() != null) files.put(copy(data.getData()));
                JSObject value = new JSObject(); value.put("files", files); call.resolve(value);
            } catch (Exception error) {
                for (int i = 0; i < files.length(); i++) {
                    try { new File(files.getJSONObject(i).getString("path")).delete(); } catch (Exception ignored) {}
                }
                call.reject(error.getMessage(), error);
            }
        });
    }

    private JSObject copy(Uri uri) throws Exception {
        String name = "Attachment";
        String type = getContext().getContentResolver().getType(uri);
        try (Cursor cursor = getContext().getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn) && cursor.getLong(sizeColumn) > MAX_BYTES) throw new Exception("Choose a file smaller than 100 MB");
            }
        }
        File output = new File(directory(), UUID.randomUUID().toString());
        try (InputStream input = getContext().getContentResolver().openInputStream(uri); FileOutputStream stream = new FileOutputStream(output)) {
            if (input == null) throw new Exception("Could not read the selected file");
            byte[] buffer = new byte[64 * 1024];
            long size = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                size += read;
                if (size > MAX_BYTES) throw new Exception("Choose a file smaller than 100 MB");
                stream.write(buffer, 0, read);
            }
        } catch (Exception error) { output.delete(); throw error; }
        return describe(output, name, type == null ? "application/octet-stream" : type);
    }

    private JSObject describe(File file, String name, String type) {
        JSObject value = new JSObject();
        value.put("path", file.getAbsolutePath()); value.put("name", name); value.put("mimeType", type);
        return value;
    }

    @PluginMethod
    public void releaseFile(PluginCall call) {
        String path = call.getString("path", "");
        try {
            File file = new File(path);
            if (file.getCanonicalPath().startsWith(directory().getCanonicalPath() + File.separator)) file.delete();
            call.resolve();
        } catch (Exception error) { call.reject("Could not release temporary file", error); }
    }

    @PluginMethod
    public void beginExport(PluginCall call) {
        if (exporting != null) { call.reject("A download is already being saved"); return; }
        exporting = new File(directory(), "export-" + UUID.randomUUID());
        call.resolve();
    }

    @PluginMethod
    public void appendExport(PluginCall call) {
        if (exporting == null) { call.reject("No download is being saved"); return; }
        try (FileOutputStream output = new FileOutputStream(exporting, true)) {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            if (exporting.length() + bytes.length > MAX_BYTES) throw new Exception("The file exceeds 100 MB");
            output.write(bytes); call.resolve();
        } catch (Exception error) { exporting.delete(); exporting = null; call.reject("Could not prepare the download", error); }
    }

    @PluginMethod
    public void saveExport(PluginCall call) {
        if (exporting == null) { call.reject("No download is being saved"); return; }
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType", "application/octet-stream"));
        intent.putExtra(Intent.EXTRA_TITLE, call.getString("name", "Attachment"));
        try { startActivityForResult(call, intent, "exported"); }
        catch (Exception error) { exporting.delete(); exporting = null; call.reject("Could not open the save dialog", error); }
    }

    @ActivityCallback
    private void exported(PluginCall call, ActivityResult result) {
        File file = exporting; exporting = null;
        if (call == null || file == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) { file.delete(); call.resolve(); return; }
        Uri destination = result.getData().getData();
        getBridge().execute(() -> {
            try (InputStream input = new FileInputStream(file); OutputStream output = getContext().getContentResolver().openOutputStream(destination)) {
                if (output == null) throw new Exception("The destination could not be opened");
                byte[] buffer = new byte[64 * 1024]; int read;
                while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
                call.resolve();
            } catch (Exception error) { call.reject("Could not save the file", error); }
            finally { file.delete(); }
        });
    }

    @PluginMethod
    public void cancelExport(PluginCall call) {
        if (exporting != null) { exporting.delete(); exporting = null; }
        call.resolve();
    }

    @PluginMethod
    public void startRecording(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) requestPermissionForAlias("microphone", call, "microphonePermission");
        else beginRecording(call);
    }

    @PermissionCallback
    private void microphonePermission(PluginCall call) {
        if (getPermissionState("microphone") == PermissionState.GRANTED) beginRecording(call);
        else call.reject("Allow microphone access to record audio");
    }

    private void beginRecording(PluginCall call) {
        if (recorder != null) { call.reject("A recording is already running"); return; }
        try {
            recording = new File(directory(), "Recording-" + System.currentTimeMillis() + ".m4a");
            recorder = Build.VERSION.SDK_INT >= 31 ? new MediaRecorder(getContext()) : new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.MIC);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioEncodingBitRate(128000);
            recorder.setAudioSamplingRate(44100);
            recorder.setOutputFile(recording.getAbsolutePath());
            recorder.setMaxFileSize(MAX_BYTES);
            recorder.prepare(); recorder.start(); call.resolve();
        } catch (Exception error) { releaseRecording(true); call.reject("Could not start audio recording", error); }
    }

    @PluginMethod
    public void stopRecording(PluginCall call) {
        if (recorder == null) { call.resolve(); return; }
        boolean cancel = call.getBoolean("cancel", false);
        File file = recording;
        try {
            recorder.stop(); releaseRecording(cancel);
            if (cancel) call.resolve(); else call.resolve(describe(file, file.getName(), "audio/mp4"));
        } catch (Exception error) { releaseRecording(true); call.reject("The recording was too short to save", error); }
    }

    private void releaseRecording(boolean cancel) {
        if (recorder != null) { recorder.release(); recorder = null; }
        if (cancel && recording != null) recording.delete();
        recording = null;
    }

    @Override
    protected void handleOnDestroy() { releaseRecording(true); if (exporting != null) exporting.delete(); }
}
