package com.hmdev.sdk.local.filesystem;

import com.hmdev.sdk.local.terminal.ITerminalSession;
import com.hmdev.sdk.local.terminal.SshTerminalSession;
import com.hmdev.sdk.local.terminal.TerminalService;
import com.jcraft.jsch.ChannelSftp;
import com.jcraft.jsch.Session;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Service;

import java.nio.file.Paths;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Service for managing file system instances.
 * Provides factory methods for creating different types of file systems.
 * Auto-creates file systems on-demand based on terminal sessions.
 *
 * Uses @Lazy injection for TerminalService to break circular dependency at startup.
 * Spring will inject TerminalService proxy, breaking the circular dependency cycle.
 */
@Service
@Slf4j
public class FileSystemService {

    // Active file system sessions mapped by session ID
    private final Map<String, IFileSystem> fileSystems = new ConcurrentHashMap<>();

    // Lazy injection - breaks circular dependency
    private final TerminalService terminalService;

    // Configuration constants (injected as bean)
    private final FileSystemConstants config;

    public FileSystemService(@Lazy TerminalService terminalService, FileSystemConstants config) {
        this.terminalService = terminalService;
        this.config = config;
    }


    // ========================================
    // PUBLIC API METHODS
    // ========================================

    /**
     * Create an SFTP file system instance from existing JSch session
     *
     * @param sessionId    Unique session identifier
     * @param sshSession   Existing JSch session
     * @param sftpChannel  Existing SFTP channel
     * @return File system instance
     * @throws FileSystemException if initialization fails
     */
    public IFileSystem createSftpFileSystemFromChannel(String sessionId, Session sshSession, ChannelSftp sftpChannel)
            throws FileSystemException {
        log.info("{} Creating SFTP file system from existing channel for session: {}", config.getLogTag(), sessionId);

        IFileSystem fileSystem = new SftpFileSystem(sshSession, sftpChannel);
        fileSystems.put(sessionId, fileSystem);
        return fileSystem;
    }

    /**
     * Get or auto-create file system for a terminal session.
     * This is the main entry point - automatically creates file system on first access.
     *
     * Uses @Lazy injected TerminalService to avoid circular dependency.
     *
     * Special handling for "notes" session ID - creates NotesFileSystem
     *
     * @param terminalSessionId Terminal session identifier (or "notes" for notes filesystem)
     * @return File system instance or null if terminal not found/unsupported
     */
    public IFileSystem getOrCreateFileSystem(String terminalSessionId) {
        if (terminalSessionId == null || terminalSessionId.trim().isEmpty()) {
            log.warn("{} Terminal session ID cannot be null or empty", config.getLogTag());
            return null;
        }

        // ✅ Special case: "notes" session ID → NotesFileSystem
        if (config.getNotesSessionId().equals(terminalSessionId)) {
            return getOrCreateNotesFileSystem();
        }

        // Check if file system already exists (fast path)
        IFileSystem existing = fileSystems.get(terminalSessionId);
        if (existing != null) {
            if (!existing.isConnected()) {
                log.warn("{} File system exists but disconnected for terminal: {}", config.getLogTag(), terminalSessionId);
                // Remove stale session and recreate below
                fileSystems.remove(terminalSessionId);
            } else {
                log.debug("{} Using existing file system for terminal: {}", config.getLogTag(), terminalSessionId);
                return existing;
            }
        }

        // Get terminal session info (TerminalService is lazily injected - no circular dependency!)
        ITerminalSession terminalSession = terminalService.getSession(terminalSessionId);
        if (terminalSession == null) {
            log.warn("{} Terminal session not found: {}", config.getLogTag(), terminalSessionId);
            return null;
        }

        // Auto-create file system based on terminal type
        try {
            if (terminalSession instanceof SshTerminalSession) {
                return createSftpFileSystemForTerminal(terminalSessionId);
            } else {
                return createLocalFileSystemForTerminal(terminalSessionId);
            }
        } catch (Exception e) {
            log.error("{} Unexpected error auto-creating file system for terminal {}: {}",
                    config.getLogTag(), terminalSessionId, e.getMessage(), e);
            return null;
        }
    }

    /**
     * Get or create NotesFileSystem (special session for notes)
     * Session ID: "notes"
     * Storage: ~/.messaging-platform/sls/notes/
     */
    private IFileSystem getOrCreateNotesFileSystem() {
        // Check if already exists
        IFileSystem existing = fileSystems.get(config.getNotesSessionId());
        if (existing != null) {
            return existing;
        }

        try {
            // Get data directory from system property
            String dataDirectory = System.getProperty("user.home") + "/" + config.getDataDirectoryPath();

            // Create NotesFileSystem
            IFileSystem notesFs = new NotesFileSystem(dataDirectory, config);
            fileSystems.put(config.getNotesSessionId(), notesFs);

            log.info("{} Created NotesFileSystem in: {}/{}/", config.getLogTag(), dataDirectory, config.getNotesDirectoryName());
            return notesFs;

        } catch (Exception e) {
            log.error("{} Failed to create NotesFileSystem: {}", config.getLogTag(), e.getMessage(), e);
            return null;
        }
    }

