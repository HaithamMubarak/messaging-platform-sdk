package com.hmdev.messaging.common.session;

import com.hmdev.messaging.common.data.AgentInfo;

import java.util.List;
import java.util.Set;

/**
 * Generic interface for managing agent sessions and channels.
 * Implementations may use Kafka, Redis, in-memory, etc.
 *
 * System roles are loaded from configuration and are not hardcoded.
 * Implementations must provide system roles via getConfiguredSystemRoles().
 */
public interface GenericSessionManager {


    /**
     * Stores a new agent session.
     * Associates both sessionId -> AgentInfo and channelId -> List<AgentInfo>.
     */
    void putSession(String sessionId, SessionInfo info);

    /**
     * Creates a new system agent session.
     * Used for creating internal system agent sessions (e.g., webrtc-relay, message-processor).
     * The sessionId is generated internally (UUID).
     *
     * @param channelId channel identifier
     * @param agentInfo agent info with role and context already set
     * @param forceNewSession if true, always create a new session; if false, return existing session if one exists for the agent in the channel
     * @return SessionInfo of the created session or existing session if overrideExisting=true and found
     */
    SessionInfo createSession(String channelId, AgentInfo agentInfo, boolean forceNewSession);

    /**
     * Retrieves a single AgentInfo by session ID.
     * @param sessionId session identifier
     * @return AgentInfo or null if not found
     */
    SessionInfo getSession(String sessionId);

    /**
     * Retrieves all agents sessions associated with a specific channel ID.
     * @param channelId channel identifier
     * @return list of AgentInfo (possibly empty)
     */
    List<SessionInfo> getSessionsByChannel(String channelId);

    /**
     * Get session info by channel ID and agent name.
     *
     * @param channelId channel identifier
     * @param agentName agent name to search for
     * @return SessionInfo if found, null otherwise
     */
    SessionInfo getSessionByChannelAndAgentName(String channelId, String agentName);

    /**
     * Get session info by channel ID and role.
     * Returns the first session found with the specified role in the channel.
     *
     * @param channelId channel identifier
     * @param role role to search for
     * @return list of SessionInfo with the specified role (possibly empty)
     */
    List<SessionInfo> getSessionByChannelAndRole(String channelId, String role);

    /**
     * Removes an agent session completely from both session and channel mappings.
     * Also triggers removal from persistence (Kafka, Redis, etc.)
     */
    void removeSession(String sessionId);

    /**
     * Update session in cache only if it still exists.
     * This prevents re-creating sessions that were intentionally deleted (e.g., via /disconnect).
     * Uses distributed locking to ensure thread-safety across multiple containers.
     *
     * @param sessionId the session ID to update
     * @param sessionInfo the session info to save
     */
    void updateSessionIfExists(String sessionId, SessionInfo sessionInfo);

    /**
     * Check if a session has a system role (e.g., webrtc-relay).
     * System role sessions are treated specially (e.g., may not require distributed locks).
     * Uses the configured system roles from the implementation.
     *
     * @param sessionId session identifier
     * @return true if session exists and has a system role, false otherwise
     */
    default boolean isSystemRoleSession(String sessionId) {
        return isSystemRoleSession(sessionId, getConfiguredSystemRoles());
    }

    /**
     * Check if a session has a system role using a custom set of system roles.
     *
     * @param sessionId session identifier
     * @param systemRoles custom set of role names considered system roles
     * @return true if session exists and has a system role, false otherwise
     */
    default boolean isSystemRoleSession(String sessionId, Set<String> systemRoles) {
        SessionInfo sessionInfo = getSession(sessionId);
        if (sessionInfo == null || sessionInfo.getAgentInfo() == null) {
            return false;
        }
        String role = sessionInfo.getAgentInfo().getRole();
        return role != null && systemRoles.contains(role);
    }

    /**
     * Get configured system roles loaded from configuration.
     * Implementations must load these from properties (e.g., messaging.systemRoles).
     * System roles are agents that are treated specially (e.g., no distributed lock required for connections).
     *
     * @return Set of configured system role names (never null, empty set if no system roles configured)
     */
    Set<String> getConfiguredSystemRoles();

    /**
     * Check if an agent name belongs to a system role.
     * Convenience method for checking agent names (e.g., "webrtc-relay-1") against configured system roles.
     *
     * @param agentName agent name to check
     * @return true if agent name indicates a system role, false otherwise
     */
    default boolean isSystemRoleAgent(String agentName) {
        if (agentName == null) {
            return false;
        }
        Set<String> rolesToCheck = getConfiguredSystemRoles();
        return rolesToCheck.stream()
            .anyMatch(agentName::startsWith);
    }

    /**
     * Get active (non-system) agents for a channel.
     * Excludes agents with roles in the configured system roles.
     *
     * @param channelId channel identifier
     * @return list of active AgentInfo objects (excluding system agents)
     */
    default List<AgentInfo> getActiveAgents(String channelId) {
        Set<String> systemRoles = getConfiguredSystemRoles();
        return getSessionsByChannel(channelId)
                .stream()
                .map(SessionInfo::getAgentInfo)
                .filter(ai -> ai != null && (ai.getRole() == null || !systemRoles.contains(ai.getRole())))
                .collect(java.util.stream.Collectors.toList());
    }

    /**
     * Get system agents for a channel.
     * Returns only agents with roles in the configured system roles.
     *
     * @param channelId channel identifier
     * @return list of system AgentInfo objects
     */
    default List<AgentInfo> getSystemAgents(String channelId) {
        Set<String> systemRoles = getConfiguredSystemRoles();
        return getSessionsByChannel(channelId)
                .stream()
                .map(SessionInfo::getAgentInfo)
                .filter(ai -> ai != null && ai.getRole() != null && systemRoles.contains(ai.getRole()))
                .collect(java.util.stream.Collectors.toList());
    }
}
