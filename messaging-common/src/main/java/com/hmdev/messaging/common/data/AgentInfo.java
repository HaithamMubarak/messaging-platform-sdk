package com.hmdev.messaging.common.data;

import com.fasterxml.jackson.annotation.JsonProperty;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Map;
import java.util.HashMap;

@Data
@NoArgsConstructor
public class AgentInfo {

    private String agentName;

    /**
     * Agent alias (display name/nickname) - DEPRECATED
     *
     * Display names are now managed entirely in the frontend.
     * This field is kept for backward compatibility but should not be used.
     *
     * @deprecated Display names should be managed in frontend only via DataChannel P2P sync.
     *             Backend no longer tracks or validates display names.
     *             Will be removed in a future version.
     */
    @Deprecated
    private String agentAlias;

    /**
     * Agent type (e.g., "JAVA-AGENT", "PYTHON-AGENT", "WEB-AGENT")
     */
    private String agentType;

    /**
     * Agent descriptor (class name, user agent string, etc.)
     */
    private String descriptor;

    /**
     * IP address of the agent
     */
    @JsonProperty("ip_address")
    private String ipAddress;

    /**
     * Server timestamp when agent initially connected (milliseconds since epoch)
     * Used to determine host agent (earliest connection time = host)
     */
    private Long connectionTime;

    /**
     * Custom metadata map for additional agent properties
     * Can store: status, version, tags, platform, region, etc.
     */
    private Map<String, String> metadata;

    /**
     * Role (e.g., "observer", "system") - determines visibility and access
     */
    private String role;

    /**
     * Custom event type filter - comma-separated list of custom types this agent listens to.
     * When set, agent only receives CUSTOM events matching these types.
     * When null/empty, agent receives all messages.
     *
     * Examples: "chess", "poker", "chess,poker"
     */
    private String customEventType;

    /**
     * Restricted capabilities for this agent session (from temporary key).
     * When set, agent can only use these capabilities (subset of plan capabilities).
     * When null, agent has access to all plan capabilities.
     */
    private java.util.Set<Capability> restrictedCapabilities;

    public AgentInfo(String agentName, Map<String, String> metadata) {
        this.agentName = agentName;
        this.agentAlias = agentName;  // Default: alias = name
        this.metadata = metadata != null ? metadata : new HashMap<>();
        this.role = null;
        this.customEventType = null;
        this.restrictedCapabilities = null;
    }

    /**
     * Constructor with role
     */
    public AgentInfo(String agentName, Map<String, String> metadata, String role) {
        this.agentName = agentName;
        this.agentAlias = agentName;  // Default: alias = name
        this.metadata = metadata != null ? metadata : new HashMap<>();
        this.role = role;
        this.customEventType = null;
        this.restrictedCapabilities = null;
    }


    /**
     * Full constructor with all fields including customEventType, restrictedCapabilities, and connectionTime
     */
    public AgentInfo(String agentName, String agentType, String descriptor, String ipAddress,
                     Map<String, String> metadata, String role, String customEventType,
                     java.util.Set<Capability> restrictedCapabilities, Long connectionTime) {
        this.agentName = agentName;
        this.agentAlias = agentName;  // Default: alias = name
        this.agentType = agentType;
        this.descriptor = descriptor;
        this.ipAddress = ipAddress;
        this.connectionTime = connectionTime;
        this.metadata = metadata != null ? metadata : new HashMap<>();
        this.role = role;
        this.customEventType = customEventType;
        this.restrictedCapabilities = restrictedCapabilities;
    }

    /**
     * Constructor with all fields except connectionTime (for backward compatibility)
     */
    public AgentInfo(String agentName, String agentType, String descriptor, String ipAddress,
                     Map<String, String> metadata, String role, String customEventType,
                     java.util.Set<Capability> restrictedCapabilities) {
        this(agentName, agentType, descriptor, ipAddress, metadata, role, customEventType,
             restrictedCapabilities, System.currentTimeMillis());
    }

