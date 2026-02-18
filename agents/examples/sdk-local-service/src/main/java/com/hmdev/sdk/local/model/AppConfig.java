package com.hmdev.sdk.local.model;

import lombok.Data;
import javax.persistence.*;
import java.time.LocalDateTime;

/**
 * Flexible key-value configuration table
 * Values stored as JSON strings for maximum flexibility
 */
@Entity
@Table(name = "app_config")
@Data
public class AppConfig {

    @Id
    @Column(name = "config_key")
    private String key;

    @Column(name = "config_value", columnDefinition = "TEXT")
    private String value; // JSON string

    @Column(name = "created_at")
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}

