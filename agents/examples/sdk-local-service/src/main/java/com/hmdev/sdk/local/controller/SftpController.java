package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.terminal.SftpService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

/**
 * REST Controller for SFTP file operations.
 * Provides file browsing, upload, download, and editing capabilities for SSH connections.
 */
@RestController
@RequestMapping("/sftp")
@RequiredArgsConstructor
@Slf4j
public class SftpController {

    private final SftpService sftpService;

    /**
     * Open SFTP channel for an existing terminal session
     *
     * POST /sftp/open
     * {
     *   "sessionId": "terminal-session-id"
     * }
     */
    @PostMapping("/open")
    public ResponseEntity<?> openSftpChannel(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId is required"));
        }

        try {
            sftpService.openSftpChannel(sessionId);
            String currentDir = sftpService.getCurrentDirectory(sessionId);
            return ResponseEntity.ok(Map.of(
                "status", "connected",
                "sessionId", sessionId,
                "currentDir", currentDir
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to open channel for session {}: {}", sessionId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Open SFTP channel directly with connection ID (standalone mode)
     *
     * POST /sftp/open-direct
     * {
     *   "connectionId": 1
     * }
     */
    @PostMapping("/open-direct")
    public ResponseEntity<?> openSftpChannelDirect(@RequestBody Map<String, Object> request) {
        Long connectionId = request.containsKey("connectionId") ?
            ((Number) request.get("connectionId")).longValue() : null;

        if (connectionId == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "connectionId is required"));
        }

        try {
            String sessionId = sftpService.openSftpChannelDirect(connectionId);
            String currentDir = sftpService.getCurrentDirectory(sessionId);
            return ResponseEntity.ok(Map.of(
                "status", "connected",
                "sessionId", sessionId,
                "currentDir", currentDir
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to open direct channel for connection {}: {}", connectionId, e.getMessage(), e);
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Close SFTP channel
     *
     * POST /sftp/close
     * {
     *   "sessionId": "sftp-session-id"
     * }
     */
    @PostMapping("/close")
    public ResponseEntity<?> closeSftpChannel(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        if (sessionId == null || sessionId.isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId is required"));
        }

        sftpService.closeSftpChannel(sessionId);
        return ResponseEntity.ok(Map.of("status", "closed"));
    }

    /**
     * Check if SFTP channel is open
     *
     * GET /sftp/status/{sessionId}
     */
    @GetMapping("/status/{sessionId}")
    public ResponseEntity<?> getStatus(@PathVariable String sessionId) {
        boolean isOpen = sftpService.isChannelOpen(sessionId);
        return ResponseEntity.ok(Map.of(
            "sessionId", sessionId,
            "connected", isOpen
        ));
    }

    /**
     * Get home directory path
     *
     * GET /sftp/home?sessionId=xxx
     */
    @GetMapping("/home")
    public ResponseEntity<?> getHomeDirectory(@RequestParam String sessionId) {
        try {
            String homePath = sftpService.getHomeDirectory(sessionId);
            return ResponseEntity.ok(Map.of("homePath", homePath));
        } catch (Exception e) {
            log.error("[SFTP] Failed to get home directory: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

/**
 * List directory contents
 *
 * GET /sftp/list?sessionId=xxx&path=/home/user
 */
@GetMapping("/list")
public ResponseEntity<?> listDirectory(
        @RequestParam String sessionId,
        @RequestParam(defaultValue = ".") String path) {
    try {
        // Change to the directory first (this updates the SFTP channel's PWD)
        sftpService.changeDirectory(sessionId, path);

        // Now list the files in current directory (.)
        List<Map<String, Object>> files = sftpService.listDirectory(sessionId, ".");

        // Get the current directory (which should now match the path we navigated to)
        String currentDir = sftpService.getCurrentDirectory(sessionId);

        log.info("[SFTP] Listed directory - requested: {}, current: {}, files: {}", path, currentDir, files.size());

        return ResponseEntity.ok(Map.of(
            "currentDir", currentDir,
            "path", path,
            "files", files,
            "count", files.size()
        ));
    } catch (Exception e) {
        log.error("[SFTP] Failed to list directory {}: {}", path, e.getMessage());
        return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
    }
}

    /**
     * Get current working directory
     *
     * GET /sftp/pwd?sessionId=xxx
     */
    @GetMapping("/pwd")
    public ResponseEntity<?> getCurrentDirectory(@RequestParam String sessionId) {
        try {
            String currentDir = sftpService.getCurrentDirectory(sessionId);
            return ResponseEntity.ok(Map.of("currentDir", currentDir));
        } catch (Exception e) {
            log.error("[SFTP] Failed to get pwd: {}", e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Change directory
     *
     * POST /sftp/cd
     * {
     *   "sessionId": "xxx",
     *   "path": "/home/user"
     * }
     */
    @PostMapping("/cd")
    public ResponseEntity<?> changeDirectory(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        String path = request.get("path");

        if (sessionId == null || path == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId and path are required"));
        }

        try {
            String newDir = sftpService.changeDirectory(sessionId, path);
            return ResponseEntity.ok(Map.of("currentDir", newDir));
        } catch (Exception e) {
            log.error("[SFTP] Failed to cd to {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Get file content (for editing)
     *
     * GET /sftp/file?sessionId=xxx&path=/path/to/file
     */
    @GetMapping("/file")
    public ResponseEntity<?> getFileContent(
            @RequestParam String sessionId,
            @RequestParam String path) {
        try {
            String content = sftpService.getFileContent(sessionId, path);
            Map<String, Object> fileInfo = sftpService.getFileInfo(sessionId, path);

            return ResponseEntity.ok(Map.of(
                "path", path,
                "content", content,
                "info", fileInfo
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to read file {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Save file content
     *
     * POST /sftp/file
     * {
     *   "sessionId": "xxx",
     *   "path": "/path/to/file",
     *   "content": "file content..."
     * }
     */
    @PostMapping("/file")
    public ResponseEntity<?> saveFileContent(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        String path = request.get("path");
        String content = request.get("content");

        if (sessionId == null || path == null || content == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId, path, and content are required"));
        }

        try {
            sftpService.saveFileContent(sessionId, path, content);
            return ResponseEntity.ok(Map.of(
                "status", "saved",
                "path", path,
                "size", content.length()
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to save file {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Create new file
     *
     * POST /sftp/create-file
     * {
     *   "sessionId": "xxx",
     *   "path": "/path/to/newfile.txt"
     * }
     */
    @PostMapping("/create-file")
    public ResponseEntity<?> createFile(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        String path = request.get("path");

        if (sessionId == null || path == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId and path are required"));
        }

        try {
            sftpService.createFile(sessionId, path);
            return ResponseEntity.ok(Map.of("status", "created", "path", path));
        } catch (Exception e) {
            log.error("[SFTP] Failed to create file {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Create directory
     *
     * POST /sftp/mkdir
     * {
     *   "sessionId": "xxx",
     *   "path": "/path/to/newdir"
     * }
     */
    @PostMapping("/mkdir")
    public ResponseEntity<?> createDirectory(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        String path = request.get("path");

        if (sessionId == null || path == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId and path are required"));
        }

        try {
            sftpService.createDirectory(sessionId, path);
            return ResponseEntity.ok(Map.of("status", "created", "path", path));
        } catch (Exception e) {
            log.error("[SFTP] Failed to create directory {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Delete file or directory
     *
     * DELETE /sftp/delete
     * {
     *   "sessionId": "xxx",
     *   "path": "/path/to/delete",
     *   "isDirectory": false
     * }
     */
    @DeleteMapping("/delete")
    public ResponseEntity<?> delete(@RequestBody Map<String, Object> request) {
        String sessionId = (String) request.get("sessionId");
        String path = (String) request.get("path");
        Boolean isDirectory = (Boolean) request.getOrDefault("isDirectory", false);

        if (sessionId == null || path == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId and path are required"));
        }

        try {
            sftpService.delete(sessionId, path, isDirectory);
            return ResponseEntity.ok(Map.of("status", "deleted", "path", path));
        } catch (Exception e) {
            log.error("[SFTP] Failed to delete {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Rename/move file or directory
     *
     * POST /sftp/rename
     * {
     *   "sessionId": "xxx",
     *   "oldPath": "/path/old",
     *   "newPath": "/path/new"
     * }
     */
    @PostMapping("/rename")
    public ResponseEntity<?> rename(@RequestBody Map<String, String> request) {
        String sessionId = request.get("sessionId");
        String oldPath = request.get("oldPath");
        String newPath = request.get("newPath");

        if (sessionId == null || oldPath == null || newPath == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId, oldPath, and newPath are required"));
        }

        try {
            sftpService.rename(sessionId, oldPath, newPath);
            return ResponseEntity.ok(Map.of(
                "status", "renamed",
                "oldPath", oldPath,
                "newPath", newPath
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to rename {} to {}: {}", oldPath, newPath, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Get file info
     *
     * GET /sftp/info?sessionId=xxx&path=/path/to/file
     */
    @GetMapping("/info")
    public ResponseEntity<?> getFileInfo(
            @RequestParam String sessionId,
            @RequestParam String path) {
        try {
            Map<String, Object> info = sftpService.getFileInfo(sessionId, path);
            return ResponseEntity.ok(info);
        } catch (Exception e) {
            log.error("[SFTP] Failed to get info for {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Change file permissions
     *
     * POST /sftp/chmod
     * {
     *   "sessionId": "xxx",
     *   "path": "/path/to/file",
     *   "permissions": 755
     * }
     */
    @PostMapping("/chmod")
    public ResponseEntity<?> chmod(@RequestBody Map<String, Object> request) {
        String sessionId = (String) request.get("sessionId");
        String path = (String) request.get("path");
        Integer permissions = (Integer) request.get("permissions");

        if (sessionId == null || path == null || permissions == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "sessionId, path, and permissions are required"));
        }

        try {
            sftpService.chmod(sessionId, path, permissions);
            return ResponseEntity.ok(Map.of(
                "status", "changed",
                "path", path,
                "permissions", String.format("%o", permissions)
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to chmod {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Download file
     *
     * GET /sftp/download?sessionId=xxx&path=/path/to/file
     */
    @GetMapping("/download")
    public ResponseEntity<?> downloadFile(
            @RequestParam String sessionId,
            @RequestParam String path) {
        try {
            long fileSize = sftpService.getFileSize(sessionId, path);
            InputStream inputStream = sftpService.downloadFile(sessionId, path);

            String filename = path.substring(path.lastIndexOf('/') + 1);
            String encodedFilename = URLEncoder.encode(filename, StandardCharsets.UTF_8.name())
                .replace("+", "%20");

            return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                    "attachment; filename=\"" + filename + "\"; filename*=UTF-8''" + encodedFilename)
                .header(HttpHeaders.CONTENT_LENGTH, String.valueOf(fileSize))
                .contentType(MediaType.APPLICATION_OCTET_STREAM)
                .body(new InputStreamResource(inputStream));

        } catch (Exception e) {
            log.error("[SFTP] Failed to download {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }

    /**
     * Upload file
     *
     * POST /sftp/upload?sessionId=xxx&path=/remote/path/filename
     * Body: multipart file
     */
    @PostMapping("/upload")
    public ResponseEntity<?> uploadFile(
            @RequestParam String sessionId,
            @RequestParam String path,
            @RequestParam("file") MultipartFile file) {
        try {
            sftpService.uploadFile(sessionId, path, file.getInputStream());
            return ResponseEntity.ok(Map.of(
                "status", "uploaded",
                "path", path,
                "size", file.getSize(),
                "originalName", file.getOriginalFilename()
            ));
        } catch (Exception e) {
            log.error("[SFTP] Failed to upload to {}: {}", path, e.getMessage());
            return ResponseEntity.internalServerError().body(Map.of("error", e.getMessage()));
        }
    }
}

