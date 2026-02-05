package com.hmdev.messaging.common.service;


import com.hmdev.messaging.common.data.*;
import com.hmdev.messaging.common.session.SessionInfo;


public interface EventMessageService<C> {

    /**
     * Sends a message to the channel and returns metadata about the send (channel id , topic, etc.).
     */
    ChannelStateDto send(String channelId, EventMessage event);

    C createChannel(String channelId, String devApiKey, String channelName, String channelPassword, boolean enableWebrtcRelay);

    /**
     * Receives messages for a channel with SessionInfo (required).
     * SessionInfo contains all necessary context: channelId, agentName, customEventType,
     * lastEphemeralReadTime, lastPersistenceReadTime, etc.
     *
     * This allows the service to:
     * - Access all session state
     * - Update session state directly (e.g., lastPersistenceReadTime)
     * - Track per-session read patterns
     *
     * @param sessionInfo The session info (REQUIRED - contains channelId, agentName, lastEphemeralReadTime, etc.)
     * @param receiveConfig Receive configuration (offsets, limits, poll source, etc.)
     * @return EventMessageResult with filtered messages and ephemeral messages
     */
    EventMessageResult receive(SessionInfo sessionInfo, ReceiveConfig receiveConfig);

    /**
     * Delete a channel entirely: remove DB record, cached state, and (where supported) the underlying topic/messages.
     * Implementations must validate the developer API key (devApiKey) and ensure only authorized callers can delete.
     * Return true when deletion completed (or topic deletion is supported and succeeded), false otherwise.
     */
    boolean deleteChannel(String channelId, String devApiKey);

    /**
     * Return current offsets info for admin inspection without making changes.
     * Implementations can return cache counter, DB metadata offsets and an observed kafka last offset.
     * Default is unsupported.
     */
    default ChannelOffsetInfo peekChannelOffsets(String channelId) {
        throw new UnsupportedOperationException("peekChannelOffsets not supported by this implementation");
    }

}
