# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-03-20

### Added
- **Wave 10 — Production Release**: Full deploy tooling, CI, and cross-cutting fixes
- `deploy.sh` for remote deployment via SSH/SCP with `--dry-run` support and timestamp cache buster
- `verify.sh` checks connectivity, injector endpoint, version, HTML injection, Nginx headers
- `.env.example` with all deployment variables documented
- Error node rendering: red error state with error message from execution data
- N8N API key fallback: prompts for API key on 401, stores in localStorage
- Multi-workflow: detects URL changes via pushState/popstate, clears previews on workflow switch
- Large execution cap: max 50 binary items per execution with truncation warning
- Dark/light theme adaptation: detects `data-theme` and body class, adjusts preview backgrounds
- Touch scrolling: `-webkit-overflow-scrolling: touch` on preview containers for tablet/mobile
- Execution sort: always sort by `startedAt` DESC to ensure most recent execution is processed first

### Changed
- All API calls now use centralized `apiRequest()` helper with auth fallback
- Cache buster now uses version string for cache invalidation
- Package.json scripts updated with `deploy` and `verify` commands

### Fixed
- Sub-workflow handling: error map for nodes that errored with no binary output
- Vue Flow re-render survival: executing rings re-applied after canvas mutations
- Workflow navigation: preview state properly cleared when switching workflows

## [1.3.0] - 2026-03-20

### Added
- **Wave 9 — Execution History Panel**: Side drawer with last 20 executions
- Click any execution to replay its previews on the canvas
- Compare mode: select 2 executions via checkboxes, split-screen overlay for visual diff
- Execution thumbnails in history rows (32px image strips)
- Real-time recording of new executions into history
- History FAB button + Ctrl+Shift+H keyboard shortcut

## [1.2.0] - 2026-03-20

### Added
- **Wave 8 — Advanced File Previews**: PDF, JSON, CSV, audio, and generic file previews
- PDF: pdf.js page 1 canvas rendering with page count, fallback to icon
- JSON: first 5 key:value pairs in monospace box, full view in lightbox
- CSV: mini 3-row table preview, full table in lightbox with row count
- Audio: animated waveform bars, inline player in lightbox
- Download button on all preview types (fetches binary, correct filename)
- Copy to clipboard on images (PNG conversion via canvas)
- File size label on all previews
- Generic file icon fallback for unsupported MIME types

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
[1.3.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.3.0
[1.2.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.2.0
[1.1.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.1.0
[1.0.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v1.0.0
[0.5.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.5.0
[0.4.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.4.0
[0.3.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.3.0
[0.2.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.2.0
[0.1.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.1.0
