package com.hmdev.sdk.local.dto.filesystem;

import com.hmdev.sdk.local.filesystem.FileInfo;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response containing file system operation results
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileSystemResponse {

    /**
     * Success indicator
     */
    private boolean success;

    /**
     * Error message (if any)
     */
    private String error;

    /**
     * Error code (if any)
     */
    private String errorCode;

    /**
     * List of files (for list operations)
     */
    private List<FileInfo> files;

    /**
     * Single file info (for get operations)
     */
    private FileInfo file;

    /**
     * File content as string (for read operations)
     */
    private String content;

    /**
     * File content as base64 (for binary read operations)
     */
    private String contentBase64;

    /**
     * Current directory path
     */
    private String currentDirectory;

    /**
     * Total space in bytes
     */
    private Long totalSpace;

    /**
     * Free space in bytes
     */
    private Long freeSpace;

    /**
     * Number of bytes written/read
     */
    private Long bytesProcessed;

    /**
     * Generic message
     */
    private String message;

    /**
     * Create success response
     */
    public static FileSystemResponse success(String message) {
        return FileSystemResponse.builder()
                .success(true)
                .message(message)
                .build();
    }

    /**
     * Create error response
     */
    public static FileSystemResponse error(String error, String errorCode) {
        return FileSystemResponse.builder()
                .success(false)
                .error(error)
                .errorCode(errorCode)
                .build();
    }
}

