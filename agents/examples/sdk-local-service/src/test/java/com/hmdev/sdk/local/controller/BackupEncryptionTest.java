package com.hmdev.sdk.local.controller;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Method;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * A config backup carries SSH passwords and private keys, so the file has to be
 * tamper-evident, not merely scrambled.
 *
 * It used to be AES/CBC/PKCS5Padding with no integrity tag: anyone who could
 * reach the file could flip bits in the ciphertext and change what the import
 * produced, without ever knowing the password. These tests pin the properties
 * that stop that — and the migration path, so backups written before the change
 * still import.
 */
class BackupEncryptionTest {

    private static final String XML =
            "<config><SshConnection><Name>prod</Name><Password>hunter2</Password></SshConnection></config>";

    private final ConfigBackupController controller =
            new ConfigBackupController(null, null, null);

    private byte[] encrypt(String xml, String password) throws Exception {
        Method m = ConfigBackupController.class.getDeclaredMethod(
                "createEncryptedZip", String.class, String.class);
        m.setAccessible(true);
        return (byte[]) m.invoke(controller, xml, password);
    }

    private String decrypt(byte[] zip, String password) throws Exception {
        Method m = ConfigBackupController.class.getDeclaredMethod(
                "extractEncryptedZip", byte[].class, String.class);
        m.setAccessible(true);
        try {
            return (String) m.invoke(controller, zip, password);
        } catch (java.lang.reflect.InvocationTargetException e) {
            throw (Exception) e.getCause();
        }
    }

    @Test
    @DisplayName("a backup round-trips through the current scheme")
    void roundTrip() throws Exception {
        assertThat(decrypt(encrypt(XML, "correct horse"), "correct horse")).isEqualTo(XML);
    }

    @Test
    @DisplayName("the secret is not sitting in the file in the clear")
    void ciphertextDoesNotLeakTheSecret() throws Exception {
        byte[] zip = encrypt(XML, "correct horse");
        assertThat(new String(zip, java.nio.charset.StandardCharsets.ISO_8859_1))
                .doesNotContain("hunter2");
    }

    @Test
    @DisplayName("a wrong password is refused")
    void wrongPasswordFails() throws Exception {
        byte[] zip = encrypt(XML, "correct horse");
        assertThatThrownBy(() -> decrypt(zip, "wrong horse"))
                .hasMessageContaining("Decryption failed");
    }

    /** Read every entry of a backup zip into a map, so a test can rebuild it. */
    private java.util.Map<String, byte[]> entries(byte[] zip) throws Exception {
        java.util.Map<String, byte[]> out = new java.util.LinkedHashMap<>();
        try (java.util.zip.ZipInputStream zis =
                     new java.util.zip.ZipInputStream(new java.io.ByteArrayInputStream(zip))) {
            java.util.zip.ZipEntry e;
            while ((e = zis.getNextEntry()) != null) {
                out.put(e.getName(), zis.readAllBytes());
            }
        }
        return out;
    }

    /** Rebuild a well-formed backup zip, so only the intended change differs. */
    private byte[] rezip(java.util.Map<String, byte[]> entries) throws Exception {
        java.io.ByteArrayOutputStream baos = new java.io.ByteArrayOutputStream();
        try (java.util.zip.ZipOutputStream zos = new java.util.zip.ZipOutputStream(baos)) {
            for (java.util.Map.Entry<String, byte[]> e : entries.entrySet()) {
                zos.putNextEntry(new java.util.zip.ZipEntry(e.getKey()));
                zos.write(e.getValue());
                zos.closeEntry();
            }
        }
        return baos.toByteArray();
    }

    @Test
    @DisplayName("flipping a bit in the ciphertext is detected, not decrypted")
    void tamperingIsDetected() throws Exception {
        java.util.Map<String, byte[]> parts = entries(encrypt(XML, "correct horse"));
        byte[] ciphertext = parts.get("config.enc");
        assertThat(ciphertext).as("the encrypted payload").isNotNull();
        // Under CBC this yielded altered plaintext with no error. Under an
        // authenticated cipher it has to fail outright.
        ciphertext[ciphertext.length / 2] ^= 0x01;

        assertThatThrownBy(() -> decrypt(rezip(parts), "correct horse"))
                .as("a corrupted backup must not decrypt to anything")
                .hasMessageContaining("Decryption failed");
    }

    @Test
    @DisplayName("the envelope declares its version, so old files can still be read")
    void envelopeIsVersioned() throws Exception {
        assertThat(entries(encrypt(XML, "correct horse")))
                .as("a reader needs to know which scheme wrote the file")
                .containsKey("version.txt");
    }

    @Test
    @DisplayName("removing the version marker does not silently downgrade the file")
    void versionStrippingIsCaught() throws Exception {
        java.util.Map<String, byte[]> parts = entries(encrypt(XML, "correct horse"));
        parts.remove("version.txt");
        // Without the marker the reader treats it as a v1 CBC file. The version
        // is bound into the ciphertext as associated data precisely so that
        // this downgrade cannot produce a readable backup.
        assertThatThrownBy(() -> decrypt(rezip(parts), "correct horse"))
                .as("a downgraded envelope must not decrypt")
                .isInstanceOf(Exception.class);
    }
}
