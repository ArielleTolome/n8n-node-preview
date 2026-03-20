# N8N Node Preview

Live image and video previews directly on N8N canvas nodes — like ComfyUI, but for N8N.

Injects a lightweight JavaScript file via Nginx `sub_filter` that watches executions, extracts binary outputs, and renders preview thumbnails directly on the canvas.

```
  ┌──────────────────────────────────────────────────────────────┐
  │  N8N Canvas                                                  │
  │                                                              │
  │  ┌─────────────┐     ┌─────────────┐     ┌──────────────┐   │
  │  │  HTTP Node   │────▶│  Edit Image  │────▶│  Save Image  │   │
  │  │             │     │             │     │              │   │
  │  │  ┌───┐      │     │  ┌───┬───┐  │     │  ┌───┐       │   │
  │  │  │ ▶ │      │     │  │img│img│  │     │  │ ✓ │       │   │
  │  │  └───┘      │     │  └───┴───┘  │     │  └───┘       │   │
  │  │  1 vid      │     │  2 img      │     │              │   │
  │  └─────────────┘     └─────────────┘     └──────────────┘   │
  │                                                              │
  │                          ┌───┐                               │
  │                          │ ⚙ │  Settings                     │
  │                          │ 👁 │  Toggle                      │
  │                          └───┘                               │
  └──────────────────────────────────────────────────────────────┘
```

## Features

### Previews
- **Image previews** — thumbnails on nodes with click-to-lightbox
- **Video previews** — inline playback on hover, fullscreen in lightbox
- **PDF previews** — pdf.js page 1 thumbnail with page count, open in new tab
- **JSON previews** — first 5 key:value snippet, full formatted view in lightbox
- **CSV previews** — 3-row mini table, full table in lightbox with row count
- **Audio previews** — animated waveform bars, inline player in lightbox
- **Generic files** — icon + extension label for any other MIME type
- **Download button** — on all preview types, correct filename
- **Copy to clipboard** — on images (PNG via canvas conversion)
- **File size labels** — shown on all preview items

### Real-Time
- **WebSocket** — instant previews via N8N's `/push` WebSocket
- **Polling fallback** — auto-fallback to 4s polling if WebSocket unavailable
- **Connection status** — green dot (WS live), yellow dot (polling), red dot (disconnected)
- **Running detection** — pulsing ring + spinner on executing nodes
- **Error nodes** — red error state with error message from execution data

### History & Compare
- **Execution history** — side drawer with last 20 executions, click to replay
- **Compare mode** — select 2 executions, split-screen visual diff
- **Thumbnail strips** — 32px image previews in history rows

### UX
- **Settings panel** — preview size (sm/md/lg), auto-show, video toggle, clear all
- **Per-node controls** — dismiss (✕) per preview
- **Keyboard shortcuts** — Ctrl+Shift+P toggle, Ctrl+Shift+H history, Escape close
- **Dark/light mode** — auto-detects N8N theme and adapts colors
- **Multi-workflow** — clears previews on workflow switch (pushState/popstate)
- **API key fallback** — prompts for key on 401, persists in localStorage

### Production
- **Deploy tooling** — `deploy.sh`, `verify.sh`, `.env.example`
- **Large execution cap** — max 50 binary items per execution
- **Debounced rendering** — MutationObserver with 150ms debounce
- **Zero dependencies** — pure vanilla JS IIFE, no build step

## Requirements

- **N8N** 2.x in Docker (tested 2.12.2)
- **Nginx** with `sub_filter` module
- **RunCloud** Nginx or any config with extra include dirs
- Ubuntu/Debian server with systemd

## Quick Start

```bash
git clone https://github.com/ArielleTolome/n8n-node-preview.git
cd n8n-node-preview
sudo bash install.sh
```

Open N8N — look for the orange "Preview Active" badge.

## Deploy to Remote Server

```bash
# Configure
cp .env.example .env
nano .env  # Set DEPLOY_HOST, N8N_URL, etc.

# Deploy
./deploy.sh

# Verify
./verify.sh
```

The deploy script:
1. Builds `dist/injector.min.js`
2. Uploads injector + Nginx configs via SCP
3. Updates `?v=` cache buster to current version
4. Runs `nginx -t && systemctl reload nginx`
5. Runs `verify.sh` to confirm everything works

Use `./deploy.sh --dry-run` to preview without making changes.

## Manual Installation

```bash
# 1. Create directory
sudo mkdir -p /opt/n8n-preview

# 2. Copy injector
sudo cp src/injector.js /opt/n8n-preview/injector.js

# 3. Copy Nginx configs
sudo cp nginx/n8n-preview.location.main.conf \
  /etc/nginx-rc/extra.d/n8n-ai.location.main.n8n-preview.conf

sudo cp nginx/n8n-preview.sub-filter.location.root.conf \
  /etc/nginx-rc/extra.d/n8n-ai.location.root.n8n-preview.conf

# 4. Test + reload
sudo nginx -t && sudo systemctl reload nginx
```

## Updating

```bash
cd n8n-node-preview
git pull
./deploy.sh
```

Or manually: `sudo cp src/injector.js /opt/n8n-preview/injector.js` then hard-refresh (Ctrl+Shift+R).

## Uninstalling

