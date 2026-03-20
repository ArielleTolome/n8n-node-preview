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
  const VIDEO_INLINE_MAX_BYTES = 5 * 1024 * 1024; // 5MB — embed inline below this
  const SIZE_MAP = { sm: 48, md: 64, lg: 96 };

  /** @returns {boolean} True if injector already initialized */
  const isAlreadyLoaded = () => !!document.getElementById(STYLE_ID);

  if (isAlreadyLoaded()) return;

  console.log(`%c[N8N Preview] Injector v${VERSION} loaded`, 'color: #ff9800; font-weight: bold;');

  // ─── Default Settings ────────────────────────────────────
  const DEFAULT_SETTINGS = { enabled: true, size: 'md', autoShow: true, videoEnabled: true };

  // ─── State ──────────────────────────────────────────────
  let lastExecutionId = null;
  let settings = loadSettings();
  let previewsEnabled = settings.enabled !== false;
  /** @type {Map<string, {items: Array, timestamp: number}>} nodeName → preview data */
  const previewCache = new Map();
  /** @type {Set<string>} node names with collapsed previews */
  const collapsedNodes = new Set();

  /** @returns {object} */
  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  /** @param {object} s */
  function saveSettings(s) {
    settings = { ...settings, ...s };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  // ─── CSS Injection ──────────────────────────────────────
  const injectStyles = () => {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${BADGE_ID} {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        background: linear-gradient(135deg, #ff9800, #ff5722);
        color: #fff;
        font-size: 11px;
        font-weight: 600;
        border-radius: 12px;
        cursor: default;
        user-select: none;
        white-space: nowrap;
        box-shadow: 0 1px 4px rgba(255, 152, 0, 0.3);
        transition: opacity 0.3s ease;
        z-index: 9999;
        margin-left: 8px;
        line-height: 1;
      }
      #${BADGE_ID}:hover { opacity: 0.85; }

      .n8n-preview-fade-in {
        animation: n8nPreviewFadeIn 0.3s ease-out;
      }
      @keyframes n8nPreviewFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

      /* Toggle button */
      #${TOGGLE_ID} {
        position: fixed;
        bottom: 20px;
        right: 20px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        border: none;
        background: linear-gradient(135deg, #ff9800, #ff5722);
        color: #fff;
        font-size: 20px;
        cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25);
        z-index: 99999;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform 0.2s, opacity 0.2s;
        line-height: 1;
      }
      #${TOGGLE_ID}:hover { transform: scale(1.1); }
      #${TOGGLE_ID}.disabled {
        background: #666;
        opacity: 0.7;
      }

      /* Preview container on nodes */
      .n8n-preview-container {
        display: flex;
        flex-wrap: nowrap;
        gap: 6px;
        padding: 6px 8px;
        margin-top: 4px;
        overflow-x: auto;
        overflow-y: hidden;
        max-width: 280px;
        scrollbar-width: thin;
        scrollbar-color: rgba(255,152,0,0.4) transparent;
        animation: n8nPreviewSlideIn 0.3s ease-out;
      }
      .n8n-preview-container::-webkit-scrollbar {
        height: 4px;
      }
      .n8n-preview-container::-webkit-scrollbar-thumb {
        background: rgba(255,152,0,0.4);
        border-radius: 2px;
      }
      @keyframes n8nPreviewSlideIn {
        from { opacity: 0; max-height: 0; }
        to { opacity: 1; max-height: 200px; }
      }

      /* Individual preview item */
      .n8n-preview-item {
        position: relative;
        flex-shrink: 0;
        width: 64px;
        height: 64px;
        border-radius: 6px;
        overflow: hidden;
        cursor: pointer;
        border: 1px solid rgba(255,255,255,0.1);
        background: #1a1a2e;
        transition: transform 0.15s, box-shadow 0.15s;
      }
      .n8n-preview-item:hover {
        transform: scale(1.08);
        box-shadow: 0 2px 8px rgba(255,152,0,0.3);
      }
      .n8n-preview-item img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      /* Overlay label on preview item */
      .n8n-preview-overlay {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        padding: 2px 4px;
        background: linear-gradient(transparent, rgba(0,0,0,0.7));
        color: #fff;
        font-size: 8px;
        text-align: center;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1.2;
      }

      /* "+N more" badge */
      .n8n-preview-more {
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        width: 64px;
        height: 64px;
        border-radius: 6px;
        background: rgba(255,152,0,0.15);
        border: 1px dashed rgba(255,152,0,0.4);
        color: #ff9800;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .n8n-preview-more:hover {
        background: rgba(255,152,0,0.25);
      }

      /* Video preview item */
      .n8n-preview-item video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }
      .n8n-preview-video-play {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(0,0,0,0.4);
        color: #fff;
        font-size: 22px;
        pointer-events: none;
        transition: background 0.15s;
      }
      .n8n-preview-item:hover .n8n-preview-video-play {
        background: rgba(0,0,0,0.2);
      }
      .n8n-preview-meta {
        position: absolute;
        top: 2px;
        left: 2px;
        padding: 1px 4px;
        background: rgba(0,0,0,0.6);
        color: #ff9800;
        font-size: 7px;
        font-weight: 600;
        border-radius: 3px;
        text-transform: uppercase;
        line-height: 1.3;
      }

      /* Lightbox */
      #${LIGHTBOX_ID} {
        display: none;
        position: fixed;
        inset: 0;
        z-index: 999999;
        background: rgba(0,0,0,0.85);
        align-items: center;
        justify-content: center;
        flex-direction: column;
        gap: 12px;
        animation: n8nPreviewFadeIn 0.2s ease-out;
      }
      #${LIGHTBOX_ID}.active { display: flex; }
      #${LIGHTBOX_ID} img,
      #${LIGHTBOX_ID} video {
        max-width: 90vw;
        max-height: 80vh;
        border-radius: 8px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      .n8n-lightbox-info {
        color: #ccc;
        font-size: 13px;
        font-family: monospace;
        text-align: center;
      }
      .n8n-lightbox-close {
        position: absolute;
        top: 16px;
        right: 20px;
        color: #fff;
        font-size: 28px;
        cursor: pointer;
        opacity: 0.7;
        transition: opacity 0.2s;
        background: none;
        border: none;
        line-height: 1;
      }
      .n8n-lightbox-close:hover { opacity: 1; }

      /* Preview header bar (timestamp + count) */
      .n8n-preview-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 2px 8px;
        font-size: 9px;
        color: #999;
        font-family: monospace;
        line-height: 1.4;
      }
      .n8n-preview-timestamp {
        opacity: 0.7;
      }
      .n8n-preview-output-label {
        color: #ff9800;
        font-weight: 600;
      }

      /* Count badge on node when previews are hidden */
      .n8n-preview-count-badge {
        position: absolute;
        top: -6px;
        right: -6px;
        min-width: 18px;
        height: 18px;
        padding: 0 5px;
        border-radius: 9px;
        background: #ff9800;
        color: #fff;
        font-size: 10px;
        font-weight: 700;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 1px 4px rgba(0,0,0,0.3);
        z-index: 10;
        pointer-events: none;
        line-height: 1;
      }

      /* Per-node header controls */
      .n8n-preview-node-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .n8n-preview-ctrl-btn {
        background: none;
        border: none;
        color: #999;
        font-size: 12px;
        cursor: pointer;
        padding: 0 2px;
        line-height: 1;
        transition: color 0.15s;
      }
      .n8n-preview-ctrl-btn:hover { color: #ff9800; }

      /* Pulsing ring on running nodes */
      .n8n-preview-running {
        box-shadow: 0 0 0 0 rgba(255,152,0,0.6);
        animation: n8nPulse 1.5s ease-out infinite;
      }
      @keyframes n8nPulse {
        0% { box-shadow: 0 0 0 0 rgba(255,152,0,0.6); }
        70% { box-shadow: 0 0 0 8px rgba(255,152,0,0); }
        100% { box-shadow: 0 0 0 0 rgba(255,152,0,0); }
      }

      /* Slide-in/out for preview container */
      .n8n-preview-slide-out {
        animation: n8nPreviewSlideOut 0.2s ease-in forwards;
      }
      @keyframes n8nPreviewSlideOut {
        from { opacity: 1; max-height: 200px; }
        to { opacity: 0; max-height: 0; overflow: hidden; }
      }

      /* Settings panel */
      #${SETTINGS_ID} {
        display: none;
        position: fixed;
        bottom: 72px;
        right: 20px;
        width: 220px;
        background: #1e1e2e;
        border: 1px solid rgba(255,152,0,0.3);
        border-radius: 12px;
        padding: 14px;
        z-index: 99999;
        box-shadow: 0 4px 16px rgba(0,0,0,0.4);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #ccc;
        font-size: 12px;
      }
      #${SETTINGS_ID}.active { display: block; }
      .n8n-settings-title {
        font-weight: 700;
        font-size: 13px;
        color: #ff9800;
        margin-bottom: 10px;
      }
      .n8n-settings-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .n8n-settings-row label {
        font-size: 11px;
        color: #aaa;
      }
      .n8n-settings-select {
        background: #2a2a3e;
        color: #fff;
        border: 1px solid rgba(255,255,255,0.1);
        border-radius: 4px;
        padding: 2px 6px;
        font-size: 11px;
        cursor: pointer;
      }
      .n8n-settings-toggle {
        width: 32px;
        height: 18px;
        border-radius: 9px;
        background: #444;
        border: none;
        cursor: pointer;
        position: relative;
        transition: background 0.2s;
      }
      .n8n-settings-toggle.on { background: #ff9800; }
      .n8n-settings-toggle::after {
        content: '';
        position: absolute;
        top: 2px;
        left: 2px;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #fff;
        transition: transform 0.2s;
      }
      .n8n-settings-toggle.on::after { transform: translateX(14px); }
      .n8n-settings-btn {
        width: 100%;
        padding: 6px;
        margin-top: 6px;
        background: rgba(255,152,0,0.15);
        border: 1px solid rgba(255,152,0,0.3);
        border-radius: 6px;
        color: #ff9800;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: background 0.15s;
      }
      .n8n-settings-btn:hover { background: rgba(255,152,0,0.25); }
    `;
    document.head.appendChild(style);
  };

  // ─── Toolbar Badge ──────────────────────────────────────
  const injectBadge = () => {
    const tryInsert = () => {
      if (document.getElementById(BADGE_ID)) return true;
      const selectors = [
        'header .actions',
        '[class*="header"] [class*="actions"]',
        '[class*="header"] [class*="right"]',
        '.el-header',
        'header',
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
          if (sel.includes('sidebar')) {
            target.parentElement?.insertBefore(badge, target.nextSibling);
          } else {
            target.appendChild(badge);
          }
          return true;
        }
      }
      return false;
    };

    if (tryInsert()) return;

    const observer = new MutationObserver((_mutations, obs) => {
      if (tryInsert()) obs.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      observer.disconnect();
      if (!document.getElementById(BADGE_ID)) {
        const fallback = document.createElement('div');
        fallback.id = BADGE_ID;
        fallback.className = 'n8n-preview-fade-in';
        fallback.textContent = '\u2728 Preview Active';
        fallback.title = `N8N Node Preview v${VERSION}`;
        Object.assign(fallback.style, { position: 'fixed', top: '10px', right: '10px', zIndex: '99999' });
        document.body.appendChild(fallback);
      }
    }, 10000);
  };

  // ─── Toggle Button + Settings Gear ──────────────────────
  const injectToggle = () => {
    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.title = 'Toggle N8N Previews (Ctrl+Shift+P)';
    btn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
    btn.className = previewsEnabled ? '' : 'disabled';
    btn.addEventListener('click', () => togglePreviews());
    document.body.appendChild(btn);

    // Settings gear button (positioned above toggle)
    const gear = document.createElement('button');
    Object.assign(gear.style, {
      position: 'fixed', bottom: '72px', right: '20px',
      width: '32px', height: '32px', borderRadius: '50%', border: 'none',
      background: '#333', color: '#ccc', fontSize: '16px', cursor: 'pointer',
      boxShadow: '0 1px 4px rgba(0,0,0,0.3)', zIndex: '99999',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      transition: 'transform 0.2s',
    });
    gear.textContent = '\u2699';
    gear.title = 'Preview Settings';
    gear.addEventListener('mouseenter', () => { gear.style.transform = 'rotate(30deg)'; });
    gear.addEventListener('mouseleave', () => { gear.style.transform = ''; });
    gear.addEventListener('click', () => {
      const panel = document.getElementById(SETTINGS_ID);
      if (panel) panel.classList.toggle('active');
    });
    document.body.appendChild(gear);
  };

  /** Toggles all previews on/off */
  function togglePreviews() {
    previewsEnabled = !previewsEnabled;
    const btn = document.getElementById(TOGGLE_ID);
    if (btn) {
      btn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
      btn.className = previewsEnabled ? '' : 'disabled';
    }
    saveSettings({ enabled: previewsEnabled });
    toggleAllPreviews(previewsEnabled);
  }

  /** @param {boolean} show */
  function toggleAllPreviews(show) {
    document.querySelectorAll('.n8n-preview-container').forEach(el => {
      if (show) {
        el.classList.remove('n8n-preview-slide-out');
        el.style.display = '';
      } else {
        el.classList.add('n8n-preview-slide-out');
        setTimeout(() => { el.style.display = 'none'; }, 200);
      }
    });
    for (const [nodeName, data] of previewCache) {
      const node = findCanvasNode(nodeName);
      if (node) {
        const mediaCount = data.items.filter(b =>
          b.mimeType.startsWith('image/') || b.mimeType.startsWith('video/')
        ).length;
        updateCountBadge(node, mediaCount);
      }
    }
  }

  // ─── Lightbox ───────────────────────────────────────────
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
      if (e.target === lb || e.target === closeBtn) {
        lb.classList.remove('active');
        const contentEl = lb.querySelector('.n8n-lightbox-content');
        while (contentEl.firstChild) contentEl.removeChild(contentEl.firstChild);
      }
    });
    document.body.appendChild(lb);
  };

  /**
   * Opens lightbox with an image or video.
   * @param {string} src - Binary data URL
   * @param {string} mimeType - MIME type
   * @param {string} fileName - File name to display
   */
  function openLightbox(src, mimeType, fileName) {
    const lb = document.getElementById(LIGHTBOX_ID);
    if (!lb) return;
    const content = lb.querySelector('.n8n-lightbox-content');
    const info = lb.querySelector('.n8n-lightbox-info');

    while (content.firstChild) content.removeChild(content.firstChild);

    if (mimeType.startsWith('image/')) {
      const img = document.createElement('img');
      img.src = src;
      img.alt = fileName;
      content.appendChild(img);
    } else if (mimeType.startsWith('video/')) {
      const video = document.createElement('video');
      video.src = src;
      video.controls = true;
      video.autoplay = true;
      video.loop = true;
      content.appendChild(video);
    }

    const ext = mimeType.split('/')[1] || '';
    info.textContent = `${fileName} \u2022 ${ext.toUpperCase()}`;
    lb.classList.add('active');
  }

  // ─── Settings Panel ──────────────────────────────────────

  /**
   * Creates and injects the settings panel with size, auto-show, video toggle, and clear controls.
   */
  const injectSettingsPanel = () => {
    const panel = document.createElement('div');
    panel.id = SETTINGS_ID;

    const title = document.createElement('div');
    title.className = 'n8n-settings-title';
    title.textContent = 'Preview Settings';
    panel.appendChild(title);

    // Preview size
    const sizeRow = document.createElement('div');
    sizeRow.className = 'n8n-settings-row';
    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Preview Size';
    sizeRow.appendChild(sizeLabel);
    const sizeSelect = document.createElement('select');
    sizeSelect.className = 'n8n-settings-select';
    for (const s of ['sm', 'md', 'lg']) {
      const opt = document.createElement('option');
      opt.value = s;
      opt.textContent = s.toUpperCase();
      if (settings.size === s) opt.selected = true;
      sizeSelect.appendChild(opt);
    }
    sizeSelect.addEventListener('change', () => {
      saveSettings({ size: sizeSelect.value });
      applyPreviewSize(sizeSelect.value);
    });
    sizeRow.appendChild(sizeSelect);
    panel.appendChild(sizeRow);

    // Auto-show toggle
    panel.appendChild(createToggleRow('Auto-show', settings.autoShow, (val) => {
      saveSettings({ autoShow: val });
    }));

    // Video toggle
    panel.appendChild(createToggleRow('Videos', settings.videoEnabled, (val) => {
      saveSettings({ videoEnabled: val });
      reRenderAll();
    }));

    // Clear all button
    const clearBtn = document.createElement('button');
    clearBtn.className = 'n8n-settings-btn';
    clearBtn.textContent = 'Clear All Previews';
    clearBtn.addEventListener('click', () => {
      previewCache.clear();
      collapsedNodes.clear();
      document.querySelectorAll('.n8n-preview-container, .n8n-preview-count-badge').forEach(el => el.remove());
    });
    panel.appendChild(clearBtn);

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (panel.classList.contains('active') && !panel.contains(e.target) &&
          !e.target.textContent?.includes('\u2699')) {
        panel.classList.remove('active');
      }
    });

    document.body.appendChild(panel);
  };

  /**
   * Creates a toggle row for the settings panel.
   * @param {string} label
   * @param {boolean} initialValue
   * @param {function} onChange
   * @returns {HTMLElement}
   */
  function createToggleRow(label, initialValue, onChange) {
    const row = document.createElement('div');
    row.className = 'n8n-settings-row';
    const lbl = document.createElement('label');
    lbl.textContent = label;
    row.appendChild(lbl);
    const toggle = document.createElement('button');
    toggle.className = 'n8n-settings-toggle' + (initialValue ? ' on' : '');
    toggle.addEventListener('click', () => {
      const newVal = !toggle.classList.contains('on');
      toggle.classList.toggle('on');
      onChange(newVal);
    });
    row.appendChild(toggle);
    return row;
  }

  /**
   * Applies preview thumbnail size to all existing preview items.
   * @param {string} size - 'sm' | 'md' | 'lg'
   */
  function applyPreviewSize(size) {
    const px = SIZE_MAP[size] || SIZE_MAP.md;
    document.querySelectorAll('.n8n-preview-item, .n8n-preview-more').forEach(el => {
      el.style.width = px + 'px';
      el.style.height = px + 'px';
    });
  }

  /** Re-renders all cached previews (e.g. after settings change). */
  function reRenderAll() {
    for (const [nodeName, data] of previewCache) {
      renderPreviewsOnNode(nodeName, data.items);
    }
  }

  // ─── Keyboard Shortcut ──────────────────────────────────

  document.addEventListener('keydown', (e) => {
    // Ctrl+Shift+P to toggle all previews
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyP') {
      e.preventDefault();
      togglePreviews();
    }
    // Escape to close lightbox
    if (e.code === 'Escape') {
      const lb = document.getElementById(LIGHTBOX_ID);
      if (lb?.classList.contains('active')) {
        lb.classList.remove('active');
        const content = lb.querySelector('.n8n-lightbox-content');
        while (content?.firstChild) content.removeChild(content.firstChild);
      }
      const sp = document.getElementById(SETTINGS_ID);
      if (sp?.classList.contains('active')) sp.classList.remove('active');
    }
  });

  // ─── Running Node Detection ─────────────────────────────

  /**
   * Watches for running workflow executions and adds pulsing ring to active nodes.
   */
  function watchRunningNodes() {
    const checkRunning = () => {
      // N8N adds data attributes/classes to running nodes
      const allNodes = document.querySelectorAll('.vue-flow__node[data-id]');
      for (const node of allNodes) {
        const isRunning = node.classList.contains('executing') ||
                          node.querySelector('[class*="running"]') ||
                          node.querySelector('[class*="executing"]') ||
                          node.querySelector('.spinner');
        if (isRunning) {
          node.classList.add('n8n-preview-running');
        } else {
          node.classList.remove('n8n-preview-running');
        }
      }
    };
    setInterval(checkRunning, 1000);
  }

  // ─── DOM Node Finders ───────────────────────────────────

  /**
   * Finds a canvas node element by its workflow node name.
   * Tries multiple selectors for N8N 2.x compatibility.
   * @param {string} nodeName
   * @returns {Element|null}
   */
  function findCanvasNode(nodeName) {
    const allNodes = document.querySelectorAll('.vue-flow__node[data-id]');
    for (const node of allNodes) {
      const nameSelectors = [
        '[data-test-id="canvas-node-name"]',
        '.node-name',
        '.node-label',
        '[class*="NodeName"]',
        '[class*="node-name"]',
        '[class*="nodeName"]',
      ];
      for (const sel of nameSelectors) {
        const nameEl = node.querySelector(sel);
        if (nameEl && nameEl.textContent.trim() === nodeName) {
          return node;
        }
      }
    }
    return null;
  }

  // ─── Preview Rendering ──────────────────────────────────

  /**
   * Formats byte size to human-readable string.
   * @param {number} bytes
   * @returns {string}
   */
  function formatSize(bytes) {
    if (!bytes || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /**
   * Returns a human-readable "X ago" string from a timestamp.
   * @param {number} ts - Unix millisecond timestamp
   * @returns {string}
   */
  function timeAgo(ts) {
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  }

  /**
   * Builds the binary data URL for a given item.
   * @param {string} id
   * @returns {string}
   */
  function binaryUrl(id) {
    return `/rest/data/binary-data?id=${encodeURIComponent(id)}&action=view`;
  }

  /**
   * Creates a preview element for an image item.
   * @param {{id: string, mimeType: string, fileName: string, fileSize?: number}} item
   * @returns {HTMLElement}
   */
  function createImagePreview(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'n8n-preview-item';

    const img = document.createElement('img');
    img.src = binaryUrl(item.id);
    img.alt = item.fileName || 'preview';
    img.loading = 'lazy';

    const overlay = document.createElement('div');
    overlay.className = 'n8n-preview-overlay';
    const ext = item.mimeType.split('/')[1] || '';
    overlay.textContent = item.fileName || ext.toUpperCase();

    wrapper.appendChild(img);
    wrapper.appendChild(overlay);

    wrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(img.src, item.mimeType, item.fileName || 'image');
    });

    return wrapper;
  }

  /**
   * Creates a preview element for a video item.
   * For small videos (<5MB): inline muted video.
   * For large videos: placeholder with play button overlay.
   * @param {{id: string, mimeType: string, fileName: string, fileSize?: number}} item
   * @returns {HTMLElement}
   */
  function createVideoPreview(item) {
    const wrapper = document.createElement('div');
    wrapper.className = 'n8n-preview-item';
    const src = binaryUrl(item.id);
    const isSmall = !item.fileSize || item.fileSize < VIDEO_INLINE_MAX_BYTES;

    if (isSmall) {
      const video = document.createElement('video');
      video.src = src;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = 'metadata';
      // Auto-play on hover
      wrapper.addEventListener('mouseenter', () => video.play().catch(() => {}));
      wrapper.addEventListener('mouseleave', () => { video.pause(); video.currentTime = 0; });
      wrapper.appendChild(video);
    } else {
      // Large video — show placeholder with play icon
      wrapper.style.background = '#0d0d1a';
      const playOverlay = document.createElement('div');
      playOverlay.className = 'n8n-preview-video-play';
      playOverlay.textContent = '\u25B6';
      wrapper.appendChild(playOverlay);
    }

    // Format/size metadata badge
    const ext = item.mimeType.split('/')[1] || 'video';
    const meta = document.createElement('div');
    meta.className = 'n8n-preview-meta';
    const sizeStr = item.fileSize ? formatSize(item.fileSize) : '';
    meta.textContent = sizeStr ? `${ext} \u2022 ${sizeStr}` : ext;
    wrapper.appendChild(meta);

    // Overlay with filename
    const overlay = document.createElement('div');
    overlay.className = 'n8n-preview-overlay';
    overlay.textContent = item.fileName || ext.toUpperCase();
    wrapper.appendChild(overlay);

    wrapper.addEventListener('click', (e) => {
      e.stopPropagation();
      openLightbox(src, item.mimeType, item.fileName || 'video');
    });

    return wrapper;
  }

  /**
   * Updates or creates a count badge on a node showing how many previews are available.
   * Shown when previews are hidden.
   * @param {Element} node - Canvas node element
   * @param {number} count - Number of media items
   */
  function updateCountBadge(node, count) {
    let badge = node.querySelector('.n8n-preview-count-badge');
    if (previewsEnabled) {
      if (badge) badge.remove();
      return;
    }
    if (count === 0) {
      if (badge) badge.remove();
      return;
    }
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'n8n-preview-count-badge';
      node.style.position = node.style.position || 'relative';
      node.appendChild(badge);
    }
    badge.textContent = String(count);
  }

  /**
   * Renders preview thumbnails onto a canvas node.
   * Handles both image/* and video/* binary items.
   * Includes timestamp header and output count labels.
   * @param {string} nodeName - Workflow node name
   * @param {Array<{id: string, mimeType: string, fileName: string, fileSize?: number, outputKey?: string}>} binaryItems
   */
  function renderPreviewsOnNode(nodeName, binaryItems) {
    const node = findCanvasNode(nodeName);
    if (!node) return;

    // Remove existing preview for this node
    const existing = node.querySelector('.n8n-preview-container');
    if (existing) existing.remove();

    const mediaItems = binaryItems.filter(b =>
      b.mimeType.startsWith('image/') || b.mimeType.startsWith('video/')
    );

    // Update count badge (visible when previews hidden, hidden when shown)
    updateCountBadge(node, mediaItems.length);

    if (mediaItems.length === 0 || !previewsEnabled) return;

    const container = document.createElement('div');
    container.className = 'n8n-preview-container n8n-preview-fade-in';

    // Filter out videos if disabled in settings
    const filteredItems = settings.videoEnabled
      ? mediaItems
      : mediaItems.filter(b => !b.mimeType.startsWith('video/'));
    if (filteredItems.length === 0) return;

    // Check if this node is collapsed
    if (collapsedNodes.has(nodeName)) {
      updateCountBadge(node, filteredItems.length);
      return;
    }

    // Header with timestamp, output count, and controls
    const cached = previewCache.get(nodeName);
    const header = document.createElement('div');
    header.className = 'n8n-preview-header';

    const tsSpan = document.createElement('span');
    tsSpan.className = 'n8n-preview-timestamp';
    tsSpan.textContent = cached ? `Last run: ${timeAgo(cached.timestamp)}` : '';
    header.appendChild(tsSpan);

    const rightControls = document.createElement('div');
    rightControls.className = 'n8n-preview-node-controls';

    const countSpan = document.createElement('span');
    countSpan.className = 'n8n-preview-output-label';
    const imgCount = filteredItems.filter(b => b.mimeType.startsWith('image/')).length;
    const vidCount = filteredItems.filter(b => b.mimeType.startsWith('video/')).length;
    const countParts = [];
    if (imgCount > 0) countParts.push(`${imgCount} img`);
    if (vidCount > 0) countParts.push(`${vidCount} vid`);
    countSpan.textContent = countParts.join(' \u2022 ');
    rightControls.appendChild(countSpan);

    // Collapse button
    const collapseBtn = document.createElement('button');
    collapseBtn.className = 'n8n-preview-ctrl-btn';
    collapseBtn.textContent = '\u203A'; // ›
    collapseBtn.title = 'Collapse';
    collapseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      collapsedNodes.add(nodeName);
      renderPreviewsOnNode(nodeName, binaryItems);
    });
    rightControls.appendChild(collapseBtn);

    // Dismiss button
    const dismissBtn = document.createElement('button');
    dismissBtn.className = 'n8n-preview-ctrl-btn';
    dismissBtn.textContent = '\u2715'; // ✕
    dismissBtn.title = 'Dismiss';
    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.add('n8n-preview-slide-out');
      setTimeout(() => container.remove(), 200);
      previewCache.delete(nodeName);
    });
    rightControls.appendChild(dismissBtn);

    header.appendChild(rightControls);
    container.appendChild(header);

    // Media strip
    const strip = document.createElement('div');
    strip.style.cssText = 'display:flex;gap:6px;overflow-x:auto;padding-bottom:2px;';

    const visibleItems = filteredItems.slice(0, MAX_ITEMS_VISIBLE);
    const remaining = filteredItems.length - MAX_ITEMS_VISIBLE;

    for (const item of visibleItems) {
      const el = item.mimeType.startsWith('video/')
        ? createVideoPreview(item)
        : createImagePreview(item);
      strip.appendChild(el);
    }

    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'n8n-preview-more';
      more.textContent = `+${remaining} more`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = filteredItems[MAX_ITEMS_VISIBLE];
        if (next) {
          openLightbox(binaryUrl(next.id), next.mimeType, next.fileName || 'media');
        }
      });
      strip.appendChild(more);
    }

    container.appendChild(strip);
    node.appendChild(container);
  }

  // ─── Execution Data Extraction ──────────────────────────

  /**
   * Extracts binary items from execution run data.
   * @param {object} executionData - N8N execution response with data.resultData.runData
   * @returns {Map<string, Array<{id: string, mimeType: string, fileName: string}>>}
   */
  function extractBinaryFromExecution(executionData) {
    /** @type {Map<string, Array>} */
    const nodeMap = new Map();

    try {
      const runData = executionData?.data?.resultData?.runData;
      if (!runData) return nodeMap;

      for (const [nodeName, runs] of Object.entries(runData)) {
        const binaries = [];

        for (const run of runs) {
          const items = run?.data?.main;
          if (!items) continue;

          for (const outputGroup of items) {
            if (!Array.isArray(outputGroup)) continue;
            for (const item of outputGroup) {
              if (!item.binary) continue;
              for (const [key, binaryData] of Object.entries(item.binary)) {
                if (binaryData.id && binaryData.mimeType) {
                  binaries.push({
                    id: binaryData.id,
                    mimeType: binaryData.mimeType,
                    fileName: binaryData.fileName || '',
                    fileSize: binaryData.fileSize || 0,
                    outputKey: key,
                  });
                }
              }
            }
          }
        }

        if (binaries.length > 0) {
          nodeMap.set(nodeName, binaries);
        }
      }
    } catch (err) {
      console.warn('[N8N Preview] Error extracting binary data:', err);
    }

    return nodeMap;
  }

  /**
   * Processes execution data and renders previews.
   * @param {object} executionData
   */
  function processExecution(executionData) {
    const nodeMap = extractBinaryFromExecution(executionData);
    if (nodeMap.size === 0) return;

    for (const [nodeName, binaries] of nodeMap) {
      previewCache.set(nodeName, { items: binaries, timestamp: Date.now() });
      renderPreviewsOnNode(nodeName, binaries);
    }

    console.log(`[N8N Preview] Rendered previews for ${nodeMap.size} node(s)`);
  }

  // ─── Fetch Interceptor ──────────────────────────────────

  const originalFetch = window.fetch;

  /**
   * Intercepts fetch calls to capture execution data from N8N API responses.
   */
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';

      const isExecution = url.includes('/rest/executions/');
      const isRun = url.includes('/rest/workflows/') && url.includes('/run');

      if (isExecution || isRun) {
        const clone = response.clone();
        clone.json().then(data => {
          if (data?.data?.resultData?.runData) {
            processExecution(data);
          }
        }).catch(() => {});
      }
    } catch {
      // Never break the original fetch
    }

    return response;
  };

  // ─── Execution Polling ──────────────────────────────────

  /**
   * Polls the executions API for new completed executions with binary data.
   */
  async function pollExecutions() {
    if (!previewsEnabled) return;

    try {
      const resp = await originalFetch('/rest/executions?limit=5&includeData=true', {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });

      if (!resp.ok) return;

      const body = await resp.json();
      const executions = body?.data || [];

      for (const exec of executions) {
        if (!exec.id || exec.id === lastExecutionId) continue;
        if (exec.status !== 'success' && exec.finished !== true) continue;

        lastExecutionId = exec.id;
        processExecution(exec);
        break;
      }
    } catch (err) {
      console.warn('[N8N Preview] Poll error:', err.message);
    }
  }

  // ─── Re-render on DOM changes ───────────────────────────

  /**
   * Watches for Vue Flow DOM changes and re-renders cached previews.
   */
  function watchCanvasChanges() {
    const observer = new MutationObserver(() => {
      if (!previewsEnabled) return;

      for (const [nodeName, data] of previewCache) {
        const node = findCanvasNode(nodeName);
        if (node && !node.querySelector('.n8n-preview-container')) {
          renderPreviewsOnNode(nodeName, data.items);
        }
      }
    });

    const startObserving = () => {
      const canvas = document.querySelector('.vue-flow');
      if (canvas) {
        observer.observe(canvas, { childList: true, subtree: true });
        return true;
      }
      return false;
    };

    if (!startObserving()) {
      const waitObserver = new MutationObserver((_m, obs) => {
        if (startObserving()) obs.disconnect();
      });
      waitObserver.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => waitObserver.disconnect(), 30000);
    }
  }

  // ─── Init ───────────────────────────────────────────────

  injectStyles();
  injectBadge();
  injectToggle();
  injectLightbox();
  injectSettingsPanel();
  watchCanvasChanges();
  watchRunningNodes();

  // Apply saved preview size
  if (settings.size && settings.size !== 'md') {
    applyPreviewSize(settings.size);
  }

  // Start polling after a brief delay
  setTimeout(() => {
    pollExecutions();
    setInterval(pollExecutions, POLL_INTERVAL);
  }, 2000);

})();
