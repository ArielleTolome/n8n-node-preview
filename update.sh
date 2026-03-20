#!/usr/bin/env bash
set -euo pipefail

# N8N Node Preview — Updater
# Updates only the injector script without touching Nginx config.

PREVIEW_DIR="/opt/n8n-preview"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

log()   { echo -e "${GREEN}[OK]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

echo "N8N Node Preview — Updater"
echo ""

if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (sudo)."
fi

if [[ ! -d "$PREVIEW_DIR" ]]; then
  error "$PREVIEW_DIR does not exist. Run install.sh first."
fi

if [[ -f "$SCRIPT_DIR/dist/injector.min.js" ]]; then
  SRC="$SCRIPT_DIR/dist/injector.min.js"
elif [[ -f "$SCRIPT_DIR/src/injector.js" ]]; then
  SRC="$SCRIPT_DIR/src/injector.js"
else
  error "Cannot find injector.js in dist/ or src/"
fi

cp "$SRC" "$PREVIEW_DIR/injector.js"
chmod 644 "$PREVIEW_DIR/injector.js"
log "injector.js updated at $PREVIEW_DIR/"

echo ""
echo "Note: Browser cache may serve the old version for up to 1 minute."
echo "Hard-refresh (Ctrl+Shift+R) to load immediately."
echo ""
