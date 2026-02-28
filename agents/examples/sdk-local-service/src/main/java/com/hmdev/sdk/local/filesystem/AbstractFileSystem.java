package com.hmdev.sdk.local.filesystem;

import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.List;

/**
 * Abstract base class for file system implementations.
 * Provides common functionality to eliminate code duplication.
 */
public abstract class AbstractFileSystem implements IFileSystem {

    /**
     * Common comparator for sorting files: directories first, then alphabetically
     */
    protected static final Comparator<FileInfo> FILE_COMPARATOR = (a, b) -> {
        // Directories first, then alphabetically
        if (a.isDirectory() != b.isDirectory()) {
            return a.isDirectory() ? -1 : 1;
        }
        return a.getName().compareToIgnoreCase(b.getName());
    };

    /**
     * Default implementation: convert string to bytes and call writeFileBytes
     */
    @Override
    public void writeFileContent(String path, String content) throws FileSystemException {
        writeFileBytes(path, content.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Default implementation: read bytes and convert to string
     */
    @Override
    public String readFileContent(String path) throws FileSystemException {
        byte[] bytes = readFileBytes(path);
        return new String(bytes, StandardCharsets.UTF_8);
    }

    /**
     * Validate path is not null or empty
     */
    protected void validatePath(String path) throws FileSystemException {
        if (path == null || path.trim().isEmpty()) {
            throw new FileSystemException(
                "Path cannot be null or empty",
                FileSystemException.ErrorCode.INVALID_PATH
            );
        }
    }

    /**
     * Get connection status - subclasses should override
     */
    protected abstract boolean isConnectedInternal();

    /**
     * Check connection and throw exception if not connected
     */
    protected void checkConnection() throws FileSystemException {
        if (!isConnectedInternal()) {
            throw new FileSystemException(
                "File system is not connected",
                FileSystemException.ErrorCode.CONNECTION_ERROR
            );
        }
    }
}

