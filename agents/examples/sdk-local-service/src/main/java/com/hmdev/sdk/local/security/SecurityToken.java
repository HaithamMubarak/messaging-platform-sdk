package com.hmdev.sdk.local.security;

import lombok.Data;

import javax.persistence.*;
import java.time.LocalDateTime;

/**
 * Security token for SDK Local Service.
 * Each token is generated on startup and must be provided by clients to access protected endpoints.
 */
@Entity
@Table(name = "security_tokens")
@Data
public class SecurityToken {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 64)
    private String token;

    @Column(nullable = false)
    private LocalDateTime createdAt;

    @Column(nullable = false)
    private LocalDateTime expiresAt;

    @Column(nullable = false)
    private boolean active = true;

    @Column(length = 500)
    private String allowedOrigin;

    @PrePersist
    protected void onCreate() {
        if (createdAt == null) {
            createdAt = LocalDateTime.now();
        }
    }
}

