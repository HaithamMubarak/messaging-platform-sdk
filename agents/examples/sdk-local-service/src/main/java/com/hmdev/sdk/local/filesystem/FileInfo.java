package com.hmdev.sdk.local.filesystem;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.Instant;

/**
 * File information DTO containing metadata about files and directories
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileInfo {

    /**
     * File or directory name
     */
    private String name;

    /**
     * Full path to the file/directory
     */
    private String path;

    /**
     * File size in bytes (0 for directories)
     */
    private long size;

    /**
     * Whether this is a directory
     */
    private boolean directory;

    /**
     * Whether this is a symbolic link
     */
    private boolean symbolicLink;

    /**
     * Last modification timestamp
     */
    private Instant lastModified;

    /**
     * Creation timestamp (may not be available on all systems)
     */
    private Instant created;

    /**
     * Last access timestamp (may not be available on all systems)
     */
    private Instant lastAccessed;

    /**
     * File permissions (Unix-style string like "rwxr-xr-x" or numeric like "755")
     */
    private String permissions;

    /**
     * Owner username (may not be available on all systems)
     */
    private String owner;

    /**
     * Group name (may not be available on all systems)
     */
    private String group;

    /**
     * Whether the file is readable
     */
    private boolean readable;

    /**
     * Whether the file is writable
     */
    private boolean writable;

    /**
     * Whether the file is executable
     */
    private boolean executable;

    /**
     * Whether the file is hidden
     */
    private boolean hidden;

    /**
     * MIME type (if available)
     */
    private String mimeType;

    /**
     * Additional metadata as key-value pairs
     */
    private java.util.Map<String, Object> metadata;

    /**
     * Check if this is a regular file (not directory or symlink)
     */
    public boolean isFile() {
        return !directory && !symbolicLink;
    }

    /**
     * Get human-readable file size
     */
    public String getHumanReadableSize() {
        if (size < 1024) {
            return size + " B";
        } else if (size < 1024 * 1024) {
            return String.format("%.2f KB", size / 1024.0);
        } else if (size < 1024 * 1024 * 1024) {
            return String.format("%.2f MB", size / (1024.0 * 1024));
        } else {
            return String.format("%.2f GB", size / (1024.0 * 1024 * 1024));
        }
    }
}

