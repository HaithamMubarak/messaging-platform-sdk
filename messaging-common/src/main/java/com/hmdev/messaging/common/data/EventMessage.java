package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.SuperBuilder;


@Data
@AllArgsConstructor
@NoArgsConstructor
@SuperBuilder
public class EventMessage {

    private String from;
    private String to;

    /**
     * Advanced filter query for targeting specific agents
     * Examples:
     *   "role=webrtc-relay"                    - Match agents with role
     *   "role=relay || role=cleanup"           - OR condition
     *   "role=webrtc-relay && status=active"   - AND condition
     *   "name=admin*"                          - Wildcard matching
     *   "tag=premium"                          - Tag matching
     *   "!role=bot"                            - Negation
     */
    private String filter;

    private EventType type;

    /**
     * Custom event subtype - used with EventType.CUSTOM to allow multiple apps
     * to share the same channel but filter different event types.
     * Examples: "chess", "poker", "game-state", "analytics"
     */
    private String customType;

    private boolean encrypted;
    private String content;
    private long date;

    private Long localOffset;

    /**
     * If true, this message is ephemeral/short-term and will:
     * - Be stored only in Redis cache (not Kafka/DB)
     * - Be delivered immediately on next pull request
     * - Be removed from cache after being read
     * - Have a short TTL (e.g., 30 seconds)
     *
     * Typical use cases: WebRTC signaling, real-time game state, presence updates
     */
    private boolean ephemeral;

    public EventMessage(String from, String to, EventType type, boolean encrypted, String content, long date) {
        this.from = from;
        this.to = to;
        this.type = type;
        this.encrypted = encrypted;
        this.content = content;
        this.date = date;
        this.localOffset = null;
        this.customType = null;
    }

    public EventMessage(EventMessage other) {
        this.from = other.from;
        this.to = other.to;
        this.filter = other.filter;
        this.type = other.type;
        this.customType = other.customType;
        this.encrypted = other.encrypted;
        this.content = other.content;
        this.date = other.date;
        this.localOffset = other.localOffset;
        this.ephemeral = other.ephemeral;
    }

    public enum EventType {
        CHAT_TEXT, CONNECT, DISCONNECT, UDP_DATA,
        /**
         * Custom event type for application-specific events.
         * Use with customType field to allow multiple apps to share same channel.
         *
         * Example: type=CUSTOM, customType="chess" for chess game events
         *          type=CUSTOM, customType="poker" for poker game events
         *
         * Agents can set customEventType on connect to filter which CUSTOM events they receive.
         */
        CUSTOM,
        /**
         * Sent by a new agent to request the channel password (payload: the agent's public key or key envelope).
         *
         * IMPORTANT: This event type is an agent-domain message; the Messaging-Service core must treat it
         * as an opaque EventMessage. The server must not persist, inspect, or process password request
         * contents in any special way. Handling (encryption/decryption and password storage) is the
         * responsibility of agents or developer-owned domain-servers.
         */
        PASSWORD_REQUEST,
        /**
         * Sent by the initiator (or any holder of the secret) as a private reply addressed to 'to' with encrypted content.
         *
         * IMPORTANT: This is an agent-domain reply. The Messaging-Service core must not attempt to decrypt,
         * persist, or otherwise special-case these messages.
         */
        PASSWORD_REPLY,
        /**
         * WebRTC signaling message for video stream negotiation.
         * Payload: JSON with SDP offer/answer or ICE candidate information.
         * Used for establishing peer-to-peer video connections between agents.
         */
        WEBRTC_SIGNALING,
        /**
         * File sharing message with download URL and metadata.
         * Payload: JSON with file information (id, url, name, size, mimeType, checksum).
         * Files may be encrypted by sender; decryption is receiver's responsibility.
         *
         * IMPORTANT: This is an agent-domain message. The server stores file blobs
         * but does not inspect encrypted content. Encryption/decryption is handled
         * by the agents themselves (end-to-end encryption).
         */
        FILE;

        /**
         * Determines if this event type should always be broadcast to all agents
         * regardless of their customEventType filter settings.
         *
         * Only CONNECT and DISCONNECT events are always broadcast:
         * - CONNECT: Agents need to know when others join
         * - DISCONNECT: Agents need to know when others leave
         *
         * All other events respect customEventType filtering:
         * - CHAT_TEXT: Can be filtered per application
         * - CUSTOM: Application-specific events (main use case for filtering)
         * - UDP_DATA: Application-specific data
         * - PASSWORD_REQUEST, PASSWORD_REPLY: Password exchange (filtered)
         * - VIDEO_STREAM_SIGNALING: WebRTC negotiation (filtered)
         * - FILE: File sharing (filtered)
         *
         * @return true if this event should bypass customEventType filtering
         */
        public boolean shouldAlwaysBroadcast() {
            switch (this) {
                case CONNECT:
                case DISCONNECT:
                case CHAT_TEXT:
                case WEBRTC_SIGNALING:
                    return true;
                case CUSTOM:
                case UDP_DATA:
                case PASSWORD_REQUEST:
                case PASSWORD_REPLY:
                case FILE:
                    return false;
                default:
                    return true;  // Default to always broadcast for safety (unknown event types)
            }
        }

        @JsonValue
        public String toJson() {
            return this.toString().toLowerCase().replace('_', '-');
        }

        @JsonCreator
        public static EventType fromJson(String value) {
            return EventType.valueOf(value.toUpperCase().replace('-', '_'));
        }
    }

}
