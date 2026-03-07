package com.hmdev.sdk.local.controller;

import com.hmdev.sdk.local.model.AppConfig;
import com.hmdev.sdk.local.model.SshConnection;
import com.hmdev.sdk.local.model.TerminalSession;
import com.hmdev.sdk.local.repository.AppConfigRepository;
import com.hmdev.sdk.local.repository.SshConnectionRepository;
import com.hmdev.sdk.local.repository.TerminalSessionRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.IvParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/**
 * Controller for exporting and importing configuration backups
 * Supports XML, ZIP, and password-protected ZIP formats
 */
@RestController
@RequestMapping("/config/backup")
@RequiredArgsConstructor
@Slf4j
public class ConfigBackupController {

    private final SshConnectionRepository sshConnectionRepository;
    private final AppConfigRepository appConfigRepository;
    private final TerminalSessionRepository terminalSessionRepository;

    private static final String AES_ALGORITHM = "AES/CBC/PKCS5Padding";
    private static final int KEY_LENGTH = 256;
    private static final int ITERATION_COUNT = 65536;
    private static final int SALT_LENGTH = 16;
    private static final int IV_LENGTH = 16;

    /**
     * Export configuration as XML, ZIP, or password-protected ZIP
     * GET /config/backup/export?format=xml&password=optional&includeSessions=true&includeNotes=false
     */
    @GetMapping("/export")
    public ResponseEntity<?> exportConfig(
            @RequestParam(defaultValue = "xml") String format,
            @RequestParam(required = false) String password,
            @RequestParam(defaultValue = "true") boolean includeSshConnections,
            @RequestParam(defaultValue = "false") boolean includeSessions,
            @RequestParam(defaultValue = "false") boolean includeNotes
    ) {
        try {
            log.info("[ConfigBackup] Export requested - format: {}, password: {}, ssh: {}, sessions: {}, notes: {}",
                    format, password != null ? "***" : "none", includeSshConnections, includeSessions, includeNotes);

            // Validate format
            if (!format.matches("xml|zip")) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Invalid format. Supported: xml, zip"));
            }

            // Validate password requirements
            if (password != null && !password.isEmpty() && password.length() < 6) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Password must be at least 6 characters long"));
            }

            // Generate XML content
            String xmlContent = generateXmlBackup(includeSshConnections, includeSessions, includeNotes);

            if (xmlContent == null || xmlContent.isEmpty()) {
                return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                        .body(Map.of("success", false, "error", "Failed to generate configuration backup"));
            }

            String filename = "sls-config-" + LocalDateTime.now().format(DateTimeFormatter.ofPattern("yyyyMMdd-HHmmss"));

            byte[] fileContent;
            String contentType;

            switch (format.toLowerCase()) {
                case "zip":
                    if (password != null && !password.isEmpty()) {
                        // Password-protected ZIP (encrypted)
                        fileContent = createEncryptedZip(xmlContent, password);
                        filename += ".zip";
                        contentType = "application/zip";
                    } else {
                        // Plain ZIP
                        fileContent = createPlainZip(xmlContent);
                        filename += ".zip";
                        contentType = "application/zip";
                    }
                    break;
                case "xml":
                default:
                    // Plain XML
                    fileContent = xmlContent.getBytes(StandardCharsets.UTF_8);
                    filename += ".xml";
                    contentType = "application/xml";
                    break;
            }

            ByteArrayResource resource = new ByteArrayResource(fileContent);

