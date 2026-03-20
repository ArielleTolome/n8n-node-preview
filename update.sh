#!/usr/bin/env bash
set -euo pipefail

# N8N Node Preview — Updater
# Updates the injector script. Supports local and remote (SSH) updates.
#
# Usage:
#   Local:  sudo bash update.sh
#   Remote: bash update.sh --remote user@server

PREVIEW_DIR="/opt/n8n-preview"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

# Determine source file
if [[ -f "$SCRIPT_DIR/dist/injector.min.js" ]]; then
  SRC="$SCRIPT_DIR/dist/injector.min.js"
elif [[ -f "$SCRIPT_DIR/src/injector.js" ]]; then
  SRC="$SCRIPT_DIR/src/injector.js"
else
  error "Cannot find injector.js in dist/ or src/"
fi

if [[ "${1:-}" == "--remote" ]]; then
  # Remote update via SSH
  SERVER="${2:-}"
  if [[ -z "$SERVER" ]]; then
    # Try .env file
    if [[ -f "$SCRIPT_DIR/.env" ]]; then
      source "$SCRIPT_DIR/.env"
      SERVER="${DEPLOY_SERVER:-}"
    fi
    if [[ -z "$SERVER" ]]; then
      echo -n "Enter server (user@host): "
      read -r SERVER
    fi
  fi
  [[ -z "$SERVER" ]] && error "No server specified"

  echo "Uploading to $SERVER:$PREVIEW_DIR/injector.js ..."
  scp "$SRC" "$SERVER:$PREVIEW_DIR/injector.js"
  log "Uploaded to $SERVER"
  echo ""
  echo "Note: Browser cache may serve the old version for up to 1 minute."
else
  # Local update
  if [[ $EUID -ne 0 ]]; then
    error "Local update requires root (sudo). Use --remote for SSH."
  fi

  if [[ ! -d "$PREVIEW_DIR" ]]; then
    error "$PREVIEW_DIR does not exist. Run install.sh first."
  fi

  cp "$SRC" "$PREVIEW_DIR/injector.js"
  chmod 644 "$PREVIEW_DIR/injector.js"
  log "injector.js updated at $PREVIEW_DIR/"
  echo ""
  echo "Hard-refresh (Ctrl+Shift+R) to load immediately."
fi
