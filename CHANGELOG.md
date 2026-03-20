# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-03-20

### Added
- **Deploy tooling**: `deploy.sh` for remote deployment via SSH/SCP with `--dry-run` support
- **Verification**: `verify.sh` checks connectivity, injector endpoint, version, HTML injection, headers
- **Environment config**: `.env.example` with all deployment variables documented
- **CI/CD**: GitHub Actions workflow — auto-creates release with `dist/injector.min.js` on tag push
- **Security documentation**: CSP notes, XSS prevention details, same-origin WebSocket policy
- **Complete README**: architecture diagram, full feature list, troubleshooting guide, deploy docs

## [1.2.0] - 2026-03-20

### Added
- **Wave 8 — Advanced File Previews**: Enhanced file type detection and preview rendering
- Download button support for preview items
- File size display on all preview types
- Improved metadata badges with format and size info

## [1.1.0] - 2026-03-20

### Added
- **Wave 7 — Real-Time WebSocket**: Connect to N8N's `/push` WebSocket for instant previews
- `executionFinished` → fetch full execution and render previews immediately
- `nodeExecuteAfter` → per-node preview as soon as node completes
- `nodeExecuteBefore` / `workflowExecutingNode` → pulsing ring + spinner on executing nodes
- WebSocket reconnection with exponential backoff (max 5 retries)
- Automatic fallback to polling when WebSocket unavailable
- Connection status indicator in badge: green (WS live), yellow (polling)

## [1.0.0] - 2026-03-20

### Added
- **Wave 6 — Production Hardening**: Debounced MutationObserver (150ms), limit to last 3 executions in cache, retry failed image loads once with 1s delay, "Preview unavailable" error state, 8 selector fallbacks for N8N version compatibility, IntersectionObserver lazy loading setup

## [0.5.0] - 2026-03-20

### Added
- **Wave 5 — UX Polish**: Settings panel (⚙) with preview size sm/md/lg, auto-show toggle, video on/off, clear all button
- FAB button group (toggle + gear)
- Per-node dismiss (✕) button in preview header
- Ctrl+Shift+P keyboard shortcut to toggle all previews
- Escape key closes lightbox and settings panel
- Pulsing ring CSS for running nodes
- Count badge on nodes when previews are hidden
- Version display in settings panel

## [0.4.0] - 2026-03-20

### Added
- **Wave 4 — Smart Mapping**: Re-run detection (replace not duplicate), multiple binary output support with labels, "Last run: X ago" live timestamps, image/video count display in header, count badge when previews hidden, zero-output graceful handling

## [0.3.0] - 2026-03-20

### Added
- **Wave 3 — Video Support**: `video/*` MIME type detection, inline `<video>` for files under 5MB with hover-to-play, placeholder with play icon for large videos, format and size metadata badges, video lightbox with controls/autoplay/loop

## [0.2.0] - 2026-03-20

### Added
- **Wave 2 — Image Previews**: Fetch interceptor captures execution API responses, execution polling (4s interval), binary data extraction from `runData`, canvas node matching via 6 selector fallbacks, thumbnail gallery strip with "+N more" overflow, click-to-lightbox with fullscreen view, floating toggle button with localStorage persistence

## [0.1.0] - 2026-03-19

### Added
- **Wave 1 — Foundation**: Initial project scaffolding
- Nginx sub_filter injection config
- Nginx static location block for `/n8n-preview/`
- `injector.js` v0.1.0 — loader with "Preview Active" badge
- `install.sh` — automated installation
- `update.sh` — update injector without touching Nginx config
- MutationObserver-based toolbar detection with fixed-position fallback

[2.0.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v2.0.0
[1.2.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.2.0
[1.1.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.1.0
[1.0.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.0.0
[0.5.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.5.0
[0.4.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.4.0
[0.3.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.3.0
[0.2.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.2.0
[0.1.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.1.0
