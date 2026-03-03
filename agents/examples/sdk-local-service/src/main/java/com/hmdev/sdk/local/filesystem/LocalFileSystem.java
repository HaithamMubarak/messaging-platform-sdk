package com.hmdev.sdk.local.filesystem;

import lombok.extern.slf4j.Slf4j;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.nio.file.attribute.BasicFileAttributes;
import java.nio.file.attribute.PosixFilePermissions;
import java.time.Instant;
import java.util.*;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * Local file system implementation using Java NIO.
 * Provides access to files on the local machine.
 */
@Slf4j
public class LocalFileSystem extends AbstractFileSystem {

    private Path currentDirectory;
    private final Path rootPath;
    private final Path homeDirectory; // ✅ Store home directory separately
    private boolean connected = true;

    /**
     * Create a local file system with default root (system root)
     */
    public LocalFileSystem() {
        this(Paths.get(System.getProperty("user.home")));
    }

    /**
     * Create a local file system with a specific root path
     *
     * @param rootPath The root path for this file system (for security/sandboxing)
     */
    public LocalFileSystem(Path rootPath) {
        this.rootPath = rootPath.toAbsolutePath().normalize();
        this.homeDirectory = this.rootPath; // ✅ Home is the initial root path
        this.currentDirectory = this.rootPath;
        log.info("[LocalFS] Initialized with root: {}, home: {}", this.rootPath, this.homeDirectory);
    }

    /**
     * Validate and resolve a path (prevent directory traversal attacks)
     */
    private Path resolvePath(String path) throws FileSystemException {
        try {
            Path resolved = currentDirectory.resolve(path).normalize();

            // Security check: ensure path is within root
            if (!resolved.startsWith(rootPath)) {
                throw new FileSystemException(
                    "Path outside root directory: " + path,
                    FileSystemException.ErrorCode.INVALID_PATH
                );
            }

            return resolved;
        } catch (InvalidPathException e) {
            throw new FileSystemException(
                "Invalid path: " + path,
                FileSystemException.ErrorCode.INVALID_PATH,
                e
            );
        }
    }

