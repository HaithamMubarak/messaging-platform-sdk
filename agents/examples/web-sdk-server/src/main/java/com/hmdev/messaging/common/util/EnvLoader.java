package com.hmdev.messaging.common.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.IOException;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.HashMap;
import java.util.Map;

/**
 * Utility class to load environment variables from .env file.
 *
 * This loader supports the open-source SDK repo while allowing
 * secure configuration from the private services repo.
 *
 * Search Order:
 * 1. Current project root (.env)
 * 2. Services repo (../../messaging-platform-services/.env)
 * 3. Falls back to system properties/environment variables
 *
 * Property Names (consistent across all repos):
 * - MESSAGING_API_KEY: Developer API key for authentication
 * - DEFAULT_API_KEY: Default API key (legacy support)
 * - MESSAGING_API_URL: URL of messaging service API
 * - FILE_API_URL: URL of file service API
 * - ADMIN_EMAIL: Admin account email
 * - ADMIN_PASSWORD: Admin account password
 *
 * Note: Empty string values are treated as non-existent (skipped in favor of next source).
 */
public class EnvLoader {

    private static final Logger logger = LoggerFactory.getLogger(EnvLoader.class);

    private static final String ENV_FILE_NAME = ".env";
    private static final Map<String, String> envVariables = new HashMap<>();
    private static boolean loaded = false;

    // Built-in defaults (used only if no other configuration is found)
    private static final Map<String, String> DEFAULT_VALUES = new HashMap<>() {{
        put("MESSAGING_API_URL", "https://hmdevonline.com/messaging-platform/api/v1/messaging-service");
        // Note: API keys should be configured via .env or environment variables
    }};

    /**
     * Load .env file and update specified system properties
     * @param systemPropertyKeysToUpdate System property keys to update from loaded configuration
     */
    public static synchronized void load(String ...systemPropertyKeysToUpdate) {
        if (loaded) {
            return;
        }

        File envFile = findEnvFile();

        if (envFile != null && envFile.exists()) {
            logger.info("Loading environment from: {}", envFile.getAbsolutePath());
            loadFromFile(envFile);
        } else {
            logger.debug("No .env file found. Using system properties/environment variables.");
        }

        loaded = true;

        for (String key : systemPropertyKeysToUpdate) {
            // Set system properties from loaded configuration
            updateSystemProperty(key);
        }
    }

    /**
     * Find .env file in search order
     */
    private static File findEnvFile() {
        // 1. Try current project root
        File currentProjectEnv = findInCurrentProject();
        if (currentProjectEnv != null && currentProjectEnv.exists()) {
            return currentProjectEnv;
        }

        // 2. Try services repo (sibling to SDK repo)
        File servicesRepoEnv = findInServicesRepo();
        if (servicesRepoEnv != null && servicesRepoEnv.exists()) {
            return servicesRepoEnv;
        }

        return null;
    }

    /**
     * Find .env in current project root
     */
    private static File findInCurrentProject() {
        // Get current working directory
        String userDir = System.getProperty("user.dir");

        // Navigate up to find project root (look for settings.gradle or build.gradle)
        Path currentPath = Paths.get(userDir);

        while (currentPath != null) {
            // Check for .env in current directory
            File envFile = new File(currentPath.toFile(), ENV_FILE_NAME);
            if (envFile.exists()) {
                return envFile;
            }

            // Also check for .env in messaging-platform-services subdirectory
            File servicesSubdirEnv = new File(new File(currentPath.toFile(), "messaging-platform-services"), ENV_FILE_NAME);
            if (servicesSubdirEnv.exists()) {
                return servicesSubdirEnv;
            }

            // Check if this is project root (has settings.gradle or build.gradle)
            File settingsGradle = new File(currentPath.toFile(), "settings.gradle");
            File buildGradle = new File(currentPath.toFile(), "build.gradle");

            if (settingsGradle.exists() || buildGradle.exists()) {
                // This is project root, stop searching
                break;
            }

            currentPath = currentPath.getParent();
        }

        return null;
    }

