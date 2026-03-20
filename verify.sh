#!/usr/bin/env bash
set -euo pipefail

# N8N Node Preview — Verification Script
# Verifies the deployment is working correctly.
#
# Usage:
#   ./verify.sh              # Verify using .env config
#   ./verify.sh <url>        # Verify a specific URL

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

check_pass() { echo -e "  ${GREEN}\u2713${NC} $1"; PASS=$((PASS + 1)); }
check_fail() { echo -e "  ${RED}\u2717${NC} $1"; FAIL=$((FAIL + 1)); }
check_warn() { echo -e "  ${YELLOW}!${NC} $1"; WARN=$((WARN + 1)); }

# ─── Load Config ──────────────────────────────────────
if [[ -n "${1:-}" ]]; then
  N8N_URL="$1"
elif [[ -f "$SCRIPT_DIR/.env" ]]; then
  set -a; source "$SCRIPT_DIR/.env"; set +a
fi

N8N_URL="${N8N_URL:?N8N_URL is required. Pass as argument or set in .env}"
VERSION=$(grep '"version"' "$SCRIPT_DIR/package.json" 2>/dev/null | head -1 | sed 's/.*"version": *"\([^"]*\)".*/\1/' || echo "unknown")

echo ""
echo "============================================="
echo "  N8N Node Preview — Verification"
echo "============================================="
echo ""
echo "  URL: ${N8N_URL}"
echo "  Expected version: v${VERSION}"
echo ""

# ─── Check 1: N8N is reachable ────────────────────────
echo "Connectivity:"
HTTP_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "${N8N_URL}/" 2>/dev/null || echo "000")
if [[ "$HTTP_CODE" == "200" ]] || [[ "$HTTP_CODE" == "302" ]]; then
  check_pass "N8N reachable (HTTP ${HTTP_CODE})"
else
  check_fail "N8N unreachable (HTTP ${HTTP_CODE})"
fi

# ─── Check 2: Injector.js endpoint ───────────────────
INJECTOR_URL="${N8N_URL}/n8n-preview/injector.js"
INJECTOR_CODE=$(curl -sL -o /dev/null -w "%{http_code}" --max-time 10 "${INJECTOR_URL}" 2>/dev/null || echo "000")
if [[ "$INJECTOR_CODE" == "200" ]]; then
  check_pass "Injector endpoint reachable (${INJECTOR_URL})"
else
  check_fail "Injector endpoint failed (HTTP ${INJECTOR_CODE})"
fi

# ─── Check 3: Version in injector ────────────────────
echo ""
echo "Injector content:"
INJECTOR_BODY=$(curl -sL --max-time 10 "${INJECTOR_URL}" 2>/dev/null || echo "")
if echo "$INJECTOR_BODY" | grep -q "N8N Node Preview Injector"; then
  check_pass "Injector contains expected header"
else
  check_fail "Injector content missing expected header"
fi

if echo "$INJECTOR_BODY" | grep -q "VERSION = '${VERSION}'"; then
  check_pass "Version matches: v${VERSION}"
elif echo "$INJECTOR_BODY" | grep -q "VERSION = "; then
  FOUND_VER=$(echo "$INJECTOR_BODY" | grep "VERSION = " | head -1 | sed "s/.*VERSION = '\\([^']*\\)'.*/\\1/")
  check_warn "Version mismatch: found v${FOUND_VER}, expected v${VERSION}"
else
  check_fail "Version string not found in injector"
fi

# ─── Check 4: Script tag injected into HTML ──────────
echo ""
echo "HTML injection:"
N8N_HTML=$(curl -sL --max-time 10 "${N8N_URL}/" 2>/dev/null || echo "")
if echo "$N8N_HTML" | grep -q "n8n-preview/injector.js"; then
  check_pass "Script tag found in HTML"
else
  check_fail "Script tag NOT found in HTML (sub_filter not working)"
fi

if echo "$N8N_HTML" | grep -q "injector.js?v="; then
  CACHE_VER=$(echo "$N8N_HTML" | grep -o 'injector.js?v=[^"]*' | head -1 | sed 's/injector.js?v=//')
  if [[ "$CACHE_VER" == "$VERSION" ]]; then
    check_pass "Cache buster matches: ?v=${VERSION}"
  else
    check_warn "Cache buster mismatch: ?v=${CACHE_VER} (expected ${VERSION})"
  fi
else
  check_warn "No cache buster parameter found"
fi

# ─── Check 5: Nginx headers ─────────────────────────
echo ""
echo "Response headers:"
HEADERS=$(curl -sI --max-time 10 "${INJECTOR_URL}" 2>/dev/null || echo "")
if echo "$HEADERS" | grep -qi "X-N8N-Preview"; then
  check_pass "X-N8N-Preview header present"
else
  check_warn "X-N8N-Preview header missing"
fi

if echo "$HEADERS" | grep -qi "Cache-Control"; then
  check_pass "Cache-Control header present"
else
  check_warn "Cache-Control header missing"
fi

# ─── Summary ─────────────────────────────────────────
echo ""
echo "============================================="
echo -e "  Results: ${GREEN}${PASS} passed${NC}, ${RED}${FAIL} failed${NC}, ${YELLOW}${WARN} warnings${NC}"
echo "============================================="
echo ""

if [[ $FAIL -gt 0 ]]; then
  exit 1
fi