    @Override
    public List<FileInfo> listFiles(String path) throws FileSystemException {
        Path dirPath = resolvePath(path);

        if (!Files.exists(dirPath)) {
            throw new FileSystemException(
                "Directory not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        if (!Files.isDirectory(dirPath)) {
            throw new FileSystemException(
                "Not a directory: " + path,
                FileSystemException.ErrorCode.INVALID_PATH
            );
        }

        // ✅ Update current directory - persists navigation in backend session!
        this.currentDirectory = dirPath;
        log.debug("[LocalFS] Navigation: currentDirectory updated to: {}", this.currentDirectory);

        try (Stream<Path> paths = Files.list(dirPath)) {
            return paths
                .map(this::pathToFileInfo)
                .filter(Objects::nonNull)
                .sorted(FILE_COMPARATOR)  // ✅ Use shared comparator from base class
                .collect(Collectors.toList());
        } catch (IOException e) {
            throw new FileSystemException(
                "Error listing directory: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public FileInfo getFileInfo(String path) throws FileSystemException {
        Path filePath = resolvePath(path);

        if (!Files.exists(filePath)) {
            throw new FileSystemException(
                "File not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        return pathToFileInfo(filePath);
    }

    private FileInfo pathToFileInfo(Path path) {
        try {
            BasicFileAttributes attrs = Files.readAttributes(path, BasicFileAttributes.class);

            FileInfo info = FileInfo.builder()
                .name(path.getFileName().toString())
                .path(path.toString())
                .size(attrs.size())
                .directory(attrs.isDirectory())
                .symbolicLink(attrs.isSymbolicLink())
                .lastModified(attrs.lastModifiedTime().toInstant())
                .created(attrs.creationTime().toInstant())
                .lastAccessed(attrs.lastAccessTime().toInstant())
                .readable(Files.isReadable(path))
                .writable(Files.isWritable(path))
                .executable(Files.isExecutable(path))
                .hidden(Files.isHidden(path))
                .build();

            // Try to get POSIX permissions (Unix-like systems)
            try {
                String permissions = PosixFilePermissions.toString(Files.getPosixFilePermissions(path));
                info.setPermissions(permissions);
            } catch (UnsupportedOperationException | IOException e) {
                // POSIX not supported (Windows), use simple format
                info.setPermissions(
                    (Files.isReadable(path) ? "r" : "-") +
                    (Files.isWritable(path) ? "w" : "-") +
                    (Files.isExecutable(path) ? "x" : "-")
                );
            }

            // Try to get file owner
            try {
                info.setOwner(Files.getOwner(path).getName());
            } catch (IOException e) {
                log.debug("Could not get file owner: {}", e.getMessage());
            }

            // Determine MIME type
            try {
                String mimeType = Files.probeContentType(path);
                info.setMimeType(mimeType);
            } catch (IOException e) {
                log.debug("Could not determine MIME type: {}", e.getMessage());
            }

            return info;

        } catch (IOException e) {
            log.error("Error reading file info for {}: {}", path, e.getMessage());
            return null;
        }
    }


    @Override
    public byte[] readFileBytes(String path) throws FileSystemException {
        Path filePath = resolvePath(path);

        if (!Files.exists(filePath)) {
            throw new FileSystemException(
                "File not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        try {
            return Files.readAllBytes(filePath);
        } catch (IOException e) {
            throw new FileSystemException(
                "Error reading file: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public byte[] readFileByteRange(String path, long offset, int length) throws FileSystemException {
        Path filePath = resolvePath(path);

        if (!Files.exists(filePath)) {
            throw new FileSystemException(
                "File not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        try (RandomAccessFile raf = new RandomAccessFile(filePath.toFile(), "r")) {
            long fileSize = raf.length();

            if (offset >= fileSize) {
                throw new FileSystemException(
                    "Offset beyond file size: " + offset + " >= " + fileSize,
                    FileSystemException.ErrorCode.INVALID_PATH
                );
            }

            int bytesToRead = (int) Math.min(length, fileSize - offset);
            byte[] buffer = new byte[bytesToRead];

            raf.seek(offset);
            int bytesRead = raf.read(buffer);

            if (bytesRead < bytesToRead) {
                return Arrays.copyOf(buffer, bytesRead);
            }

            return buffer;

        } catch (IOException e) {
            throw new FileSystemException(
                "Error reading file range: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public InputStream openInputStream(String path) throws FileSystemException {
        Path filePath = resolvePath(path);

        if (!Files.exists(filePath)) {
            throw new FileSystemException(
                "File not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        try {
            return Files.newInputStream(filePath);
        } catch (IOException e) {
            throw new FileSystemException(
                "Error opening file for reading: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }


    @Override
    public void writeFileBytes(String path, byte[] bytes) throws FileSystemException {
        Path filePath = resolvePath(path);

        try {
            // Create parent directories if needed
            Path parent = filePath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }

            Files.write(filePath, bytes);
            log.info("[LocalFS] Wrote {} bytes to {}", bytes.length, path);

        } catch (IOException e) {
            throw new FileSystemException(
                "Error writing file: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public void writeAtPosition(String path, long position, byte[] bytes) throws FileSystemException {
        Path filePath = resolvePath(path);

        if (!Files.exists(filePath)) {
            throw new FileSystemException(
                "File not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        try (RandomAccessFile raf = new RandomAccessFile(filePath.toFile(), "rw")) {
            raf.seek(position);
            raf.write(bytes);
            log.info("[LocalFS] Wrote {} bytes at position {} in {}", bytes.length, position, path);

        } catch (IOException e) {
            throw new FileSystemException(
                "Error writing at position: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public void appendToFile(String path, String content) throws FileSystemException {
        Path filePath = resolvePath(path);

        try {
            Files.write(
                filePath,
                content.getBytes(StandardCharsets.UTF_8),
                StandardOpenOption.CREATE,
                StandardOpenOption.APPEND
            );
            log.info("[LocalFS] Appended to file: {}", path);

        } catch (IOException e) {
            throw new FileSystemException(
                "Error appending to file: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public OutputStream openOutputStream(String path, boolean append) throws FileSystemException {
        Path filePath = resolvePath(path);

        try {
            // Create parent directories if needed
            Path parent = filePath.getParent();
            if (parent != null && !Files.exists(parent)) {
                Files.createDirectories(parent);
            }

            if (append) {
                return Files.newOutputStream(filePath, StandardOpenOption.CREATE, StandardOpenOption.APPEND);
            } else {
                return Files.newOutputStream(filePath, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            }

        } catch (IOException e) {
            throw new FileSystemException(
                "Error opening file for writing: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public void createDirectory(String path) throws FileSystemException {
        Path dirPath = resolvePath(path);

        if (Files.exists(dirPath)) {
            throw new FileSystemException(
                "Path already exists: " + path,
                FileSystemException.ErrorCode.ALREADY_EXISTS
            );
        }

        try {
            Files.createDirectories(dirPath);
            log.info("[LocalFS] Created directory: {}", path);

        } catch (IOException e) {
            throw new FileSystemException(
                "Error creating directory: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public boolean deleteFile(String path) throws FileSystemException {
        Path filePath = resolvePath(path);

        if (!Files.exists(filePath)) {
            return false;
        }

        if (Files.isDirectory(filePath)) {
            try (Stream<Path> entries = Files.list(filePath)) {
                if (entries.findAny().isPresent()) {
                    throw new FileSystemException(
                        "Directory not empty: " + path,
                        FileSystemException.ErrorCode.DIRECTORY_NOT_EMPTY
                    );
                }
            } catch (IOException e) {
                throw new FileSystemException(
                    "Error checking directory: " + path,
                    FileSystemException.ErrorCode.IO_ERROR,
                    e
                );
            }
        }

        try {
            Files.delete(filePath);
            log.info("[LocalFS] Deleted: {}", path);
            return true;

        } catch (IOException e) {
            throw new FileSystemException(
                "Error deleting file: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public boolean deleteRecursive(String path) throws FileSystemException {
        Path dirPath = resolvePath(path);

        if (!Files.exists(dirPath)) {
            return false;
        }

        try {
            Files.walkFileTree(dirPath, new SimpleFileVisitor<Path>() {
                @Override
                public FileVisitResult visitFile(Path file, BasicFileAttributes attrs) throws IOException {
                    Files.delete(file);
                    return FileVisitResult.CONTINUE;
                }

                @Override
                public FileVisitResult postVisitDirectory(Path dir, IOException exc) throws IOException {
                    Files.delete(dir);
                    return FileVisitResult.CONTINUE;
                }
            });

            log.info("[LocalFS] Deleted recursively: {}", path);
            return true;

        } catch (IOException e) {
            throw new FileSystemException(
                "Error deleting recursively: " + path,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public void rename(String oldPath, String newPath) throws FileSystemException {
        Path source = resolvePath(oldPath);
        Path target = resolvePath(newPath);

        if (!Files.exists(source)) {
            throw new FileSystemException(
                "Source not found: " + oldPath,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        if (Files.exists(target)) {
            throw new FileSystemException(
                "Target already exists: " + newPath,
                FileSystemException.ErrorCode.ALREADY_EXISTS
            );
        }

        try {
            Files.move(source, target);
            log.info("[LocalFS] Renamed {} to {}", oldPath, newPath);

        } catch (IOException e) {
            throw new FileSystemException(
                "Error renaming file: " + oldPath + " -> " + newPath,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public void copyFile(String sourcePath, String destinationPath) throws FileSystemException {
        Path source = resolvePath(sourcePath);
        Path destination = resolvePath(destinationPath);

        if (!Files.exists(source)) {
            throw new FileSystemException(
                "Source not found: " + sourcePath,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        try {
            Files.copy(source, destination, StandardCopyOption.REPLACE_EXISTING);
            log.info("[LocalFS] Copied {} to {}", sourcePath, destinationPath);

        } catch (IOException e) {
            throw new FileSystemException(
                "Error copying file: " + sourcePath + " -> " + destinationPath,
                FileSystemException.ErrorCode.IO_ERROR,
                e
            );
        }
    }

    @Override
    public boolean exists(String path) {
        try {
            Path filePath = resolvePath(path);
            return Files.exists(filePath);
        } catch (FileSystemException e) {
            return false;
        }
    }

    @Override
    public boolean isDirectory(String path) {
        try {
            Path filePath = resolvePath(path);
            return Files.isDirectory(filePath);
        } catch (FileSystemException e) {
            return false;
        }
    }

    @Override
    public String getCurrentDirectory() {
        return currentDirectory.toString();
    }

    @Override
    public String getHomeDirectory() {
        return homeDirectory.toString();
    }

    @Override
    public void changeDirectory(String path) throws FileSystemException {
        Path newDir = resolvePath(path);

        if (!Files.exists(newDir)) {
            throw new FileSystemException(
                "Directory not found: " + path,
                FileSystemException.ErrorCode.NOT_FOUND
            );
        }

        if (!Files.isDirectory(newDir)) {
            throw new FileSystemException(
                "Not a directory: " + path,
                FileSystemException.ErrorCode.INVALID_PATH
            );
        }

        currentDirectory = newDir;
        log.info("[LocalFS] Changed directory to: {}", currentDirectory);
    }

    @Override
    public long getTotalSpace() {
        try {
            FileStore store = Files.getFileStore(currentDirectory);
            return store.getTotalSpace();
        } catch (IOException e) {
            log.error("Error getting total space: {}", e.getMessage());
            return -1;
        }
    }

    @Override
    public long getFreeSpace() {
        try {
            FileStore store = Files.getFileStore(currentDirectory);
            return store.getUsableSpace();
        } catch (IOException e) {
            log.error("Error getting free space: {}", e.getMessage());
            return -1;
        }
    }

    @Override
    public void close() {
        connected = false;
        log.info("[LocalFS] Closed local file system");
    }

    @Override
    public boolean isConnected() {
        return connected;
    }

    @Override
    protected boolean isConnectedInternal() {
        return connected;
    }
}

