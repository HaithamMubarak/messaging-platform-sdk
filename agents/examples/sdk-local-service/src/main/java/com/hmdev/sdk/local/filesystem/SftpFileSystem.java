package com.hmdev.sdk.local.filesystem;

import com.jcraft.jsch.*;
import lombok.extern.slf4j.Slf4j;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;

/**
 * SFTP-based file system implementation.
 * Provides remote file access over SSH/SFTP protocol.
 */
@Slf4j
public class SftpFileSystem extends AbstractFileSystem {

    private final Session sshSession;
    private final ChannelSftp sftpChannel;
    private String currentDirectory;
    private String homeDirectory; // ✅ Store home directory separately
    private boolean connected = false;

    /**
     * Create SFTP file system with explicit credentials
     */
    public SftpFileSystem(String host, int port, String username, String password, String privateKey)
            throws FileSystemException {
        try {
            JSch jsch = new JSch();

            // Add private key if provided
            if (privateKey != null && !privateKey.trim().isEmpty()) {
                jsch.addIdentity("key", privateKey.getBytes(StandardCharsets.UTF_8), null, null);
            }

            sshSession = jsch.getSession(username, host, port);

            if (password != null && !password.isEmpty()) {
                sshSession.setPassword(password);
            }

            sshSession.setConfig("StrictHostKeyChecking", "no");
            sshSession.connect(30000);

            // Open SFTP channel
            sftpChannel = (ChannelSftp) sshSession.openChannel("sftp");
            sftpChannel.connect(10000);

            currentDirectory = sftpChannel.pwd();
            homeDirectory = currentDirectory; // ✅ Store initial directory as home
            connected = true;

            log.info("[SftpFS] Connected to {}:{} as {} (current dir: {}, home: {})",
                    host, port, username, currentDirectory, homeDirectory);

        } catch (JSchException | SftpException e) {
            throw new FileSystemException(
                    "Failed to connect to SFTP server: " + e.getMessage(),
                    FileSystemException.ErrorCode.CONNECTION_ERROR,
                    e
            );
        }
    }

    /**
     * Create SFTP file system with existing SFTP channel
     */
    public SftpFileSystem(Session sshSession, ChannelSftp sftpChannel) throws FileSystemException {
        this.sshSession = sshSession;
        this.sftpChannel = sftpChannel;

        if (!sftpChannel.isConnected()) {
            throw new FileSystemException(
                    "SFTP channel is not connected",
                    FileSystemException.ErrorCode.CONNECTION_ERROR
            );
        }

        try {
            this.currentDirectory = sftpChannel.pwd();
            this.homeDirectory = this.currentDirectory; // ✅ Store initial directory as home
            this.connected = true;
            log.info("[SftpFS] Initialized with existing channel (current dir: {}, home: {})",
                    currentDirectory, homeDirectory);
        } catch (SftpException e) {
            throw new FileSystemException(
                    "Failed to get current directory",
                    FileSystemException.ErrorCode.CONNECTION_ERROR,
                    e
            );
        }
    }

    /**
     * Create SFTP file system by opening a new SFTP channel on an existing SSH session.
     * This is the preferred method when reusing an existing SSH terminal connection.
     *
     * @param sshSession Existing JSch SSH session (must be connected)
     * @return SftpFileSystem instance with new SFTP channel
     * @throws FileSystemException if SSH session is invalid or SFTP channel creation fails
     */
    public static SftpFileSystem fromExistingSession(Session sshSession) throws FileSystemException {
        if (sshSession == null || !sshSession.isConnected()) {
            throw new FileSystemException(
                    "SSH session is null or not connected",
                    FileSystemException.ErrorCode.CONNECTION_ERROR
            );
        }

        try {
            // Open a new SFTP channel on the existing SSH session
            ChannelSftp sftpChannel = (ChannelSftp) sshSession.openChannel("sftp");
            sftpChannel.connect(10000); // 10 second timeout

            log.info("[SftpFS] Opened new SFTP channel on existing SSH session");

            return new SftpFileSystem(sshSession, sftpChannel);

        } catch (JSchException e) {
            throw new FileSystemException(
                    "Failed to open SFTP channel on existing SSH session: " + e.getMessage(),
                    FileSystemException.ErrorCode.CONNECTION_ERROR,
                    e
            );
        }
    }

