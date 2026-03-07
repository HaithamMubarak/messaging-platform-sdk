package com.hmdev.sdk.local.dto.filesystem;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Request for file write operations
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class FileWriteRequest {

    /**
     * File path
     */
    private String path;

    /**
     * Content to write (string)
     */
    private String content;

    /**
     * Content to write (base64 encoded bytes)
     */
    private String contentBase64;

    /**
     * Position to write at (for writeAtPosition)
     */
    private Long position;

    /**
     * Append mode (for output stream operations)
     */
    private Boolean append;
}

