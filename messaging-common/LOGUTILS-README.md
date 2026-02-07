# LogUtils - Common Logging Utilities

**Location:** `com.hmdev.messaging.common.util.LogUtils`

**Module:** `messaging-common`

## Purpose

LogUtils provides centralized logging utilities for the entire messaging platform:
- **Controlled stack trace depth** - Avoid log spam with configurable stack traces
- **Security-focused logging** - Sanitize user input to prevent log injection
- **Sensitive data redaction** - Automatically redact passwords, tokens, API keys
- **Performance optimization** - Conditional debug/trace logging to avoid overhead

## Usage

### 1. Add Dependency

In your `build.gradle`:

```gradle
dependencies {
    implementation project(':common:messaging-common')
}
```

### 2. Import

```java
import com.hmdev.messaging.common.util.LogUtils;
import org.slf4j.Logger;
```

### 3. Basic Error Logging

```java
private static final Logger log = LogUtils.getLogger(MyClass.class);

try {
    // ... code that might throw
} catch (Exception e) {
    // Default: 2 stack trace lines
    LogUtils.logError(log, "Operation failed", e);
    
    // Custom stack trace depth
    LogUtils.logError(log, "Operation failed", e, 5);
    
    // Full stack trace
    LogUtils.logError(log, "Operation failed", e, -1);
    
    // No stack trace (just message)
    LogUtils.logError(log, "Operation failed", e, 0);
}
```

### 4. Warning Logging

```java
LogUtils.logWarn(log, "Connection timeout", exception);
LogUtils.logWarn(log, "Retrying operation", exception, 1); // 1 line stack trace
```

### 5. Performance-Optimized Debug/Trace

```java
// Only evaluates if debug is enabled (avoids string concatenation overhead)
LogUtils.logDebug(log, "Processing message: channelId={}, offset={}", channelId, offset);
LogUtils.logTrace(log, "Full message details: {}", message);

// Regular logging
LogUtils.logInfo(log, "Service started on port {}", port);
```

### 6. Safe User Input Logging

**IMPORTANT:** Always sanitize user input before logging to prevent:
- Log injection attacks (newlines creating fake log entries)
- Sensitive data exposure (passwords, tokens, API keys)
- Log flooding (truncates long strings)

```java
String userInput = request.getParameter("data");

// BAD - Unsafe
log.info("User submitted: {}", userInput);

// GOOD - Safe
log.info("User submitted: {}", LogUtils.sanitizeForLog(userInput));

// Also works with objects
log.info("Request: {}", LogUtils.sanitizeForLog(requestObject));
```

### 7. Sensitive Data Redaction

```java
String config = "password=secret123 apiKey=abc123xyz token=bearer_xyz";

// Automatically redacts sensitive patterns
String safe = LogUtils.redactSensitiveData(config);
// Result: "password: [REDACTED] apiKey: [REDACTED] token: [REDACTED]"

log.info("Config: {}", safe);
```

### 8. Exception Formatting

```java
// Minimal exception logging (just class name and message)
log.warn("Operation warning: {}", LogUtils.formatException(exception));
// Output: "IOException: Connection refused"
```

## Configuration

### System Properties

Set default stack trace depth:

```bash
# Command line
java -Dlogging.stacktrace.depth=5 -jar myapp.jar

# In code (before logging)
System.setProperty("logging.stacktrace.depth", "3");
```

## Best Practices

### ✅ DO

```java
// 1. Use controlled stack traces
LogUtils.logError(log, "Failed to process", e);

// 2. Sanitize all user input
log.info("User name: {}", LogUtils.sanitizeForLog(userName));

// 3. Use performance-optimized debug logging
LogUtils.logDebug(log, "Processing {}", item);

// 4. Format exceptions for warnings
log.warn("Minor issue: {}", LogUtils.formatException(e));
```

### ❌ DON'T

```java
// 1. Don't log full stack traces for common errors
log.error("Error", e); // Spam!

// 2. Don't log unsanitized user input
log.info("User input: {}", userInput); // Log injection risk!

// 3. Don't check debug level manually
if (log.isDebugEnabled()) {
    log.debug("Message: " + x); // Use LogUtils.logDebug() instead
}

// 4. Don't log sensitive data
log.info("Password: {}", password); // Security risk!
```

## Migration from Existing Code

### Replace Logger Creation

**Before:**
```java
private static final Logger log = LoggerFactory.getLogger(MyClass.class);
```

**After:**
```java
private static final Logger log = LogUtils.getLogger(MyClass.class);
```

### Replace Error Logging

**Before:**
```java
log.error("Operation failed", exception); // Full stack trace
```

**After:**
```java
LogUtils.logError(log, "Operation failed", exception); // Controlled stack trace
```

### Replace Debug Logging

**Before:**
```java
if (log.isDebugEnabled()) {
    log.debug("Value: " + value);
}
```

**After:**
```java
LogUtils.logDebug(log, "Value: {}", value);
```

## Current Usage

LogUtils is now available in:

1. **messaging-common** - Core implementation (this module)
2. **java-agent** - Has its own copy (can migrate to use common)
3. **web-sdk-server** - Has its own copy (can migrate to use common)
4. **messaging-services** - Should use common version

## Future Work

- Migrate java-agent to use common LogUtils
- Migrate web-sdk-server to use common LogUtils
- Add structured logging support (JSON format)
- Add correlation ID support for distributed tracing
- Add metrics collection for error rates

---

**Created:** February 1, 2026  
**Location:** `messaging-common/src/main/java/com/hmdev/messaging/common/util/LogUtils.java`
