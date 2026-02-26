package com.hmdev.sdk.local.dto;

import lombok.AllArgsConstructor;
import lombok.Data;

/**
 * DTO for SSH connection test response
 */
@Data
@AllArgsConstructor
public class SshTestResponse {
    private boolean success;
    private String message;
    private SshTestDetails details;
    private String error;

    public static SshTestResponse success(String host, Integer port, String username, String serverVersion) {
        return new SshTestResponse(
            true,
            "Connection successful",
            new SshTestDetails(host, port, username, serverVersion),
            null
        );
    }

    public static SshTestResponse failure(String errorMessage) {
        return new SshTestResponse(
            false,
            null,
            null,
            errorMessage
        );
    }

    @Data
    @AllArgsConstructor
    public static class SshTestDetails {
        private String host;
        private Integer port;
        private String username;
        private String serverVersion;
    }
}

