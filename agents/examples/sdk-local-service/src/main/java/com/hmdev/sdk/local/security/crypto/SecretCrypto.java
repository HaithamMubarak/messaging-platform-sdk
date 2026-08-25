package com.hmdev.sdk.local.security.crypto;

import lombok.extern.slf4j.Slf4j;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.nio.file.attribute.PosixFilePermission;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.EnumSet;
import java.util.Set;

/**
 * Encryption for secrets held in the local database.
 *
 * SSH passwords and private keys were stored as plain columns in an H2 file on
 * disk, so anything that could read that file — a stray backup, a sync folder,
 * another process, the H2 console — got the credentials for every host the user
 * had saved.
 *
 * The key comes from configuration (sls.security.secret-key, or the
 * SLS_SECRET_KEY environment variable) when one is set. When none is, a key is
 * generated once and written beside the database with owner-only permissions.
 * That is weaker — a reader who has the database file may well have the key
 * file too — but it is strictly better than plaintext for the backup and
 * copied-folder cases, and it keeps a local developer tool working without
 * ceremony. The warning below says which mode is in force.
 *
 * Values carry a version prefix, so a database written before this existed
 * still reads: an unprefixed value is legacy plaintext and is returned as-is,
 * then written back encrypted the next time the row is saved.
 */
@Slf4j
public final class SecretCrypto {

    private static final String PREFIX = "enc:v1:";
    private static final String ALGORITHM = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;
    private static final int IV_BYTES = 12;
    private static final int KEY_BYTES = 32;

    private final SecretKey key;
    private final SecureRandom random = new SecureRandom();

    public SecretCrypto(String configuredKey, Path keyFile) {
        this.key = resolveKey(configuredKey, keyFile);
    }

    private SecretKey resolveKey(String configuredKey, Path keyFile) {
        if (configuredKey != null && !configuredKey.trim().isEmpty()) {
            byte[] raw = Base64.getDecoder().decode(configuredKey.trim());
            if (raw.length != KEY_BYTES) {
                throw new IllegalStateException(
                        "sls.security.secret-key must be " + KEY_BYTES + " base64-encoded bytes");
            }
            log.info("[Secrets] Stored credentials are encrypted with the configured key");
            return new SecretKeySpec(raw, "AES");
        }
        return loadOrCreateKeyFile(keyFile);
    }

    private SecretKey loadOrCreateKeyFile(Path keyFile) {
        try {
            if (Files.exists(keyFile)) {
                byte[] raw = Base64.getDecoder().decode(new String(
                        Files.readAllBytes(keyFile), StandardCharsets.UTF_8).trim());
                return new SecretKeySpec(raw, "AES");
            }
            byte[] raw = new byte[KEY_BYTES];
            new SecureRandom().nextBytes(raw);

            Files.createDirectories(keyFile.getParent());
            Files.write(keyFile, Base64.getEncoder().encodeToString(raw)
                    .getBytes(StandardCharsets.UTF_8));
            restrictToOwner(keyFile);

            log.warn("[Secrets] No sls.security.secret-key was configured, so a key was generated at {}. "
                    + "Set SLS_SECRET_KEY to keep the key separate from the data it protects.", keyFile);
            return new SecretKeySpec(raw, "AES");
        } catch (Exception e) {
            throw new IllegalStateException("Could not establish a key for stored secrets", e);
        }
    }

    /** Owner-only where the filesystem supports it; a no-op on Windows. */
    private void restrictToOwner(Path file) {
        try {
            Set<PosixFilePermission> ownerOnly = EnumSet.of(
                    PosixFilePermission.OWNER_READ, PosixFilePermission.OWNER_WRITE);
            Files.setPosixFilePermissions(file, ownerOnly);
        } catch (UnsupportedOperationException | java.io.IOException e) {
            log.debug("[Secrets] Could not restrict permissions on the key file: {}", e.getMessage());
        }
    }

    /** Encrypt a value for storage. Null and empty pass through unchanged. */
    public String encrypt(String plaintext) {
        if (plaintext == null || plaintext.isEmpty()) {
            return plaintext;
        }
        if (plaintext.startsWith(PREFIX)) {
            return plaintext;   // already encrypted; do not double-wrap
        }
        try {
            byte[] iv = new byte[IV_BYTES];
            random.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.ENCRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ct = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));

            byte[] joined = new byte[iv.length + ct.length];
            System.arraycopy(iv, 0, joined, 0, iv.length);
            System.arraycopy(ct, 0, joined, iv.length, ct.length);
            return PREFIX + Base64.getEncoder().encodeToString(joined);
        } catch (Exception e) {
            throw new IllegalStateException("Could not encrypt a stored secret", e);
        }
    }

    /** Decrypt a stored value. An unprefixed value is legacy plaintext. */
    public String decrypt(String stored) {
        if (stored == null || stored.isEmpty() || !stored.startsWith(PREFIX)) {
            return stored;
        }
        try {
            byte[] joined = Base64.getDecoder().decode(stored.substring(PREFIX.length()));
            byte[] iv = new byte[IV_BYTES];
            System.arraycopy(joined, 0, iv, 0, IV_BYTES);

            Cipher cipher = Cipher.getInstance(ALGORITHM);
            cipher.init(Cipher.DECRYPT_MODE, key, new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] pt = cipher.doFinal(joined, IV_BYTES, joined.length - IV_BYTES);
            return new String(pt, StandardCharsets.UTF_8);
        } catch (Exception e) {
            // A key change or a corrupted row. Fail loudly rather than handing
            // back ciphertext that would be used as a password.
            throw new IllegalStateException(
                    "Could not decrypt a stored secret — was the key changed?", e);
        }
    }

    public static Path defaultKeyFile(String dataDirectory) {
        return Paths.get(dataDirectory, "secret.key");
    }
}
