package com.hmdev.sdk.local.security;

import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.Optional;

/**
 * Repository for security tokens
 */
@Repository
public interface SecurityTokenRepository extends JpaRepository<SecurityToken, Long> {

    /**
     * Find an active token by its value
     */
    Optional<SecurityToken> findByTokenAndActiveTrue(String token);

    /**
     * Find all expired tokens
     */
    Optional<SecurityToken> findByExpiresAtBeforeAndActiveTrue(LocalDateTime dateTime);

    /**
     * Delete expired tokens
     */
    void deleteByExpiresAtBefore(LocalDateTime dateTime);
}

