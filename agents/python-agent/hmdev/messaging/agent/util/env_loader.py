"""
Utility module to load environment variables from .env file.

This loader supports the open-source SDK repo while allowing
secure configuration from the private services repo.

Search Order:
1. Current project root (.env)
2. Services repo (../../messaging-platform-services/.env)
3. Falls back to os.environ environment variables

Property Names (consistent across all repos):
- MESSAGING_API_KEY: Developer API key for authentication
- DEFAULT_API_KEY: Default API key (legacy support)
- MESSAGING_API_URL: URL of messaging service API

Note: Empty string values are treated as non-existent (skipped in favor of next source).
"""

import os
import logging
from pathlib import Path
from typing import Optional, Dict

logger = logging.getLogger(__name__)

# Module-level state
_env_variables: Dict[str, str] = {}
_loaded: bool = False

# Built-in defaults (used only if no other configuration is found)
_DEFAULT_VALUES: Dict[str, str] = {
    "MESSAGING_API_URL": "https://hmdevonline.com/messaging-platform/api/v1/messaging-service",
    # Note: API keys should be configured via .env or environment variables
}

ENV_FILE_NAME = ".env"


def load() -> None:
    """
    Load .env file if not already loaded.
    Searches in order:
    1. Current project root
    2. Services repo (sibling to SDK repo)
    """
    global _loaded, _env_variables

    if _loaded:
        return

    env_file = _find_env_file()

    if env_file and env_file.exists():
        logger.info(f"Loading environment from: {env_file.absolute()}")
        _load_from_file(env_file)
    else:
        logger.debug("No .env file found. Using environment variables.")

    _loaded = True


def _find_env_file() -> Optional[Path]:
    """Find .env file in search order."""
    # 1. Try current project root
    current_project_env = _find_in_current_project()
    if current_project_env and current_project_env.exists():
        return current_project_env

    # 2. Try services repo (sibling to SDK repo)
    services_repo_env = _find_in_services_repo()
    if services_repo_env and services_repo_env.exists():
        return services_repo_env

    return None


def _find_in_current_project() -> Optional[Path]:
    """Find .env in current project root."""
    # Get current working directory
    current_path = Path.cwd()

    # Navigate up to find project root
    while current_path.parent != current_path:  # Stop at filesystem root
        # Check for .env in current directory
        env_file = current_path / ENV_FILE_NAME
        if env_file.exists():
            return env_file

        # Also check for .env in messaging-platform-services subdirectory
        services_subdir_env = current_path / "messaging-platform-services" / ENV_FILE_NAME
        if services_subdir_env.exists():
            return services_subdir_env

        # Check if this is project root (has common project indicators)
        if (current_path / "setup.py").exists() or \
           (current_path / "pyproject.toml").exists() or \
           (current_path / "build.gradle").exists() or \
           (current_path / "settings.gradle").exists():
            # This is project root, stop searching
            break

        current_path = current_path.parent

    return None


def _find_in_services_repo() -> Optional[Path]:
    """Find .env in services repo (assuming SDK and services are siblings)."""
    try:
        # Get current working directory
        current_path = Path.cwd()

        # Navigate up to find SDK root (contains "messaging-platform-sdk" in path)
        while current_path.parent != current_path:  # Stop at filesystem root
            if current_path.name == "messaging-platform-sdk":
                # Found SDK root, now look for services repo as sibling
                parent_path = current_path.parent
                services_path = parent_path / "messaging-platform-services"
                services_env_file = services_path / ENV_FILE_NAME

                if services_env_file.exists():
                    return services_env_file

                break

            current_path = current_path.parent
    except Exception as e:
        logger.warning(f"Error searching for services repo .env: {e}")

    return None


def _load_from_file(env_file: Path) -> None:
    """Load variables from .env file."""
    try:
        with open(env_file, 'r', encoding='utf-8') as f:
            line_number = 0
            for line in f:
                line_number += 1
                line = line.strip()

                # Skip empty lines and comments
                if not line or line.startswith('#'):
                    continue

                # Parse KEY=VALUE
                if '=' in line:
                    key, _, value = line.partition('=')
                    key = key.strip()
                    value = value.strip()

                    # Remove quotes if present
                    if (value.startswith('"') and value.endswith('"')) or \
                       (value.startswith("'") and value.endswith("'")):
                        value = value[1:-1]

                    _env_variables[key] = value
                else:
                    logger.warning(f"Invalid line {line_number} in {env_file.name}: {line}")

        logger.debug(f"Loaded {len(_env_variables)} variables from .env file")

    except IOError as e:
        logger.error(f"Error reading .env file: {e}")


def _is_valid_value(value: Optional[str]) -> bool:
    """Check if a value is valid (not None and not empty)."""
    return value is not None and value != ""


def get(key: str, default_value: Optional[str] = None) -> Optional[str]:
    """
    Get environment variable from multiple sources.

    Search order:
    1. Loaded .env variables
    2. os.environ environment variables
    3. Built-in defaults
    4. Provided default value

    Args:
        key: Environment variable key
        default_value: Default value if not found

    Returns:
        The environment variable value or default
    """
    # Ensure .env is loaded
    load()

    # 1. Check loaded .env variables
    value = _env_variables.get(key)
    if _is_valid_value(value):
        return value

    # 2. Check environment variables
    value = os.environ.get(key)
    if _is_valid_value(value):
        return value

    # 3. Check built-in defaults
    value = _DEFAULT_VALUES.get(key)
    if _is_valid_value(value):
        return value

    # 4. Return provided default
    return default_value
