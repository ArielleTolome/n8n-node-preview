/**
 * N8N Node Preview Injector v0.4.0
 * Adds live image & video previews directly onto N8N canvas nodes.
 * Injected via Nginx sub_filter into the N8N HTML page.
 *
 * @license MIT
 * @author Ariel Tolome
 */
(function () {
  'use strict';

  const VERSION = '0.4.0';
  const STORAGE_KEY = 'n8n-preview-settings';
  const STYLE_ID = 'n8n-preview-styles';
  const BADGE_ID = 'n8n-preview-badge';
  const TOGGLE_ID = 'n8n-preview-toggle';
  const LIGHTBOX_ID = 'n8n-preview-lightbox';
  const POLL_INTERVAL = 4000;
  const MAX_ITEMS_VISIBLE = 4;
  const VIDEO_INLINE_MAX_BYTES = 5 * 1024 * 1024;

  const isAlreadyLoaded = () => !!document.getElementById(STYLE_ID);
  if (isAlreadyLoaded()) return;

  console.log(`%c[N8N Preview] Injector v${VERSION} loaded`, 'color: #ff9800; font-weight: bold;');

  // ─── State ──────────────────────────────────────────────
  let lastExecutionId = null;
  let previewsEnabled = loadSettings().enabled !== false;
  /** @type {Map<string, {items: Array, timestamp: number}>} */
  const previewCache = new Map();

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { enabled: true }; }
    catch { return { enabled: true }; }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

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
        white-space: nowrap;
        box-shadow: 0 1px 4px rgba(255, 152, 0, 0.3);
        transition: opacity 0.3s ease;
        z-index: 9999; margin-left: 8px; line-height: 1;
      }
      #${BADGE_ID}:hover { opacity: 0.85; }

      .n8n-preview-fade-in { animation: n8nPreviewFadeIn 0.3s ease-out; }
      @keyframes n8nPreviewFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      #${TOGGLE_ID} {
        position: fixed; bottom: 20px; right: 20px;
        width: 44px; height: 44px; border-radius: 50%; border: none;
        background: linear-gradient(135deg, #ff9800, #ff5722);
        color: #fff; font-size: 20px; cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25); z-index: 99999;
        display: flex; align-items: center; justify-content: center;
        transition: transform 0.2s, opacity 0.2s; line-height: 1;
      }
      #${TOGGLE_ID}:hover { transform: scale(1.1); }
      #${TOGGLE_ID}.disabled { background: #666; opacity: 0.7; }

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

      .n8n-preview-item {
        position: relative; flex-shrink: 0; width: 64px; height: 64px;
        border-radius: 6px; overflow: hidden; cursor: pointer;
        border: 1px solid rgba(255,255,255,0.1); background: #1a1a2e;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .n8n-preview-item:hover {
        transform: scale(1.08);
        box-shadow: 0 2px 8px rgba(255,152,0,0.3);
      }
      .n8n-preview-item img, .n8n-preview-item video {
        width: 100%; height: 100%; object-fit: cover; display: block;
      }

      .n8n-preview-overlay {
        position: absolute; bottom: 0; left: 0; right: 0;
        padding: 2px 4px;
        background: linear-gradient(transparent, rgba(0,0,0,0.7));
        color: #fff; font-size: 8px; text-align: center;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; line-height: 1.2;
      }

      .n8n-preview-more {
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; width: 64px; height: 64px; border-radius: 6px;
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
      const selectors = [
        'header .actions', '[class*="header"] [class*="actions"]',
        '[class*="header"] [class*="right"]', '.el-header', 'header',
        '[data-test-id="main-sidebar-toggle"]',
      ];
      for (const sel of selectors) {
        const target = document.querySelector(sel);
        if (target) {
          const badge = document.createElement('span');
          badge.id = BADGE_ID;
          badge.className = 'n8n-preview-fade-in';
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

  // ─── Toggle ─────────────────────────────────────────────
  const injectToggle = () => {
    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.title = 'Toggle N8N Previews (Ctrl+Shift+P)';
    btn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
    btn.className = previewsEnabled ? '' : 'disabled';
    btn.addEventListener('click', () => {
      previewsEnabled = !previewsEnabled;
      btn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
      btn.className = previewsEnabled ? '' : 'disabled';
      saveSettings({ ...loadSettings(), enabled: previewsEnabled });
      document.querySelectorAll('.n8n-preview-container').forEach(el => {
        el.style.display = previewsEnabled ? 'flex' : 'none';
      });
      // Show/hide count badges when previews toggled off/on
      document.querySelectorAll('.n8n-preview-count-badge').forEach(el => {
        el.style.display = previewsEnabled ? 'none' : 'flex';
      });
    });
    document.body.appendChild(btn);
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') { e.preventDefault(); btn.click(); }
    });
  };

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
    closeBtn.className = 'n8n-lightbox-close';
    closeBtn.textContent = '\u00D7';
    lb.appendChild(closeBtn);
    const content = document.createElement('div');
    content.className = 'n8n-lightbox-content';
    lb.appendChild(content);
    const info = document.createElement('div');
    info.className = 'n8n-lightbox-info';
    lb.appendChild(info);
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
      const img = document.createElement('img');
      img.src = src; img.alt = fileName;
      content.appendChild(img);
    } else if (mimeType.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = src; video.controls = true; video.autoplay = true; video.loop = true;
      content.appendChild(video);
    }
    const ext = mimeType.split('/')[1] || '';
    info.textContent = `${fileName} \u2022 ${ext.toUpperCase()}`;
    lb.classList.add('active');
  }

  // ─── DOM Helpers ────────────────────────────────────────
  function findCanvasNode(nodeName) {
    const allNodes = document.querySelectorAll('.vue-flow__node[data-id]');
    for (const node of allNodes) {
      const sels = [
        '[data-test-id="canvas-node-name"]', '.node-name', '.node-label',
        '[class*="NodeName"]', '[class*="node-name"]', '[class*="nodeName"]',
      ];
      for (const sel of sels) {
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
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return diff + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  // ─── Preview Creation ───────────────────────────────────
  function createImagePreview(item) {
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    const img = document.createElement('img');
    img.src = binaryUrl(item.id); img.alt = item.fileName || 'preview'; img.loading = 'lazy';
    const ov = document.createElement('div');
    ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || (item.mimeType.split('/')[1] || '').toUpperCase();
    w.appendChild(img); w.appendChild(ov);
    w.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(img.src, item.mimeType, item.fileName || 'image');
    });
    return w;
  }

  function createVideoPreview(item) {
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    const src = binaryUrl(item.id);
    const isSmall = !item.fileSize || item.fileSize < VIDEO_INLINE_MAX_BYTES;
    if (isSmall) {
      const video = document.createElement('video');
      video.src = src; video.muted = true; video.loop = true;
      video.playsInline = true; video.preload = 'metadata';
      w.addEventListener('mouseenter', () => video.play().catch(() => {}));
      w.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
      w.appendChild(video);
    } else {
      w.style.background = '#0d0d1a';
      const play = document.createElement('div');
      play.className = 'n8n-preview-video-play';
      play.textContent = '\u25B6';
      w.appendChild(play);
    }
    const ext = item.mimeType.split('/')[1] || 'video';
    const meta = document.createElement('div');
    meta.className = 'n8n-preview-meta';
    const sz = item.fileSize ? formatSize(item.fileSize) : '';
    meta.textContent = sz ? `${ext} \u2022 ${sz}` : ext;
    w.appendChild(meta);
    const ov = document.createElement('div');
    ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || ext.toUpperCase();
    w.appendChild(ov);
    w.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(src, item.mimeType, item.fileName || 'video');
    });
    return w;
  }

  // ─── Rendering ──────────────────────────────────────────
  function renderPreviewsOnNode(nodeName, binaryItems, timestamp) {
    if (!previewsEnabled) return;
    const node = findCanvasNode(nodeName);
    if (!node) return;

    // Remove existing
    const existing = node.querySelector('.n8n-preview-container');
    if (existing) existing.remove();
    const existingBadge = node.querySelector('.n8n-preview-count-badge');
    if (existingBadge) existingBadge.remove();

    const mediaItems = binaryItems.filter(b =>
      b.mimeType.startsWith('image/') || b.mimeType.startsWith('video/')
    );
    if (mediaItems.length === 0) return;

    // Preview header with timestamp and count
    const header = document.createElement('div');
    header.className = 'n8n-preview-header';
    const tsEl = document.createElement('span');
    tsEl.className = 'n8n-preview-timestamp';
    tsEl.textContent = timestamp ? timeAgo(timestamp) : '';
    const countEl = document.createElement('span');
    countEl.className = 'n8n-preview-output-label';
    const imgCount = mediaItems.filter(b => b.mimeType.startsWith('image/')).length;
    const vidCount = mediaItems.filter(b => b.mimeType.startsWith('video/')).length;
    const parts = [];
    if (imgCount > 0) parts.push(imgCount + ' img');
    if (vidCount > 0) parts.push(vidCount + ' vid');
    countEl.textContent = parts.join(' \u2022 ');
    header.appendChild(tsEl);
    header.appendChild(countEl);

    // Gallery container
    const container = document.createElement('div');
    container.className = 'n8n-preview-container n8n-preview-fade-in';

    const visible = mediaItems.slice(0, MAX_ITEMS_VISIBLE);
    const remaining = mediaItems.length - MAX_ITEMS_VISIBLE;

    for (const item of visible) {
      container.appendChild(
        item.mimeType.startsWith('video/') ? createVideoPreview(item) : createImagePreview(item)
      );
    }

    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'n8n-preview-more';
      more.textContent = `+${remaining} more`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = mediaItems[MAX_ITEMS_VISIBLE];
        if (next) openLightbox(binaryUrl(next.id), next.mimeType, next.fileName || 'media');
      });
      container.appendChild(more);
    }

    // Count badge (shown when previews are hidden)
    const badge = document.createElement('div');
    badge.className = 'n8n-preview-count-badge';
    badge.textContent = String(mediaItems.length);
    badge.style.display = previewsEnabled ? 'none' : 'flex';

    node.style.position = node.style.position || 'relative';
    node.appendChild(badge);
    node.appendChild(header);
    node.appendChild(container);

    // Update timestamp periodically
    const tsInterval = setInterval(() => {
      if (!document.contains(tsEl)) { clearInterval(tsInterval); return; }
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
          const items = run?.data?.main;
          if (!items) continue;
          for (const og of items) {
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
  injectToggle();
  injectLightbox();
  watchCanvasChanges();
  setTimeout(() => { pollExecutions(); setInterval(pollExecutions, POLL_INTERVAL); }, 2000);

})();