            return ResponseEntity.ok()
                    .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + filename + "\"")
                    .contentType(MediaType.parseMediaType(contentType))
                    .contentLength(fileContent.length)
                    .body(resource);

        } catch (Exception e) {
            log.error("[ConfigBackup] Export failed", e);
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
                    .body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * Import configuration from XML, ZIP, or password-protected ZIP
     * POST /config/backup/import
     */
    @PostMapping("/import")
    public ResponseEntity<?> importConfig(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String password,
            @RequestParam(defaultValue = "false") boolean overwriteExisting
    ) {
        try {
            log.info("[ConfigBackup] Import requested - file: {}, password: {}, overwrite: {}",
                    file.getOriginalFilename(), password != null ? "***" : "none", overwriteExisting);

            // Validate file
            if (file.isEmpty()) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "File is empty"));
            }

            // Validate file size (max 10MB)
            if (file.getSize() > 10 * 1024 * 1024) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "File size exceeds 10MB limit"));
            }

            String xmlContent;
            String filename = file.getOriginalFilename();

            if (filename == null) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Invalid filename"));
            }

            if (filename.endsWith(".zip")) {
                // Handle ZIP file
                try {
                    if (password != null && !password.isEmpty()) {
                        xmlContent = extractEncryptedZip(file.getBytes(), password);
                    } else {
                        xmlContent = extractPlainZip(file.getBytes());
                    }
                } catch (Exception e) {
                    log.error("[ConfigBackup] Failed to extract ZIP file", e);
                    return ResponseEntity.badRequest()
                            .body(Map.of("success", false, "error",
                                "Failed to extract ZIP: " + e.getMessage()));
                }
            } else if (filename.endsWith(".xml")) {
                // Handle plain XML
                xmlContent = new String(file.getBytes(), StandardCharsets.UTF_8);
            } else {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Unsupported file type. Use .xml or .zip"));
            }

            // Validate XML content
            if (xmlContent == null || xmlContent.trim().isEmpty()) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Configuration file is empty"));
            }

            if (!xmlContent.contains("<SLSConfiguration>")) {
                return ResponseEntity.badRequest()
                        .body(Map.of("success", false, "error", "Invalid configuration file format"));
            }

            // Parse and import XML
            Map<String, Object> result = parseAndImportXml(xmlContent, overwriteExisting);

            return ResponseEntity.ok(result);

        } catch (Exception e) {
            log.error("[ConfigBackup] Import failed", e);
            return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                    .body(Map.of("success", false, "error", e.getMessage()));
        }
    }

    /**
     * Generate XML backup content
     */
    private String generateXmlBackup(boolean includeSsh, boolean includeSessions, boolean includeNotes) {
        StringBuilder xml = new StringBuilder();
        xml.append("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
        xml.append("<SLSConfiguration>\n");
        xml.append("  <Metadata>\n");
        xml.append("    <ExportedAt>").append(LocalDateTime.now()).append("</ExportedAt>\n");
        xml.append("    <Version>1.0</Version>\n");
        xml.append("  </Metadata>\n");

        if (includeSsh) {
            xml.append("  <SSHConnections>\n");
            List<SshConnection> connections = sshConnectionRepository.findAll();
            for (SshConnection conn : connections) {
                xml.append("    <Connection>\n");
                xml.append("      <Name>").append(escapeXml(conn.getName())).append("</Name>\n");
                xml.append("      <Host>").append(escapeXml(conn.getHost())).append("</Host>\n");
                xml.append("      <Port>").append(conn.getPort()).append("</Port>\n");
                xml.append("      <Username>").append(escapeXml(conn.getUsername())).append("</Username>\n");
                if (conn.getPassword() != null) {
                    xml.append("      <Password>").append(escapeXml(conn.getPassword())).append("</Password>\n");
                }
                if (conn.getPrivateKey() != null) {
                    xml.append("      <PrivateKey><![CDATA[").append(conn.getPrivateKey()).append("]]></PrivateKey>\n");
                }
                if (conn.getDescription() != null) {
                    xml.append("      <Description>").append(escapeXml(conn.getDescription())).append("</Description>\n");
                }
                xml.append("    </Connection>\n");
            }
            xml.append("  </SSHConnections>\n");
        }

        if (includeSessions) {
            xml.append("  <TerminalSessions>\n");
            List<TerminalSession> sessions = terminalSessionRepository.findAll();
            for (TerminalSession session : sessions) {
                xml.append("    <Session>\n");
                xml.append("      <Type>").append(escapeXml(session.getType())).append("</Type>\n");
                xml.append("      <Shell>").append(escapeXml(session.getShell())).append("</Shell>\n");
                if (session.getTabName() != null) {
                    xml.append("      <TabName>").append(escapeXml(session.getTabName())).append("</TabName>\n");
                }
                xml.append("    </Session>\n");
            }
            xml.append("  </TerminalSessions>\n");
        }

        xml.append("  <AppConfig>\n");
        List<AppConfig> configs = appConfigRepository.findAll();
        for (AppConfig config : configs) {
            // Skip sensitive notes if not included
            if (!includeNotes && config.getKey().startsWith("note_")) {
                continue;
            }
            xml.append("    <Entry>\n");
            xml.append("      <Key>").append(escapeXml(config.getKey())).append("</Key>\n");
            xml.append("      <Value><![CDATA[").append(config.getValue() != null ? config.getValue() : "").append("]]></Value>\n");
            xml.append("    </Entry>\n");
        }
        xml.append("  </AppConfig>\n");

        xml.append("</SLSConfiguration>");
        return xml.toString();
    }

    /**
     * Create plain ZIP file
     */
    private byte[] createPlainZip(String xmlContent) throws IOException {
        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            ZipEntry entry = new ZipEntry("config.xml");
            zos.putNextEntry(entry);
            zos.write(xmlContent.getBytes(StandardCharsets.UTF_8));
            zos.closeEntry();
        }
        return baos.toByteArray();
    }

    /**
     * Create encrypted ZIP file using AES-256
     */
    private byte[] createEncryptedZip(String xmlContent, String password) throws Exception {
        byte[] salt = generateSalt();
        byte[] iv = generateIv();
        SecretKey key = deriveKey(password, salt);

        Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
        cipher.init(Cipher.ENCRYPT_MODE, key, new IvParameterSpec(iv));
        byte[] encryptedData = cipher.doFinal(xmlContent.getBytes(StandardCharsets.UTF_8));

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(baos)) {
            // Store salt
            ZipEntry saltEntry = new ZipEntry("salt.bin");
            zos.putNextEntry(saltEntry);
            zos.write(salt);
            zos.closeEntry();

            // Store IV
            ZipEntry ivEntry = new ZipEntry("iv.bin");
            zos.putNextEntry(ivEntry);
            zos.write(iv);
            zos.closeEntry();

            // Store encrypted config
            ZipEntry configEntry = new ZipEntry("config.enc");
            zos.putNextEntry(configEntry);
            zos.write(encryptedData);
            zos.closeEntry();
        }
        return baos.toByteArray();
    }

    /**
     * Extract plain ZIP file
     */
    private String extractPlainZip(byte[] zipData) throws IOException {
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipData))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.getName().equals("config.xml")) {
                    return new String(zis.readAllBytes(), StandardCharsets.UTF_8);
                }
            }
        }
        throw new IOException("config.xml not found in ZIP file");
    }

    /**
     * Extract encrypted ZIP file
     */
    private String extractEncryptedZip(byte[] zipData, String password) throws Exception {
        byte[] salt = null;
        byte[] iv = null;
        byte[] encryptedData = null;

        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zipData))) {
            ZipEntry entry;
            while ((entry = zis.getNextEntry()) != null) {
                byte[] data = zis.readAllBytes();
                switch (entry.getName()) {
                    case "salt.bin":
                        salt = data;
                        break;
                    case "iv.bin":
                        iv = data;
                        break;
                    case "config.enc":
                        encryptedData = data;
                        break;
                }
            }
        }

        if (salt == null || iv == null || encryptedData == null) {
            throw new IOException("Invalid encrypted ZIP file - missing required files");
        }

        SecretKey key = deriveKey(password, salt);
        Cipher cipher = Cipher.getInstance(AES_ALGORITHM);
        cipher.init(Cipher.DECRYPT_MODE, key, new IvParameterSpec(iv));

        try {
            byte[] decryptedData = cipher.doFinal(encryptedData);
            return new String(decryptedData, StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new Exception("Decryption failed - incorrect password or corrupted file");
        }
    }

    /**
     * Parse XML and import configuration
     */
    private Map<String, Object> parseAndImportXml(String xmlContent, boolean overwrite) {
        Map<String, Object> result = new HashMap<>();
        int sshImported = 0;
        int sshSkipped = 0;
        int configImported = 0;
        List<String> errors = new ArrayList<>();

        try {
            // Simple XML parsing (production should use proper XML parser like DocumentBuilder)
            if (xmlContent.contains("<SSHConnections>")) {
                String sshSection = extractSection(xmlContent, "<SSHConnections>", "</SSHConnections>");
                List<String> connections = extractBlocks(sshSection, "<Connection>", "</Connection>");

                for (String connXml : connections) {
                    try {
                        String name = extractValue(connXml, "<Name>", "</Name>");
                        String host = extractValue(connXml, "<Host>", "</Host>");
                        String portStr = extractValue(connXml, "<Port>", "</Port>");
                        String username = extractValue(connXml, "<Username>", "</Username>");
                        String password = extractValue(connXml, "<Password>", "</Password>");
                        String privateKey = extractCData(connXml, "<PrivateKey>", "</PrivateKey>");
                        String description = extractValue(connXml, "<Description>", "</Description>");

                        // Validate required fields
                        if (name == null || host == null || portStr == null || username == null) {
                            errors.add("SSH connection missing required fields - skipped");
                            continue;
                        }

                        // Check if connection already exists
                        Optional<SshConnection> existing = sshConnectionRepository.findByName(name);
                        if (existing.isPresent() && !overwrite) {
                            sshSkipped++;
                            continue;
                        }

                        SshConnection conn = existing.orElse(new SshConnection());
                        conn.setName(name);
                        conn.setHost(host);
                        conn.setPort(Integer.parseInt(portStr));
                        conn.setUsername(username);
                        conn.setPassword(password);
                        conn.setPrivateKey(privateKey);
                        conn.setDescription(description);

                        sshConnectionRepository.save(conn);
                        sshImported++;
                    } catch (Exception e) {
                        errors.add("SSH connection import failed: " + e.getMessage());
                    }
                }
            }

            if (xmlContent.contains("<AppConfig>")) {
                String configSection = extractSection(xmlContent, "<AppConfig>", "</AppConfig>");
                List<String> entries = extractBlocks(configSection, "<Entry>", "</Entry>");

                for (String entryXml : entries) {
                    try {
                        String key = extractValue(entryXml, "<Key>", "</Key>");
                        String value = extractCData(entryXml, "<Value>", "</Value>");

                        // Validate key is not null
                        if (key == null || key.trim().isEmpty()) {
                            errors.add("Config entry missing key - skipped");
                            continue;
                        }

                        Optional<AppConfig> existing = appConfigRepository.findById(key);
                        if (existing.isPresent() && !overwrite) {
                            continue;
                        }

                        AppConfig config = existing.orElse(new AppConfig());
                        config.setKey(key);
                        config.setValue(value);

                        appConfigRepository.save(config);
                        configImported++;
                    } catch (Exception e) {
                        errors.add("Config entry import failed: " + e.getMessage());
                    }
                }
            }

            result.put("success", true);
            result.put("sshConnectionsImported", sshImported);
            result.put("sshConnectionsSkipped", sshSkipped);
            result.put("configEntriesImported", configImported);
            if (!errors.isEmpty()) {
                result.put("errors", errors);
            }

        } catch (Exception e) {
            result.put("success", false);
            result.put("error", "Failed to parse XML: " + e.getMessage());
        }

        return result;
    }

    // Helper methods for encryption
    private byte[] generateSalt() {
        byte[] salt = new byte[SALT_LENGTH];
        new SecureRandom().nextBytes(salt);
        return salt;
    }

    private byte[] generateIv() {
        byte[] iv = new byte[IV_LENGTH];
        new SecureRandom().nextBytes(iv);
        return iv;
    }

    private SecretKey deriveKey(String password, byte[] salt) throws Exception {
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        KeySpec spec = new PBEKeySpec(password.toCharArray(), salt, ITERATION_COUNT, KEY_LENGTH);
        return new SecretKeySpec(factory.generateSecret(spec).getEncoded(), "AES");
    }

    // Helper methods for XML parsing
    private String escapeXml(String text) {
        if (text == null) return "";
        return text.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    private String extractSection(String xml, String startTag, String endTag) {
        int start = xml.indexOf(startTag);
        int end = xml.indexOf(endTag);
        if (start == -1 || end == -1) return "";
        return xml.substring(start + startTag.length(), end);
    }

    private List<String> extractBlocks(String xml, String startTag, String endTag) {
        List<String> blocks = new ArrayList<>();
        int pos = 0;
        while (true) {
            int start = xml.indexOf(startTag, pos);
            if (start == -1) break;
            int end = xml.indexOf(endTag, start);
            if (end == -1) break;
            blocks.add(xml.substring(start + startTag.length(), end));
            pos = end + endTag.length();
        }
        return blocks;
    }

    private String extractValue(String xml, String startTag, String endTag) {
        int start = xml.indexOf(startTag);
        if (start == -1) return null;
        int end = xml.indexOf(endTag, start);
        if (end == -1) return null;
        return xml.substring(start + startTag.length(), end);
    }

    private String extractCData(String xml, String startTag, String endTag) {
        String value = extractValue(xml, startTag, endTag);
        if (value == null) return null;
        if (value.startsWith("<![CDATA[") && value.endsWith("]]>")) {
            return value.substring(9, value.length() - 3);
        }
        return value;
    }
}