    // ========================================
    // ROBUST CONNECTION VALIDATION
    // ========================================

    /**
     * Validate that SFTP channel is actually usable (not just "connected").
     *
     * Problem: Sometimes channel reports connected=true but throws IO errors.
     * This happens due to:
     * - Concurrent requests using same channel
     * - Stale/broken channel state
     * - SSH session disconnected but channel not notified
     *
     * Solution: Test channel health with a lightweight operation before use.
     *
     * @param operation Name of operation for logging
     * @throws FileSystemException if channel is not healthy
     */
    private synchronized void validateChannelHealth(String operation) throws FileSystemException {
        // Step 1: Basic connection check
        checkConnection();

        // Step 2: Validate SSH session is still connected
        if (sshSession == null || !sshSession.isConnected()) {
            log.warn("[SftpFS] SSH session disconnected during {}", operation);
            connected = false;
            throw new FileSystemException(
                "SSH session disconnected",
                FileSystemException.ErrorCode.CONNECTION_ERROR
            );
        }

        // Step 3: Validate SFTP channel is actually usable
        if (sftpChannel == null || sftpChannel.isClosed()) {
            log.warn("[SftpFS] SFTP channel closed during {}", operation);
            connected = false;
            throw new FileSystemException(
                "SFTP channel closed",
                FileSystemException.ErrorCode.CONNECTION_ERROR
            );
        }

        // Step 4: Test channel with lightweight operation (pwd)
        // This catches stale channels that report connected=true but can't actually work
        try {
            String testPwd = sftpChannel.pwd();
            if (testPwd == null) {
                log.warn("[SftpFS] Channel health check failed (pwd returned null) during {}", operation);
                connected = false;
                throw new FileSystemException(
                    "SFTP channel unhealthy - pwd returned null",
                    FileSystemException.ErrorCode.CONNECTION_ERROR
                );
            }
            // Channel is healthy ✅
            log.debug("[SftpFS] Channel health check passed for {}", operation);
        } catch (SftpException e) {
            log.warn("[SftpFS] Channel health check failed during {}: {}", operation, e.getMessage());
            connected = false;
            throw new FileSystemException(
                "SFTP channel unhealthy - health check failed: " + e.getMessage(),
                FileSystemException.ErrorCode.CONNECTION_ERROR,
                e
            );
        }
    }

    @Override
    public synchronized List<FileInfo> listFiles(String path) throws FileSystemException {
        // ✅ Robust connection check with channel validation
        validateChannelHealth("listFiles");

        try {
            String targetPath = path.isEmpty() || path.equals(".") ? currentDirectory : path;

            @SuppressWarnings("unchecked")
            Vector<ChannelSftp.LsEntry> entries = sftpChannel.ls(targetPath);

            // ✅ Update current directory - persists navigation in backend session!
            // Normalize the path to absolute path
            if (!targetPath.startsWith("/")) {
                // Relative path - resolve it
                String resolvedPath = currentDirectory.endsWith("/")
                    ? currentDirectory + targetPath
                    : currentDirectory + "/" + targetPath;
                this.currentDirectory = normalizePath(resolvedPath);
            } else {
                // Absolute path
                this.currentDirectory = targetPath;
            }
            log.debug("[SftpFS] Navigation: currentDirectory updated to: {}", this.currentDirectory);

            return entries.stream()
                    .filter(entry -> !entry.getFilename().equals(".") && !entry.getFilename().equals(".."))
                    .map(entry -> convertToFileInfo(entry, this.currentDirectory))
                    .sorted(FILE_COMPARATOR)  // ✅ Use shared comparator from base class
                    .collect(Collectors.toList());

        } catch (SftpException e) {
            // Check if connection was lost during operation
            if (!isConnected()) {
                throw new FileSystemException(
                        "SFTP connection lost during list operation: " + path,
                        FileSystemException.ErrorCode.CONNECTION_ERROR,
                        e
                );
            }
            throw new FileSystemException(
                    "Error listing directory: " + path + (e.getMessage() != null ? " - " + e.getMessage() : ""),
                    mapSftpError(e),
                    e
            );
        }
    }

