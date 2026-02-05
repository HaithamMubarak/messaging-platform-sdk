package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * Platform capabilities that can be enabled/disabled per plan or session.
 * This enum is in the common module so it can be used by AgentInfo.
 */
public enum Capability {
    CHAT("chat"),
    FILES("files"),
    WEBRTC("webrtc"),
    WEBRTC_RELAY("webrtc-relay"),
    UDP("udp"),
    DB_PERSISTENCE("db-persistence"),
    REDIS_CACHE("redis-cache"),
    ANALYTICS("analytics"),
    RECORDING("recording"),
    SCREEN_SHARE("screen-share");

    private final String value;

    Capability(String value) {
        this.value = value;
    }

    @JsonValue
    public String getValue() {
        return value;
    }

    /**
     * Get capability from string value.
     * Returns null if value is not valid.
     */
    public static Capability fromValue(String value) {
        if (value == null) {
            return null;
        }
        for (Capability capability : values()) {
            if (capability.value.equals(value)) {
                return capability;
            }
        }
        return null;
    }

    @Override
    public String toString() {
        return value;
    }
}