```bash
sudo rm /etc/nginx-rc/extra.d/n8n-ai.location.{main,root}.n8n-preview.conf
sudo rm -rf /opt/n8n-preview
sudo nginx -t && sudo systemctl reload nginx
```

## How It Works

```
Browser ← Nginx ← N8N Docker (:5678)
           │
           ├─ sub_filter: injects <script> before </head>
           ├─ location /n8n-preview/: serves injector.js
           │
           └─ injector.js (vanilla JS IIFE, ~2000 lines):
              │
              ├─ Data Sources
              │  ├─ WebSocket wss://<host>/push → instant execution events
              │  ├─ fetch() intercept → captures API responses passively
              │  └─ Polling fallback → GET /rest/executions (4s interval)
              │
              ├─ Processing
              │  ├─ Binary extraction → parses runData for image/video/pdf/json/csv/audio
              │  ├─ Error extraction → maps node errors from execution data
              │  ├─ Execution cap → max 50 binary items per execution
              │  └─ API key auth → X-N8N-API-KEY header on 401
              │
              ├─ Rendering
              │  ├─ Canvas matching → 8 selector fallbacks for N8N versions
              │  ├─ Preview types → image, video, PDF, JSON, CSV, audio, generic
              │  ├─ Actions → download, copy to clipboard, lightbox
              │  └─ Theme → auto dark/light mode detection
              │
              ├─ History
              │  ├─ Last 20 executions in side drawer
              │  ├─ Click to replay previews on canvas
              │  └─ Compare mode → split-screen visual diff
              │
              └─ Lifecycle
                 ├─ MutationObserver → debounced re-render on DOM changes
                 ├─ pushState/popstate → clear on workflow switch
                 └─ WS reconnect → exponential backoff, max 5 retries
```

### Why sub_filter?

N8N has no plugin system for script injection. Nginx `sub_filter` modifies the HTML response on the fly — no Docker changes, survives N8N updates, zero overhead, easy to disable.

The config includes `proxy_set_header Accept-Encoding ""` so Nginx can perform string replacement on uncompressed HTML. Nginx still gzips the response to clients.

## Settings

Click the ⚙ gear button (bottom-right) to open settings:

| Setting | Options | Default |
|---------|---------|---------|
| Preview Size | sm (48px), md (64px), lg (96px) | md |
| Auto-show | on/off | on |
| Videos | on/off | on |
| Clear All | button | — |

Settings persist in `localStorage["n8n-preview-settings"]`.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| Ctrl+Shift+P | Toggle all previews on/off |
| Ctrl+Shift+H | Toggle execution history panel |
| Escape | Close lightbox / settings / compare / history |

## Project Structure

```
n8n-node-preview/
├── src/
│   └── injector.js          # Main injector (vanilla JS IIFE)
├── dist/
│   └── injector.min.js      # Build artifact (cp of src)
├── nginx/
│   ├── n8n-preview.location.main.conf       # Static file serving
│   └── n8n-preview.sub-filter.location.root.conf  # Script injection
├── .github/workflows/
│   └── release.yml          # Auto-release on tag push
├── deploy.sh                # Remote deploy via SSH/SCP
├── verify.sh                # Deployment verification
├── install.sh               # Local server install
├── update.sh                # Update injector only
├── .env.example             # Deploy config template
├── package.json
├── CHANGELOG.md
└── README.md
```

## Troubleshooting

### Badge doesn't appear

1. Check console for `[N8N Preview] Injector loaded`
2. View Page Source → search for `n8n-preview`
3. Run `./verify.sh` to check all endpoints
4. Check `sudo nginx -t` for config errors
5. Verify file exists: `ls -la /opt/n8n-preview/injector.js`

### WebSocket not connecting

The injector connects to `wss://<host>/push`. If this fails, it falls back to polling. Check:
- WebSocket proxy is configured in Nginx (standard N8N setup includes this)
- Badge shows yellow dot (polling) vs green dot (WS live)

### Previews not showing

1. Execute a workflow that produces binary output (images/videos)
2. Check the console for `[N8N Preview] Rendered previews for N node(s)`
3. If polling: wait 4 seconds after execution completes
4. Verify the binary API: `curl <n8n-url>/rest/data/binary-data?id=<id>&action=view`

### nginx -t fails

- Check `sub_filter` module: `nginx -V 2>&1 | grep sub_filter`
- No duplicate `proxy_set_header Accept-Encoding` directives
- File permissions on config files

### Cache issues

Script is served with 1-minute cache. After updating:
- Hard-refresh: Ctrl+Shift+R
- Or update `?v=` in sub_filter config (deploy.sh does this automatically)

## Security Notes

- The injector runs in the same origin as N8N — it has access to the same cookies/session
- All HTML is built with `createElement` + `textContent` — no `innerHTML` with user data
- Binary URLs use `encodeURIComponent` for ID parameters
- The WebSocket connects to same-origin `/push` only
- PDF previews load pdf.js from `cdnjs.cloudflare.com` on demand — falls back to icon if blocked
- CSP: if you use Content-Security-Policy, add `script-src 'self' https://cdnjs.cloudflare.com` (for pdf.js) or disable PDF rendering

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Edit `src/injector.js` — no build step needed
4. Test by deploying to your N8N server
5. Submit a pull request

The code is a single vanilla JS IIFE. Keep it dependency-free.

## License

MIT
