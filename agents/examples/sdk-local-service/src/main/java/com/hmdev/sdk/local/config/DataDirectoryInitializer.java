package com.hmdev.sdk.local.config;

import com.hmdev.sdk.local.filesystem.FileSystemConstants;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.util.StreamUtils;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

/**
 * Application data directory initialization.
 * Creates the ~/.messaging-platform/sls/ directory structure on startup.
 *
 * Directory Structure:
 * <pre>
 * ~/.messaging-platform/
 * └── sls/
 *     ├── database/          # H2 database files
 *     │   └── sls-data.mv.db
 *     ├── logs/              # Application logs
 *     │   └── sls.log
 *     ├── config/            # User configuration files
 *     └── temp/              # Temporary files
 * </pre>
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DataDirectoryInitializer {

    @Value("${sls.data.directory}")
    private String dataDirectory;

    private final FileSystemConstants fsConfig;

    @EventListener(ApplicationReadyEvent.class)
    public void initializeDataDirectory() {
        try {
            Path dataPath = Paths.get(dataDirectory);

            log.info("+----------------------------------------------------------------+");
            log.info("|       SLS Data Directory Initialization                        |");
            log.info("+----------------------------------------------------------------+");
            log.info("Data directory: {}", dataPath.toAbsolutePath());

            // Create main data directory
            createDirectoryIfNotExists(dataPath, "Main data directory");

            // Create subdirectories
            createDirectoryIfNotExists(dataPath.resolve(fsConfig.getDatabaseDirectoryName()), "Database directory");
            createDirectoryIfNotExists(dataPath.resolve(fsConfig.getLogsDirectoryName()), "Logs directory");
            createDirectoryIfNotExists(dataPath.resolve(fsConfig.getConfigDirectoryName()), "Config directory");
            createDirectoryIfNotExists(dataPath.resolve(fsConfig.getTempDirectoryName()), "Temp directory");
            createDirectoryIfNotExists(dataPath.resolve(fsConfig.getNotesDirectoryName()), "Notes directory");

            // Create README file with directory information
            createReadmeFile(dataPath);

            log.info("[OK] Data directory structure initialized successfully");
            log.info("----------------------------------------------------------------");
            log.info("[DIR] Location: {}", dataPath.toAbsolutePath());
            log.info("[DB]  Database: {}/{}/", dataPath.toAbsolutePath(), fsConfig.getDatabaseDirectoryName());
            log.info("[LOG] Logs:     {}/{}/", dataPath.toAbsolutePath(), fsConfig.getLogsDirectoryName());
            log.info("[CFG] Config:   {}/{}/", dataPath.toAbsolutePath(), fsConfig.getConfigDirectoryName());
            log.info("[TXT] Notes:    {}/{}/", dataPath.toAbsolutePath(), fsConfig.getNotesDirectoryName());
            log.info("[TMP] Temp:     {}/{}/", dataPath.toAbsolutePath(), fsConfig.getTempDirectoryName());
            log.info("----------------------------------------------------------------");

        } catch (IOException e) {
            log.error("[ERROR] Failed to initialize data directory: {}", e.getMessage(), e);
            throw new RuntimeException("Failed to initialize data directory", e);
        }
    }

    private void createDirectoryIfNotExists(Path directory, String description) throws IOException {
        if (!Files.exists(directory)) {
            Files.createDirectories(directory);
            log.info("[CREATED] {} - {}", description, directory.toAbsolutePath());
        } else {
            log.info("[EXISTS]  {} - {}", description, directory.toAbsolutePath());
        }
    }

    private void createReadmeFile(Path dataPath) {
        try {
            Path readmePath = dataPath.resolve("README.txt");
            if (!Files.exists(readmePath)) {
                String content = buildReadmeContent();
                Files.write(readmePath, content.getBytes());
                log.info("[CREATED] README.txt");
            }
        } catch (IOException e) {
            log.warn("Failed to create README.txt: {}", e.getMessage());
        }
    }

    private String buildReadmeContent() {
        try {
            // Load README template from classpath
            ClassPathResource resource = new ClassPathResource("templates/data-directory-readme.txt");

            try (InputStream inputStream = resource.getInputStream()) {
                String template = StreamUtils.copyToString(inputStream, StandardCharsets.UTF_8);

                // Replace timestamp placeholder
                String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
                return template.replace("{timestamp}", timestamp);
            }
        } catch (IOException e) {
            log.warn("Failed to load README template, using fallback content: {}", e.getMessage());
            return buildFallbackReadmeContent();
        }
    }

    /**
     * Fallback README content if template file cannot be loaded
     */
    private String buildFallbackReadmeContent() {
        String timestamp = LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"));
        return "═══════════════════════════════════════════════════════════════════\n" +
                "    Messaging Platform - SDK Local Service (SLS)\n" +
                "    Data Directory\n" +
                "═══════════════════════════════════════════════════════════════════\n" +
                "\n" +
                "This directory contains all data for the SDK Local Service.\n" +
                "\n" +
                "📁 Directory Structure:\n" +
                "───────────────────────────────────────────────────────────────────\n" +
                "\n" +
                "~/.messaging-platform/sls/\n" +
                "├── database/          # H2 database files\n" +
                "├── logs/              # Application logs\n" +
                "├── config/            # User configuration\n" +
                "└── temp/              # Temporary files\n" +
                "\n" +
                "═══════════════════════════════════════════════════════════════════\n" +
                "    H2 Database Console Access\n" +
                "═══════════════════════════════════════════════════════════════════\n" +
                "\n" +
                "URL:      http://localhost:8088/h2-console\n" +
                "Username: admin\n" +
                "Password: changeme\n" +
                "\n" +
                "Generated: " + timestamp + "\n" +
                "\n" +
                "═══════════════════════════════════════════════════════════════════\n";
    }
}