    /**
     * Close and remove a file system instance
     * Called automatically when terminal session closes
     *
     * @param sessionId Session identifier (can be null - will return false)
     * @return true if file system was found and closed successfully
     */
    public boolean closeFileSystem(String sessionId) {
        if (sessionId == null || sessionId.trim().isEmpty()) {
            log.debug("{} Cannot close - session ID is null or empty", config.getLogTag());
            return false;
        }

        IFileSystem fileSystem = fileSystems.remove(sessionId);
        if (fileSystem != null) {
            try {
                fileSystem.close();
                log.info("{} Closed file system for session: {}", config.getLogTag(), sessionId);
                return true;
            } catch (FileSystemException e) {
                log.error("{} Error closing file system for session {}: {}",
                        config.getLogTag(), sessionId, e.getMessage());
                return false;
            }
        }
        log.debug("{} No file system found to close for session: {}", config.getLogTag(), sessionId);
        return false;
    }

    /**
     * Get all active file system session IDs
     *
     * @return Set of active session IDs
     */
    public java.util.Set<String> getActiveSessions() {
        return fileSystems.keySet();
    }

    /**
     * Check if a file system session exists
     *
     * @param sessionId Session identifier
     * @return true if session exists
     */
    public boolean hasSession(String sessionId) {
        return fileSystems.containsKey(sessionId);
    }

    /**
     * Check if a file system is still connected
     *
     * @param sessionId Session identifier
     * @return true if connected, false if not found or disconnected
     */
    public boolean isConnected(String sessionId) {
        IFileSystem fileSystem = fileSystems.get(sessionId);
        return fileSystem != null && fileSystem.isConnected();
    }

    /**
     * Close all file systems (cleanup on shutdown)
     */
    public void closeAll() {
        log.info("{} Closing all file systems ({} active)", config.getLogTag(), fileSystems.size());

        fileSystems.forEach((sessionId, fileSystem) -> {
            try {
                fileSystem.close();
                log.debug("{} Closed file system: {}", config.getLogTag(), sessionId);
            } catch (FileSystemException e) {
                log.error("{} Error closing file system {}: {}", config.getLogTag(), sessionId, e.getMessage());
            }
        });

        fileSystems.clear();
    }

    // ========================================
    // PRIVATE HELPER METHODS
    // ========================================

    /**
     * Create SFTP file system for SSH terminal (Internal helper)
     * Reuses the existing SSH session from the terminal instead of creating a new connection!
     */
    private IFileSystem createSftpFileSystemForTerminal(String terminalSessionId) {
        log.info("{} Auto-creating SFTP file system for SSH terminal: {}", config.getLogTag(), terminalSessionId);

        // Get the live terminal session (not DB record!)
        ITerminalSession terminalSession = terminalService.getSession(terminalSessionId);
        if (!(terminalSession instanceof SshTerminalSession)) {
            log.warn("{} Terminal session is not SSH type: {}", config.getLogTag(), terminalSessionId);
            return null;
        }

        SshTerminalSession sshTerminal = (SshTerminalSession) terminalSession;

        try {
            // Get the existing JSch Session from the live SSH terminal
            Session jschSession = sshTerminal.getJSchSession();

            // Use the professional factory method to create SFTP from existing SSH session
            IFileSystem fileSystem = SftpFileSystem.fromExistingSession(jschSession);
            fileSystems.put(terminalSessionId, fileSystem);

            log.info("{} SFTP file system created for terminal: {}", config.getLogTag(), terminalSessionId);
            return fileSystem;

        } catch (FileSystemException e) {
            log.error("{} Failed to create SFTP file system for terminal {}: {}",
                    config.getLogTag(), terminalSessionId, e.getMessage(), e);
            return null;
        }
    }

    /**
     * Create local file system for local terminal (Internal helper)
     */
    private IFileSystem createLocalFileSystemForTerminal(String terminalSessionId) {
        log.info("{} Auto-creating local file system for terminal: {}", config.getLogTag(), terminalSessionId);
        return createLocalFileSystem(terminalSessionId, null);
    }

    /**
     * Create a local file system instance (Internal use only)
     *
     * @param sessionId Unique session identifier
     * @param rootPath  Root path for the file system (optional, defaults to user home)
     * @return File system instance
     */
    private IFileSystem createLocalFileSystem(String sessionId, String rootPath) {
        log.info("{} Creating local file system for session: {} (root: {})",
                config.getLogTag(), sessionId, rootPath);

        IFileSystem fileSystem;
        if (rootPath != null && !rootPath.isEmpty()) {
            fileSystem = new LocalFileSystem(Paths.get(rootPath));
        } else {
            fileSystem = new LocalFileSystem();
        }

        fileSystems.put(sessionId, fileSystem);
        return fileSystem;
    }

    /**
     * Create an SFTP file system instance with credentials (Internal use only)
     *
     * @param sessionId  Unique session identifier
     * @param host       SSH host
     * @param port       SSH port
     * @param username   SSH username
     * @param password   SSH password (optional if using private key)
     * @param privateKey SSH private key (optional if using password)
     * @return File system instance
     * @throws FileSystemException if connection fails
     */
    private IFileSystem createSftpFileSystem(String sessionId, String host, int port,
                                            String username, String password, String privateKey)
            throws FileSystemException {
        log.info("{} Creating SFTP file system for session: {} ({}:{}@{}:{})",
                config.getLogTag(), sessionId, username, "***", host, port);

        IFileSystem fileSystem = new SftpFileSystem(host, port, username, password, privateKey);
        fileSystems.put(sessionId, fileSystem);
        return fileSystem;
    }
}

