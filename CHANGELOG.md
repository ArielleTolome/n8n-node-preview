# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-03-20

### Added

- **Wave 2 — Image Previews**: Fetch interception, execution polling (4s), binary extraction, canvas node matching, thumbnail gallery with "+N more", click-to-lightbox, floating toggle button with localStorage
- **Wave 3 — Video Support**: video/* detection, inline `<video>` for small files (<5MB) with hover-to-play, placeholder for large videos, video metadata badges, video lightbox playback
- **Wave 4 — Smart Mapping**: Re-run detection (replace not duplicate), multiple binary outputs with labels, "Last run: X ago" timestamps, image/video count display, count badge when hidden, zero-output handling
- **Wave 5 — UX Polish**: Settings panel (size sm/md/lg, auto-show, video toggle, clear all), slide-in/out animations, per-node collapse/dismiss controls, Ctrl+Shift+P shortcut, Escape closes modals, pulsing ring on executing nodes
- **Wave 6 — Production Hardening**: Debounced MutationObserver, limit to last 3 executions in memory, retry failed image loads once, "Preview unavailable" error state, 8 selector fallbacks for N8N version compatibility

## [0.1.0] - 2026-03-19

### Added

- Initial project scaffolding
- Nginx sub_filter injection config (injects `<script>` before `</head>`)
- Nginx static location block for serving `/n8n-preview/` assets
- `injector.js` v0.1.0 — loader with "Preview Active" badge in N8N toolbar
- `install.sh` — automated installation script
- `update.sh` — update injector without touching Nginx config
- MutationObserver-based toolbar detection with fixed-position fallback
- Fade-in animation for badge

[1.0.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.0.0
[0.1.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.1.0