    /**
     * Find .env in services repo (assuming SDK and services are siblings)
     */
    private static File findInServicesRepo() {
        try {
            // Get current working directory
            String userDir = System.getProperty("user.dir");
            Path currentPath = Paths.get(userDir);

            // Navigate up to find SDK root (contains "messaging-platform-sdk" in path)
            while (currentPath != null) {
                String dirName = currentPath.getFileName().toString();

                if (dirName.equals("messaging-platform-sdk")) {
                    // Found SDK root, now look for services repo as sibling
                    Path parentPath = currentPath.getParent();

                    if (parentPath != null) {
                        Path servicesPath = parentPath.resolve("messaging-platform-services");
                        File servicesEnvFile = servicesPath.resolve(ENV_FILE_NAME).toFile();

                        if (servicesEnvFile.exists()) {
                            return servicesEnvFile;
                        }
                    }

                    break;
                }

                // Also check for "messaging-platform-services" in path
                if (dirName.equals("messaging-platform-services")) {
                    // Found services root, look for .env in root
                    File servicesEnvFile = new File(currentPath.toFile(), ENV_FILE_NAME);
                    if (servicesEnvFile.exists()) {
                        return servicesEnvFile;
                    }
                    break;
                }

                currentPath = currentPath.getParent();
            }
        } catch (Exception e) {
            logger.warn("Error searching for services repo .env: {}", e.getMessage());
        }

        return null;
    }

    /**
     * Load variables from .env file
     */
    private static void loadFromFile(File envFile) {
        try (BufferedReader reader = new BufferedReader(new FileReader(envFile))) {
            String line;
            int lineNumber = 0;

            while ((line = reader.readLine()) != null) {
                lineNumber++;
                line = line.trim();

                // Skip empty lines and comments
                if (line.isEmpty() || line.startsWith("#")) {
                    continue;
                }

                // Parse KEY=VALUE
                int equalsIndex = line.indexOf('=');
                if (equalsIndex > 0) {
                    String key = line.substring(0, equalsIndex).trim();
                    String value = line.substring(equalsIndex + 1).trim();

                    // Remove quotes if present
                    if ((value.startsWith("\"") && value.endsWith("\"")) ||
                        (value.startsWith("'") && value.endsWith("'"))) {
                        value = value.substring(1, value.length() - 1);
                    }

                    envVariables.put(key, value);
                } else {
                    logger.warn("Invalid line {} in {}: {}", lineNumber, envFile.getName(), line);
                }
            }

            logger.debug("Loaded {} variables from .env file", envVariables.size());

        } catch (IOException e) {
            logger.error("Error reading .env file: {}", e.getMessage());
        }
    }

    /**
     * Check if a value is valid (non-null and non-empty)
     */
    private static boolean isValidValue(String value) {
        return value != null && !value.isEmpty();
    }

    /**
     * Get environment variable (from .env, system properties, or environment)
     */
    public static String get(String key) {
        return get(key, null);
    }

    /**
     * Get environment variable with default value
     */
    public static String get(String key, String defaultValue) {
        // Ensure .env is loaded
        load();

        // 1. Check loaded .env variables (direct key)
        String value = envVariables.get(key);
        if (isValidValue(value)) {
            return value;
        }

        // 2. Check system properties
        value = System.getProperty(key);
        if (isValidValue(value)) {
            return value;
        }

        // 3. Check environment variables
        value = System.getenv(key);
        if (isValidValue(value)) {
            return value;
        }

        // 4. Check built-in defaults
        value = DEFAULT_VALUES.get(key);
        if (isValidValue(value)) {
            return value;
        }

        // 5. Return provided default
        return defaultValue;
    }

    /**
     * Set system property from .env variable or built-in defaults
     * @param key Property key to set
     */
    public static void updateSystemProperty(String key) {
        String value = get(key);
        if (isValidValue(value)) {
            System.setProperty(key, value);
        }
    }

    /**
     * Set system property from .env variable with custom default
     * @param key Property key to set
     * @param defaultValue Default value if not found in any configuration source
     */
    public static void updateSystemProperty(String key, String defaultValue) {
        String value = get(key, defaultValue);
        if (isValidValue(value)) {
            System.setProperty(key, value);
        }
    }
}
