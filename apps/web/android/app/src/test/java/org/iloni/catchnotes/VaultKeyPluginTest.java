package org.iloni.catchnotes;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;

import androidx.biometric.BiometricPrompt;
import java.nio.charset.StandardCharsets;
import org.junit.Test;

public class VaultKeyPluginTest {
    // The web app (lib/vaultBiometrics.ts) acts on these codes, so they are a contract.
    @Test
    public void namesEachWayThePromptEnds() {
        assertEquals("fallback", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_NEGATIVE_BUTTON));
        assertEquals("canceled", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_USER_CANCELED));
        assertEquals("canceled", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_CANCELED));
        assertEquals("canceled", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_TIMEOUT));
        assertEquals("lockout", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_LOCKOUT));
        assertEquals("lockout", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_LOCKOUT_PERMANENT));
        assertEquals("unavailable", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_NO_BIOMETRICS));
        assertEquals("unavailable", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_HW_UNAVAILABLE));
        assertEquals("failed", VaultKeyPlugin.errorCode(BiometricPrompt.ERROR_VENDOR));
    }

    @Test
    public void keepsOneKeyPerAccountAndBindsTheSealToIt() {
        assertEquals("catch-vault-bio-user_1", VaultKeyPlugin.alias("user_1"));
        assertArrayEquals(
            "catch-vault-bio:user_1".getBytes(StandardCharsets.UTF_8),
            VaultKeyPlugin.additionalData("user_1")
        );
    }
}
