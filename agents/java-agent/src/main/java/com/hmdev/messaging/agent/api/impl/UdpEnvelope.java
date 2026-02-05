package com.hmdev.messaging.agent.api.impl;

import com.fasterxml.jackson.databind.JsonNode;
import lombok.Getter;
import lombok.Setter;

/**
 * Simple model for UDP envelope messages sent to the service UDP listener.
 * Structure: { "action": "push" | "pull", "payload": { ... }, "requestId": "..." }
 */
@Setter
@Getter
public class UdpEnvelope {
    private String action;
    private JsonNode payload;
    private String requestId;

    public UdpEnvelope() { }

    public UdpEnvelope(String action, JsonNode payload) {
        this.action = action;
        this.payload = payload;
    }

    public UdpEnvelope(String action, JsonNode payload, String requestId) {
        this.action = action;
        this.payload = payload;
        this.requestId = requestId;
    }

}
