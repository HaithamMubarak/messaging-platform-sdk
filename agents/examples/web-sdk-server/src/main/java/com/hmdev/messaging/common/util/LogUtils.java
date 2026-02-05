package com.hmdev.messaging.common.util;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.regex.Pattern;

/**
 * Common logging utilities for messaging platform.
 *
 * Provides:
 * - Configurable stack trace depth for error logging
 * - Consistent error message formatting
 * - Debug-level logging helpers for high-frequency operations
 * - Security-focused log sanitization to prevent log injection and sensitive data exposure
 *
 * Usage:
 * <pre>
 * // Log error with default 2 extra stack trace lines
 * LogUtils.logError(logger, "Operation failed", exception);
 *
 * // Log error with custom stack trace depth
 * LogUtils.logError(logger, "Operation failed", exception, 5);
 *
 * // Log debug only if debug is enabled (avoids string concatenation)
 * LogUtils.logDebug(logger, "Processing item {}", itemId);
 *
 * // Sanitize user input before logging
 * LogUtils.logInfo(logger, "User input: {}", LogUtils.sanitizeForLog(userInput));
 * </pre>
 */
public final class LogUtils {

    private LogUtils() { /* no instances */ }

    /**
     * Default number of stack trace lines to include in error logs.
     * Can be overridden per-call or via system property 'logging.stacktrace.depth'.
     */
    public static final int DEFAULT_STACK_TRACE_DEPTH = 2;

    /**
     * System property name for configuring default stack trace depth.
     */
    public static final String STACK_TRACE_DEPTH_PROPERTY = "logging.stacktrace.depth";

    /**
     * Maximum length for logged strings to prevent excessive log sizes.
     */
    public static final int MAX_LOG_STRING_LENGTH = 1000;

    /**
     * Pattern to detect potential log injection attempts (newlines, carriage returns).
     */
    private static final Pattern LOG_INJECTION_PATTERN = Pattern.compile("[\r\n]");

    /**
     * Pattern to detect sensitive data patterns (API keys, tokens, passwords).
     */
    private static final Pattern SENSITIVE_DATA_PATTERN = Pattern.compile(
            "(?i)(password|token|secret|apikey|api_key|authorization|bearer)\\s*[:=]\\s*['\"]?([^'\"\\s]{8,})",
            Pattern.CASE_INSENSITIVE
    );

    /**
     * Get the configured default stack trace depth.
     * Reads from system property 'logging.stacktrace.depth', falls back to DEFAULT_STACK_TRACE_DEPTH.
     */
    public static int getDefaultStackTraceDepth() {
        String depthProperty = System.getProperty(STACK_TRACE_DEPTH_PROPERTY);
        if (depthProperty != null && !depthProperty.isEmpty()) {
            try {
                return Integer.parseInt(depthProperty);
            } catch (NumberFormatException e) {
                // Ignore and use default
            }
        }
        return DEFAULT_STACK_TRACE_DEPTH;
    }

    /**
     * Log an error with a limited stack trace (default depth).
     *
     * @param logger The logger instance
     * @param message Error message
     * @param throwable The exception to log
     */
    public static void logError(Logger logger, String message, Throwable throwable) {
        logError(logger, message, throwable, getDefaultStackTraceDepth());
    }

    /**
     * Log an error with a limited stack trace.
     *
     * @param logger The logger instance
     * @param message Error message
     * @param throwable The exception to log
     * @param stackTraceDepth Number of stack trace lines to include (0 for none, -1 for full)
     */
    public static void logError(Logger logger, String message, Throwable throwable, int stackTraceDepth) {
        if (throwable == null) {
            logger.error(message);
            return;
        }

        if (stackTraceDepth < 0) {
            // Full stack trace
            logger.error(message, throwable);
        } else if (stackTraceDepth == 0) {
            // No stack trace, just message and exception message
            logger.error("{}: {}", message, throwable.getMessage());
        } else {
            // Limited stack trace
            String limitedTrace = getLimitedStackTrace(throwable, stackTraceDepth);
            logger.error("{}: {}\n{}", message, throwable.getMessage(), limitedTrace);
        }
    }

    /**
     * Log a warning with a limited stack trace.
     *
     * @param logger The logger instance
     * @param message Warning message
     * @param throwable The exception to log
     */
    public static void logWarn(Logger logger, String message, Throwable throwable) {
        logWarn(logger, message, throwable, getDefaultStackTraceDepth());
    }

