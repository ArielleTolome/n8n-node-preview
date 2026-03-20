# N8N Node Preview

Live image and video previews directly on N8N canvas nodes — like ComfyUI, but for N8N.

This tool uses Nginx `sub_filter` to inject a lightweight JavaScript file into N8N's HTML. The script watches for workflow executions, extracts binary image/video outputs, and renders preview thumbnails directly below each canvas node that produced them.

## What It Does

**Before:** You run a workflow with image outputs and have to click into each node to see results.

**After:** Thumbnails appear directly on the canvas nodes, showing you exactly what each node produced — images, videos, and more — without clicking anything.

## System Requirements

- **N8N** 2.x running in Docker (tested on 2.12.2)
- **Nginx** with `sub_filter` module enabled (standard in most installs)
- **RunCloud** Nginx setup (or any Nginx config that supports extra include dirs)
- Ubuntu/Debian server (install script assumes systemd)

## Installation

### Automated (Recommended)

```bash
git clone https://github.com/ArielleTolome/n8n-node-preview.git
cd n8n-node-preview
cp src/injector.js dist/injector.min.js
sudo bash install.sh
```

### Manual

1. Create the preview directory:

```bash
sudo mkdir -p /opt/n8n-preview
```

2. Copy the injector script:

```bash
sudo cp src/injector.js /opt/n8n-preview/injector.js
```

3. Copy Nginx configs to your extra.d directory:

```bash
# Static file serving (server-level)
sudo cp nginx/n8n-preview.location.main.conf \
  /etc/nginx-rc/extra.d/n8n-ai.location.main.n8n-preview.conf

# sub_filter injection (inside location / block)
sudo cp nginx/n8n-preview.sub-filter.location.root.conf \
  /etc/nginx-rc/extra.d/n8n-ai.location.root.n8n-preview.conf
```

4. Test and reload Nginx:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

5. Open N8N — you should see an orange "Preview Active" badge.

## Updating

### Using update.sh

```bash
cd n8n-node-preview
git pull
cp src/injector.js dist/injector.min.js
sudo bash update.sh
```

### Manual

```bash
sudo cp src/injector.js /opt/n8n-preview/injector.js
```

Hard-refresh your browser (Ctrl+Shift+R) to bypass the 1-minute cache.

## Uninstalling

```bash
# Remove Nginx configs
sudo rm /etc/nginx-rc/extra.d/n8n-ai.location.main.n8n-preview.conf
sudo rm /etc/nginx-rc/extra.d/n8n-ai.location.root.n8n-preview.conf

# Remove preview files
sudo rm -rf /opt/n8n-preview

# Reload Nginx
sudo nginx -t && sudo systemctl reload nginx
```

## How It Works

### Injection Pipeline

1. **Nginx sub_filter** intercepts the HTML response from N8N's proxy_pass
2. It injects a `<script>` tag before `</head>`, loading `/n8n-preview/injector.js`
3. A separate Nginx location block serves static files from `/opt/n8n-preview/`
4. The injector runs in the browser as a vanilla JS IIFE — no build step, no dependencies

### Why sub_filter?

N8N doesn't support custom plugins or script injection natively. The Nginx `sub_filter` directive lets us modify the HTML response on the fly, adding our script tag without touching N8N's Docker container or source code. This approach:

- Survives N8N updates (the container is untouched)
- Is easy to disable (remove the Nginx config and reload)
- Adds zero overhead to N8N itself
- Works with any N8N deployment behind Nginx

### Important: Accept-Encoding

The sub_filter config includes `proxy_set_header Accept-Encoding ""` — this tells Nginx to request uncompressed responses from N8N so the string replacement works. Nginx will still gzip the final response to the client.

## Configuration

Settings are stored in `localStorage` under the key `n8n-preview-settings`. In future versions, a settings panel will be available in the UI.

## Troubleshooting

### Badge doesn't appear

1. Check the browser console for `[N8N Preview] Injector loaded`
2. Verify the script is injected: View Page Source and search for `n8n-preview`
3. Check Nginx config: `sudo nginx -t`
4. Verify the file exists: `ls -la /opt/n8n-preview/injector.js`

### nginx -t fails

- Check that `sub_filter` module is loaded: `nginx -V 2>&1 | grep sub_filter`
- Ensure no duplicate `proxy_set_header Accept-Encoding` directives
- Check file permissions on the config files

### Script loads but badge is in wrong position

The badge tries multiple toolbar selectors. If N8N's UI has changed, it falls back to a fixed-position element in the top-right corner. This is expected on newer N8N versions.

### Cache issues

The script is served with a 1-minute cache. After updating, either:
- Wait 60 seconds, or
- Hard-refresh with Ctrl+Shift+R, or
- Update the `?v=` query parameter in the sub_filter config

## Contributing

1. Fork the repo
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Edit `src/injector.js` (no build step needed)
4. Test by copying to your N8N server
5. Submit a pull request

## License

MIT
