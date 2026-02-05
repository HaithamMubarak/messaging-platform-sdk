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
        return new AgentInfo(agentName, agentType, descriptor, ipAddress, customMetadata, role,
                           customEventType, restrictedCapabilities, connectionTime);
    }

    /**
     * Factory method: Create AgentInfo from request metadata map (with role and customEventType).
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
}

