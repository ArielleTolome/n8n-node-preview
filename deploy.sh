#!/usr/bin/env bash
set -euo pipefail

# N8N Node Preview — Deploy Script
# Deploys injector.js and Nginx configs to the remote server.
#
# Usage:
#   ./deploy.sh              # Deploy using .env
#   ./deploy.sh --dry-run    # Show what would be done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()   { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1" >&2; exit 1; }

# ─── Load .env ─────────────────────────────────────────
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
else
  fail ".env file not found. Copy .env.example to .env and configure."
fi

# ─── Defaults ──────────────────────────────────────────
DEPLOY_HOST="${DEPLOY_HOST:?DEPLOY_HOST is required}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
PREVIEW_DIR="${PREVIEW_DIR:-/opt/n8n-preview}"
NGINX_EXTRA_D="${NGINX_EXTRA_D:-/etc/nginx-rc/extra.d}"
N8N_URL="${N8N_URL:-https://n8n.pigeonfi.com}"
SSH_KEY="${SSH_KEY:-}"

SSH_OPTS="-o StrictHostKeyChecking=accept-new -p $DEPLOY_PORT"
if [[ -n "$SSH_KEY" ]]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
  info "DRY RUN — no changes will be made"
fi

# ─── Get Version ───────────────────────────────────────
VERSION=$(grep '"version"' "$SCRIPT_DIR/package.json" | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/')
info "Deploying n8n-node-preview v${VERSION}"

echo ""
echo "============================================="
echo "  N8N Node Preview — Deploy v${VERSION}"
echo "============================================="
echo ""
info "Target: ${DEPLOY_USER}@${DEPLOY_HOST}:${DEPLOY_PORT}"
info "Preview dir: ${PREVIEW_DIR}"
info "Nginx dir: ${NGINX_EXTRA_D}"
echo ""

# ─── Build ─────────────────────────────────────────────
info "Building dist/injector.min.js ..."
cp "$SCRIPT_DIR/src/injector.js" "$SCRIPT_DIR/dist/injector.min.js"
log "Build complete"

if $DRY_RUN; then
  info "Would upload: dist/injector.min.js → ${PREVIEW_DIR}/injector.js"
  info "Would upload: nginx configs → ${NGINX_EXTRA_D}/"
  info "Would update cache buster to ?v=${VERSION}"
  info "Would run: nginx -t && systemctl reload nginx"
  echo ""
  log "Dry run complete"
  exit 0
fi

# ─── Upload Files ──────────────────────────────────────
info "Creating remote directory ..."
ssh $SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" "mkdir -p ${PREVIEW_DIR}"
log "Directory ready"

info "Uploading injector.js ..."
scp -P "$DEPLOY_PORT" ${SSH_KEY:+-i "$SSH_KEY"} \
  "$SCRIPT_DIR/dist/injector.min.js" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${PREVIEW_DIR}/injector.js"
log "Injector uploaded"

info "Uploading Nginx configs ..."
scp -P "$DEPLOY_PORT" ${SSH_KEY:+-i "$SSH_KEY"} \
  "$SCRIPT_DIR/nginx/n8n-preview.location.main.conf" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${NGINX_EXTRA_D}/n8n-ai.location.main.n8n-preview.conf"

scp -P "$DEPLOY_PORT" ${SSH_KEY:+-i "$SSH_KEY"} \
  "$SCRIPT_DIR/nginx/n8n-preview.sub-filter.location.root.conf" \
  "${DEPLOY_USER}@${DEPLOY_HOST}:${NGINX_EXTRA_D}/n8n-ai.location.root.n8n-preview.conf"
log "Nginx configs uploaded"

# ─── Update Cache Buster ───────────────────────────────
info "Updating cache buster to v=${VERSION} ..."
ssh $SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" \
  "sed -i 's|injector\\.js?v=[^\"]*|injector.js?v=${VERSION}|g' ${NGINX_EXTRA_D}/n8n-ai.location.root.n8n-preview.conf"
log "Cache buster updated"

# ─── Nginx Test + Reload ───────────────────────────────
info "Testing Nginx config ..."
ssh $SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" "nginx -t" || fail "Nginx config test failed!"
log "Nginx config valid"

info "Reloading Nginx ..."
ssh $SSH_OPTS "${DEPLOY_USER}@${DEPLOY_HOST}" "systemctl reload nginx || nginx -s reload"
log "Nginx reloaded"

# ─── Verify ───────────────────────────────────────────
echo ""
info "Running verification ..."
sleep 2
bash "$SCRIPT_DIR/verify.sh" || warn "Verification had issues (see above)"

echo ""
echo "============================================="
echo -e "  ${GREEN}Deploy complete! v${VERSION}${NC}"
echo "============================================="
echo ""
echo "  URL: ${N8N_URL}"
echo "  Injector: ${PREVIEW_DIR}/injector.js"
echo ""
