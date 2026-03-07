package com.hmdev.sdk.local.repository;

import com.hmdev.sdk.local.model.AppConfig;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

/**
 * Repository for app configuration (key-value store with JSON values)
 */
@Repository
public interface AppConfigRepository extends JpaRepository<AppConfig, String> {
}

