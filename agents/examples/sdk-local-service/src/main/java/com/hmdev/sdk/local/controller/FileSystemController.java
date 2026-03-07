package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.dto.filesystem.*;
import com.hmdev.sdk.local.filesystem.*;
import com.hmdev.sdk.local.filesystem.NotesFileSystem;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * REST Controller for File System operations.
 * Auto-creates file system sessions on-demand based on terminal session.
 * Uses FileSystemService.getOrCreateFileSystem() which handles auto-creation with @Lazy injection.
 */
@RestController
@RequestMapping("/filesystem")
@RequiredArgsConstructor
@Slf4j
public class FileSystemController {

    private final FileSystemService fileSystemService;


    /**
     * List files in a directory
     * GET /filesystem/{terminalSessionId}/list?path=/some/path
     * Auto-creates file system if needed based on terminal session
     */
    @GetMapping("/{terminalSessionId}/list")
    public ResponseEntity<FileSystemResponse> listFiles(
            @PathVariable String terminalSessionId,
            @RequestParam(defaultValue = ".") String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(terminalSessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("Terminal session not found or unsupported", "SESSION_NOT_FOUND")
                );
            }

            List<FileInfo> files = fs.listFiles(path);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .files(files)
                    .currentDirectory(fs.getCurrentDirectory())
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error listing files: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Get file information
     * GET /filesystem/{sessionId}/info?path=/some/file.txt
     */
    @GetMapping("/{sessionId}/info")
    public ResponseEntity<FileSystemResponse> getFileInfo(
            @PathVariable String sessionId,
            @RequestParam String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            FileInfo fileInfo = fs.getFileInfo(path);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .file(fileInfo)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error getting file info: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Get file system status (current directory, home directory, space info)
     * GET /filesystem/{sessionId}/status
     */
    @GetMapping("/{sessionId}/status")
    public ResponseEntity<FileSystemResponse> getStatus(@PathVariable String sessionId) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            String currentDir = fs.getCurrentDirectory();
            String homeDir = fs.getHomeDirectory();
            long totalSpace = fs.getTotalSpace();
            long freeSpace = fs.getFreeSpace();

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .currentDirectory(currentDir)
                    .message("homeDirectory:" + homeDir) // Store homeDirectory in message field
                    .totalSpace(totalSpace)
                    .freeSpace(freeSpace)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error getting status: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Read file content as text
     * GET /filesystem/{sessionId}/read?path=/some/file.txt
     */
    @GetMapping("/{sessionId}/read")
    public ResponseEntity<FileSystemResponse> readFile(
            @PathVariable String sessionId,
            @RequestParam String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            String content = fs.readFileContent(path);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .content(content)
                    .bytesProcessed((long) content.length())
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error reading file: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Read file content as binary (base64 encoded)
     * GET /filesystem/{sessionId}/read-binary?path=/some/file.bin
     */
    @GetMapping("/{sessionId}/read-binary")
    public ResponseEntity<FileSystemResponse> readFileBinary(
            @PathVariable String sessionId,
            @RequestParam String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            byte[] bytes = fs.readFileBytes(path);
            String base64 = Base64.getEncoder().encodeToString(bytes);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .contentBase64(base64)
                    .bytesProcessed((long) bytes.length)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error reading binary file: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Download a file directly (returns file as downloadable resource)
     * GET /filesystem/{sessionId}/download?path=/some/file.txt
     * Returns the file with proper Content-Disposition headers for download
     */
    @GetMapping("/{sessionId}/download")
    public ResponseEntity<Resource> downloadFile(
            @PathVariable String sessionId,
            @RequestParam String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                log.error("[FileSystem] Download failed - session not found: {}", sessionId);
                return ResponseEntity.status(HttpStatus.NOT_FOUND).build();
            }

            // Get file info for filename
            FileInfo fileInfo = fs.getFileInfo(path);
            if (fileInfo.isDirectory()) {
                log.error("[FileSystem] Cannot download directory: {}", path);
                return ResponseEntity.badRequest().build();
            }

            // Read file bytes
            byte[] bytes = fs.readFileBytes(path);
            Resource resource = new ByteArrayResource(bytes);

            // Determine content type
            String contentType = determineContentType(fileInfo.getName());

            // Encode filename for Content-Disposition header (handles special characters)
            String encodedFilename = URLEncoder.encode(fileInfo.getName(), StandardCharsets.UTF_8.toString())
                    .replaceAll("\\+", "%20");

            log.info("[FileSystem] File downloaded: {} ({} bytes)", path, bytes.length);

            // Return file with proper headers
            return ResponseEntity.ok()
                    .contentType(MediaType.parseMediaType(contentType))
                    .header(HttpHeaders.CONTENT_DISPOSITION,
                            "attachment; filename=\"" + fileInfo.getName() + "\"; filename*=UTF-8''" + encodedFilename)
                    .contentLength(bytes.length)
                    .body(resource);

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error downloading file: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        } catch (Exception e) {
            log.error("[FileSystem] Unexpected error downloading file: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).build();
        }
    }

    /**
     * Determine content type based on file extension
     */
    private String determineContentType(String filename) {
        String lower = filename.toLowerCase();

        // Text files
        if (lower.endsWith(".txt")) return "text/plain";
        if (lower.endsWith(".log")) return "text/plain";
        if (lower.endsWith(".md")) return "text/markdown";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".xml")) return "application/xml";
        if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "text/yaml";
        if (lower.endsWith(".csv")) return "text/csv";

        // Code files
        if (lower.endsWith(".java")) return "text/x-java";
        if (lower.endsWith(".js")) return "text/javascript";
        if (lower.endsWith(".py")) return "text/x-python";
        if (lower.endsWith(".sh")) return "text/x-shellscript";
        if (lower.endsWith(".bat") || lower.endsWith(".cmd")) return "text/x-bat";
        if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html";
        if (lower.endsWith(".css")) return "text/css";

        // Archives
        if (lower.endsWith(".zip")) return "application/zip";
        if (lower.endsWith(".tar")) return "application/x-tar";
        if (lower.endsWith(".gz")) return "application/gzip";
        if (lower.endsWith(".7z")) return "application/x-7z-compressed";
        if (lower.endsWith(".rar")) return "application/x-rar-compressed";

        // Images
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".ico")) return "image/x-icon";

        // Documents
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".doc")) return "application/msword";
        if (lower.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        if (lower.endsWith(".xls")) return "application/vnd.ms-excel";
        if (lower.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

        // Default
        return "application/octet-stream";
    }

    /**
     * Read file byte range
     * GET /filesystem/{sessionId}/read-range?path=/some/file.bin&offset=0&length=1024
     */
    @GetMapping("/{sessionId}/read-range")
    public ResponseEntity<FileSystemResponse> readFileRange(
            @PathVariable String sessionId,
            @RequestParam String path,
            @RequestParam long offset,
            @RequestParam int length) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            byte[] bytes = fs.readFileByteRange(path, offset, length);
            String base64 = Base64.getEncoder().encodeToString(bytes);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .contentBase64(base64)
                    .bytesProcessed((long) bytes.length)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error reading file range: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Write content to file
     * POST /filesystem/{sessionId}/write
     */
    @PostMapping("/{sessionId}/write")
    public ResponseEntity<FileSystemResponse> writeFile(
            @PathVariable String sessionId,
            @RequestBody FileWriteRequest request) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            long bytesWritten;

            if (request.getContent() != null) {
                // Write string content
                fs.writeFileContent(request.getPath(), request.getContent());
                bytesWritten = request.getContent().length();
            } else if (request.getContentBase64() != null) {
                // Write binary content
                byte[] bytes = Base64.getDecoder().decode(request.getContentBase64());
                fs.writeFileBytes(request.getPath(), bytes);
                bytesWritten = bytes.length;
            } else {
                return ResponseEntity.badRequest().body(
                        FileSystemResponse.error("No content provided", "MISSING_CONTENT")
                );
            }

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("File written successfully")
                    .bytesProcessed(bytesWritten)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error writing file: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Write at specific position
     * POST /filesystem/{sessionId}/write-at
     */
    @PostMapping("/{sessionId}/write-at")
    public ResponseEntity<FileSystemResponse> writeAtPosition(
            @PathVariable String sessionId,
            @RequestBody FileWriteRequest request) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            if (request.getPosition() == null) {
                return ResponseEntity.badRequest().body(
                        FileSystemResponse.error("Position is required", "MISSING_POSITION")
                );
            }

            byte[] bytes;
            if (request.getContentBase64() != null) {
                bytes = Base64.getDecoder().decode(request.getContentBase64());
            } else if (request.getContent() != null) {
                bytes = request.getContent().getBytes();
            } else {
                return ResponseEntity.badRequest().body(
                        FileSystemResponse.error("No content provided", "MISSING_CONTENT")
                );
            }

            fs.writeAtPosition(request.getPath(), request.getPosition(), bytes);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("Wrote at position successfully")
                    .bytesProcessed((long) bytes.length)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error writing at position: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Append to file
     * POST /filesystem/{sessionId}/append
     */
    @PostMapping("/{sessionId}/append")
    public ResponseEntity<FileSystemResponse> appendToFile(
            @PathVariable String sessionId,
            @RequestBody FileWriteRequest request) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            if (request.getContent() == null) {
                return ResponseEntity.badRequest().body(
                        FileSystemResponse.error("Content is required", "MISSING_CONTENT")
                );
            }

            fs.appendToFile(request.getPath(), request.getContent());

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("Appended to file successfully")
                    .bytesProcessed((long) request.getContent().length())
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error appending to file: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Create directory
     * POST /filesystem/{sessionId}/mkdir?path=/some/newdir
     */
    @PostMapping("/{sessionId}/mkdir")
    public ResponseEntity<FileSystemResponse> createDirectory(
            @PathVariable String sessionId,
            @RequestParam String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            fs.createDirectory(path);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("Directory created successfully")
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error creating directory: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Create a new note with a unique generated name.
     * POST /filesystem/notes/create
     * Returns: { success: true, noteId: "UntitledNote#1", path: "note://UntitledNote#1" }
     */
    @PostMapping("/notes/create")
    public ResponseEntity<FileSystemResponse> createNote() {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem("notes");
            if (!(fs instanceof NotesFileSystem)) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                        FileSystemResponse.error("Notes filesystem not available", "SESSION_NOT_FOUND")
                );
            }
            String noteId = ((NotesFileSystem) fs).createNote();
            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message(noteId)  // noteId returned in message field
                    .currentDirectory("note://" + noteId)
                    .build());
        } catch (FileSystemException e) {
            log.error("[FileSystem] Error creating note: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Delete file or directory
     * DELETE /filesystem/{sessionId}/delete?path=/some/file&recursive=false
     */
    @DeleteMapping("/{sessionId}/delete")
    public ResponseEntity<FileSystemResponse> delete(
            @PathVariable String sessionId,
            @RequestParam String path,
            @RequestParam(defaultValue = "false") boolean recursive) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            boolean deleted;
            if (recursive) {
                deleted = fs.deleteRecursive(path);
            } else {
                deleted = fs.deleteFile(path);
            }

            if (deleted) {
                return ResponseEntity.ok(FileSystemResponse.builder()
                        .success(true)
                        .message("Deleted successfully")
                        .build());
            } else {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File not found", "NOT_FOUND")
                );
            }

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error deleting: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Rename/move file
     * POST /filesystem/{sessionId}/rename?oldPath=/old&newPath=/new
     */
    @PostMapping("/{sessionId}/rename")
    public ResponseEntity<FileSystemResponse> rename(
            @PathVariable String sessionId,
            @RequestParam String oldPath,
            @RequestParam String newPath) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            fs.rename(oldPath, newPath);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("Renamed successfully")
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error renaming: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Copy file
     * POST /filesystem/{sessionId}/copy?source=/old&destination=/new
     */
    @PostMapping("/{sessionId}/copy")
    public ResponseEntity<FileSystemResponse> copy(
            @PathVariable String sessionId,
            @RequestParam String source,
            @RequestParam String destination) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            fs.copyFile(source, destination);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("Copied successfully")
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error copying: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }

    /**
     * Change directory
     * POST /filesystem/{sessionId}/cd?path=/some/dir
     */
    @PostMapping("/{sessionId}/cd")
    public ResponseEntity<FileSystemResponse> changeDirectory(
            @PathVariable String sessionId,
            @RequestParam String path) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            fs.changeDirectory(path);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .currentDirectory(fs.getCurrentDirectory())
                    .message("Changed directory successfully")
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error changing directory: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        }
    }


    /**
     * Upload a file
     * POST /filesystem/{sessionId}/upload?path=/remote/path/filename
     * Body: multipart file
     */
    @PostMapping("/{sessionId}/upload")
    public ResponseEntity<FileSystemResponse> uploadFile(
            @PathVariable String sessionId,
            @RequestParam String path,
            @RequestParam("file") MultipartFile file) {
        try {
            IFileSystem fs = fileSystemService.getOrCreateFileSystem(sessionId);
            if (fs == null) {
                return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                        FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
                );
            }

            if (file.isEmpty()) {
                return ResponseEntity.badRequest().body(
                        FileSystemResponse.error("File is empty", "EMPTY_FILE")
                );
            }

            // Read file bytes and write to file system
            byte[] fileBytes = file.getBytes();
            fs.writeFileBytes(path, fileBytes);

            log.info("[FileSystem] File uploaded successfully: {} ({} bytes)", path, fileBytes.length);

            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("File uploaded successfully")
                    .bytesProcessed((long) fileBytes.length)
                    .build());

        } catch (FileSystemException e) {
            log.error("[FileSystem] Error uploading file: {}", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error(e.getMessage(), e.getErrorCode().name())
            );
        } catch (Exception e) {
            log.error("[FileSystem] Unexpected error uploading file: {}", e.getMessage(), e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(
                    FileSystemResponse.error("Failed to upload file: " + e.getMessage(), "UPLOAD_ERROR")
            );
        }
    }

    /**
     * Close file system session
     * DELETE /filesystem/{sessionId}
     */
    @DeleteMapping("/{sessionId}")
    public ResponseEntity<FileSystemResponse> closeFileSystem(@PathVariable String sessionId) {
        boolean closed = fileSystemService.closeFileSystem(sessionId);

        if (closed) {
            return ResponseEntity.ok(FileSystemResponse.builder()
                    .success(true)
                    .message("File system closed successfully")
                    .build());
        } else {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(
                    FileSystemResponse.error("File system session not found", "SESSION_NOT_FOUND")
            );
        }
    }
}

