package com.hmdev.sdk.local.dto;

import com.hmdev.sdk.local.model.SshConnection;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.util.Collections;
import java.util.List;
import java.util.Locale;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The API's SSH connection shape must not be able to carry a secret.
 *
 * Two failures are guarded here. The obvious one: a password or private key
 * reaching a caller. The quieter one: the previous implementation cleared those
 * fields on the JPA entity returned by findAll(), which is MANAGED — so the
 * blanking marked the row dirty and Hibernate could write the null back,
 * destroying the stored credential. The view must therefore leave the entity
 * untouched.
 */
class SshConnectionViewTest {

    private SshConnection sample() {
        SshConnection c = new SshConnection();
        c.setId(7L);
        c.setName("prod-db");
        c.setHost("10.0.0.4");
        c.setPort(22);
        c.setUsername("deploy");
        c.setPassword("hunter2");
        c.setPrivateKey("-----BEGIN OPENSSH PRIVATE KEY-----abc");
        c.setDescription("primary");
        return c;
    }

    @Test
    @DisplayName("the view has no field that could hold a secret")
    void viewCarriesNoSecretField() {
        for (Field f : SshConnectionView.class.getDeclaredFields()) {
            String n = f.getName().toLowerCase(Locale.ROOT);
            assertThat(n.contains("password") && !n.startsWith("has"))
                    .as("field %s could carry a password", f.getName()).isFalse();
            assertThat((n.contains("privatekey") || n.contains("passphrase")) && !n.startsWith("has"))
                    .as("field %s could carry key material", f.getName()).isFalse();
        }
    }

    @Test
    @DisplayName("converting does not blank the stored credential")
    void conversionLeavesTheEntityIntact() {
        SshConnection entity = sample();
        SshConnectionView.of(entity);
        assertThat(entity.getPassword())
                .as("mutating a managed entity is how the stored password got destroyed")
                .isEqualTo("hunter2");
        assertThat(entity.getPrivateKey()).startsWith("-----BEGIN");
    }

    @Test
    @DisplayName("the view says whether a secret exists without revealing it")
    void viewReportsPresenceOnly() {
        SshConnectionView v = SshConnectionView.of(sample());
        assertThat(v.isHasPassword()).isTrue();
        assertThat(v.isHasPrivateKey()).isTrue();
        assertThat(v.getName()).isEqualTo("prod-db");
        assertThat(v.getUsername()).isEqualTo("deploy");
    }

    @Test
    @DisplayName("no secret survives into the view's own string form")
    void secretsAreNotInToString() {
        String rendered = SshConnectionView.of(sample()).toString();
        assertThat(rendered).doesNotContain("hunter2");
        assertThat(rendered).doesNotContain("BEGIN OPENSSH PRIVATE KEY");
    }

    @Test
    @DisplayName("a connection with no secret on file reports that honestly")
    void absentSecretsReportFalse() {
        SshConnection c = sample();
        c.setPassword(null);
        c.setPrivateKey("");
        SshConnectionView v = SshConnectionView.of(c);
        assertThat(v.isHasPassword()).isFalse();
        assertThat(v.isHasPrivateKey()).isFalse();
    }

    @Test
    @DisplayName("list conversion keeps the same guarantees")
    void listConversion() {
        List<SshConnectionView> views = SshConnectionView.of(Collections.singletonList(sample()));
        assertThat(views).hasSize(1);
        assertThat(views.get(0).toString()).doesNotContain("hunter2");
    }
}
