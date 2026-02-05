package com.hmdev.messaging.common.data;

/**
 * Controls where to poll messages from.
 * Supports three-layer fallback: Cache -> Kafka -> Database
 *
 * Layer 1: CACHE - Ultra-fast in-memory storage (Redis)
 * Layer 2: KAFKA - Message broker with retention limits
 * Layer 3: DATABASE - Permanent storage (source of truth for historical data)
 */
public enum PollSource {
    CACHE,
    DATABASE,
    KAFKA,
    AUTO;

    public boolean isCacheEnabled() {
        return this == AUTO || this == CACHE;
    }

    public boolean isDatabaseEnabled() {
        return this == AUTO || this == DATABASE;
    }

    public boolean isKafkaEnabled() {
        return this == AUTO || this == KAFKA;
    }

}
