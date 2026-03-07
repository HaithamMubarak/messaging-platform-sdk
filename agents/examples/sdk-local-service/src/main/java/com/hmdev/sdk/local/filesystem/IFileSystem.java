package com.hmdev.sdk.local.filesystem;

import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;

/**
 * File System Interface for remote and local file access.
 * Provides abstraction for file operations supporting multiple implementations (SFTP, Local, etc.).
 */
public interface IFileSystem {

    /**
     * List files and directories in a given path
     *
     * @param path The directory path to list
     * @return List of file information objects
     * @throws FileSystemException if operation fails
     */
    List<FileInfo> listFiles(String path) throws FileSystemException;

    /**
     * Get detailed information about a specific file or directory
     *
     * @param path The file/directory path
     * @return File information
     * @throws FileSystemException if file not found or operation fails
     */
    FileInfo getFileInfo(String path) throws FileSystemException;

    /**
     * Read entire file content as string
     *
     * @param path The file path
     * @return File content as string
     * @throws FileSystemException if operation fails
     */
    String readFileContent(String path) throws FileSystemException;

    /**
     * Read file content as bytes
     *
     * @param path The file path
     * @return File content as byte array
     * @throws FileSystemException if operation fails
     */
    byte[] readFileBytes(String path) throws FileSystemException;

    /**
     * Read a specific byte range from a file (for streaming/partial reads)
     *
     * @param path   The file path
     * @param offset Starting byte position (0-based)
     * @param length Number of bytes to read
     * @return Byte array containing the requested range
     * @throws FileSystemException if operation fails
     */
    byte[] readFileByteRange(String path, long offset, int length) throws FileSystemException;

    /**
     * Open an input stream for reading a file
     *
     * @param path The file path
     * @return Input stream for reading
     * @throws FileSystemException if operation fails
     */
    InputStream openInputStream(String path) throws FileSystemException;

    /**
     * Write string content to a file (overwrites existing content)
     *
     * @param path    The file path
     * @param content Content to write
     * @throws FileSystemException if operation fails
     */
    void writeFileContent(String path, String content) throws FileSystemException;

    /**
     * Write bytes to a file (overwrites existing content)
     *
     * @param path  The file path
     * @param bytes Content to write
     * @throws FileSystemException if operation fails
     */
    void writeFileBytes(String path, byte[] bytes) throws FileSystemException;

    /**
     * Write bytes at a specific position in the file (for partial updates)
     *
     * @param path     The file path
     * @param position Starting position (0-based)
     * @param bytes    Content to write
     * @throws FileSystemException if operation fails
     */
    void writeAtPosition(String path, long position, byte[] bytes) throws FileSystemException;

    /**
     * Append content to an existing file
     *
     * @param path    The file path
     * @param content Content to append
     * @throws FileSystemException if operation fails
     */
    void appendToFile(String path, String content) throws FileSystemException;

    /**
     * Open an output stream for writing to a file
     *
     * @param path   The file path
     * @param append If true, append to existing content; if false, overwrite
     * @return Output stream for writing
     * @throws FileSystemException if operation fails
     */
    OutputStream openOutputStream(String path, boolean append) throws FileSystemException;

    /**
     * Create a new directory
     *
     * @param path The directory path to create
     * @throws FileSystemException if operation fails
     */
    void createDirectory(String path) throws FileSystemException;

    /**
     * Delete a file or empty directory
     *
     * @param path The file/directory path to delete
     * @return true if deletion was successful
     * @throws FileSystemException if operation fails
     */
    boolean deleteFile(String path) throws FileSystemException;

    /**
     * Delete a directory recursively (including all contents)
     *
     * @param path The directory path to delete
     * @return true if deletion was successful
     * @throws FileSystemException if operation fails
     */
    boolean deleteRecursive(String path) throws FileSystemException;

    /**
     * Rename or move a file/directory
     *
     * @param oldPath Current path
     * @param newPath New path
     * @throws FileSystemException if operation fails
     */
    void rename(String oldPath, String newPath) throws FileSystemException;

    /**
     * Copy a file
     *
     * @param sourcePath      Source file path
     * @param destinationPath Destination file path
     * @throws FileSystemException if operation fails
     */
    void copyFile(String sourcePath, String destinationPath) throws FileSystemException;

    /**
     * Check if a file or directory exists
     *
     * @param path The path to check
     * @return true if exists, false otherwise
     */
    boolean exists(String path);

    /**
     * Check if the path is a directory
     *
     * @param path The path to check
     * @return true if directory, false otherwise
     */
    boolean isDirectory(String path);

    /**
     * Get the current working directory
     *
     * @return Current working directory path
     * @throws FileSystemException if operation fails
     */
    String getCurrentDirectory() throws FileSystemException;

    /**
     * Get the home directory for this file system
     *
     * @return Home directory path (e.g., /root, /home/username)
     * @throws FileSystemException if operation fails
     */
    String getHomeDirectory() throws FileSystemException;

    /**
     * Change the current working directory
     *
     * @param path New working directory path
     * @throws FileSystemException if operation fails
     */
    void changeDirectory(String path) throws FileSystemException;

    /**
     * Get total space available on the file system (in bytes)
     *
     * @return Total space in bytes, or -1 if not supported
     */
    long getTotalSpace();

    /**
     * Get free space available on the file system (in bytes)
     *
     * @return Free space in bytes, or -1 if not supported
     */
    long getFreeSpace();

    /**
     * Close and cleanup file system resources
     */
    void close() throws FileSystemException;

    /**
     * Check if the file system connection is still active
     *
     * @return true if connected, false otherwise
     */
    boolean isConnected();
}

