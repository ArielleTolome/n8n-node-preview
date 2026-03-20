#!/usr/bin/env bash
# Extended waves runner — fires after base v1.0.0 is complete
set -e
cd ~/Projects/n8n-node-preview

claude --permission-mode bypassPermissions --print '
You are continuing work on "n8n-node-preview" — a Nginx sub_filter injector for live image/video previews on N8N canvas nodes. Base v1.0.0 is already built with 6 waves. Now build Waves 7-10 (v1.1.0 through v2.0.0), continuing WITHOUT losing any existing functionality.

The repo is at ~/Projects/n8n-node-preview. Read src/injector.js first to understand the current state, then build each wave on top of it.

---

## WAVE 7 — Real-Time WebSocket (v1.1.0)

Replace 4-second polling with N8N WebSocket push events as primary trigger (keep polling as fallback).

N8N push WebSocket URL: same origin, path /push (try both ws:// and wss://)
N8N push event format (JSON messages on the WS):
```json
{"type": "executionFinished", "data": {"executionId": "123", "status": "success"}}
{"type": "nodeExecuteAfter", "data": {"executionId": "123", "nodeName": "HTTP Request", "data": {...}}}
{"type": "workflowExecutingNode", "data": {"executionId": "123", "nodeName": "HTTP Request"}}
```

Implementation:
1. Try to connect to WebSocket at window.location.origin.replace("https://","wss://") + "/push"
2. On "executionFinished" → fetch full execution with includeData=true and process previews
3. On "nodeExecuteAfter" → if node has binary data in the event payload, inject preview immediately (before full execution completes) — this gives per-node real-time preview
4. On "workflowExecutingNode" → add a pulsing "running" ring to that node on canvas
5. On WS close/error → fall back to 4s polling automatically
6. Show WS connection status indicator in the badge (green dot = live, yellow = polling fallback)

Also add: per-node loading spinner WHILE the node is executing (appears on workflowExecutingNode, disappears when nodeExecuteAfter fires for that node)

Commit: "feat: Wave 7 — Real-time WebSocket push integration"
Release: v1.1.0 — "Real-Time WebSocket" — "Instant previews via N8N push events. Per-node live status. Polling fallback."

---

## WAVE 8 — Advanced File Previews (v1.2.0)

Expand preview support beyond images and video:

### PDF Preview
- Detect mimeType "application/pdf"
- Use PDF.js from CDN (https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js)
- Render first page as canvas thumbnail
- Show page count badge, "Open PDF" button that opens in new tab
- Fallback if pdf.js fails: show PDF icon + filename + size + download button

### JSON/XML/CSV Data Preview
- Detect "application/json", "text/xml", "text/csv"
- For JSON: fetch binary data, parse, show first 5 keys with values in a compact monospace box (truncated if large), "Expand" button to see full formatted JSON in a modal
- For CSV: show first 3 rows as a mini table, row count badge
- For XML: show first 500 chars, formatted

### Audio Preview
- Detect "audio/*"
- Show waveform visualization using Web Audio API (simple bar chart visualization, no external lib)
- Inline <audio> element with controls

### Universal Actions (ALL preview types)
- Download button (⬇) on every preview: fetches /rest/data/binary-data?id={id}&action=view and triggers browser download with correct filename
- Copy to clipboard button (📋) on images: uses navigator.clipboard.write with ClipboardItem
- File size shown on all previews (from binary metadata or fetched headers)
- Full filename shown in tooltip

Commit: "feat: Wave 8 — PDF, JSON, CSV, audio previews + download/copy"
Release: v1.2.0

---

## WAVE 9 — Execution History Panel (v1.3.0)

A slide-in side drawer for execution history:

### Trigger
- "📋 History" button in the floating controls (next to toggle and settings)
- Keyboard shortcut: Ctrl+Shift+H

### Panel UI (inject as fixed right-side drawer, 320px wide)
- Header: "Execution History" + close button
- List of last 20 executions fetched from GET /rest/executions?limit=20
- Each row shows:
  - Status icon (✅ success, ❌ error, ⏳ running)
  - Workflow name (from execution data)
  - Timestamp (relative: "2 min ago")
  - Thumbnail strip: tiny 32px thumbnails of all binary outputs from that execution
  - Click row → loads that executions previews onto the canvas (calls existing injectPreviews with that executions data)

### Compare Mode
- "Compare" toggle button in panel header
- When on: clicking two rows selects them (highlighted), then a "Compare ▶" button appears
- Compare view: opens a full-screen overlay split left/right
  - Left: execution A thumbnails labeled by node name
  - Right: execution B thumbnails labeled by node name
  - Easy to visually diff which nodes changed output

Commit: "feat: Wave 9 — Execution history panel + compare mode"
Release: v1.3.0

---

## WAVE 10 — Deploy Scripts + Verification + v2.0.0 (v2.0.0)

### deploy.sh
Full automated deploy script that:
1. Reads config from .env file (SERVER, SERVER_USER, N8N_NGINX_EXTRA_D, N8N_PREVIEW_DIR, APP_NAME)
2. SSHs to server using sshpass or SSH key
3. Creates /opt/n8n-preview/ if not exists
4. Copies src/injector.js to server as /opt/n8n-preview/injector.js
5. Copies nginx confs to /etc/nginx-rc/extra.d/ with correct names
6. Updates the ?v= cache buster in the sub_filter conf to current timestamp
7. Runs nginx -t to verify config
8. Reloads nginx
9. Runs verify step (curl the URL, check for script tag in response)
10. Prints: "✅ Deployed v{VERSION} to {SERVER}"

### .env.example
```
SERVER=135.181.57.124
SERVER_USER=root
N8N_NGINX_EXTRA_D=/etc/nginx-rc/extra.d
N8N_PREVIEW_DIR=/opt/n8n-preview
APP_NAME=n8n-ai
N8N_URL=https://n8n.pigeonfi.com
```

### verify.sh
```bash
#!/usr/bin/env bash
# Verify injection is live on server
N8N_URL="${1:-https://n8n.pigeonfi.com}"
echo "Checking $N8N_URL for injector script tag..."
RESPONSE=$(curl -sk "$N8N_URL")
if echo "$RESPONSE" | grep -q "n8n-preview/injector.js"; then
    echo "✅ Injection confirmed — injector.js is live"
else
    echo "❌ Injection NOT found in HTML response"
    echo "Check: nginx sub_filter config, nginx reload, Accept-Encoding header"
    exit 1
fi
echo "Checking /n8n-preview/injector.js accessibility..."
STATUS=$(curl -sk -o /dev/null -w "%{http_code}" "$N8N_URL/n8n-preview/injector.js")
if [ "$STATUS" = "200" ]; then
    echo "✅ injector.js accessible (HTTP 200)"
else
    echo "❌ injector.js returned HTTP $STATUS"
fi
```

### README final update
- Add "Quick Deploy" section at top with copy-paste commands
- Add architecture diagram (ASCII art showing Nginx → sub_filter → injector.js → N8N API → Canvas)
- Add full troubleshooting section with all known issues and fixes
- Add "All Features" section listing everything across all 10 waves
- Add screenshots section with placeholder descriptions

### Final release notes
Summarize ALL waves 1-10 in the v2.0.0 release notes.

Commit: "feat: Wave 10 — Deploy scripts, verify, v2.0.0 production"
Release: v2.0.0 (MAJOR) — full release notes covering all 10 waves

---

## CROSS-CUTTING GAPS TO FIX ACROSS ALL WAVES

While building each wave, also fix/add these if not already done:

1. **Vue Flow node re-render survival**: When user pans/zooms the canvas, Vue Flow may re-render nodes and detach injected DOM elements. Use MutationObserver on the .vue-flow__nodes container to detect node re-renders and re-inject previews for affected nodes.

2. **Canvas zoom scaling**: N8N canvas zoom (Ctrl+scroll) applies CSS transform: scale() to the flow. Our injected previews should NOT scale with this since they are inside the node. Verify the preview containers are inside .vue-flow__node (which auto-handles this).

3. **Dark/light mode**: N8N has dark mode toggle. Check document.body class or html[data-theme] attribute. Apply appropriate bg colors (dark: #1a1a2e, light: #f5f5f5) to preview containers.

4. **Sub-workflow execution nesting**: N8N sub-workflow runs create child executions. The parent execution might not include the child data. Handle by checking if runData is empty for some nodes and showing "Sub-workflow — check child execution" note.

5. **Execution pagination**: If the workflow has run >100 times, the first execution in list might not be the most recent. Always sort by startedAt DESC and take executions[0].

6. **Error node previews**: If a node errored, show a red error state preview (with the error message) instead of silently showing nothing.

7. **N8N API key auth fallback**: If cookie auth fails (401 on executions endpoint), show a one-time prompt to enter N8N API key (stored in localStorage["n8n-preview-apikey"]). Add header "X-N8N-API-KEY" to all API requests.

8. **Large execution data**: If execution has 100+ binary items, cap at 50 and show warning. Avoid downloading all binary data at once.

9. **Multiple workflows**: When user navigates between workflows in N8N, clear previews from the previous workflow and start fresh. Detect workflow change via URL change (pushstate/popstate).

10. **Mobile/tablet**: N8N can be used on tablet. Make preview containers touch-scrollable, tap-to-lightbox.

---

RULES (same as before):
- Pure vanilla JS, IIFE, no deps, all CSS in JS
- Idempotent, ES2020+, JSDoc
- Never break existing waves

When all 4 extended waves are done, run:
openclaw system event --text "Done: n8n-node-preview v2.0.0 all 10 waves complete — repo: https://github.com/ArielleTolome/n8n-node-preview" --mode now
'
