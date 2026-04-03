#!/bin/bash
# PDF Extractor Analyzer - Skill Setup Script
# Run this script to set up the PDF Extractor for use with pi
#
# Configuration order (first found wins):
#   1. --dir CLI argument
#   2. PDF_EXTRACTOR_DIR environment variable
#   3. ~/.config/pdf-extractor-skill/config.env
#   4. Interactive prompt
#   5. Default: ~/Projects/.../pdf-extractor-analyzer

set -e

# Script directory and default paths
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/pdf-extractor-skill"
CONFIG_FILE="$CONFIG_DIR/config.env"
DEFAULT_INSTALL_DIR="$HOME/Projects/lotus-creations.com/_PROJECTS/agent-playground/pdf-extractor-analyzer"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()    { echo -e "${GREEN}✓${NC} $1"; }
warn()    { echo -e "${YELLOW}⚠${NC} $1"; }
error()   { echo -e "${RED}✗${NC} $1" >&2; }

usage() {
    cat << EOF
Usage: $(basename "$0") [OPTIONS]

Set up PDF Extractor Analyzer for use with pi.

OPTIONS:
    --dir PATH         Installation directory (overrides all other sources)
    --install-here     Install in skill directory ($SKILL_DIR)
    --create-config    Create default config file (does not install)
    -h, --help         Show this help message

CONFIGURATION FILE:
    Location: $CONFIG_FILE
    Content:  PDF_EXTRACTOR_DIR=/path/to/installation

EXAMPLES:
    $(basename "$0")                                    # Interactive setup
    $(basename "$0") --dir ~/my-pdfs                    # Use specific directory
    $(basename "$0") --install-here                     # Install in skill folder
    $(basename "$0") --create-config                    # Create config file

EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dir)
            ARG_INSTALL_DIR="$2"
            shift 2
            ;;
        --install-here)
            ARG_INSTALL_DIR="$SKILL_DIR"
            shift
            ;;
        --create-config)
            CREATE_CONFIG_ONLY=true
            shift
            ;;
        -h|--help)
            usage
            ;;
        *)
            error "Unknown option: $1"
            usage
            ;;
    esac
done

echo "=== PDF Extractor Analyzer Skill Setup ==="
echo ""

# =============================================================================
# Step 1: Determine installation directory
# =============================================================================

get_install_dir() {
    local dir=""

    # 1. CLI argument
    if [ -n "$ARG_INSTALL_DIR" ]; then
        dir="$ARG_INSTALL_DIR"
        echo "Using directory from CLI argument: $dir"
        return 0
    fi

    # 2. Environment variable
    if [ -n "$PDF_EXTRACTOR_DIR" ]; then
        dir="$PDF_EXTRACTOR_DIR"
        echo "Using directory from \$PDF_EXTRACTOR_DIR: $dir"
        return 0
    fi

    # 3. Config file
    if [ -f "$CONFIG_FILE" ]; then
        source "$CONFIG_FILE"
        if [ -n "$PDF_EXTRACTOR_DIR" ]; then
            dir="$PDF_EXTRACTOR_DIR"
            echo "Using directory from config: $dir"
            return 0
        fi
    fi

    # 4. Check default location
    if [ -f "$DEFAULT_INSTALL_DIR/pyproject.toml" ]; then
        dir="$DEFAULT_INSTALL_DIR"
        echo "Found existing installation at: $dir"
        return 0
    fi

    # 5. Interactive prompt
    echo ""
    echo "Enter the PDF Extractor project directory, or press Enter to use:"
    echo "  $DEFAULT_INSTALL_DIR"
    read -r -p "> " INPUT_DIR
    dir="${INPUT_DIR:-$DEFAULT_INSTALL_DIR}"

    return 0
}

# =============================================================================
# Step 2: Create config file (--create-config mode)
# =============================================================================

create_config_file() {
    echo "Creating config directory: $CONFIG_DIR"
    mkdir -p "$CONFIG_DIR"

    if [ -f "$CONFIG_FILE" ]; then
        echo ""
        warn "Config file already exists: $CONFIG_FILE"
        read -r -p "Overwrite? [y/N] " -n 1 REPLY
        echo ""
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "Aborted."
            exit 0
        fi
    fi

    cat > "$CONFIG_FILE" << EOF
# PDF Extractor Skill Configuration
# This file is sourced by setup.sh and extract.py
#
# Set the installation directory for pdf-extractor-analyzer:
PDF_EXTRACTOR_DIR=$DEFAULT_INSTALL_DIR
EOF

    echo ""
    info "Config file created: $CONFIG_FILE"
    echo ""
    echo "Edit this file to change your installation directory."
}

if [ "$CREATE_CONFIG_ONLY" = true ]; then
    create_config_file
    exit 0
fi

