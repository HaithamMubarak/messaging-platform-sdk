package com.hmdev.sdk.local.service;

import com.jcraft.jsch.*;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/**
 * SFTP Service for file operations over SSH connections.
 * Provides file browsing, upload, download, and editing capabilities.
 */
@Service
@Slf4j
@RequiredArgsConstructor
public class SftpService {

    // SFTP channel sessions mapped by terminal session ID
    private final Map<String, ChannelSftp> sftpChannels = new ConcurrentHashMap<>();
    private final Map<String, Session> sftpSessions = new ConcurrentHashMap<>();

    private final TerminalService terminalService;

    /**
     * Open SFTP channel for an existing SSH terminal session
     * Reuses the same JSch session if available
     */
    public void openSftpChannel(String terminalSessionId) throws Exception {
        ITerminalSession session = terminalService.getSession(terminalSessionId);

        if (session == null) {
            throw new IllegalArgumentException("Terminal session not found: " + terminalSessionId);
        }

        if (!(session instanceof SshTerminalSession)) {
            throw new IllegalArgumentException("Session is not an SSH session: " + terminalSessionId);
        }

        // Check if already open
        if (sftpChannels.containsKey(terminalSessionId)) {
            ChannelSftp existing = sftpChannels.get(terminalSessionId);
            if (existing.isConnected()) {
                log.info("[SFTP] Channel already open for session: {}", terminalSessionId);
                return;
            }
        }

        // We need to create a new session for SFTP since the existing one is used by the shell channel
        // Get connection details from the terminal service
        var dbSession = terminalService.getSessionById(terminalSessionId);
        if (dbSession.isEmpty() || dbSession.get().getSshConnectionId() == null) {
            throw new IllegalArgumentException("SSH connection info not found for session");
        }

        var sshConnection = terminalService.getSshConnectionByIdWithCredentials(dbSession.get().getSshConnectionId());
        if (sshConnection.isEmpty()) {
            throw new IllegalArgumentException("SSH connection not found");
        }

        var conn = sshConnection.get();

        // Create new JSch session for SFTP
        JSch jsch = new JSch();

        // Add private key if provided
        if (conn.getPrivateKey() != null && !conn.getPrivateKey().isEmpty()) {
            jsch.addIdentity("key", conn.getPrivateKey().getBytes(StandardCharsets.UTF_8), null, null);
        }

        Session jschSession = jsch.getSession(conn.getUsername(), conn.getHost(), conn.getPort());

        if (conn.getPassword() != null && !conn.getPassword().isEmpty()) {
            jschSession.setPassword(conn.getPassword());
        }

        jschSession.setConfig("StrictHostKeyChecking", "no");
        jschSession.connect(30000);

        // Open SFTP channel
        ChannelSftp sftpChannel = (ChannelSftp) jschSession.openChannel("sftp");
        sftpChannel.connect(10000);

        sftpSessions.put(terminalSessionId, jschSession);
        sftpChannels.put(terminalSessionId, sftpChannel);

        log.info("[SFTP] Opened SFTP channel for session: {}", terminalSessionId);
    }

    /**
     * Open SFTP channel directly with connection ID (without existing terminal session)
     */
    public String openSftpChannelDirect(Long connectionId) throws Exception {
        var sshConnection = terminalService.getSshConnectionByIdWithCredentials(connectionId);
        if (sshConnection.isEmpty()) {
            throw new IllegalArgumentException("SSH connection not found: " + connectionId);
        }

        var conn = sshConnection.get();
        String sftpSessionId = "sftp-" + UUID.randomUUID().toString();

        // Create new JSch session for SFTP
        JSch jsch = new JSch();

        if (conn.getPrivateKey() != null && !conn.getPrivateKey().isEmpty()) {
            jsch.addIdentity("key", conn.getPrivateKey().getBytes(StandardCharsets.UTF_8), null, null);
        }

        Session jschSession = jsch.getSession(conn.getUsername(), conn.getHost(), conn.getPort());

        if (conn.getPassword() != null && !conn.getPassword().isEmpty()) {
            jschSession.setPassword(conn.getPassword());
        }

        jschSession.setConfig("StrictHostKeyChecking", "no");
        jschSession.connect(30000);

        ChannelSftp sftpChannel = (ChannelSftp) jschSession.openChannel("sftp");
        sftpChannel.connect(10000);

        sftpSessions.put(sftpSessionId, jschSession);
        sftpChannels.put(sftpSessionId, sftpChannel);

        log.info("[SFTP] Opened direct SFTP channel: {} for connection: {}", sftpSessionId, connectionId);
        return sftpSessionId;
    }

