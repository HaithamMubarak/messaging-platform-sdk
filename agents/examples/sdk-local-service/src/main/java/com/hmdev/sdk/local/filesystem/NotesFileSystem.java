package com.hmdev.sdk.local.filesystem;

import lombok.extern.slf4j.Slf4j;

import java.io.*;
import java.nio.file.*;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.stream.Stream;

/**
 * File system implementation for Notes.
 * Notes are stored in: ~/.messaging-platform/sls/notes/
 * Each note is a text file named: {noteId}.txt
 * Session ID: "notes" (special session for notes)
 * File paths: note://{noteId}
 */
@Slf4j
public class NotesFileSystem extends AbstractFileSystem {

    private final Path notesDirectory;
    private final FileSystemConstants config;

    public NotesFileSystem(String dataDirectory, FileSystemConstants config) throws IOException {
        this.config = config;
        this.notesDirectory = Paths.get(dataDirectory, config.getNotesDirectoryName());

        if (!Files.exists(notesDirectory)) {
            Files.createDirectories(notesDirectory);
            log.info("{} Created notes directory: {}", config.getNotesLogTag(), notesDirectory.toAbsolutePath());
        }

        log.info("{} Initialized: {}", config.getNotesLogTag(), notesDirectory.toAbsolutePath());
    }

    /**
     * Create a new note with a unique generated name.
     * Tries UntitledNote_1 .. _10, then random numbers until unique.
     * Returns the generated noteId (= filename without .txt).
     */
    public String createNote() throws FileSystemException {
        String noteId = generateUniqueNoteName();
        Path notePath = getNotePath(noteId);
        try {
            Files.write(notePath, new byte[0], StandardOpenOption.CREATE_NEW);
            log.info("{} Created note: {}", config.getNotesLogTag(), noteId);
            return noteId;
        } catch (IOException e) {
            throw new FileSystemException("Failed to create note", FileSystemException.ErrorCode.IO_ERROR, e);
        }
    }

    private String generateUniqueNoteName() {
        // Try UntitledNote_1 through _10
        for (int i = 1; i <= 10; i++) {
            String candidate = "UntitledNote_" + i;
            if (!Files.exists(getNotePath(candidate))) return candidate;
        }
        // Fall back to random numbers
        Random rnd = new Random();
        while (true) {
            String candidate = "UntitledNote_" + (rnd.nextInt(9000) + 11);
            if (!Files.exists(getNotePath(candidate))) return candidate;
        }
    }

    @Override
    public List<FileInfo> listFiles(String path) throws FileSystemException {
        List<FileInfo> files = new ArrayList<>();

        try (Stream<Path> stream = Files.list(notesDirectory)) {
            stream.filter(p -> Files.isRegularFile(p) && p.toString().endsWith(config.getNoteFileExtension()))
                .forEach(p -> {
                    try {
                        String noteId = p.getFileName().toString().replace(config.getNoteFileExtension(), "");
                        FileInfo info = pathToFileInfo(p, noteId);
                        if (info != null) files.add(info);
                    } catch (Exception e) {
                        log.warn("{} Error: {}", config.getNotesLogTag(), e.getMessage());
                    }
                });
        } catch (IOException e) {
            throw new FileSystemException("Failed to list notes", FileSystemException.ErrorCode.IO_ERROR, e);
        }

        return files;
    }

    @Override
    public FileInfo getFileInfo(String path) throws FileSystemException {
        String noteId = extractNoteId(path);
        Path notePath = getNotePath(noteId);

        if (!Files.exists(notePath)) {
            throw new FileSystemException("Note not found", FileSystemException.ErrorCode.NOT_FOUND);
        }

        return pathToFileInfo(notePath, noteId);
    }

    @Override
    public byte[] readFileBytes(String path) throws FileSystemException {
        String noteId = extractNoteId(path);
        Path notePath = getNotePath(noteId);

        if (!Files.exists(notePath)) {
            throw new FileSystemException("Note not found", FileSystemException.ErrorCode.NOT_FOUND);
        }

        try {
            return Files.readAllBytes(notePath);
        } catch (IOException e) {
            throw new FileSystemException("Failed to read note", FileSystemException.ErrorCode.IO_ERROR, e);
        }
    }

    @Override
    public byte[] readFileByteRange(String path, long offset, int length) throws FileSystemException {
        byte[] bytes = readFileBytes(path);
        int start = (int) Math.min(offset, bytes.length);
        int end = Math.min(start + length, bytes.length);
        byte[] result = new byte[end - start];
        System.arraycopy(bytes, start, result, 0, end - start);
        return result;
    }

    @Override
    public InputStream openInputStream(String path) throws FileSystemException {
        return new ByteArrayInputStream(readFileBytes(path));
    }

