package com.hmdev.sdk.local.security.crypto;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.SecureRandom;
import java.util.Base64;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Secrets in the local database must not be readable from the database file.
 *
 * SSH passwords and private keys were stored as plain columns in an H2 file, so
 * a stray backup or a sync folder handed over every saved host credential.
 */
class SecretCryptoTest {

    private String aKey() {
        byte[] raw = new byte[32];
        new SecureRandom().nextBytes(raw);
        return Base64.getEncoder().encodeToString(raw);
    }

    @Test
    @DisplayName("a secret round-trips")
    void roundTrip(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        assertThat(c.decrypt(c.encrypt("hunter2"))).isEqualTo("hunter2");
    }

    @Test
    @DisplayName("the stored form does not contain the secret")
    void storedFormIsOpaque(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        assertThat(c.encrypt("hunter2")).doesNotContain("hunter2").startsWith("enc:v1:");
    }

    @Test
    @DisplayName("the same secret encrypts differently every time")
    void nonceIsFresh(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        assertThat(c.encrypt("hunter2"))
                .as("a repeated ciphertext would reveal that two hosts share a password")
                .isNotEqualTo(c.encrypt("hunter2"));
    }

    @Test
    @DisplayName("a row written before encryption existed still reads")
    void legacyPlaintextStillReads(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        assertThat(c.decrypt("hunter2"))
                .as("existing databases must keep working")
                .isEqualTo("hunter2");
    }

    @Test
    @DisplayName("encrypting an already-encrypted value does not double-wrap it")
    void encryptIsIdempotent(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        String once = c.encrypt("hunter2");
        assertThat(c.decrypt(c.encrypt(once))).isEqualTo("hunter2");
    }

    @Test
    @DisplayName("null and empty pass through untouched")
    void emptyValues(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        assertThat(c.encrypt(null)).isNull();
        assertThat(c.encrypt("")).isEmpty();
        assertThat(c.decrypt(null)).isNull();
    }

    @Test
    @DisplayName("a tampered stored value is refused, not returned")
    void tamperingIsRefused(@TempDir Path dir) {
        SecretCrypto c = new SecretCrypto(aKey(), dir.resolve("secret.key"));
        String stored = c.encrypt("hunter2");
        // Corrupt one base64 character of the payload.
        char[] chars = stored.toCharArray();
        int last = chars.length - 2;
        chars[last] = chars[last] == 'A' ? 'B' : 'A';
        assertThatThrownBy(() -> c.decrypt(new String(chars)))
                .as("handing back ciphertext as if it were a password would be worse than failing")
                .isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("a different key cannot read another key's secrets")
    void keysAreNotInterchangeable(@TempDir Path dir) {
        SecretCrypto a = new SecretCrypto(aKey(), dir.resolve("a.key"));
        SecretCrypto b = new SecretCrypto(aKey(), dir.resolve("b.key"));
        String stored = a.encrypt("hunter2");
        assertThatThrownBy(() -> b.decrypt(stored)).isInstanceOf(IllegalStateException.class);
    }

    @Test
    @DisplayName("with no configured key one is generated and reused")
    void generatedKeyIsStable(@TempDir Path dir) {
        Path keyFile = dir.resolve("secret.key");
        SecretCrypto first = new SecretCrypto(null, keyFile);
        String stored = first.encrypt("hunter2");

        assertThat(Files.exists(keyFile)).as("the generated key is persisted").isTrue();
        // A restart must still be able to read what the last run wrote.
        SecretCrypto afterRestart = new SecretCrypto(null, keyFile);
        assertThat(afterRestart.decrypt(stored)).isEqualTo("hunter2");
    }

    @Test
    @DisplayName("a key of the wrong size is rejected rather than silently padded")
    void badKeyRejected(@TempDir Path dir) {
        assertThatThrownBy(() ->
                new SecretCrypto(Base64.getEncoder().encodeToString(new byte[8]), dir.resolve("k")))
                .isInstanceOf(IllegalStateException.class);
    }
}
