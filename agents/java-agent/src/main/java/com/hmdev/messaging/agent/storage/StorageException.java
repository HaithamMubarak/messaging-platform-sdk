package com.hmdev.messaging.agent.storage;

import lombok.Getter;

/**
 * A storage call the server refused, or that never reached it.
 * {@code httpStatus} is 0 for a network failure; {@link #isAppendOnly()} is a
 * 409, a write to a key an append-only add has locked.
 */
@Getter
public class StorageException extends RuntimeException {

    private final int httpStatus;

    public StorageException(String message, int httpStatus) {
        super(message);
        this.httpStatus = httpStatus;
    }

    public StorageException(String message, Throwable cause) {
        super(message, cause);
        this.httpStatus = 0;
    }

    public boolean isAppendOnly() {
        return httpStatus == 409;
    }
}