    /**
     * Close SFTP channel
     */
    public void closeSftpChannel(String sessionId) {
        ChannelSftp channel = sftpChannels.remove(sessionId);
        Session session = sftpSessions.remove(sessionId);

        if (channel != null && channel.isConnected()) {
            channel.disconnect();
        }
        if (session != null && session.isConnected()) {
            session.disconnect();
        }

        log.info("[SFTP] Closed SFTP channel for session: {}", sessionId);
    }

    /**
     * List directory contents
     */
    public List<Map<String, Object>> listDirectory(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        List<Map<String, Object>> files = new ArrayList<>();

        @SuppressWarnings("unchecked")
        Vector<ChannelSftp.LsEntry> entries = channel.ls(path);

        for (ChannelSftp.LsEntry entry : entries) {
            String filename = entry.getFilename();
            // Skip . and ..
            if (".".equals(filename) || "..".equals(filename)) {
                continue;
            }

            SftpATTRS attrs = entry.getAttrs();
            Map<String, Object> fileInfo = new LinkedHashMap<>();
            fileInfo.put("name", filename);
            fileInfo.put("path", path.endsWith("/") ? path + filename : path + "/" + filename);
            fileInfo.put("isDirectory", attrs.isDir());
            fileInfo.put("isLink", attrs.isLink());
            fileInfo.put("size", attrs.getSize());
            fileInfo.put("permissions", attrs.getPermissionsString());
            fileInfo.put("permissionsOctal", String.format("%o", attrs.getPermissions() & 0777));
            fileInfo.put("uid", attrs.getUId());
            fileInfo.put("gid", attrs.getGId());
            fileInfo.put("mtime", attrs.getMTime() * 1000L); // Convert to milliseconds
            fileInfo.put("atime", attrs.getATime() * 1000L);

            // Determine file type icon hint
            fileInfo.put("type", getFileType(filename, attrs.isDir()));

            files.add(fileInfo);
        }

        // Sort: directories first, then by name
        files.sort((a, b) -> {
            boolean aDir = (Boolean) a.get("isDirectory");
            boolean bDir = (Boolean) b.get("isDirectory");
            if (aDir != bDir) {
                return aDir ? -1 : 1;
            }
            return ((String) a.get("name")).compareToIgnoreCase((String) b.get("name"));
        });

        log.debug("[SFTP] Listed {} files in: {}", files.size(), path);
        return files;
    }

