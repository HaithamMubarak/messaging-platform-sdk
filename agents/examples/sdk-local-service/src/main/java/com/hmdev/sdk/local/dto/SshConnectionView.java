package com.hmdev.sdk.local.dto;

import com.hmdev.sdk.local.model.SshConnection;
import lombok.Value;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * An SSH connection as the API is allowed to describe it: everything needed to
 * identify and manage a connection, and nothing that could be used to open one.
 *
 * This type exists so that "do not leak the password" is a property of the
 * shape rather than of remembering to clear a field. The previous approach
 * returned the JPA entity with setPassword(null) called on it, which had two
 * problems: a new secret field would be exposed by default, and — because
 * findAll() hands back MANAGED entities — nulling the field marked the row
 * dirty, so Hibernate could flush the blanked credential back to the database
 * and destroy the stored secret.
 *
 * Credentials leave the service through exactly one door: the config backup
 * export, which is separately authorised and encrypted.
 */
@Value
public class SshConnectionView {

    Long id;
    String name;
    String host;
    Integer port;
    String username;
    String description;
    LocalDateTime createdAt;
    LocalDateTime updatedAt;
    LocalDateTime lastUsedAt;

    /** True when a secret is on file, so a UI can say "saved" without seeing it. */
    boolean hasPassword;
    boolean hasPrivateKey;

    public static SshConnectionView of(SshConnection c) {
        return new SshConnectionView(
                c.getId(), c.getName(), c.getHost(), c.getPort(), c.getUsername(),
                c.getDescription(), c.getCreatedAt(), c.getUpdatedAt(), c.getLastUsedAt(),
                c.getPassword() != null && !c.getPassword().isEmpty(),
                c.getPrivateKey() != null && !c.getPrivateKey().isEmpty());
    }

    public static List<SshConnectionView> of(List<SshConnection> connections) {
        return connections.stream().map(SshConnectionView::of).collect(Collectors.toList());
    }
}