    // ...existing constructors...

    /**
     * Get metadata value by key, checking common fields first
     */
    public String get(String key) {
        switch (key) {
            case "name":
            case "agentName":
                return agentName;
            case "agentType":
                return agentType;
            case "descriptor":
                return descriptor;
            case "ipAddress":
            case "ip_address":
                return ipAddress;
            case "connectionTime":
                return connectionTime != null ? connectionTime.toString() : null;
            case "role":
                return role;
            default:
                return metadata != null ? metadata.get(key) : null;
        }
    }

    /**
     * Get metadata value by key (direct metadata map access)
     */
    public String getMetadataEntry(String key) {
        return metadata != null ? metadata.get(key) : null;
    }

    /**
     * Factory method: Create AgentInfo from request metadata map.
     * Extracts common fields (agentType, descriptor, ipAddress) from the metadata map
     * and creates an AgentInfo with those fields set directly.
     * Remaining custom fields stay in the metadata map.
     * Sets connectionTime to current server time.
     *
     * @param agentName The agent name
     * @param agentContext The metadata map from the connect request
     * @param role Optional role (null for normal agents)
     * @param customEventType Optional custom event type filter
     * @param restrictedCapabilities Optional restricted capabilities from temporary key
     * @return AgentInfo with extracted fields and cleaned metadata
     */
    public static AgentInfo fromContextMap(String agentName, Map<String, String> agentContext, String role,
                                          String customEventType, java.util.Set<Capability> restrictedCapabilities) {
        return fromContextMap(agentName, null, agentContext, role, customEventType, restrictedCapabilities);
    }

    /**
     * Factory method: Create AgentInfo from request metadata map with optional agentAlias.
     * Extracts common fields from the metadata map and creates an AgentInfo with those fields set directly.
     * Remaining custom fields stay in the metadata map.
     *
     * @param agentName The permanent agent identifier
     * @param agentAlias The display name (if null, defaults to agentName)
     * @param agentContext The metadata map from the connect request
     * @param role Optional role (null for normal agents)
     * @param customEventType Optional custom event type filter
     * @param restrictedCapabilities Optional restricted capabilities from temporary key
     * @return AgentInfo with extracted fields and cleaned metadata
     */
    public static AgentInfo fromContextMap(String agentName, String agentAlias, Map<String, String> agentContext, String role,
                                          String customEventType, java.util.Set<Capability> restrictedCapabilities) {
        // Extract common fields from metadata
        String agentType = agentContext != null ? agentContext.get("agentType") : null;
        String descriptor = agentContext != null ? agentContext.get("descriptor") : null;
        String ipAddress = agentContext != null ? agentContext.get("ipAddress") : null;

        // Extract customEventType from agentContext if not explicitly provided
        if (customEventType == null && agentContext != null) {
            customEventType = agentContext.get("customEventType");
        }

        // Support both ipAddress and ip_address formats
        if (ipAddress == null && agentContext != null) {
            ipAddress = agentContext.get("ip_address");
        }

        // Create metadata map without the extracted fields (keep only custom fields)
        Map<String, String> customMetadata = null;
        if (agentContext != null) {
            customMetadata = new HashMap<>(agentContext);
            customMetadata.remove("agentType");
            customMetadata.remove("descriptor");
            customMetadata.remove("ipAddress");
            customMetadata.remove("ip_address");
            customMetadata.remove("customEventType");  // Remove from metadata since it's a direct field
        }

        // Set connectionTime to current server timestamp (milliseconds since epoch)
        Long connectionTime = System.currentTimeMillis();

        // Create AgentInfo with all fields including customEventType, restrictedCapabilities, and connectionTime
        AgentInfo agentInfo = new AgentInfo(agentName, agentType, descriptor, ipAddress, customMetadata, role,
                           customEventType, restrictedCapabilities, connectionTime);

        // Set agentAlias if provided, otherwise it defaults to agentName (set in constructor)
        if (agentAlias != null && !agentAlias.trim().isEmpty()) {
            agentInfo.setAgentAlias(agentAlias);
        }

        return agentInfo;
    }