    /**
     * Log a warning with a limited stack trace.
     *
     * @param logger The logger instance
     * @param message Warning message
     * @param throwable The exception to log
     * @param stackTraceDepth Number of stack trace lines to include
     */
    public static void logWarn(Logger logger, String message, Throwable throwable, int stackTraceDepth) {
        if (throwable == null) {
            logger.warn(message);
            return;
        }

        if (stackTraceDepth < 0) {
            logger.warn(message, throwable);
        } else if (stackTraceDepth == 0) {
            logger.warn("{}: {}", message, throwable.getMessage());
        } else {
            String limitedTrace = getLimitedStackTrace(throwable, stackTraceDepth);
            logger.warn("{}: {}\n{}", message, throwable.getMessage(), limitedTrace);
        }
    }

    /**
     * Get a limited stack trace as a string.
     *
     * @param throwable The exception
     * @param depth Number of stack trace lines to include
     * @return Formatted stack trace string
     */
    public static String getLimitedStackTrace(Throwable throwable, int depth) {
        if (throwable == null || depth <= 0) {
            return "";
        }

        StackTraceElement[] stackTrace = throwable.getStackTrace();
        int actualDepth = Math.min(depth, stackTrace.length);

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < actualDepth; i++) {
            sb.append("\tat ").append(stackTrace[i]).append("\n");
        }

        if (stackTrace.length > actualDepth) {
            sb.append("\t... ").append(stackTrace.length - actualDepth).append(" more");
        }

        return sb.toString().trim();
    }

    /**
     * Log a debug message only if debug level is enabled.
     * This avoids string concatenation overhead when debug is disabled.
     *
     * @param logger The logger instance
     * @param message Message with {} placeholders
     * @param args Arguments to substitute
     */
    public static void logDebug(Logger logger, String message, Object... args) {
        if (logger.isDebugEnabled()) {
            logger.debug(message, args);
        }
    }

    /**
     * Log a trace message only if trace level is enabled.
     *
     * @param logger The logger instance
     * @param message Message with {} placeholders
     * @param args Arguments to substitute
     */
    public static void logTrace(Logger logger, String message, Object... args) {
        if (logger.isTraceEnabled()) {
            logger.trace(message, args);
        }
    }

    /**
     * Log an info message.
     *
     * @param logger The logger instance
     * @param message Message with {} placeholders
     * @param args Arguments to substitute
     */
    public static void logInfo(Logger logger, String message, Object... args) {
        logger.info(message, args);
    }

    /**
     * Create a logger for a class.
     * Convenience method to avoid repeating LoggerFactory import.
     *
     * @param clazz The class to create logger for
     * @return Logger instance
     */
    public static Logger getLogger(Class<?> clazz) {
        return LoggerFactory.getLogger(clazz);
    }

    /**
     * Format an exception for minimal logging (just class name and message).
     *
     * @param throwable The exception
     * @return Formatted string like "IOException: File not found"
     */
    public static String formatException(Throwable throwable) {
        if (throwable == null) {
            return "null";
        }
        String className = throwable.getClass().getSimpleName();
        String message = throwable.getMessage();
        return message != null ? className + ": " + message : className;
    }

    /**
     * Sanitize a string for safe logging by:
     * 1. Removing newlines/carriage returns (prevents log injection)
     * 2. Truncating to max length (prevents log flooding)
     * 3. Redacting sensitive data patterns
     *
     * @param input The string to sanitize
     * @return Sanitized string safe for logging
     */
    public static String sanitizeForLog(String input) {
        if (input == null) {
            return "null";
        }

        // Remove log injection characters
        String sanitized = LOG_INJECTION_PATTERN.matcher(input).replaceAll(" ");

        // Redact sensitive data
        sanitized = redactSensitiveData(sanitized);

        // Truncate if too long
        if (sanitized.length() > MAX_LOG_STRING_LENGTH) {
            sanitized = sanitized.substring(0, MAX_LOG_STRING_LENGTH) + "... (truncated)";
        }

        return sanitized;
    }

    /**
     * Redact sensitive data patterns from a string.
     *
     * @param input The string to redact
     * @return String with sensitive data replaced with [REDACTED]
     */
    public static String redactSensitiveData(String input) {
        if (input == null) {
            return null;
        }

        return SENSITIVE_DATA_PATTERN.matcher(input).replaceAll("$1: [REDACTED]");
    }

    /**
     * Sanitize an object for logging. Handles null, strings, and toString() for other objects.
     *
     * @param obj The object to sanitize
     * @return Sanitized string representation
     */
    public static String sanitizeForLog(Object obj) {
        if (obj == null) {
            return "null";
        }
        if (obj instanceof String) {
            return sanitizeForLog((String) obj);
        }
        return sanitizeForLog(obj.toString());
    }
}
