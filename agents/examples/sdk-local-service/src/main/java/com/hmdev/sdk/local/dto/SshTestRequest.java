package com.hmdev.sdk.local.dto;

import lombok.Data;

/**
 * DTO for testing SSH connection credentials
 */
@Data
public class SshTestRequest {
    private String host;
    private Integer port = 22;
    private String username;
    private String password;
    private String privateKey;
}

