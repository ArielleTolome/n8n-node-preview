# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/ArielleTolome/n8n-node-preview/releases/tag/v0.1.0
