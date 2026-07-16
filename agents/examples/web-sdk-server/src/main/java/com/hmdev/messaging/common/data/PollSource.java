package com.hmdev.messaging.common.data;

/**
 * Controls where to poll messages from.
 *
 * Two-layer fallback: Cache -> Database
 *
 * Layer 1: CACHE    - Ultra-fast in-memory storage (Redis) - the delivery layer
 * Layer 2: DATABASE - Permanent storage (PostgreSQL, source of truth for history)
 *
 * AUTO reads the cache first and falls back to the database, and is the only
 * value that long-polls; CACHE returns immediately with whatever is present.
 */
public enum PollSource {
    CACHE,
    DATABASE,

    /**
     * @deprecated Kafka was removed from the messaging flow (July 2026). This value is
     * RETAINED so existing clients that still send {@code pollSource: "KAFKA"} keep
     * working - the server now treats it exactly like {@link #DATABASE}, since everything
     * that used to live in Kafka retention is in PostgreSQL. Use {@link #DATABASE}.
     */
    @Deprecated
    KAFKA,

    AUTO;

    public boolean isCacheEnabled() {
        return this == AUTO || this == CACHE;
    }

    public boolean isDatabaseEnabled() {
        return this == AUTO || this == DATABASE;
    }

    /**
     * @deprecated Kafka is no longer a poll source; there is no broker. Retained for
     * binary/source compatibility only. Use {@link #isDatabaseEnabled()}.
     */
    @Deprecated
    public boolean isKafkaEnabled() {
        return this == AUTO || this == KAFKA;
    }

}
