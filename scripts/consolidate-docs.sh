#!/bin/bash
# SDK Documentation Consolidation Script
# Date: December 27, 2025

set -e

echo "🧹 Starting SDK documentation cleanup..."

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Create archive directories
echo "${BLUE}📁 Creating archive directories...${NC}"
mkdir -p agents/java-agent/docs/archive
mkdir -p AI/archived/temp-key-fixes

# Archive WebRTC documentation from java-agent
echo "${BLUE}📦 Archiving WebRTC documentation...${NC}"
if ls agents/java-agent/WEBRTC_*.md 1> /dev/null 2>&1; then
    mv agents/java-agent/WEBRTC_*.md agents/java-agent/docs/archive/
    echo "${GREEN}✓${NC} Moved WEBRTC_*.md files"
fi

if ls agents/java-agent/ICE_*.md 1> /dev/null 2>&1; then
    mv agents/java-agent/ICE_*.md agents/java-agent/docs/archive/
    echo "${GREEN}✓${NC} Moved ICE_*.md files"
fi

if [ -f agents/java-agent/DEBUG_MODE.md ]; then
    mv agents/java-agent/DEBUG_MODE.md agents/java-agent/docs/archive/
    echo "${GREEN}✓${NC} Moved DEBUG_MODE.md"
fi

# Archive temporary key fix documentation
echo "${BLUE}📦 Archiving temporary key fix documentation...${NC}"
if ls AI/CHAT-TEMPORARY-KEY-*.md 1> /dev/null 2>&1; then
    mv AI/CHAT-TEMPORARY-KEY-*.md AI/archived/temp-key-fixes/
    echo "${GREEN}✓${NC} Moved CHAT-TEMPORARY-KEY-*.md files"
fi

if ls AI/WEBRTC-TEMPORARY-KEY-*.md 1> /dev/null 2>&1; then
    mv AI/WEBRTC-TEMPORARY-KEY-*.md AI/archived/temp-key-fixes/
    echo "${GREEN}✓${NC} Moved WEBRTC-TEMPORARY-KEY-*.md files"
fi

# Create index files in archive directories
echo "${BLUE}📝 Creating archive index files...${NC}"

cat > agents/java-agent/docs/archive/README.md << 'EOF'
# Archived Documentation

This directory contains historical WebRTC implementation documentation.

These files have been consolidated into the main **USER-GUIDE.md** at the repository root.

## Files

- `WEBRTC_INTEGRATION_COMPLETE.md` - Initial WebRTC integration
- `WEBRTC_JAVA_INTEGRATION.md` - Java-specific WebRTC implementation
- `ICE_SERVER_CONFIGURED.md` - ICE server configuration
- `ICE_TURN_CONFIG.md` - TURN server setup
- `DEBUG_MODE.md` - Debug mode documentation

## Current Documentation

See [/USER-GUIDE.md](../../../../USER-GUIDE.md) for current WebRTC documentation.
EOF

cat > AI/archived/temp-key-fixes/README.md << 'EOF'
# Temporary API Key Implementation History

This directory contains historical documentation about the temporary API key system implementation.

## Files

- `CHAT-TEMPORARY-KEY-FIX-DEC27-2025.md` - Chat.html implementation
- `CHAT-TEMPORARY-KEY-COMPLETE-DEC27-2025.md` - Verification and completion
- `WEBRTC-TEMPORARY-KEY-FIX-DEC27-2025.md` - WebRTC.html implementation

## Current Documentation

See [/USER-GUIDE.md](../../../USER-GUIDE.md#best-practices) for current temporary key usage documentation.

## Summary

All web agent examples (chat.html and webrtc.html) now request fresh temporary API keys on each connect action, providing enhanced security.
EOF

echo "${GREEN}✓${NC} Created archive index files"

# Count archived files
webrtc_count=$(ls agents/java-agent/docs/archive/*.md 2>/dev/null | wc -l)
tempkey_count=$(ls AI/archived/temp-key-fixes/*.md 2>/dev/null | wc -l)

echo ""
echo "${GREEN}✅ Documentation cleanup complete!${NC}"
echo ""
echo "📊 Summary:"
echo "  - WebRTC docs archived: $webrtc_count files"
echo "  - Temp key docs archived: $tempkey_count files"
echo ""
echo "📖 Main documentation:"
echo "  - USER-GUIDE.md (comprehensive guide)"
echo "  - README.md (quick overview)"
echo "  - AI/ (implementation notes)"
echo ""
echo "🗂️  Archived documentation:"
echo "  - agents/java-agent/docs/archive/"
echo "  - AI/archived/temp-key-fixes/"
echo ""
echo "👉 Next: Update README.md to point to USER-GUIDE.md"

