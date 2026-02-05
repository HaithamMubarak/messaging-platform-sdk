# Contributing to Messaging Platform SDK

Thank you for your interest in contributing to the Messaging Platform SDK! This document provides guidelines and information for contributors.

## Code of Conduct

Please be respectful and constructive in all interactions. We welcome contributors of all skill levels.

## Getting Started

### Prerequisites

- Java 11+ (for Java agent and web demos server)
- Python 3.8+ (for Python agent)
- Node.js 16+ (optional, for npm-based workflows)
- Git

### Setup Development Environment

```bash
# Clone the repository
git clone https://github.com/your-org/messaging-platform-sdk.git
cd messaging-platform-sdk

# Build all agents
./gradlew clean build

# Run tests
./gradlew test
```

## How to Contribute

### Reporting Issues

1. Search existing issues to avoid duplicates
2. Use a clear, descriptive title
3. Include:
   - Steps to reproduce
   - Expected behavior
   - Actual behavior
   - Environment details (OS, Java/Python version, browser)

### Submitting Changes

1. **Fork** the repository
2. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following the coding standards below
4. **Write/update tests** for your changes
5. **Run tests** to ensure everything passes:
   ```bash
   ./gradlew test
   ```
6. **Commit** with a clear message:
   ```bash
   git commit -m "Add: brief description of change"
   ```
7. **Push** to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
8. **Open a Pull Request** with:
   - Clear description of changes
   - Link to related issue (if any)
   - Screenshots (for UI changes)

## Coding Standards

### Java (Java Agent)

- Follow standard Java naming conventions
- Use Java 11 features (no higher for compatibility)
- Use SLF4J for logging
- Add JavaDoc comments for public methods
- Follow existing code patterns in `agents/java-agent/`

```java
// Good example
public class MyService {
    private static final Logger logger = LoggerFactory.getLogger(MyService.class);
    
    /**
     * Process the message and return the result.
     *
     * @param message the message to process
     * @return processed result
     */
    public Result processMessage(Message message) {
        Objects.requireNonNull(message, "Message cannot be null");
        logger.debug("Processing message: {}", message.getId());
        // implementation
    }
}
```

### Python (Python Agent)

- Follow PEP 8 style guide
- Use type hints (Python 3.8+)
- Add docstrings for public methods
- Use snake_case for variables and functions

```python
# Good example
def process_message(message: dict) -> Result:
    """
    Process the message and return the result.
    
    Args:
        message: The message dictionary to process
        
    Returns:
        The processed Result object
    """
    if message is None:
        raise ValueError("Message cannot be None")
    logger.debug(f"Processing message: {message.get('id')}")
    # implementation
```

### JavaScript (Web Agent)

- Use ES6+ features
- Follow existing patterns in `agents/web-agent-js/js/`
- Use JSDoc comments for public functions
- Test in multiple browsers

```javascript
// Good example
/**
 * Send a text message to the channel.
 * @param {string} content - The message content
 * @param {string} [filterQuery] - Optional filter query
 * @returns {Promise<boolean>} Success status
 */
async sendTextMessage(content, filterQuery = null) {
    if (!content) {
        throw new Error('Content cannot be empty');
    }
    // implementation
}
```

## Project Structure

```
messaging-platform-sdk/
├── agents/
│   ├── java-agent/       # Java client library
│   ├── python-agent/     # Python client library
│   ├── web-agent-js/     # JavaScript/Web client
│   └── examples/         # Example applications
├── libs/                 # Compiled dependencies
├── AI/                   # AI documentation
└── docs/                 # Additional documentation
```

## Testing

### Running Tests

```bash
# All tests
./gradlew test

# Java agent tests
./gradlew :agents:java-agent:test

# Python tests
cd agents/python-agent
pytest

# Web agent (manual testing)
cd agents/examples/web-demos-server
./gradlew bootRun
# Open http://localhost:8084
```

### Writing Tests

- Write unit tests for new functionality
- Aim for >80% code coverage on new code
- Use meaningful test names that describe behavior

## Documentation

- Update README.md if adding new features
- Update DEVELOPER-GUIDE.md for developer-facing changes
- Update USER-GUIDE.md for user-facing changes
- Add JSDoc/JavaDoc/docstrings for new public APIs

## Questions?

- Open a GitHub Discussion for questions
- Open an Issue for bugs or feature requests

---

Thank you for contributing! 🎉

