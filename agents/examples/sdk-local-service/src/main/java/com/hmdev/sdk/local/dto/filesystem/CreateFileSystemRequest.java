package com.hmdev.sdk.local.dto.filesystem;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request to create a file system session
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CreateFileSystemRequest {

    /**
     * Unique session identifier
     */
    private String sessionId;

    /**
     * File system type: "local" or "sftp"
     */
    private String type;

    /**
     * For local file system: root path (optional)
     */
    private String rootPath;

    /**
     * For SFTP: SSH host
     */
    private String host;

    /**
     * For SFTP: SSH port (default: 22)
     */
    private Integer port;

    /**
     * For SFTP: SSH username
     */
    private String username;

    /**
     * For SFTP: SSH password (optional if using private key)
     */
    private String password;

    /**
     * For SFTP: SSH private key (optional if using password)
     */
    private String privateKey;

    /**
     * Optional: Existing SSH session ID to reuse
     */
    private String sshSessionId;
}

