#!/usr/bin/env bash
set -euo pipefail

# N8N Node Preview — Installer
# Installs Nginx config and injector script for N8N canvas node previews.

PREVIEW_DIR="/opt/n8n-preview"
NGINX_EXTRA_D="/etc/nginx-rc/extra.d"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()   { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1" >&2; exit 1; }

echo ""
echo "====================================="
echo "  N8N Node Preview — Installer"
echo "====================================="
echo ""

# Check root
if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root (sudo)."
fi

# Check nginx
if ! command -v nginx &>/dev/null; then
  error "nginx not found. Is Nginx installed?"
fi

# Check nginx extra.d directory
if [[ ! -d "$NGINX_EXTRA_D" ]]; then
  error "Nginx extra.d directory not found at $NGINX_EXTRA_D"
fi

# Step 1: Create preview directory
echo "Step 1: Creating $PREVIEW_DIR ..."
mkdir -p "$PREVIEW_DIR"
log "Directory created"

# Step 2: Copy injector.js
echo "Step 2: Copying injector.js ..."
if [[ -f "$SCRIPT_DIR/dist/injector.min.js" ]]; then
  cp "$SCRIPT_DIR/dist/injector.min.js" "$PREVIEW_DIR/injector.js"
elif [[ -f "$SCRIPT_DIR/src/injector.js" ]]; then
  cp "$SCRIPT_DIR/src/injector.js" "$PREVIEW_DIR/injector.js"
else
  error "Cannot find injector.js in dist/ or src/"
fi
chmod 644 "$PREVIEW_DIR/injector.js"
log "injector.js installed to $PREVIEW_DIR/"

# Step 3: Copy Nginx configs
echo "Step 3: Installing Nginx configuration ..."

cp "$SCRIPT_DIR/nginx/n8n-preview.location.main.conf" \
   "$NGINX_EXTRA_D/n8n-ai.location.main.n8n-preview.conf"
log "Installed location.main config"

cp "$SCRIPT_DIR/nginx/n8n-preview.sub-filter.location.root.conf" \
   "$NGINX_EXTRA_D/n8n-ai.location.root.n8n-preview.conf"
log "Installed location.root (sub_filter) config"

# Step 4: Test Nginx config
echo "Step 4: Testing Nginx configuration ..."
if nginx -t 2>&1; then
  log "Nginx config test passed"
else
  error "Nginx config test failed. Check the error above."
fi

# Step 5: Reload Nginx
echo "Step 5: Reloading Nginx ..."
if systemctl is-active --quiet nginx; then
  systemctl reload nginx
elif command -v nginx &>/dev/null; then
  nginx -s reload
fi
log "Nginx reloaded"

echo ""
echo "====================================="
echo -e "  ${GREEN}Installation complete!${NC}"
echo "====================================="
echo ""
echo "  Injector:  $PREVIEW_DIR/injector.js"
echo "  Configs:   $NGINX_EXTRA_D/n8n-ai.location.{main,root}.n8n-preview.conf"
echo ""
echo "  Open your N8N instance and look for the"
echo "  orange 'Preview Active' badge in the toolbar."
echo ""
