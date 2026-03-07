package com.hmdev.sdk.local.model;

import lombok.Data;
import javax.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "terminal_sessions")
@Data
public class TerminalSession {

    @Id
    private String sessionId;

    @Column(nullable = false)
    private String type; // "local" or "ssh"

    @Column
    private String shell; // For local: bash, cmd, etc.

    @Column(name = "ssh_connection_id")
    private Long sshConnectionId; // Reference to saved SSH connection

    @Column
    private String currentDirectory;

    @Column(nullable = false)
    private String status; // "active", "closed"

    @Column(name = "created_at")
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "closed_at")
    private LocalDateTime closedAt;

    @Column
    private Integer processId;

    // UI state fields for tab persistence
    @Column(name = "tab_name")
    private String tabName; // Custom tab name (user can rename)

    @Column(name = "tab_icon")
    private String tabIcon; // Icon for the tab (emoji)

    @Column(name = "tab_order")
    private Integer tabOrder; // Order of tabs (for restoration)

    @Column(name = "auto_restore")
    private Boolean autoRestore = true; // Should this tab be restored on reload?

    // Shared terminal fields
    @Column(name = "is_shared")
    private Boolean isShared = false; // Is this terminal being shared via cloud?

    @Column(name = "source")
    private String source; // Agent name that is sharing this terminal (empty for local terminals)

    // Transient fields (not stored in DB, computed at runtime)
    @Transient
    private Boolean isAlive; // Is this session alive in backend memory? (null = unknown, true = alive, false = disconnected)
}