    /**
     * Normalize path by resolving .. and . segments
     */
    private String normalizePath(String path) {
        String[] parts = path.split("/");
        java.util.List<String> normalizedParts = new java.util.ArrayList<>();

        for (String part : parts) {
            if (part.isEmpty() || part.equals(".")) {
                continue;
            } else if (part.equals("..")) {
                if (!normalizedParts.isEmpty()) {
                    normalizedParts.remove(normalizedParts.size() - 1);
                }
            } else {
                normalizedParts.add(part);
            }
        }

        return "/" + String.join("/", normalizedParts);
    }

    @Override
    public FileInfo getFileInfo(String path) throws FileSystemException {
        validateChannelHealth("getFileInfo");

        try {
            SftpATTRS attrs = sftpChannel.stat(path);
            String filename = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
            return convertToFileInfo(filename, path, attrs);

        } catch (SftpException e) {
            throw new FileSystemException(
                    "Error getting file info: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    private FileInfo convertToFileInfo(ChannelSftp.LsEntry entry, String parentPath) {
        String fullPath = parentPath.endsWith("/")
                ? parentPath + entry.getFilename()
                : parentPath + "/" + entry.getFilename();
        return convertToFileInfo(entry.getFilename(), fullPath, entry.getAttrs());
    }

    private FileInfo convertToFileInfo(String filename, String fullPath, SftpATTRS attrs) {
        boolean isDirectory = attrs.isDir();
        boolean isLink = attrs.isLink();

        FileInfo.FileInfoBuilder builder = FileInfo.builder()
                .name(filename)
                .path(fullPath)
                .size(attrs.getSize())
                .directory(isDirectory)
                .symbolicLink(isLink)
                .lastModified(Instant.ofEpochSecond(attrs.getMTime()))
                .permissions(attrs.getPermissionsString())
                .readable((attrs.getPermissions() & 0400) != 0)
                .writable((attrs.getPermissions() & 0200) != 0)
                .executable((attrs.getPermissions() & 0100) != 0);

        // Get owner and group info
        try {
            builder.owner(String.valueOf(attrs.getUId()));
            builder.group(String.valueOf(attrs.getGId()));
        } catch (Exception e) {
            log.debug("Could not get owner/group info: {}", e.getMessage());
        }

        return builder.build();
    }


    @Override
    public byte[] readFileBytes(String path) throws FileSystemException {
        validateChannelHealth("readFileBytes");

        try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            sftpChannel.get(path, baos);
            return baos.toByteArray();

        } catch (SftpException | IOException e) {
            // Check if connection was lost during operation
            if (!isConnected()) {
                throw new FileSystemException(
                        "SFTP connection lost during read operation: " + path,
                        FileSystemException.ErrorCode.CONNECTION_ERROR,
                        e
                );
            }
            throw new FileSystemException(
                    "Error reading file: " + path + (e.getMessage() != null ? " - " + e.getMessage() : ""),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public byte[] readFileByteRange(String path, long offset, int length) throws FileSystemException {
        validateChannelHealth("readFileByteRange");

        try (InputStream is = sftpChannel.get(path, null, offset)) {
            byte[] buffer = new byte[length];
            int totalRead = 0;

            while (totalRead < length) {
                int bytesRead = is.read(buffer, totalRead, length - totalRead);
                if (bytesRead == -1) break;
                totalRead += bytesRead;
            }

            if (totalRead < length) {
                return Arrays.copyOf(buffer, totalRead);
            }

            return buffer;

        } catch (SftpException | IOException e) {
            throw new FileSystemException(
                    "Error reading file range: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public InputStream openInputStream(String path) throws FileSystemException {
        validateChannelHealth("openInputStream");

        try {
            return sftpChannel.get(path);
        } catch (SftpException e) {
            throw new FileSystemException(
                    "Error opening file for reading: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }


    @Override
    public void writeFileBytes(String path, byte[] bytes) throws FileSystemException {
        validateChannelHealth("writeFileBytes");

        try (ByteArrayInputStream bais = new ByteArrayInputStream(bytes)) {
            sftpChannel.put(bais, path, ChannelSftp.OVERWRITE);
            log.info("[SftpFS] Wrote {} bytes to {}", bytes.length, path);

        } catch (SftpException | IOException e) {
            // Check if connection was lost during operation
            if (!isConnected()) {
                throw new FileSystemException(
                        "SFTP connection lost during write operation: " + path,
                        FileSystemException.ErrorCode.CONNECTION_ERROR,
                        e
                );
            }
            throw new FileSystemException(
                    "Error writing file: " + path + (e.getMessage() != null ? " - " + e.getMessage() : ""),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public void writeAtPosition(String path, long position, byte[] bytes) throws FileSystemException {
        validateChannelHealth("writeAtPosition");

        try {
            // SFTP doesn't support direct write at position
            // We need to: 1) download file, 2) modify, 3) upload
            byte[] existingContent;
            try (ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
                sftpChannel.get(path, baos);
                existingContent = baos.toByteArray();
            }

            // Expand file if needed
            int requiredSize = (int) (position + bytes.length);
            if (existingContent.length < requiredSize) {
                existingContent = Arrays.copyOf(existingContent, requiredSize);
            }

            // Write bytes at position
            System.arraycopy(bytes, 0, existingContent, (int) position, bytes.length);

            // Upload modified file
            try (ByteArrayInputStream bais = new ByteArrayInputStream(existingContent)) {
                sftpChannel.put(bais, path, ChannelSftp.OVERWRITE);
            }

            log.info("[SftpFS] Wrote {} bytes at position {} in {}", bytes.length, position, path);

        } catch (SftpException | IOException e) {
            throw new FileSystemException(
                    "Error writing at position: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public void appendToFile(String path, String content) throws FileSystemException {
        validateChannelHealth("appendToFile");

        try (ByteArrayInputStream bais = new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8))) {
            sftpChannel.put(bais, path, ChannelSftp.APPEND);
            log.info("[SftpFS] Appended to file: {}", path);

        } catch (SftpException | IOException e) {
            throw new FileSystemException(
                    "Error appending to file: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public OutputStream openOutputStream(String path, boolean append) throws FileSystemException {
        validateChannelHealth("openOutputStream");

        try {
            int mode = append ? ChannelSftp.APPEND : ChannelSftp.OVERWRITE;
            return sftpChannel.put(path, mode);

        } catch (SftpException e) {
            throw new FileSystemException(
                    "Error opening file for writing: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public void createDirectory(String path) throws FileSystemException {
        validateChannelHealth("createDirectory");

        try {
            sftpChannel.mkdir(path);
            log.info("[SftpFS] Created directory: {}", path);

        } catch (SftpException e) {
            throw new FileSystemException(
                    "Error creating directory: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public boolean deleteFile(String path) throws FileSystemException {
        validateChannelHealth("deleteFile");

        try {
            SftpATTRS attrs = sftpChannel.stat(path);

            if (attrs.isDir()) {
                sftpChannel.rmdir(path);
            } else {
                sftpChannel.rm(path);
            }

            log.info("[SftpFS] Deleted: {}", path);
            return true;

        } catch (SftpException e) {
            if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                return false;
            }
            throw new FileSystemException(
                    "Error deleting file: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public boolean deleteRecursive(String path) throws FileSystemException {
        validateChannelHealth("deleteRecursive");

        try {
            deleteRecursiveInternal(path);
            log.info("[SftpFS] Deleted recursively: {}", path);
            return true;

        } catch (SftpException e) {
            if (e.id == ChannelSftp.SSH_FX_NO_SUCH_FILE) {
                return false;
            }
            throw new FileSystemException(
                    "Error deleting recursively: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    private void deleteRecursiveInternal(String path) throws SftpException {
        SftpATTRS attrs = sftpChannel.stat(path);

        if (attrs.isDir()) {
            @SuppressWarnings("unchecked")
            Vector<ChannelSftp.LsEntry> entries = sftpChannel.ls(path);

            for (ChannelSftp.LsEntry entry : entries) {
                if (!entry.getFilename().equals(".") && !entry.getFilename().equals("..")) {
                    String childPath = path + "/" + entry.getFilename();
                    deleteRecursiveInternal(childPath);
                }
            }

            sftpChannel.rmdir(path);
        } else {
            sftpChannel.rm(path);
        }
    }

    @Override
    public void rename(String oldPath, String newPath) throws FileSystemException {
        validateChannelHealth("rename");

        try {
            sftpChannel.rename(oldPath, newPath);
            log.info("[SftpFS] Renamed {} to {}", oldPath, newPath);

        } catch (SftpException e) {
            throw new FileSystemException(
                    "Error renaming file: " + oldPath + " -> " + newPath + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public void copyFile(String sourcePath, String destinationPath) throws FileSystemException {
        validateChannelHealth("copyFile");

        try {
            // SFTP doesn't have native copy, so we download and upload
            byte[] content = readFileBytes(sourcePath);
            writeFileBytes(destinationPath, content);
            log.info("[SftpFS] Copied {} to {}", sourcePath, destinationPath);

        } catch (Exception e) {
            throw new FileSystemException(
                    "Error copying file: " + sourcePath + " -> " + destinationPath,
                    FileSystemException.ErrorCode.IO_ERROR,
                    e
            );
        }
    }

    @Override
    public boolean exists(String path) {
        if (!connected || !sftpChannel.isConnected()) {
            return false;
        }

        try {
            sftpChannel.stat(path);
            return true;
        } catch (SftpException e) {
            return false;
        }
    }

    @Override
    public boolean isDirectory(String path) {
        if (!connected || !sftpChannel.isConnected()) {
            return false;
        }

        try {
            SftpATTRS attrs = sftpChannel.stat(path);
            return attrs.isDir();
        } catch (SftpException e) {
            return false;
        }
    }

    @Override
    public String getCurrentDirectory() {
        return currentDirectory;
    }

    @Override
    public String getHomeDirectory() {
        return homeDirectory;
    }

    @Override
    public void changeDirectory(String path) throws FileSystemException {
        validateChannelHealth("changeDirectory");

        try {
            sftpChannel.cd(path);
            currentDirectory = sftpChannel.pwd();
            log.info("[SftpFS] Changed directory to: {}", currentDirectory);

        } catch (SftpException e) {
            throw new FileSystemException(
                    "Error changing directory to: " + path + " - " + e.getMessage(),
                    mapSftpError(e),
                    e
            );
        }
    }

    @Override
    public long getTotalSpace() {
        // SFTP protocol doesn't provide disk space information
        return -1;
    }

    @Override
    public long getFreeSpace() {
        // SFTP protocol doesn't provide disk space information
        return -1;
    }

    @Override
    public void close() throws FileSystemException {
        try {
            if (sftpChannel != null && sftpChannel.isConnected()) {
                sftpChannel.disconnect();
            }
            if (sshSession != null && sshSession.isConnected()) {
                sshSession.disconnect();
            }
            connected = false;
            log.info("[SftpFS] Closed SFTP connection");

        } catch (Exception e) {
            throw new FileSystemException(
                    "Error closing SFTP connection",
                    FileSystemException.ErrorCode.IO_ERROR,
                    e
            );
        }
    }

    @Override
    public boolean isConnected() {
        return connected && sftpChannel != null && sftpChannel.isConnected();
    }

    @Override
    protected boolean isConnectedInternal() {
        return connected && sftpChannel != null && sftpChannel.isConnected();
    }

    /**
     * Map SFTP exceptions to FileSystemException error codes
     */
    private FileSystemException.ErrorCode mapSftpError(Exception e) {
        if (e instanceof SftpException) {
            SftpException sftpException = (SftpException) e;
            switch (sftpException.id) {
                case ChannelSftp.SSH_FX_NO_SUCH_FILE:
                    return FileSystemException.ErrorCode.NOT_FOUND;
                case ChannelSftp.SSH_FX_PERMISSION_DENIED:
                    return FileSystemException.ErrorCode.PERMISSION_DENIED;
                // Note: SSH_FX_FILE_ALREADY_EXISTS and SSH_FX_NO_SPACE_ON_FILESYSTEM
                // are not defined in JSch, so we check error message instead
                default:
                    if (sftpException.getMessage() != null) {
                        String msg = sftpException.getMessage().toLowerCase();
                        if (msg.contains("already exists") || msg.contains("file exists")) {
                            return FileSystemException.ErrorCode.ALREADY_EXISTS;
                        }
                        if (msg.contains("no space") || msg.contains("disk full")) {
                            return FileSystemException.ErrorCode.NO_SPACE;
                        }
                    }
                    return FileSystemException.ErrorCode.IO_ERROR;
            }
        }
        return FileSystemException.ErrorCode.IO_ERROR;
    }
}


