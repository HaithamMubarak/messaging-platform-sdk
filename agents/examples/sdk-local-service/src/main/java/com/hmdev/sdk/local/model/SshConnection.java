package com.hmdev.sdk.local.model;

import lombok.Data;
import com.hmdev.sdk.local.security.crypto.EncryptedStringConverter;

import javax.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "ssh_connections")
@Data
public class SshConnection {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true)
    private String name;

    @Column(nullable = false)
    private String host;

    @Column(nullable = false)
    private Integer port = 22;

    @Column(nullable = false)
    private String username;

    // Encrypted at rest: these are the credentials for a real host, and the
    // database is a file on disk that backups and sync folders pick up.
    @Column(length = 2048)
    @Convert(converter = EncryptedStringConverter.class)
    private String password;

    @Column(length = 8192)
    @Convert(converter = EncryptedStringConverter.class)
    private String privateKey;

    @Column
    private String description;

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "updated_at")
    private LocalDateTime updatedAt = LocalDateTime.now();

    @Column(name = "last_used_at")
    private LocalDateTime lastUsedAt;

    @PreUpdate
    public void preUpdate() {
        this.updatedAt = LocalDateTime.now();
    }
}

