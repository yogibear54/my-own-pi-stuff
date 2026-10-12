#!/usr/bin/env bash
# ai-video-gen — Skill Setup Script
# Syncs the project environment (uv) and verifies the vidgen CLI.
#
# Install-dir resolution (first found wins):
#   1. --dir CLI argument
#   2. VIDEO_GEN_DIR environment variable
#   3. ~/.config/video-gen-skill/config.env
#   4. Default: the ai-video-gen project checkout

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="${XDG_CONFIG_HOME:-$HOME/.config}/video-gen-skill/config.env"
DEFAULT_DIR="/home/yogibear54/Projects/lotus-creations.com/_PROJECTS/ai-video-gen"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info() { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}⚠${NC} $1"; }
error() { echo -e "${RED}✗${NC} $1" >&2; }

# --- resolve install dir -----------------------------------------------------
INSTALL_DIR="${1:-}"
if [ -z "$INSTALL_DIR" ] && [ -n "${VIDEO_GEN_DIR:-}" ]; then
  INSTALL_DIR="$VIDEO_GEN_DIR"
fi
if [ -z "$INSTALL_DIR" ] && [ -f "$CONFIG_FILE" ]; then
  # shellcheck source=/dev/null
  source "$CONFIG_FILE"
  INSTALL_DIR="${VIDEO_GEN_DIR:-}"
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
echo "Verifying vidgen..."
(cd "$INSTALL_DIR" && uv run vidgen --version) || {
  error "vidgen CLI not runnable"
  exit 1
}
info "vidgen CLI available"

# --- token hint ------------------------------------------------------------------
echo ""
TOKEN_OK=0
if [ -n "${REPLICATE_API_TOKEN:-}" ] || grep -qE '^REPLICATE_API_TOKEN=.+' "$INSTALL_DIR/.env" 2>/dev/null; then
  info "REPLICATE_API_TOKEN configured"
  TOKEN_OK=1
else
  warn "No REPLICATE_API_TOKEN — copy $INSTALL_DIR/.env.example to $INSTALL_DIR/.env and set it"
fi
if [ -n "${OPENROUTER_API_KEY:-}" ] || grep -qE '^OPENROUTER_API_KEY=.+' "$INSTALL_DIR/.env" 2>/dev/null; then
  info "OPENROUTER_API_KEY configured (--provider openrouter available)"
  TOKEN_OK=1
fi
[ "$TOKEN_OK" -eq 0 ] && warn "No video provider credential found"

# --- save config if non-default ----------------------------------------------------
if [ "$INSTALL_DIR" != "$DEFAULT_DIR" ]; then
  mkdir -p "$(dirname "$CONFIG_FILE")"
  echo "VIDEO_GEN_DIR=$INSTALL_DIR" > "$CONFIG_FILE"
  info "Config saved: $CONFIG_FILE"
fi

# --- done ---------------------------------------------------------------------------
echo ""
echo "=== Setup complete ==="
echo ""
echo "Try it:"
echo "  $(dirname "$0")/vidgen doctor"
echo "  $(dirname "$0")/vidgen generate --prompt \"a drone shot over a lotus pond\""
echo ""
echo "Remember: activate this skill in pi with /system (toggle video-gen), then /reload"
