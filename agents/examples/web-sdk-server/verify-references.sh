#!/bin/bash

# Verification script for web-demos-server HTML file references

echo "============================================"
echo "Web Demos Server - Reference Verification"
echo "============================================"
echo ""

ERRORS=0

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if generated folder exists
echo "1. Checking generated folder..."
if [ -d "src/main/resources/static/generated" ]; then
    echo -e "${GREEN}✓${NC} Generated folder exists"

    # Check for required SDK files
    REQUIRED_FILES=(
        "web-agent.js"
        "web-agent.webrtc.js"
        "web-agent.libs.js"
        "config-loader.js"
        "qrcode.min.js"
        "common.css"
        "icons.css"
    )

    for file in "${REQUIRED_FILES[@]}"; do
        if [ -f "src/main/resources/static/generated/$file" ]; then
            echo -e "  ${GREEN}✓${NC} $file"
        else
            echo -e "  ${RED}✗${NC} $file (missing)"
            ERRORS=$((ERRORS+1))
        fi
    done
else
    echo -e "${RED}✗${NC} Generated folder does not exist"
    ERRORS=$((ERRORS+1))
fi

echo ""
echo "2. Checking demo-specific files..."

# Check CSS files
if [ -f "src/main/resources/static/css/share-modal.css" ]; then
    echo -e "${GREEN}✓${NC} css/share-modal.css"
else
    echo -e "${RED}✗${NC} css/share-modal.css (missing)"
    ERRORS=$((ERRORS+1))
fi

if [ -f "src/main/resources/static/css/mini-games-connection.css" ]; then
    echo -e "${GREEN}✓${NC} css/mini-games-connection.css"
else
    echo -e "${RED}✗${NC} css/mini-games-connection.css (missing)"
    ERRORS=$((ERRORS+1))
fi

# Check JS files
if [ -f "src/main/resources/static/js/share-modal.js" ]; then
    echo -e "${GREEN}✓${NC} js/share-modal.js"
else
    echo -e "${RED}✗${NC} js/share-modal.js (missing)"
    ERRORS=$((ERRORS+1))
fi

if [ -f "src/main/resources/static/js/mini-game-utils.js" ]; then
    echo -e "${GREEN}✓${NC} js/mini-game-utils.js"
else
    echo -e "${RED}✗${NC} js/mini-game-utils.js (missing)"
    ERRORS=$((ERRORS+1))
fi

# Check BaseGame.js
if [ -f "src/main/resources/static/mini-games/common/BaseGame.js" ]; then
    echo -e "${GREEN}✓${NC} mini-games/common/BaseGame.js"
else
    echo -e "${RED}✗${NC} mini-games/common/BaseGame.js (missing)"
    ERRORS=$((ERRORS+1))
fi

echo ""
echo "3. Checking HTML file references..."

# Check for old references that should have been updated
OLD_REFS=$(grep -r 'src="../js/web-agent' src/main/resources/static/ 2>/dev/null | grep -v node_modules | wc -l)
if [ "$OLD_REFS" -eq 0 ]; then
    echo -e "${GREEN}✓${NC} No old ../js/web-agent.js references found"
else
    echo -e "${YELLOW}⚠${NC} Found $OLD_REFS old ../js/web-agent.js references (should be ../generated/)"
    grep -r 'src="../js/web-agent' src/main/resources/static/ 2>/dev/null | grep -v node_modules
fi

# Check for new correct references
NEW_REFS=$(grep -r 'src="../generated/web-agent' src/main/resources/static/examples/ 2>/dev/null | wc -l)
if [ "$NEW_REFS" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} Found $NEW_REFS correct ../generated/ references in examples"
else
    echo -e "${RED}✗${NC} No ../generated/ references found in examples"
    ERRORS=$((ERRORS+1))
fi

NEW_REFS_MG=$(grep -r 'src="../../generated/web-agent' src/main/resources/static/mini-games/ 2>/dev/null | wc -l)
if [ "$NEW_REFS_MG" -gt 0 ]; then
    echo -e "${GREEN}✓${NC} Found $NEW_REFS_MG correct ../../generated/ references in mini-games"
else
    echo -e "${RED}✗${NC} No ../../generated/ references found in mini-games"
    ERRORS=$((ERRORS+1))
fi

# Check for non-existent file references
echo ""
echo "4. Checking for references to non-existent files..."

UTILS_REFS=$(grep -r 'src=".*utils.js"' src/main/resources/static/ 2>/dev/null | grep -v node_modules | wc -l)
if [ "$UTILS_REFS" -eq 0 ]; then
    echo -e "${GREEN}✓${NC} No references to utils.js (doesn't exist)"
else
    echo -e "${YELLOW}⚠${NC} Found $UTILS_REFS references to utils.js (file doesn't exist)"
    grep -r 'src=".*utils.js"' src/main/resources/static/ 2>/dev/null | grep -v node_modules
fi

CONN_REFS=$(grep -r 'src=".*connection-modal.js"' src/main/resources/static/ 2>/dev/null | grep -v node_modules | wc -l)
if [ "$CONN_REFS" -eq 0 ]; then
    echo -e "${GREEN}✓${NC} No references to connection-modal.js (doesn't exist)"
else
    echo -e "${YELLOW}⚠${NC} Found $CONN_REFS references to connection-modal.js (file doesn't exist)"
    grep -r 'src=".*connection-modal.js"' src/main/resources/static/ 2>/dev/null | grep -v node_modules
fi

echo ""
echo "============================================"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✓ All checks passed!${NC}"
    echo "============================================"
    exit 0
else
    echo -e "${RED}✗ Found $ERRORS error(s)${NC}"
    echo "============================================"
    exit 1
fi

