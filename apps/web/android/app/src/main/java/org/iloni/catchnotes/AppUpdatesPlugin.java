package org.iloni.catchnotes;

import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.math.BigInteger;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Arrays;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Installs an exact published release, retaining the app's identity, signature and data. */
@CapacitorPlugin(name = "AppUpdates")
public class AppUpdatesPlugin extends Plugin {
    private static final Pattern VERSION = Pattern.compile("(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(-preview)?");
    private static final long MAX_APK_BYTES = 200L * 1024 * 1024;
    private final AtomicBoolean installing = new AtomicBoolean(false);
    // Downloads must not hold Capacitor's shared plugin thread: SQLite writes use it too.
    private final ExecutorService downloads = Executors.newSingleThreadExecutor();
    private File pendingApk;

    private String channel() {
        String id = getContext().getPackageName();
        if (id.endsWith(".dev")) return "dev";
        return id.endsWith(".preview") ? "preview" : "stable";
    }

    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject value = new JSObject();
            value.put("version", installed.versionName);
            value.put("channel", channel());
            call.resolve(value);
        } catch (Exception error) {
            call.reject("Could not read the installed app version", error);
        }
    }

    @PluginMethod
    public void install(PluginCall call) {
        String version = call.getString("version", "");
        Matcher target = VERSION.matcher(version);
        String requestedChannel = version.endsWith("-preview") ? "preview" : "stable";
        if (!target.matches() || !requestedChannel.equals(channel()) || !channel().equals(call.getString("channel"))) {
            call.reject("Choose a release from this app's channel");
            return;
        }
        if (!installing.compareAndSet(false, true)) {
            call.reject("An update is already being prepared");
            return;
        }
        downloads.execute(() -> {
            File apk = new File(getContext().getCacheDir(), "catch-update.apk");
            try {
                PackageManager manager = getContext().getPackageManager();
                int flags = Build.VERSION.SDK_INT >= 28 ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
                PackageInfo installed = manager.getPackageInfo(getContext().getPackageName(), flags);
                if (!newer(version, installed.versionName)) throw new Exception("This release is not newer than the installed app");
                String base = "https://github.com/iiloni/catch/releases/download/v" + version + "/catch-" + version + ".apk";
                String checksum = readChecksum(base + ".sha256", "catch-" + version + ".apk");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                HttpURLConnection connection = connect(base);
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(apk)) {
                    byte[] buffer = new byte[64 * 1024];
                    long total = 0;
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        total += count;
                        if (total > MAX_APK_BYTES) throw new Exception("The update download is too large");
                        digest.update(buffer, 0, count);
                        output.write(buffer, 0, count);
                    }
                } finally { connection.disconnect(); }
                if (!checksum.equals(hex(digest.digest()))) throw new Exception("The update checksum did not match. Try again.");
                PackageInfo downloaded = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
                if (downloaded == null || !installed.packageName.equals(downloaded.packageName) ||
                    !version.equals(downloaded.versionName) || versionCode(downloaded) <= versionCode(installed) ||
                    !Arrays.equals(signatures(installed), signatures(downloaded))) {
                    throw new Exception("This APK cannot update the installed app");
                }
                pendingApk = apk;
                getActivity().runOnUiThread(() -> {
                    try {
                        if (Build.VERSION.SDK_INT >= 26 && !manager.canRequestPackageInstalls()) {
                            Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getContext().getPackageName()));
                            startActivityForResult(call, permission, "installPermissionResult");
                        } else openInstaller(call);
                    } catch (Exception error) { fail(call, "Could not open the Android installer", error); }
                });
            } catch (Exception error) {
                apk.delete();
                fail(call, error.getMessage() == null ? "Could not download the update. Try again." : error.getMessage(), error);
            }
        });
    }

    @Override
    protected void handleOnDestroy() {
        downloads.shutdownNow();
    }

    @ActivityCallback
    private void installPermissionResult(PluginCall call, ActivityResult result) {
        if (call == null) { installing.set(false); return; }
        if (Build.VERSION.SDK_INT >= 26 && !getContext().getPackageManager().canRequestPackageInstalls()) {
            fail(call, "Allow Catch to install updates, then try again", null);
            return;
        }
        try { openInstaller(call); }
        catch (Exception error) { fail(call, "Could not open the Android installer", error); }
    }

    private void openInstaller(PluginCall call) throws Exception {
        if (pendingApk == null || !pendingApk.isFile()) throw new Exception("Download the update again");
        Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", pendingApk);
        Intent intent = new Intent(Intent.ACTION_VIEW);
        intent.setDataAndType(uri, "application/vnd.android.package-archive");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.setClipData(ClipData.newRawUri("Catch update", uri));
        getActivity().startActivity(intent);
        pendingApk = null;
        installing.set(false);
        call.resolve();
    }

    private void fail(PluginCall call, String message, Exception error) {
        if (pendingApk != null) { pendingApk.delete(); pendingApk = null; }
        installing.set(false);
        call.reject(message, error);
    }

    private static HttpURLConnection connect(String url) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(30000);
        connection.setRequestProperty("User-Agent", "Catch-Android");
        int status = connection.getResponseCode();
        if (status != 200) {
            connection.disconnect();
            throw new Exception(status == 404 ? "The server's Android release is not published yet. Try again later." : "Could not download the update. Try again.");
        }
        return connection;
    }

    private static String readChecksum(String url, String filename) throws Exception {
        HttpURLConnection connection = connect(url);
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        try (InputStream input = connection.getInputStream()) {
            byte[] buffer = new byte[512];
            int count;
            while ((count = input.read(buffer)) != -1) {
                if (output.size() + count > 1024) throw new Exception("Invalid update checksum");
                output.write(buffer, 0, count);
            }
        } finally { connection.disconnect(); }
        String text = output.toString(StandardCharsets.UTF_8.name()).trim();
        Matcher match = Pattern.compile("([a-fA-F0-9]{64}) +\\*?" + Pattern.quote(filename)).matcher(text);
        if (!match.matches()) throw new Exception("Invalid update checksum");
        return match.group(1).toLowerCase(java.util.Locale.ROOT);
    }

    private static boolean newer(String targetVersion, String installedVersion) {
        Matcher target = VERSION.matcher(targetVersion);
        Matcher installed = VERSION.matcher(installedVersion == null ? "" : installedVersion);
        if (!target.matches() || !installed.matches()) return false;
        for (int part = 1; part <= 3; part++) {
            int comparison = new BigInteger(target.group(part)).compareTo(new BigInteger(installed.group(part)));
            if (comparison != 0) return comparison > 0;
        }
        return false;
    }

    private static long versionCode(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
    }

    private static Signature[] signatures(PackageInfo info) {
        return Build.VERSION.SDK_INT >= 28 ? info.signingInfo.getApkContentsSigners() : info.signatures;
    }

    private static String hex(byte[] bytes) {
        StringBuilder output = new StringBuilder();
        for (byte value : bytes) output.append(String.format(java.util.Locale.ROOT, "%02x", value & 0xff));
        return output.toString();
    }
}
