package com.hmdev.sdk.local.filesystem;

/**
 * Exception thrown by file system operations
 */
public class FileSystemException extends Exception {

    private final ErrorCode errorCode;

    public FileSystemException(String message) {
        super(message);
        this.errorCode = ErrorCode.GENERAL_ERROR;
    }

    public FileSystemException(String message, Throwable cause) {
        super(message, cause);
        this.errorCode = ErrorCode.GENERAL_ERROR;
    }

    public FileSystemException(String message, ErrorCode errorCode) {
        super(message);
        this.errorCode = errorCode;
    }

    public FileSystemException(String message, ErrorCode errorCode, Throwable cause) {
        super(message, cause);
        this.errorCode = errorCode;
    }

    public ErrorCode getErrorCode() {
        return errorCode;
    }

    /**
     * Error codes for file system operations
     */
    public enum ErrorCode {
        /**
         * General/unknown error
         */
        GENERAL_ERROR,

        /**
         * File or directory not found
         */
        NOT_FOUND,

        /**
         * Permission denied
         */
        PERMISSION_DENIED,

        /**
         * File already exists
         */
        ALREADY_EXISTS,

        /**
         * Directory is not empty
         */
        DIRECTORY_NOT_EMPTY,

        /**
         * Invalid path
         */
        INVALID_PATH,

        /**
         * I/O error
         */
        IO_ERROR,

        /**
         * Connection error (for remote file systems)
         */
        CONNECTION_ERROR,

        /**
         * Authentication error (for remote file systems)
         */
        AUTHENTICATION_ERROR,

        /**
         * Timeout error
         */
        TIMEOUT,

        /**
         * Not supported operation
         */
        NOT_SUPPORTED,

        /**
         * Disk full / no space left
         */
        NO_SPACE,

        /**
         * File is too large
         */
        FILE_TOO_LARGE
    }
}

