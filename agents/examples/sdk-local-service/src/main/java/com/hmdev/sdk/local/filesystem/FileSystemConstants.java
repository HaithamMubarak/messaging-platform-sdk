package com.hmdev.sdk.local.filesystem;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * Configuration properties for File System Service.
 * Values can be customized via application.properties with prefix "filesystem"
 *
 * Example:
 * filesystem.notes-session-id=notes
 * filesystem.data-directory-path=.messaging-platform/sls
 */
@Component
@ConfigurationProperties(prefix = "filesystem")
@Data
public class FileSystemConstants {

    // ========================================
    // SESSION IDs
    // ========================================

    /**
     * Special session ID for notes file system
     * Property: filesystem.notes-session-id
     */
    private String notesSessionId = "notes";

    // ========================================
    // DIRECTORY PATHS
    // ========================================

    /**
     * Base data directory relative to user home
     * Property: filesystem.data-directory-path
     */
    private String dataDirectoryPath = ".messaging-platform/sls";

    /**
     * Notes subdirectory name
     * Property: filesystem.notes-directory-name
     */
    private String notesDirectoryName = "notes";

    /**
     * Database subdirectory name
     * Property: filesystem.database-directory-name
     */
    private String databaseDirectoryName = "database";

    /**
     * Logs subdirectory name
     * Property: filesystem.logs-directory-name
     */
    private String logsDirectoryName = "logs";

    /**
     * Config subdirectory name
     * Property: filesystem.config-directory-name
     */
    private String configDirectoryName = "config";

    /**
     * Temp subdirectory name
     * Property: filesystem.temp-directory-name
     */
    private String tempDirectoryName = "temp";

    // ========================================
    // PATH PREFIXES
    // ========================================

    /**
     * Virtual path prefix for notes
     * Example: note://abc-123-def
     * Property: filesystem.note-path-prefix
     */
    private String notePathPrefix = "note://";

    // ========================================
    // LOG TAGS
    // ========================================

    /**
     * Log tag for FileSystemService
     * Property: filesystem.log-tag
     */
    private String logTag = "[FileSystemService]";

    /**
     * Log tag for NotesFileSystem
     * Property: filesystem.notes-log-tag
     */
    private String notesLogTag = "[NotesFileSystem]";

    /**
     * Log tag for LocalFileSystem
     * Property: filesystem.local-log-tag
     */
    private String localLogTag = "[LocalFS]";

    /**
     * Log tag for SftpFileSystem
     * Property: filesystem.sftp-log-tag
     */
    private String sftpLogTag = "[SFTP]";

    // ========================================
    // FILE EXTENSIONS
    // ========================================

    /**
     * Note file extension
     * Property: filesystem.note-file-extension
     */
    private String noteFileExtension = ".txt";

    // ========================================
    // TIMEOUT VALUES
    // ========================================

    /**
     * SFTP connection timeout in milliseconds
     * Property: filesystem.sftp-connect-timeout-ms
     */
    private int sftpConnectTimeoutMs = 10000; // 10 seconds

    /**
     * SSH session timeout in milliseconds
     * Property: filesystem.ssh-session-timeout-ms
     */
    private int sshSessionTimeoutMs = 30000; // 30 seconds
}


