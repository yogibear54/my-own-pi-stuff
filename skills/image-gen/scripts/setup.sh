#!/usr/bin/env bash
# ai-image-gen — Skill Setup Script
# Syncs the project environment (uv) and verifies the imggen CLI.
#
# Install-dir resolution (first found wins):
#   1. --dir CLI argument
#   2. IMAGE_GEN_DIR environment variable
#   3. ~/.config/image-gen-skill/config.env
#   4. Default: the ai-image-gen project checkout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/image-gen-skill/config.env"
DEFAULT_DIR="/home/yogibear54/Projects/lotus-creations.com/_PROJECTS/ai-image-gen"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; }

# --- resolve install dir -----------------------------------------------------
INSTALL_DIR="${1:-}"
if [ -z "$INSTALL_DIR" ] && [ -n "${IMAGE_GEN_DIR:-}" ]; then
  INSTALL_DIR="$IMAGE_GEN_DIR"
fi
if [ -z "$INSTALL_DIR" ] && [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  INSTALL_DIR="${IMAGE_GEN_DIR:-}"
fi
if [ -z "$INSTALL_DIR" ]; then
  INSTALL_DIR="$DEFAULT_DIR"
fi
INSTALL_DIR="$(cd "$INSTALL_DIR" && pwd)"

if [ ! -f "$INSTALL_DIR/pyproject.toml" ]; then
  error "No pyproject.toml at $INSTALL_DIR"
  exit 1
fi
info "Using project: $INSTALL_DIR"

# --- uv required --------------------------------------------------------------
if ! command -v uv > /dev/null 2>&1; then
  error "uv not found — install it first: https://docs.astral.sh/uv/"
  exit 1
fi
info "uv $(uv --version | awk '{print $2}') found"

# --- sync environment ----------------------------------------------------------
echo ""
echo "Syncing environment (base + replicate + dev tools)..."
(cd "$INSTALL_DIR" && uv sync --extra replicate) || {
  error "uv sync failed"
  exit 1
}
info "Environment synced"

# --- verify CLI -----------------------------------------------------------------
echo ""
echo "Verifying imggen..."
(cd "$INSTALL_DIR" && uv run imggen --version) || {
  error "imggen CLI not runnable"
  exit 1
}
info "imggen CLI available"

# --- token hint ------------------------------------------------------------------
echo ""
if [ -n "${REPLICATE_API_TOKEN:-}" ] || grep -qE '^REPLICATE_API_TOKEN=.+' "$INSTALL_DIR/.env" 2>/dev/null; then
  info "REPLICATE_API_TOKEN configured"
else
  warn "No REPLICATE_API_TOKEN — copy $INSTALL_DIR/.env.example to $INSTALL_DIR/.env and set it"
fi

# --- save config if non-default ----------------------------------------------------
if [ "$INSTALL_DIR" != "$DEFAULT_DIR" ]; then
  mkdir -p "$(dirname "$CONFIG_FILE")"
  echo "IMAGE_GEN_DIR=$INSTALL_DIR" > "$CONFIG_FILE"
  info "Config saved: $CONFIG_FILE"
fi

# --- done ---------------------------------------------------------------------------
echo ""
echo "=== Setup complete ==="
echo ""
echo "Try it:"
echo "  $(dirname "$0")/imggen doctor"
echo "  $(dirname "$0")/imggen generate --prompt \"a watercolor lotus\""
echo ""
echo "Remember: activate this skill in pi with /system (toggle image-gen), then /reload"