    /**
     * Get current working directory
     */
    public String getCurrentDirectory(String sessionId) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        return channel.pwd();
    }

    /**
     * Get home directory
     */
    public String getHomeDirectory(String sessionId) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        return channel.getHome();
    }

    /**
     * Change directory
     */
    public String changeDirectory(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        channel.cd(path);
        return channel.pwd();
    }

    /**
     * Get file content (for text files)
     */
    public String getFileContent(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);

        // Check file size first (limit to 5MB for text files)
        SftpATTRS attrs = channel.stat(path);
        if (attrs.getSize() > 5 * 1024 * 1024) {
            throw new IllegalArgumentException("File too large to edit (max 5MB)");
        }

        try (InputStream is = channel.get(path);
             ByteArrayOutputStream baos = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int len;
            while ((len = is.read(buffer)) != -1) {
                baos.write(buffer, 0, len);
            }
            return baos.toString(StandardCharsets.UTF_8.name());
        }
    }

    /**
     * Save file content
     */
    public void saveFileContent(String sessionId, String path, String content) throws Exception {
        ChannelSftp channel = getChannel(sessionId);

        try (InputStream is = new ByteArrayInputStream(content.getBytes(StandardCharsets.UTF_8))) {
            channel.put(is, path, ChannelSftp.OVERWRITE);
        }

        log.info("[SFTP] Saved file: {} ({} bytes)", path, content.length());
    }

    /**
     * Create new file
     */
    public void createFile(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);

        try (InputStream is = new ByteArrayInputStream(new byte[0])) {
            channel.put(is, path);
        }

        log.info("[SFTP] Created file: {}", path);
    }

    /**
     * Create directory
     */
    public void createDirectory(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        channel.mkdir(path);
        log.info("[SFTP] Created directory: {}", path);
    }

    /**
     * Delete file or directory
     */
    public void delete(String sessionId, String path, boolean isDirectory) throws Exception {
        ChannelSftp channel = getChannel(sessionId);

        if (isDirectory) {
            deleteDirectoryRecursive(channel, path);
        } else {
            channel.rm(path);
        }

        log.info("[SFTP] Deleted: {} (isDir: {})", path, isDirectory);
    }

    /**
     * Recursively delete directory
     */
    private void deleteDirectoryRecursive(ChannelSftp channel, String path) throws SftpException {
        @SuppressWarnings("unchecked")
        Vector<ChannelSftp.LsEntry> entries = channel.ls(path);

        for (ChannelSftp.LsEntry entry : entries) {
            String name = entry.getFilename();
            if (".".equals(name) || "..".equals(name)) {
                continue;
            }

            String fullPath = path.endsWith("/") ? path + name : path + "/" + name;

            if (entry.getAttrs().isDir()) {
                deleteDirectoryRecursive(channel, fullPath);
            } else {
                channel.rm(fullPath);
            }
        }

        channel.rmdir(path);
    }

    /**
     * Rename/move file or directory
     */
    public void rename(String sessionId, String oldPath, String newPath) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        channel.rename(oldPath, newPath);
        log.info("[SFTP] Renamed: {} -> {}", oldPath, newPath);
    }

    /**
     * Get file info
     */
    public Map<String, Object> getFileInfo(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        SftpATTRS attrs = channel.stat(path);

        Map<String, Object> info = new LinkedHashMap<>();
        info.put("path", path);
        info.put("name", path.substring(path.lastIndexOf('/') + 1));
        info.put("isDirectory", attrs.isDir());
        info.put("isLink", attrs.isLink());
        info.put("size", attrs.getSize());
        info.put("permissions", attrs.getPermissionsString());
        info.put("permissionsOctal", String.format("%o", attrs.getPermissions() & 0777));
        info.put("uid", attrs.getUId());
        info.put("gid", attrs.getGId());
        info.put("mtime", attrs.getMTime() * 1000L);
        info.put("atime", attrs.getATime() * 1000L);

        return info;
    }

    /**
     * Change file permissions
     */
    public void chmod(String sessionId, String path, int permissions) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        channel.chmod(permissions, path);
        log.info("[SFTP] Changed permissions of {} to {}", path, String.format("%o", permissions));
    }

    /**
     * Download file - returns input stream for streaming
     */
    public InputStream downloadFile(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        return channel.get(path);
    }

    /**
     * Get file size
     */
    public long getFileSize(String sessionId, String path) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        return channel.stat(path).getSize();
    }

    /**
     * Upload file
     */
    public void uploadFile(String sessionId, String remotePath, InputStream inputStream) throws Exception {
        ChannelSftp channel = getChannel(sessionId);
        channel.put(inputStream, remotePath, ChannelSftp.OVERWRITE);
        log.info("[SFTP] Uploaded file to: {}", remotePath);
    }

    /**
     * Check if SFTP channel is open
     */
    public boolean isChannelOpen(String sessionId) {
        ChannelSftp channel = sftpChannels.get(sessionId);
        return channel != null && channel.isConnected();
    }

    /**
     * Get channel or throw exception
     */
    private ChannelSftp getChannel(String sessionId) throws Exception {
        ChannelSftp channel = sftpChannels.get(sessionId);
        if (channel == null || !channel.isConnected()) {
            throw new IllegalStateException("SFTP channel not open for session: " + sessionId);
        }
        return channel;
    }

    /**
     * Determine file type based on extension
     */
    private String getFileType(String filename, boolean isDirectory) {
        if (isDirectory) {
            return "folder";
        }

        String lower = filename.toLowerCase();
        int dotIndex = lower.lastIndexOf('.');
        if (dotIndex == -1) {
            return "file";
        }

        String ext = lower.substring(dotIndex + 1);

        // Text/Code files
        if (Set.of("txt", "md", "log", "cfg", "conf", "ini", "yml", "yaml", "json", "xml",
                   "html", "htm", "css", "js", "ts", "jsx", "tsx", "java", "py", "rb", "go",
                   "rs", "c", "cpp", "h", "hpp", "cs", "php", "sh", "bash", "zsh", "bat", "cmd",
                   "ps1", "sql", "properties", "env", "gitignore", "dockerfile", "makefile")
                .contains(ext)) {
            return "text";
        }

        // Images
        if (Set.of("jpg", "jpeg", "png", "gif", "bmp", "svg", "ico", "webp").contains(ext)) {
            return "image";
        }

        // Archives
        if (Set.of("zip", "tar", "gz", "bz2", "xz", "7z", "rar", "jar", "war", "ear").contains(ext)) {
            return "archive";
        }

        // Executables
        if (Set.of("exe", "msi", "bin", "app", "dmg", "deb", "rpm").contains(ext)) {
            return "executable";
        }

        // Documents
        if (Set.of("pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp").contains(ext)) {
            return "document";
        }

        // Audio
        if (Set.of("mp3", "wav", "ogg", "flac", "aac", "m4a").contains(ext)) {
            return "audio";
        }

        // Video
        if (Set.of("mp4", "avi", "mkv", "mov", "wmv", "webm").contains(ext)) {
            return "video";
        }

        return "file";
    }
}



