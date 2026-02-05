package com.hmdev.messaging.agent.core;

/**
 * Functional interface used by AgentConnection to decide whether to reply to a PASSWORD_REQUEST.
 * Implementations must return true to allow the agent to send a PASSWORD_REPLY (encrypted to the requester),
 * or false to ignore the request.
 */
@FunctionalInterface
public interface PasswordRequestHandler {
    /**
     * @param channelId the server-side channel identifier (may be null if unknown)
     * @param requesterAgentName agent name of the requester (may be null or "*")
     * @param requesterPublicKeyPem public key string provided by requester (PEM or base64)
     * @return true to allow sending a PASSWORD_REPLY, false to ignore
     */
    boolean onPasswordRequest(String channelId, String requesterAgentName, String requesterPublicKeyPem);
}
