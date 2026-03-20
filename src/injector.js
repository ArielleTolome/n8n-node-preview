/**
 * N8N Node Preview Injector v0.5.0
 * Adds live image & video previews directly onto N8N canvas nodes.
 * Injected via Nginx sub_filter into the N8N HTML page.
 *
 * @license MIT
 * @author Ariel Tolome
 */
(function () {
  'use strict';

  const VERSION = '0.5.0';
  const STORAGE_KEY = 'n8n-preview-settings';
  const STYLE_ID = 'n8n-preview-styles';
  const BADGE_ID = 'n8n-preview-badge';
  const TOGGLE_ID = 'n8n-preview-toggle';
  const SETTINGS_ID = 'n8n-preview-settings-panel';
  const LIGHTBOX_ID = 'n8n-preview-lightbox';
  const POLL_INTERVAL = 4000;
  const MAX_ITEMS_VISIBLE = 4;
  const VIDEO_INLINE_MAX_BYTES = 5 * 1024 * 1024;

  const isAlreadyLoaded = () => !!document.getElementById(STYLE_ID);
  if (isAlreadyLoaded()) return;

  console.log(`%c[N8N Preview] Injector v${VERSION} loaded`, 'color: #ff9800; font-weight: bold;');

  // ─── Settings ───────────────────────────────────────────
  const defaultSettings = {
    enabled: true,
    previewSize: 'medium',
    autoShow: true,
    showVideos: true,
  };

  let lastExecutionId = null;
  let settings = loadSettings();
  let previewsEnabled = settings.enabled !== false;
  const previewCache = new Map();

  function loadSettings() {
    try {
      return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch { return { ...defaultSettings }; }
  }

  function saveSettings(s) {
    settings = { ...settings, ...s };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  // ─── Size map ───────────────────────────────────────────
  const sizeMap = { small: 48, medium: 64, large: 96 };
  function getItemSize() { return sizeMap[settings.previewSize] || 64; }

  // ─── CSS ────────────────────────────────────────────────
  const injectStyles = () => {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        display: inline-flex; align-items: center; gap: 4px;
        padding: 4px 10px;
        background: linear-gradient(135deg, #ff9800, #ff5722);
        color: #fff; font-size: 11px; font-weight: 600;
        border-radius: 12px; cursor: default; user-select: none;
        white-space: nowrap; box-shadow: 0 1px 4px rgba(255,152,0,0.3);
        transition: opacity 0.3s; z-index: 9999; margin-left: 8px; line-height: 1;
      }
      #${BADGE_ID}:hover { opacity: 0.85; }

      .n8n-preview-fade-in { animation: n8nPreviewFadeIn 0.3s ease-out; }
      @keyframes n8nPreviewFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Toggle + Settings buttons */
      .n8n-preview-fab-group {
        position: fixed; bottom: 20px; right: 20px;
        display: flex; flex-direction: column-reverse; gap: 8px;
        z-index: 99999; align-items: center;
      }
      .n8n-preview-fab {
        width: 44px; height: 44px; border-radius: 50%; border: none;
        color: #fff; font-size: 20px; cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, opacity 0.2s; line-height: 1;
      }
      .n8n-preview-fab:hover { transform: scale(1.1); }
      .n8n-preview-fab-primary {
        background: linear-gradient(135deg, #ff9800, #ff5722);
      }
      .n8n-preview-fab-primary.disabled { background: #666; opacity: 0.7; }
      .n8n-preview-fab-secondary {
        width: 36px; height: 36px; font-size: 16px;
        background: #333; border: 1px solid #555;
      }
      .n8n-preview-fab-secondary:hover { background: #444; }

      /* Settings Panel */
      #${SETTINGS_ID} {
        position: fixed; bottom: 80px; right: 20px;
        width: 240px; background: #1e1e2e; border: 1px solid #333;
        border-radius: 12px; padding: 16px; z-index: 99998;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        font-family: system-ui, sans-serif; font-size: 12px; color: #ccc;
        display: none;
        animation: n8nPreviewFadeIn 0.2s ease-out;
      }
      #${SETTINGS_ID}.open { display: block; }
      .n8n-settings-title {
        font-size: 13px; font-weight: 600; color: #ff9800;
        margin-bottom: 12px; display: flex; align-items: center; gap: 6px;
      }
      .n8n-settings-row {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 0; border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .n8n-settings-row:last-child { border-bottom: none; }
      .n8n-settings-toggle {
        position: relative; width: 36px; height: 20px;
        background: #444; border-radius: 10px; cursor: pointer;
        border: none; padding: 0; transition: background 0.2s;
      }
      .n8n-settings-toggle.on { background: #ff9800; }
      .n8n-settings-toggle::after {
        content: ''; position: absolute; top: 2px; left: 2px;
        width: 16px; height: 16px; border-radius: 50%;
        background: #fff; transition: transform 0.2s;
      }
      .n8n-settings-toggle.on::after { transform: translateX(16px); }
      .n8n-settings-select {
        background: #333; color: #ccc; border: 1px solid #555;
        border-radius: 6px; padding: 3px 8px; font-size: 11px;
        cursor: pointer; outline: none;
      }
      .n8n-settings-btn {
        width: 100%; margin-top: 10px; padding: 6px 12px;
        background: #333; color: #ef5350; border: 1px solid #555;
        border-radius: 6px; cursor: pointer; font-size: 11px;
        transition: background 0.2s;
      }
      .n8n-settings-btn:hover { background: #444; }

      /* Preview container */
      .n8n-preview-container {
        display: flex; flex-wrap: nowrap; gap: 6px;
        padding: 6px 8px; margin-top: 4px;
        overflow-x: auto; overflow-y: hidden; max-width: 280px;
        scrollbar-width: thin; scrollbar-color: rgba(255,152,0,0.4) transparent;
        animation: n8nPreviewSlideIn 0.3s ease-out;
      }
      .n8n-preview-container::-webkit-scrollbar { height: 4px; }
      .n8n-preview-container::-webkit-scrollbar-thumb { background: rgba(255,152,0,0.4); border-radius: 2px; }
      @keyframes n8nPreviewSlideIn {
        from { opacity: 0; max-height: 0; }
        to { opacity: 1; max-height: 200px; }
      }

      .n8n-preview-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 2px 8px; font-size: 9px; color: #999;
        font-family: monospace; line-height: 1.4;
      }
      .n8n-preview-timestamp { opacity: 0.7; }
      .n8n-preview-output-label { color: #ff9800; font-weight: 600; }
      .n8n-preview-collapse {
        background: none; border: none; color: #666; cursor: pointer;
        font-size: 12px; padding: 0 2px; transition: color 0.2s;
      }
      .n8n-preview-collapse:hover { color: #ff9800; }

      .n8n-preview-item {
        position: relative; flex-shrink: 0;
        border-radius: 6px; overflow: hidden; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.1); background: #1a1a2e;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .n8n-preview-item:hover {
        transform: scale(1.08); box-shadow: 0 2px 8px rgba(255,152,0,0.3);
      }
      .n8n-preview-item img, .n8n-preview-item video {
        width: 100%; height: 100%; object-fit: cover; display: block;
      }

      .n8n-preview-overlay {
        position: absolute; bottom: 0; left: 0; right: 0;
        padding: 2px 4px; background: linear-gradient(transparent, rgba(0,0,0,0.7));
        color: #fff; font-size: 8px; text-align: center;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;
      }

      .n8n-preview-more {
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; border-radius: 6px;
        background: rgba(255,152,0,0.15); border: 1px dashed rgba(255,152,0,0.4);
        color: #ff9800; font-size: 11px; font-weight: 600; cursor: pointer;
      }
      .n8n-preview-more:hover { background: rgba(255,152,0,0.25); }

      .n8n-preview-video-play {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
        background: rgba(0,0,0,0.4); color: #fff; font-size: 22px;
        pointer-events: none; transition: background 0.15s;
      }
      .n8n-preview-item:hover .n8n-preview-video-play { background: rgba(0,0,0,0.2); }

      .n8n-preview-meta {
        position: absolute; top: 2px; left: 2px;
        padding: 1px 4px; background: rgba(0,0,0,0.6);
        color: #ff9800; font-size: 7px; font-weight: 600;
        border-radius: 3px; text-transform: uppercase; line-height: 1.3;
      }

      .n8n-preview-count-badge {
        position: absolute; top: -6px; right: -6px;
        min-width: 18px; height: 18px; padding: 0 5px;
        border-radius: 9px; background: #ff9800; color: #fff;
        font-size: 10px; font-weight: 700;
        display: none; align-items: center; justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3); z-index: 10;
        pointer-events: none; line-height: 1;
      }

      .n8n-preview-dismiss {
        background: none; border: none; color: #666; cursor: pointer;
        font-size: 14px; padding: 0 2px; margin-left: auto;
        transition: color 0.2s; line-height: 1;
      }
      .n8n-preview-dismiss:hover { color: #ef5350; }

      /* Execution running indicator */
      .n8n-preview-running {
        position: absolute; top: -4px; left: -4px;
        width: 10px; height: 10px; border-radius: 50%;
        background: #ff9800; z-index: 10;
        animation: n8nPreviewPulse 1.5s ease-in-out infinite;
      }
      @keyframes n8nPreviewPulse {
        0%, 100% { opacity: 1; transform: scale(1); }
        50% { opacity: 0.4; transform: scale(1.3); }
      }

      /* Lightbox */
      #${LIGHTBOX_ID} {
        display: none; position: fixed; inset: 0; z-index: 999999;
        background: rgba(0,0,0,0.85);
        align-items: center; justify-content: center;
        flex-direction: column; gap: 12px;
        animation: n8nPreviewFadeIn 0.2s ease-out;
      }
      #${LIGHTBOX_ID}.active { display: flex; }
      #${LIGHTBOX_ID} img, #${LIGHTBOX_ID} video {
        max-width: 90vw; max-height: 80vh;
        border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      .n8n-lightbox-info { color: #ccc; font-size: 13px; font-family: monospace; text-align: center; }
      .n8n-lightbox-close {
        position: absolute; top: 16px; right: 20px;
        color: #fff; font-size: 28px; cursor: pointer;
        opacity: 0.7; transition: opacity 0.2s;
        background: none; border: none; line-height: 1;
      }
      .n8n-lightbox-close:hover { opacity: 1; }
    `;
    document.head.appendChild(style);
  };

  // ─── Badge ──────────────────────────────────────────────
  const injectBadge = () => {
    const tryInsert = () => {
      if (document.getElementById(BADGE_ID)) return true;
      const sels = [
        'header .actions', '[class*="header"] [class*="actions"]',
        '[class*="header"] [class*="right"]', '.el-header', 'header',
        '[data-test-id="main-sidebar-toggle"]',
      ];
      for (const sel of sels) {
        const target = document.querySelector(sel);
        if (target) {
          const badge = document.createElement('span');
          badge.id = BADGE_ID; badge.className = 'n8n-preview-fade-in';
          badge.textContent = '\u2728 Preview Active';
          badge.title = `N8N Node Preview v${VERSION}`;
          if (sel.includes('sidebar')) target.parentElement?.insertBefore(badge, target.nextSibling);
          else target.appendChild(badge);
          return true;
        }
      }
      return false;
    };
    if (tryInsert()) return;
    const obs = new MutationObserver((_m, o) => { if (tryInsert()) o.disconnect(); });
    obs.observe(document.body, { childList: true, subtree: true });
    setTimeout(() => {
      obs.disconnect();
      if (!document.getElementById(BADGE_ID)) {
        const fb = document.createElement('div');
        fb.id = BADGE_ID; fb.className = 'n8n-preview-fade-in';
        fb.textContent = '\u2728 Preview Active'; fb.title = `N8N Node Preview v${VERSION}`;
        Object.assign(fb.style, { position: 'fixed', top: '10px', right: '10px', zIndex: '99999' });
        document.body.appendChild(fb);
      }
    }, 10000);
  };

  // ─── FAB Group (Toggle + Settings) ──────────────────────
  const injectFabGroup = () => {
    const group = document.createElement('div');
    group.className = 'n8n-preview-fab-group';

    // Main toggle
    const toggleBtn = document.createElement('button');
    toggleBtn.id = TOGGLE_ID;
    toggleBtn.className = 'n8n-preview-fab n8n-preview-fab-primary' + (previewsEnabled ? '' : ' disabled');
    toggleBtn.title = 'Toggle Previews (Ctrl+Shift+P)';
    toggleBtn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
    toggleBtn.addEventListener('click', () => {
      previewsEnabled = !previewsEnabled;
      toggleBtn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
      toggleBtn.className = 'n8n-preview-fab n8n-preview-fab-primary' + (previewsEnabled ? '' : ' disabled');
      saveSettings({ enabled: previewsEnabled });
      document.querySelectorAll('.n8n-preview-container, .n8n-preview-header').forEach(el => {
        el.style.display = previewsEnabled ? '' : 'none';
      });
      document.querySelectorAll('.n8n-preview-count-badge').forEach(el => {
        el.style.display = previewsEnabled ? 'none' : 'flex';
      });
    });
    group.appendChild(toggleBtn);

    // Settings gear
    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'n8n-preview-fab n8n-preview-fab-secondary';
    settingsBtn.title = 'Preview Settings';
    settingsBtn.textContent = '\u2699';
    settingsBtn.addEventListener('click', () => {
      const panel = document.getElementById(SETTINGS_ID);
      if (panel) panel.classList.toggle('open');
    });
    group.appendChild(settingsBtn);

    document.body.appendChild(group);

    // Ctrl+Shift+P
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') { e.preventDefault(); toggleBtn.click(); }
    });
  };

  // ─── Settings Panel ─────────────────────────────────────
  const injectSettingsPanel = () => {
    const panel = document.createElement('div');
    panel.id = SETTINGS_ID;

    const title = document.createElement('div');
    title.className = 'n8n-settings-title';
    title.textContent = '\u2699 Preview Settings';
    panel.appendChild(title);

    // Toggle: Auto-show on execution
    const autoRow = createSettingsRow('Auto-show on run', settings.autoShow, (val) => {
      saveSettings({ autoShow: val });
    });
    panel.appendChild(autoRow);

    // Toggle: Show videos
    const vidRow = createSettingsRow('Show video previews', settings.showVideos, (val) => {
      saveSettings({ showVideos: val });
    });
    panel.appendChild(vidRow);

    // Select: Preview size
    const sizeRow = document.createElement('div');
    sizeRow.className = 'n8n-settings-row';
    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = 'Preview size';
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'n8n-settings-select';
    for (const opt of ['small', 'medium', 'large']) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt;
      if (settings.previewSize === opt) o.selected = true;
      sizeSelect.appendChild(o);
    }
    sizeSelect.addEventListener('change', () => {
      saveSettings({ previewSize: sizeSelect.value });
      // Resize existing previews
      const sz = getItemSize();
      document.querySelectorAll('.n8n-preview-item').forEach(el => {
        el.style.width = sz + 'px'; el.style.height = sz + 'px';
      });
      document.querySelectorAll('.n8n-preview-more').forEach(el => {
        el.style.width = sz + 'px'; el.style.height = sz + 'px';
      });
    });
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(sizeSelect);
    panel.appendChild(sizeRow);

    // Clear all button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'n8n-settings-btn';
    clearBtn.textContent = 'Clear All Previews';
    clearBtn.addEventListener('click', () => {
      previewCache.clear();
      document.querySelectorAll('.n8n-preview-container, .n8n-preview-header, .n8n-preview-count-badge').forEach(el => el.remove());
    });
    panel.appendChild(clearBtn);

    document.body.appendChild(panel);
  };

  function createSettingsRow(label, value, onChange) {
    const row = document.createElement('div');
    row.className = 'n8n-settings-row';
    const lbl = document.createElement('span');
    lbl.textContent = label;
    const toggle = document.createElement('button');
    toggle.className = 'n8n-settings-toggle' + (value ? ' on' : '');
    toggle.addEventListener('click', () => {
      const newVal = !toggle.classList.contains('on');
      toggle.classList.toggle('on', newVal);
      onChange(newVal);
    });
    row.appendChild(lbl);
    row.appendChild(toggle);
    return row;
  }

  // ─── Lightbox ───────────────────────────────────────────
  const closeLightbox = () => {
    const lb = document.getElementById(LIGHTBOX_ID);
    if (!lb) return;
    lb.classList.remove('active');
    const c = lb.querySelector('.n8n-lightbox-content');
    while (c.firstChild) c.removeChild(c.firstChild);
  };

  const injectLightbox = () => {
    const lb = document.createElement('div');
    lb.id = LIGHTBOX_ID;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'n8n-lightbox-close'; closeBtn.textContent = '\u00D7';
    lb.appendChild(closeBtn);
    const content = document.createElement('div');
    content.className = 'n8n-lightbox-content'; lb.appendChild(content);
    const info = document.createElement('div');
    info.className = 'n8n-lightbox-info'; lb.appendChild(info);
    lb.addEventListener('click', (e) => {
      if (e.target === lb || e.target === closeBtn) closeLightbox();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
    document.body.appendChild(lb);
  };

  function openLightbox(src, mimeType, fileName) {
    const lb = document.getElementById(LIGHTBOX_ID);
    if (!lb) return;
    const content = lb.querySelector('.n8n-lightbox-content');
    const info = lb.querySelector('.n8n-lightbox-info');
    while (content.firstChild) content.removeChild(content.firstChild);
    if (mimeType.startsWith('image/')) {
      const img = document.createElement('img'); img.src = src; img.alt = fileName;
      content.appendChild(img);
    } else if (mimeType.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = src; video.controls = true; video.autoplay = true; video.loop = true;
      content.appendChild(video);
    }
    info.textContent = `${fileName} \u2022 ${(mimeType.split('/')[1] || '').toUpperCase()}`;
    lb.classList.add('active');
  }

  // ─── Helpers ────────────────────────────────────────────
  function findCanvasNode(nodeName) {
    for (const node of document.querySelectorAll('.vue-flow__node[data-id]')) {
      for (const sel of [
        '[data-test-id="canvas-node-name"]', '.node-name', '.node-label',
        '[class*="NodeName"]', '[class*="node-name"]', '[class*="nodeName"]',
      ]) {
        const el = node.querySelector(sel);
        if (el && el.textContent.trim() === nodeName) return node;
      }
    }
    return null;
  }

  function binaryUrl(id) {
    return `/rest/data/binary-data?id=${encodeURIComponent(id)}&action=view`;
  }

  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  function timeAgo(ts) {
    const d = Math.floor((Date.now() - ts) / 1000);
    if (d < 5) return 'just now';
    if (d < 60) return d + 's ago';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    return Math.floor(d / 86400) + 'd ago';
  }

  // ─── Preview Creation ───────────────────────────────────
  function createImagePreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';
    const img = document.createElement('img');
    img.src = binaryUrl(item.id); img.alt = item.fileName || 'preview'; img.loading = 'lazy';
    const ov = document.createElement('div');
    ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || (item.mimeType.split('/')[1] || '').toUpperCase();
    w.appendChild(img); w.appendChild(ov);
    w.addEventListener('click', (e) => {
      e.stopPropagation(); openLightbox(img.src, item.mimeType, item.fileName || 'image');
    });
    return w;
  }

  function createVideoPreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';
    const src = binaryUrl(item.id);
    const isSmall = !item.fileSize || item.fileSize < VIDEO_INLINE_MAX_BYTES;
    if (isSmall) {
      const v = document.createElement('video');
      v.src = src; v.muted = true; v.loop = true; v.playsInline = true; v.preload = 'metadata';
      w.addEventListener('mouseenter', () => v.play().catch(() => {}));
      w.addEventListener('mouseleave', () => { v.pause(); v.currentTime = 0; });
      w.appendChild(v);
    } else {
      w.style.background = '#0d0d1a';
      const p = document.createElement('div');
      p.className = 'n8n-preview-video-play'; p.textContent = '\u25B6';
      w.appendChild(p);
    }
    const ext = item.mimeType.split('/')[1] || 'video';
    const meta = document.createElement('div');
    meta.className = 'n8n-preview-meta';
    const szStr = item.fileSize ? formatSize(item.fileSize) : '';
    meta.textContent = szStr ? `${ext} \u2022 ${szStr}` : ext;
    w.appendChild(meta);
    const ov = document.createElement('div');
    ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || ext.toUpperCase();
    w.appendChild(ov);
    w.addEventListener('click', (e) => {
      e.stopPropagation(); openLightbox(src, item.mimeType, item.fileName || 'video');
    });
    return w;
  }

  // ─── Rendering ──────────────────────────────────────────
  function renderPreviewsOnNode(nodeName, binaryItems, timestamp) {
    if (!previewsEnabled && !settings.autoShow) return;
    const node = findCanvasNode(nodeName);
    if (!node) return;

    // Clean existing
    for (const sel of ['.n8n-preview-container', '.n8n-preview-header', '.n8n-preview-count-badge', '.n8n-preview-running']) {
      const el = node.querySelector(sel);
      if (el) el.remove();
    }

    let mediaItems = binaryItems.filter(b =>
      b.mimeType.startsWith('image/') || (settings.showVideos && b.mimeType.startsWith('video/'))
    );
    if (mediaItems.length === 0) return;

    // Header
    const header = document.createElement('div');
    header.className = 'n8n-preview-header';
    const tsEl = document.createElement('span');
    tsEl.className = 'n8n-preview-timestamp';
    tsEl.textContent = timestamp ? timeAgo(timestamp) : '';
    const countEl = document.createElement('span');
    countEl.className = 'n8n-preview-output-label';
    const ic = mediaItems.filter(b => b.mimeType.startsWith('image/')).length;
    const vc = mediaItems.filter(b => b.mimeType.startsWith('video/')).length;
    const parts = [];
    if (ic > 0) parts.push(ic + ' img');
    if (vc > 0) parts.push(vc + ' vid');
    countEl.textContent = parts.join(' \u2022 ');
    // Dismiss button
    const dismiss = document.createElement('button');
    dismiss.className = 'n8n-preview-dismiss';
    dismiss.textContent = '\u2715';
    dismiss.title = 'Dismiss preview';
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation();
      previewCache.delete(nodeName);
      for (const s of ['.n8n-preview-container', '.n8n-preview-header', '.n8n-preview-count-badge']) {
        const el = node.querySelector(s);
        if (el) el.remove();
      }
    });
    header.appendChild(tsEl);
    header.appendChild(countEl);
    header.appendChild(dismiss);

    // Gallery
    const container = document.createElement('div');
    container.className = 'n8n-preview-container n8n-preview-fade-in';
    const visible = mediaItems.slice(0, MAX_ITEMS_VISIBLE);
    const remaining = mediaItems.length - MAX_ITEMS_VISIBLE;
    const sz = getItemSize();

    for (const item of visible) {
      container.appendChild(
        item.mimeType.startsWith('video/') ? createVideoPreview(item) : createImagePreview(item)
      );
    }

    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'n8n-preview-more';
      more.style.width = sz + 'px'; more.style.height = sz + 'px';
      more.textContent = `+${remaining}`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = mediaItems[MAX_ITEMS_VISIBLE];
        if (next) openLightbox(binaryUrl(next.id), next.mimeType, next.fileName || 'media');
      });
      container.appendChild(more);
    }

    // Count badge (shown when previews hidden)
    const badge = document.createElement('div');
    badge.className = 'n8n-preview-count-badge';
    badge.textContent = String(mediaItems.length);
    badge.style.display = previewsEnabled ? 'none' : 'flex';

    node.style.position = node.style.position || 'relative';
    node.appendChild(badge);
    if (previewsEnabled) {
      node.appendChild(header);
      node.appendChild(container);
    }

    // Update timestamp
    const tsTimer = setInterval(() => {
      if (!document.contains(tsEl)) { clearInterval(tsTimer); return; }
      if (timestamp) tsEl.textContent = timeAgo(timestamp);
    }, 30000);
  }

  // ─── Execution Extraction ───────────────────────────────
  function extractBinaryFromExecution(executionData) {
    const nodeMap = new Map();
    try {
      const runData = executionData?.data?.resultData?.runData;
      if (!runData) return nodeMap;
      for (const [nodeName, runs] of Object.entries(runData)) {
        const binaries = [];
        for (const run of runs) {
          if (!run?.data?.main) continue;
          for (const og of run.data.main) {
            if (!Array.isArray(og)) continue;
            for (const item of og) {
              if (!item.binary) continue;
              for (const [_k, bd] of Object.entries(item.binary)) {
                if (bd.id && bd.mimeType) {
                  binaries.push({
                    id: bd.id, mimeType: bd.mimeType,
                    fileName: bd.fileName || '', fileSize: bd.fileSize || 0,
                  });
                }
              }
            }
          }
        }
        if (binaries.length > 0) nodeMap.set(nodeName, binaries);
      }
    } catch (err) { console.warn('[N8N Preview] Extraction error:', err); }
    return nodeMap;
  }

  function processExecution(executionData) {
    const nodeMap = extractBinaryFromExecution(executionData);
    if (nodeMap.size === 0) return;
    const ts = Date.now();
    for (const [nodeName, binaries] of nodeMap) {
      previewCache.set(nodeName, { items: binaries, timestamp: ts });
      renderPreviewsOnNode(nodeName, binaries, ts);
    }
    console.log(`[N8N Preview] Rendered previews for ${nodeMap.size} node(s)`);
  }

  // ─── Fetch Interceptor ──────────────────────────────────
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (url.includes('/rest/executions/') || (url.includes('/rest/workflows/') && url.includes('/run'))) {
        response.clone().json().then(data => {
          if (data?.data?.resultData?.runData) processExecution(data);
        }).catch(() => {});
      }
    } catch { /* never break fetch */ }
    return response;
  };

  // ─── Polling ────────────────────────────────────────────
  async function pollExecutions() {
    if (!previewsEnabled) return;
    try {
      const resp = await originalFetch('/rest/executions?limit=5&includeData=true', {
        credentials: 'include', headers: { 'Accept': 'application/json' },
      });
      if (!resp.ok) return;
      const body = await resp.json();
      for (const exec of (body?.data || [])) {
        if (!exec.id || exec.id === lastExecutionId) continue;
        if (exec.status !== 'success' && exec.finished !== true) continue;
        lastExecutionId = exec.id;
        processExecution(exec);
        break;
      }
    } catch (err) { console.warn('[N8N Preview] Poll error:', err.message); }
  }

  // ─── Canvas Watcher ─────────────────────────────────────
  function watchCanvasChanges() {
    const observer = new MutationObserver(() => {
      if (!previewsEnabled) return;
      for (const [nodeName, data] of previewCache) {
        const node = findCanvasNode(nodeName);
        if (node && !node.querySelector('.n8n-preview-container')) {
          renderPreviewsOnNode(nodeName, data.items, data.timestamp);
        }
      }
    });
    const start = () => {
      const canvas = document.querySelector('.vue-flow');
      if (canvas) { observer.observe(canvas, { childList: true, subtree: true }); return true; }
      return false;
    };
    if (!start()) {
      const wo = new MutationObserver((_m, o) => { if (start()) o.disconnect(); });
      wo.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => wo.disconnect(), 30000);
    }
  }

  // ─── Init ───────────────────────────────────────────────
  injectStyles();
  injectBadge();
  injectFabGroup();
  injectSettingsPanel();
  injectLightbox();
  watchCanvasChanges();
  setTimeout(() => { pollExecutions(); setInterval(pollExecutions, POLL_INTERVAL); }, 2000);

})();
