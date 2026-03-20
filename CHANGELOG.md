# Changelog — N8N Node Preview Injector

All notable changes to this project will be documented in this file.

## [3.0.0] — 2026-03-20

### Changed
- Bumped version to 3.0.0 (stable milestone)
- Updated file header comment to reflect full feature set

### Fixed
- Gallery escape key listener cleaned up on close (removeEventListener)
- Lightbox arrow key listener cleaned up on close (removeEventListener)
- Run timers cleared in `removeAllPreviews()`
- Gallery data cleared in `removeAllPreviews()`

---

## [2.9.0] — 2026-03-20

### Added
- **Lightbox arrow navigation**: left (‹) and right (›) buttons + keyboard ← →
- **Item counter** "3 / 8" displayed top-right of lightbox
- **Lightbox title bar**: filename | file size | MIME type
- **Image zoom**: click to toggle fit ↔ actual size; scroll wheel 0.5×–4×
- `lbItems` / `lbIdx` state for sequential lightbox browsing
- Arrow key listener removed on lightbox close

---

## [2.8.0] — 2026-03-20

### Added
- Grid layout override from Preview node `gridLayout` param
- Caption template rendering (`{{$index}}`, `{{$index+1}}`, `{{fileName}}`, `{{fileSize}}`, `{{mimeType}}`)
- `showDimensions` flag passed to `createImagePreview` to suppress dim label

---

## [2.7.0] — 2026-03-20

### Added
- **Live execution timer**: orange `⚙ Xs` badge above running nodes
- **Re-run Workflow button** (▶ in FAB): POSTs to `/rest/workflows/{id}/run`
- **Completion toast**: "✓ Done — X image(s) generated" after execution
- `runTimers` Map tracks per-node timers
- `showToast(msg)` helper with auto-dismiss after 3s

---

## [2.6.0] — 2026-03-20

### Added
- **Batch Download All** (⬇ All): appears when node has ≥2 binary items; staggers downloads 200ms apart
- **Gallery Panel** (🖼 FAB button): fullscreen overlay grouped by node, 200px thumbnails, hover to download
- Gallery updates automatically when new execution data arrives
- Keyboard shortcut: Ctrl+Shift+G

---

## [2.5.0] — Prior release

### Added
- 2-column image grid layout (`.n8n-preview-grid`)
- Pixel dimensions overlay on images (width×height bottom-left)
- Grid columns toggle in settings panel
- Execution history panel with compare mode
- WebSocket + polling hybrid for live updates