    @Override
    public void writeFileBytes(String path, byte[] data) throws FileSystemException {
        String noteId = extractNoteId(path);
        Path notePath = getNotePath(noteId);

        try {
            Files.write(notePath, data, StandardOpenOption.CREATE, StandardOpenOption.TRUNCATE_EXISTING);
            log.info("{} Wrote note: {} ({} bytes)", config.getNotesLogTag(), noteId, data.length);
        } catch (IOException e) {
            throw new FileSystemException("Failed to write note", FileSystemException.ErrorCode.IO_ERROR, e);
        }
    }

    @Override
    public void writeAtPosition(String path, long position, byte[] bytes) throws FileSystemException {
        throw new FileSystemException("Not supported", FileSystemException.ErrorCode.NOT_SUPPORTED);
    }

    @Override
    public void appendToFile(String path, String content) throws FileSystemException {
        String existing = readFileContent(path);
        writeFileContent(path, existing + content);
    }

    @Override
    public OutputStream openOutputStream(String path, boolean append) throws FileSystemException {
        throw new FileSystemException("Not supported", FileSystemException.ErrorCode.NOT_SUPPORTED);
    }

    @Override
    public void createDirectory(String path) throws FileSystemException {
        throw new FileSystemException("Not supported", FileSystemException.ErrorCode.NOT_SUPPORTED);
    }

    @Override
    public boolean deleteFile(String path) throws FileSystemException {
        String noteId = extractNoteId(path);
        Path notePath = getNotePath(noteId);

        try {
            if (Files.exists(notePath)) {
                Files.delete(notePath);
                log.info("{} Deleted: {}", config.getNotesLogTag(), noteId);
                return true;
            }
            return false;
        } catch (IOException e) {
            throw new FileSystemException("Failed to delete", FileSystemException.ErrorCode.IO_ERROR, e);
        }
    }

    @Override
    public boolean deleteRecursive(String path) throws FileSystemException {
        return deleteFile(path);
    }

    @Override
    public void rename(String oldPath, String newPath) throws FileSystemException {
        String oldId = extractNoteId(oldPath);
        String newId = extractNoteId(newPath);
        Path src = getNotePath(oldId);
        Path dst = getNotePath(newId);

        if (!Files.exists(src)) {
            throw new FileSystemException("Note not found: " + oldId, FileSystemException.ErrorCode.NOT_FOUND);
        }
        if (Files.exists(dst)) {
            throw new FileSystemException("A note named '" + newId + "' already exists", FileSystemException.ErrorCode.ALREADY_EXISTS);
        }
        try {
            Files.move(src, dst, StandardCopyOption.ATOMIC_MOVE);
            log.info("{} Renamed: {} -> {}", config.getNotesLogTag(), oldId, newId);
        } catch (IOException e) {
            throw new FileSystemException("Failed to rename note", FileSystemException.ErrorCode.IO_ERROR, e);
        }
    }

    @Override
    public void copyFile(String sourcePath, String destinationPath) throws FileSystemException {
        byte[] content = readFileBytes(sourcePath);
        writeFileBytes(destinationPath, content);
    }

    @Override
    public boolean exists(String path) {
        return Files.exists(getNotePath(extractNoteId(path)));
    }

    @Override
    public boolean isDirectory(String path) {
        return false;
    }

    @Override
    public long getTotalSpace() {
        try {
            return Files.getFileStore(notesDirectory).getTotalSpace();
        } catch (IOException e) {
            return -1;
        }
    }

    @Override
    public long getFreeSpace() {
        try {
            return Files.getFileStore(notesDirectory).getUsableSpace();
        } catch (IOException e) {
            return -1;
        }
    }

    @Override
    public void close() throws FileSystemException {
        log.debug("{} Closed", config.getNotesLogTag());
    }

    @Override
    public boolean isConnected() {
        return isConnectedInternal();
    }

    @Override
    protected boolean isConnectedInternal() {
        return true;
    }

    private String extractNoteId(String path) {
        if (path.startsWith(config.getNotePathPrefix())) {
            return path.substring(config.getNotePathPrefix().length());
        }
        return path;
    }

    private Path getNotePath(String noteId) {
        return notesDirectory.resolve(noteId + config.getNoteFileExtension());
    }

    private FileInfo pathToFileInfo(Path path, String noteId) {
        try {
            return FileInfo.builder()
                    .name(noteId + config.getNoteFileExtension())
                    .path(config.getNotePathPrefix() + noteId)
                    .directory(false)
                    .size(Files.size(path))
                    .lastModified(Files.getLastModifiedTime(path).toInstant())
                    .readable(Files.isReadable(path))
                    .writable(Files.isWritable(path))
                    .executable(false)
                    .hidden(false)
                    .mimeType("text/plain")
                    .build();
        } catch (IOException e) {
            log.error("{} Error: {}", config.getNotesLogTag(), e.getMessage());
            return null;
        }
    }

    @Override
    public String getCurrentDirectory() {
        return notesDirectory.toString();
    }

    @Override
    public String getHomeDirectory() {
        return notesDirectory.toString();
    }

    @Override
    public void changeDirectory(String path) {
        // Notes filesystem doesn't support navigation - always in notes directory
        log.debug("{} changeDirectory called but not supported for notes", config.getNotesLogTag());
    }
}














