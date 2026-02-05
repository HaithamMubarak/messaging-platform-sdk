package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonPropertyOrder;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;


@Data
@AllArgsConstructor
@NoArgsConstructor
@JsonPropertyOrder({"events", "ephemeralEvents", "nextGlobalOffset", "nextLocalOffset", "pollSource"})
public class EventMessageResult {
    private List<EventMessage> events;

    /**
     * Ephemeral (short-term) messages that were delivered immediately.
     * These bypass Kafka/DB and are stored only in Redis cache.
     * Separated from normal events to maintain offset tracking integrity.
     */
    private List<EventMessage> ephemeralEvents;

    private Long nextGlobalOffset;
    private Long nextLocalOffset;

    /**
     * Indicates where the messages were fetched from (CACHE, DATABASE, KAFKA).
     * Optional - may be null for backward compatibility.
     */
    private PollSource pollSource;


    public EventMessageResult(List<EventMessage> events, Long nextGlobalOffset, Long nextLocalOffset) {
        this.events = events;
        this.nextGlobalOffset = nextGlobalOffset;
        this.nextLocalOffset = nextLocalOffset;
        this.pollSource = null;
        this.ephemeralEvents = null;
    }
}