# =============================================================================
# Step 3: Normal setup flow
# =============================================================================

# Check Python version
echo "Checking Python version..."
PYTHON_VERSION=$(python3 --version 2>&1 | grep -oP '\d+\.\d+' | head -1)
REQUIRED_VERSION=3.11
if (( $(echo "$PYTHON_VERSION < $REQUIRED_VERSION" | bc -l) )); then
    error "Python 3.11+ required. Found: $PYTHON_VERSION"
    exit 1
fi
info "Python $PYTHON_VERSION found"

# Get installation directory
echo ""
get_install_dir

# Resolve to absolute path
INSTALL_DIR="$(cd "$dir" && pwd)"

# Verify it's a valid installation
if [ ! -f "$INSTALL_DIR/pyproject.toml" ]; then
    error "No pyproject.toml found at: $INSTALL_DIR"
    echo ""
    echo "Please ensure this is the pdf-extractor-analyzer project directory."
    echo "You can:"
    echo "  1. Clone it: git clone <repo> $INSTALL_DIR"
    echo "  2. Run setup again with a different path"
    echo "  3. Create config at $CONFIG_FILE"
    exit 1
fi

echo ""
info "Using installation directory: $INSTALL_DIR"

# =============================================================================
# Step 4: Virtual environment setup
# =============================================================================

VENV_DIR="$INSTALL_DIR/.venv"
if [ ! -d "$VENV_DIR" ]; then
    echo ""
    echo "Creating virtual environment..."
    python3 -m venv "$VENV_DIR"
    info "Virtual environment created"
else
    echo ""
    info "Virtual environment already exists"
fi

# Activate virtual environment
VENV_ACTIVATE="$VENV_DIR/bin/activate"
if [ -f "$VENV_ACTIVATE" ]; then
    # shellcheck source=/dev/null
    source "$VENV_ACTIVATE"
fi

# Upgrade pip
echo ""
echo "Upgrading pip..."
pip install --upgrade pip -q
info "pip upgraded"

# =============================================================================
# Step 5: Install package
# =============================================================================

echo ""
echo "Installing PDF Extractor Analyzer..."
if pip install -e "$INSTALL_DIR[replicate]" -q; then
    info "PDF Extractor Analyzer installed"
else
    # Try without extras in case replicate is not defined
    echo "  (retrying without extras...)"
    pip install -e "$INSTALL_DIR" -q
    info "PDF Extractor Analyzer installed (base package)"
fi

# =============================================================================
# Step 6: Verify installation
# =============================================================================

echo ""
echo "Verifying installation..."
if command -v pdf-extractor > /dev/null 2>&1; then
    info "pdf-extractor command available"
else
    warn "pdf-extractor not found in PATH"
    echo "  Add to PATH: export PATH=\"$VENV_DIR/bin:\$PATH\""
fi

# =============================================================================
# Step 7: Check API token
# =============================================================================

echo ""
echo "=== Configuration ==="
if [ -n "$REPLICATE_API_TOKEN" ]; then
    info "REPLICATE_API_TOKEN is set"
elif [ -n "$OPENROUTER_API_KEY" ]; then
    info "OPENROUTER_API_KEY is set"
else
    echo ""
    warn "No API token detected. Please set one of:"
    echo ""
    echo "  For Replicate (default):"
    echo "    export REPLICATE_API_TOKEN=your_token_here"
    echo ""
    echo "  For OpenRouter:"
    echo "    export OPENROUTER_API_KEY=your_key_here"
    echo ""
    echo "Get your tokens at:"
    echo "  - Replicate: https://replicate.com"
    echo "  - OpenRouter: https://openrouter.ai"
fi

# =============================================================================
# Step 8: Save config if using non-default directory
# =============================================================================

if [ "$INSTALL_DIR" != "$DEFAULT_INSTALL_DIR" ]; then
    echo ""
    read -r -p "Save this directory to config for future runs? [Y/n] " REPLY
    REPLY="${REPLY:-Y}"
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        mkdir -p "$CONFIG_DIR"
        cat > "$CONFIG_FILE" << EOF
# PDF Extractor Skill Configuration
PDF_EXTRACTOR_DIR=$INSTALL_DIR
EOF
        info "Config saved to $CONFIG_FILE"
    fi
fi

# =============================================================================
# Done
# =============================================================================

echo ""
echo "=== Setup Complete ==="
echo ""
echo "To activate the environment in your shell:"
echo "  source $VENV_DIR/bin/activate"
echo ""
echo "Usage examples:"
echo "  pdf-extractor ./document.pdf --mode summary --pretty"
echo "  pdf-extractor ./document.pdf --mode markdown --pretty"
echo ""
echo "To change installation directory later:"
echo "  1. Edit: $CONFIG_FILE"
echo "  2. Or run: $(basename "$0") --dir /new/path"
