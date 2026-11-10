package org.iloni.catchnotes;

import android.content.pm.PackageManager;
import android.os.Build;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyPermanentlyInvalidatedException;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.ProviderException;
import java.util.Arrays;
import java.util.regex.Pattern;
import javax.crypto.AEADBadTagException;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * Opens the vault with a fingerprint (ADR 0020). The web app hands over the vault key once,
 * and this seals it under a Keystore key that only a strong biometric unlocks, one key per
 * account. The web app keeps the sealed copy; the phone keeps only the key that opens it.
 *
 * The key is used through a {@link BiometricPrompt.CryptoObject}, not after a yes or no
 * from the prompt, so the vault key cannot be had without a fingerprint. Enrolling a new
 * fingerprint invalidates the Keystore key, so someone who knows the phone's PIN cannot
 * add their own finger and open the vault. The phone's PIN is never accepted in its place.
 *
 * Errors carry a code the web app acts on: canceled, fallback (the prompt's own button),
 * lockout, invalidated (fingerprints changed), gone (no Keystore key), damaged, unavailable,
 * busy and failed.
 */
@CapacitorPlugin(name = "VaultKey")
public class VaultKeyPlugin extends Plugin {
    private static final String KEYSTORE = "AndroidKeyStore";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int TAG_BITS = 128;
    private static final int KEY_BYTES = 32;
    private static final Pattern USER_ID = Pattern.compile("[A-Za-z0-9_-]{1,128}");
    private static final int STRONG = BiometricManager.Authenticators.BIOMETRIC_STRONG;

    /** The call waiting on the prompt shown now, if one is. */
    private PluginCall prompting;

    @PluginMethod
    public void available(PluginCall call) {
        JSObject result = new JSObject();
        result.put(
            "available",
            BiometricManager.from(getContext()).canAuthenticate(STRONG) == BiometricManager.BIOMETRIC_SUCCESS
        );
        result.put("kind", fingerprintOnly() ? "fingerprint" : "biometrics");
        call.resolve(result);
    }

    /** Seals the vault key under a new Keystore key, once a fingerprint confirms it. */
    @PluginMethod
    public void enable(PluginCall call) {
        String userId = userId(call);
        if (userId == null) return;
        byte[] key = decode(call.getString("key"));
        if (key == null || key.length != KEY_BYTES) {
            call.reject("The vault key is not valid.", "failed");
            return;
        }
        Cipher cipher;
        try {
            forgetKey(userId);
            SecretKey secret = createKey(userId);
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.ENCRYPT_MODE, secret);
        } catch (Exception error) {
            Arrays.fill(key, (byte) 0);
            forgetQuietly(userId);
            // Generating a key bound to biometric enrollment fails when none is enrolled.
            call.reject("Fingerprint unlock is not available.", "unavailable", error);
            return;
        }
        prompt(call, cipher, new Use() {
            @Override
            public void succeeded(Cipher authenticated) throws Exception {
                try {
                    authenticated.updateAAD(additionalData(userId));
                    byte[] sealed = authenticated.doFinal(key);
                    JSObject result = new JSObject();
                    result.put("iv", Base64.encodeToString(authenticated.getIV(), Base64.NO_WRAP));
                    result.put("sealed", Base64.encodeToString(sealed, Base64.NO_WRAP));
                    call.resolve(result);
                } finally {
                    Arrays.fill(key, (byte) 0);
                }
            }

            @Override
            public void failed() {
                Arrays.fill(key, (byte) 0);
                forgetQuietly(userId);
            }
        });
    }

    /** Opens the sealed vault key, once a fingerprint unlocks the Keystore key. */
    @PluginMethod
    public void open(PluginCall call) {
        String userId = userId(call);
        if (userId == null) return;
        byte[] iv = decode(call.getString("iv"));
        byte[] sealed = decode(call.getString("sealed"));
        if (iv == null || sealed == null) {
            call.reject("The sealed vault key is damaged.", "damaged");
            return;
        }
        Cipher cipher;
        try {
            SecretKey secret = loadKey(userId);
            if (secret == null) {
                call.reject("Fingerprint unlock is not set up.", "gone");
                return;
            }
            cipher = Cipher.getInstance(TRANSFORMATION);
            cipher.init(Cipher.DECRYPT_MODE, secret, new GCMParameterSpec(TAG_BITS, iv));
        } catch (KeyPermanentlyInvalidatedException error) {
            forgetQuietly(userId);
            call.reject("The fingerprints on this phone changed.", "invalidated", error);
            return;
        } catch (Exception error) {
            call.reject("Could not use fingerprint unlock.", "failed", error);
            return;
        }
        prompt(call, cipher, new Use() {
            @Override
            public void succeeded(Cipher authenticated) throws Exception {
                authenticated.updateAAD(additionalData(userId));
                byte[] key = authenticated.doFinal(sealed);
                try {
                    JSObject result = new JSObject();
                    result.put("key", Base64.encodeToString(key, Base64.NO_WRAP));
                    call.resolve(result);
                } finally {
                    Arrays.fill(key, (byte) 0);
                }
            }

            @Override
            public void failed() {}
        });
    }

    @PluginMethod
    public void forget(PluginCall call) {
        String userId = userId(call);
        if (userId == null) return;
        try {
            forgetKey(userId);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not delete the fingerprint key.", "failed", error);
        }
    }

    private interface Use {
        void succeeded(Cipher authenticated) throws Exception;

        /** The prompt ended without a fingerprint, or using it failed. */
        void failed();
    }

    private void prompt(PluginCall call, Cipher cipher, Use use) {
        String title = call.getString("title", "Unlock the vault");
        String cancel = call.getString("cancel", "Cancel");
        getActivity().runOnUiThread(() -> {
            FragmentActivity activity = getActivity();
            if (prompting != null) {
                use.failed();
                call.reject("Another fingerprint prompt is open.", "busy");
                return;
            }
            // After onSaveInstanceState the prompt would silently not show, and never answer.
            if (activity == null || activity.isFinishing() || activity.getSupportFragmentManager().isStateSaved()) {
                use.failed();
                call.reject("The app is not in front.", "canceled");
                return;
            }
            prompting = call;
            BiometricPrompt prompt = new BiometricPrompt(
                activity,
                ContextCompat.getMainExecutor(activity),
                new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                        prompting = null;
                        BiometricPrompt.CryptoObject crypto = result.getCryptoObject();
                        Cipher authenticated = crypto == null ? null : crypto.getCipher();
                        if (authenticated == null) {
                            use.failed();
                            call.reject("The fingerprint did not unlock the key.", "failed");
                            return;
                        }
                        try {
                            use.succeeded(authenticated);
                        } catch (AEADBadTagException error) {
                            use.failed();
                            call.reject("The sealed vault key is damaged.", "damaged", error);
                        } catch (Exception error) {
                            use.failed();
                            call.reject("Could not use fingerprint unlock.", "failed", error);
                        }
                    }

                    @Override
                    public void onAuthenticationError(int code, @NonNull CharSequence message) {
                        prompting = null;
                        use.failed();
                        call.reject(message.toString(), errorCode(code));
                    }

                    // A finger not recognised: the prompt says so and waits for another.
                    @Override
                    public void onAuthenticationFailed() {}
                }
            );
            BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                .setTitle(title)
                .setNegativeButtonText(cancel)
                .setAllowedAuthenticators(STRONG)
                .setConfirmationRequired(false)
                .build();
            try {
                prompt.authenticate(info, new BiometricPrompt.CryptoObject(cipher));
            } catch (RuntimeException error) {
                prompting = null;
                use.failed();
                call.reject("Could not show the fingerprint prompt.", "failed", error);
            }
        });
    }

    static String errorCode(int code) {
        switch (code) {
            case BiometricPrompt.ERROR_NEGATIVE_BUTTON:
                return "fallback";
            case BiometricPrompt.ERROR_USER_CANCELED:
            case BiometricPrompt.ERROR_CANCELED:
            case BiometricPrompt.ERROR_TIMEOUT:
                return "canceled";
            case BiometricPrompt.ERROR_LOCKOUT:
            case BiometricPrompt.ERROR_LOCKOUT_PERMANENT:
                return "lockout";
            case BiometricPrompt.ERROR_NO_BIOMETRICS:
            case BiometricPrompt.ERROR_HW_NOT_PRESENT:
            case BiometricPrompt.ERROR_HW_UNAVAILABLE:
            case BiometricPrompt.ERROR_SECURITY_UPDATE_REQUIRED:
                return "unavailable";
            default:
                return "failed";
        }
    }

    /** Whether the phone's only strong biometric is likely a fingerprint, for the words shown. */
    private boolean fingerprintOnly() {
        PackageManager packages = getContext().getPackageManager();
        if (!packages.hasSystemFeature(PackageManager.FEATURE_FINGERPRINT)) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return true;
        return (
            !packages.hasSystemFeature(PackageManager.FEATURE_FACE) && !packages.hasSystemFeature(PackageManager.FEATURE_IRIS)
        );
    }

    private String userId(PluginCall call) {
        String userId = call.getString("userId");
        if (userId == null || !USER_ID.matcher(userId).matches()) {
            call.reject("No account was given.", "failed");
            return null;
        }
        return userId;
    }

    static String alias(String userId) {
        return "catch-vault-bio-" + userId;
    }

    /** Binds the sealed key to its account, as the web app's own seals are bound (ADR 0020). */
    static byte[] additionalData(String userId) {
        return ("catch-vault-bio:" + userId).getBytes(StandardCharsets.UTF_8);
    }

    private static byte[] decode(String text) {
        if (text == null) return null;
        try {
            return Base64.decode(text, Base64.NO_WRAP);
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    private static SecretKey loadKey(String userId) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        return (SecretKey) store.getKey(alias(userId), null);
    }

    private static void forgetKey(String userId) throws Exception {
        KeyStore store = KeyStore.getInstance(KEYSTORE);
        store.load(null);
        store.deleteEntry(alias(userId));
    }

    private static void forgetQuietly(String userId) {
        try {
            forgetKey(userId);
        } catch (Exception ignored) {}
    }

    private static SecretKey createKey(String userId) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            try {
                return generate(userId, true);
            } catch (ProviderException noStrongBox) {
                // StrongBoxUnavailableException, or a StrongBox that cannot hold this key.
            }
        }
        return generate(userId, false);
    }

    @SuppressWarnings("deprecation")
    private static SecretKey generate(String userId, boolean strongBox) throws Exception {
        KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(
            alias(userId),
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(KEY_BYTES * 8)
            .setUserAuthenticationRequired(true)
            .setInvalidatedByBiometricEnrollment(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            // Every use needs its own fingerprint, never the phone's PIN.
            spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
        } else {
            // -1: every use is authorised through a CryptoObject, which takes only biometrics.
            spec.setUserAuthenticationValidityDurationSeconds(-1);
        }
        if (strongBox && Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) spec.setIsStrongBoxBacked(true);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE);
        generator.init(spec.build());
        return generator.generateKey();
    }
}