    /**
     * Factory method: Create AgentInfo from request metadata map (without agentAlias).
     *
     * @param agentName The agent name
     * @param agentContext The metadata map from the connect request
     * @param role Optional role (null for normal agents)
     * @param customEventType Optional custom event type filter
     * @return AgentInfo with extracted fields and cleaned metadata
     */
    public static AgentInfo fromContextMap(String agentName, Map<String, String> agentContext, String role, String customEventType) {
        return fromContextMap(agentName, agentContext, role, customEventType, null);
    }

    /**
     * Factory method: Create AgentInfo from request metadata map (with role but without customEventType).
     *
     * @param agentName The agent name
     * @param agentContext The metadata map from the connect request
     * @param role Optional role (null for normal agents)
     * @return AgentInfo with extracted fields and cleaned metadata
     */
    public static AgentInfo fromContextMap(String agentName, Map<String, String> agentContext, String role) {
        return fromContextMap(agentName, agentContext, role, null);
    }

    /**
     * Factory method: Create AgentInfo from request metadata map (without role).
     *
     * @param agentName The agent name
     * @param requestMetadata The metadata map from the connect request
     * @return AgentInfo with extracted fields and cleaned metadata
     */
    public static AgentInfo fromContextMap(String agentName, Map<String, String> requestMetadata) {
        return fromContextMap(agentName, requestMetadata, null);
    }

    /**
     * Factory method: Create a new AgentInfo with a different agent name, copying all other fields.
     * Used for agent name change operations.
     *
     * @param original The original AgentInfo to copy from
     * @param newAgentName The new agent name
     * @return New AgentInfo with updated name and all other fields preserved
     * @deprecated Use withNewAlias instead - agent name should remain permanent
     */
    @Deprecated
    public static AgentInfo withNewName(AgentInfo original, String newAgentName) {
        if (original == null) {
            throw new IllegalArgumentException("Original AgentInfo cannot be null");
        }
        if (newAgentName == null || newAgentName.trim().isEmpty()) {
            throw new IllegalArgumentException("New agent name cannot be null or empty");
        }

        // Create new AgentInfo with same fields but new name
        // Keep original connectionTime to maintain session continuity
        return new AgentInfo(
            newAgentName,
            original.getAgentType(),
            original.getDescriptor(),
            original.getIpAddress(),
            original.getMetadata() != null ? new HashMap<>(original.getMetadata()) : null,
            original.getRole(),
            original.getCustomEventType(),
            original.getRestrictedCapabilities(),
            original.getConnectionTime()
        );
    }

    /**
     * Factory method: Create a new AgentInfo with a different agent alias (display name).
     * Agent name remains unchanged (permanent identifier).
     *
     * @param original The original AgentInfo to copy from
     * @param newAgentAlias The new agent alias/display name
     * @return New AgentInfo with updated alias and all other fields preserved
     */
    public static AgentInfo withNewAlias(AgentInfo original, String newAgentAlias) {
        if (original == null) {
            throw new IllegalArgumentException("Original AgentInfo cannot be null");
        }
        if (newAgentAlias == null || newAgentAlias.trim().isEmpty()) {
            throw new IllegalArgumentException("New agent alias cannot be null or empty");
        }

        AgentInfo updated = new AgentInfo(
            original.getAgentName(),  // Keep original name (permanent)
            original.getAgentType(),
            original.getDescriptor(),
            original.getIpAddress(),
            original.getMetadata() != null ? new HashMap<>(original.getMetadata()) : null,
            original.getRole(),
            original.getCustomEventType(),
            original.getRestrictedCapabilities(),
            original.getConnectionTime()
        );
        updated.setAgentAlias(newAgentAlias);  // Update alias only
        return updated;
    }
}
