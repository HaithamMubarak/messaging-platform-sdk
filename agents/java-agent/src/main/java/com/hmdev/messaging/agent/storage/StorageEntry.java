package com.hmdev.messaging.agent.storage;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.Builder;
import lombok.Getter;

/**
 * One stored version, decoded to the text that was written (decrypted when it
 * was encrypted). {@code writtenBy} is the agent name the writing session was
 * connected under, stamped by the server; a name inside the value is only the
 * writer's claim.
 */
@Getter
@Builder
public class StorageEntry {

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final String text;
    private final String writtenBy;
    private final boolean appendOnly;
    private final boolean encrypted;
    private final Long id;
    private final Integer version;
    private final String createdAt;
    private final JsonNode metadata;

    /** The value parsed as JSON, or null when it was written as plain text. */
    public JsonNode getJson() {
        try {
            return MAPPER.readTree(text);
        } catch (Exception e) {
            return null;
        }
    }

    /** The value read as {@code type}, for values written as JSON. */
    public <T> T as(Class<T> type) {
        try {
            return MAPPER.readValue(text, type);
        } catch (Exception e) {
            throw new StorageException("Stored value is not a " + type.getSimpleName() + ": " + e.getMessage(), e);
        }
    }
}
