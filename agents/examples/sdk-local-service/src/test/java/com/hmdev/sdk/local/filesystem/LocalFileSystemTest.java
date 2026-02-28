package com.hmdev.sdk.local.filesystem;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Basic tests for LocalFileSystem implementation
 */
class LocalFileSystemTest {

    @TempDir
    Path tempDir;

    @Test
    void testCreateAndListFiles() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Initially empty
        List<FileInfo> files = fs.listFiles(".");
        assertTrue(files.isEmpty(), "Temp directory should be empty");

        // Create a file
        fs.writeFileContent("test.txt", "Hello, World!");

        // List should now have one file
        files = fs.listFiles(".");
        assertEquals(1, files.size(), "Should have one file");
        assertEquals("test.txt", files.get(0).getName());
        assertFalse(files.get(0).isDirectory());

        fs.close();
    }

    @Test
    void testReadWriteFile() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        String content = "This is a test file.\nWith multiple lines.\n";

        // Write
        fs.writeFileContent("data.txt", content);

        // Read
        String readContent = fs.readFileContent("data.txt");
        assertEquals(content, readContent, "Content should match");

        // File info
        FileInfo info = fs.getFileInfo("data.txt");
        assertEquals("data.txt", info.getName());
        assertEquals(content.length(), info.getSize());
        assertTrue(info.isReadable());
        assertTrue(info.isWritable());

        fs.close();
    }

    @Test
    void testCreateDirectory() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create directory
        fs.createDirectory("subdir");

        // Verify it exists
        assertTrue(fs.exists("subdir"));
        assertTrue(fs.isDirectory("subdir"));

        // List should show it
        List<FileInfo> files = fs.listFiles(".");
        assertEquals(1, files.size());
        assertTrue(files.get(0).isDirectory());

        fs.close();
    }

    @Test
    void testDeleteFile() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create and delete
        fs.writeFileContent("temp.txt", "temporary");
        assertTrue(fs.exists("temp.txt"));

        boolean deleted = fs.deleteFile("temp.txt");
        assertTrue(deleted);
        assertFalse(fs.exists("temp.txt"));

        // Delete non-existent should return false
        boolean deleted2 = fs.deleteFile("nonexistent.txt");
        assertFalse(deleted2);

        fs.close();
    }

    @Test
    void testRenameFile() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create file
        fs.writeFileContent("old.txt", "content");
        assertTrue(fs.exists("old.txt"));

        // Rename
        fs.rename("old.txt", "new.txt");

        // Verify
        assertFalse(fs.exists("old.txt"));
        assertTrue(fs.exists("new.txt"));
        assertEquals("content", fs.readFileContent("new.txt"));

        fs.close();
    }

    @Test
    void testAppendToFile() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create initial file
        fs.writeFileContent("log.txt", "Line 1\n");

        // Append
        fs.appendToFile("log.txt", "Line 2\n");
        fs.appendToFile("log.txt", "Line 3\n");

        // Read and verify
        String content = fs.readFileContent("log.txt");
        assertEquals("Line 1\nLine 2\nLine 3\n", content);

        fs.close();
    }

    @Test
    void testByteRangeRead() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Write some bytes
        byte[] data = new byte[]{0, 1, 2, 3, 4, 5, 6, 7, 8, 9};
        fs.writeFileBytes("binary.dat", data);

        // Read range
        byte[] range = fs.readFileByteRange("binary.dat", 3, 4);
        assertArrayEquals(new byte[]{3, 4, 5, 6}, range);

        fs.close();
    }

    @Test
    void testWriteAtPosition() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create file with initial content
        fs.writeFileBytes("data.bin", new byte[]{0, 0, 0, 0, 0, 0, 0, 0});

        // Write at position
        fs.writeAtPosition("data.bin", 2, new byte[]{1, 2, 3});

        // Read and verify
        byte[] result = fs.readFileBytes("data.bin");
        assertArrayEquals(new byte[]{0, 0, 1, 2, 3, 0, 0, 0}, result);

        fs.close();
    }

    @Test
    void testChangeDirectory() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create subdirectory
        fs.createDirectory("subdir");

        // Initial directory
        String initialDir = fs.getCurrentDirectory();
        assertTrue(initialDir.endsWith("subdir") || initialDir.equals(tempDir.toString()));

        // Change directory
        fs.changeDirectory("subdir");
        String newDir = fs.getCurrentDirectory();
        assertTrue(newDir.endsWith("subdir"));

        fs.close();
    }

    @Test
    void testPathSecurityValidation() {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Try to access parent directory (should fail)
        assertThrows(FileSystemException.class, () -> {
            fs.listFiles("../../etc");
        });

        fs.close();
    }

    @Test
    void testFileNotFound() {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Try to read non-existent file
        assertThrows(FileSystemException.class, () -> {
            fs.readFileContent("nonexistent.txt");
        });

        fs.close();
    }

    @Test
    void testCopyFile() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create source file
        String content = "File to be copied";
        fs.writeFileContent("source.txt", content);

        // Copy
        fs.copyFile("source.txt", "destination.txt");

        // Verify both exist with same content
        assertTrue(fs.exists("source.txt"));
        assertTrue(fs.exists("destination.txt"));
        assertEquals(content, fs.readFileContent("source.txt"));
        assertEquals(content, fs.readFileContent("destination.txt"));

        fs.close();
    }

    @Test
    void testDeleteRecursive() throws FileSystemException {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        // Create directory structure
        fs.createDirectory("dir1");
        fs.changeDirectory("dir1");
        fs.writeFileContent("file1.txt", "content1");
        fs.createDirectory("subdir");
        fs.changeDirectory("subdir");
        fs.writeFileContent("file2.txt", "content2");

        // Go back to root
        fs.changeDirectory(tempDir.toString());

        // Delete recursively
        boolean deleted = fs.deleteRecursive("dir1");
        assertTrue(deleted);
        assertFalse(fs.exists("dir1"));

        fs.close();
    }

    @Test
    void testIsConnected() {
        LocalFileSystem fs = new LocalFileSystem(tempDir);

        assertTrue(fs.isConnected());

        fs.close();
        assertFalse(fs.isConnected());
    }
}

