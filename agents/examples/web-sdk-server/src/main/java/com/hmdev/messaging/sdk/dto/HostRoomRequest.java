package com.hmdev.messaging.sdk.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * POST /app/api/host: open a room whose host is the caller.
 *
 * The caller names only its app and the agent name it will connect as. The
 * room's name and password are made here, at random, so nobody can open the
 * same room first or guess it afterwards.
 */
@Data
@NoArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class HostRoomRequest {
    /** The app the room is for: the page's customType, so the room is `<channelName>.<app>` on the wire. */
    private String app;
    /** The agent name the host connects as. */
    private String agentName;
    /** Whose account the room is opened on, as for /app/api/config; empty is the site's own. */
    private String tenant;
}
