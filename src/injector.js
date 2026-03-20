/**
 * N8N Node Preview Injector v0.2.0
 * Adds live image & video previews directly onto N8N canvas nodes.
 * Injected via Nginx sub_filter into the N8N HTML page.
 *
 * @license MIT
 * @author Ariel Tolome
 */
(function () {
  'use strict';

  const VERSION = '0.2.0';
  const STORAGE_KEY = 'n8n-preview-settings';
  const STYLE_ID = 'n8n-preview-styles';
  const BADGE_ID = 'n8n-preview-badge';
  const TOGGLE_ID = 'n8n-preview-toggle';
  const LIGHTBOX_ID = 'n8n-preview-lightbox';
  const POLL_INTERVAL = 4000;
  const MAX_IMAGES_VISIBLE = 4;

  /** @returns {boolean} True if injector already initialized */
  const isAlreadyLoaded = () => !!document.getElementById(STYLE_ID);

  if (isAlreadyLoaded()) return;

  console.log(`%c[N8N Preview] Injector v${VERSION} loaded`, 'color: #ff9800; font-weight: bold;');

  // ─── State ──────────────────────────────────────────────
  let lastExecutionId = null;
  let previewsEnabled = loadSettings().enabled !== false;
  /** @type {Map<string, {items: Array, timestamp: number}>} nodeName → preview data */
  const previewCache = new Map();

  /** @returns {{enabled: boolean}} */
  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || { enabled: true };
    } catch {
      return { enabled: true };
    }
  }

  /** @param {object} settings */
  function saveSettings(settings) {
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

  // ─── Toggle Button ──────────────────────────────────────
  const injectToggle = () => {
    const btn = document.createElement('button');
    btn.id = TOGGLE_ID;
    btn.title = 'Toggle N8N Previews';
    btn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
    btn.className = previewsEnabled ? '' : 'disabled';
    btn.addEventListener('click', () => {
      previewsEnabled = !previewsEnabled;
      btn.textContent = previewsEnabled ? '\uD83D\uDC41' : '\uD83D\uDEAB';
      btn.className = previewsEnabled ? '' : 'disabled';
      saveSettings({ ...loadSettings(), enabled: previewsEnabled });
      toggleAllPreviews(previewsEnabled);
    });
    document.body.appendChild(btn);
  };

  /** @param {boolean} show */
  function toggleAllPreviews(show) {
    document.querySelectorAll('.n8n-preview-container').forEach(el => {
      el.style.display = show ? 'flex' : 'none';
    });
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
   * Renders preview thumbnails onto a canvas node.
   * @param {string} nodeName - Workflow node name
   * @param {Array<{id: string, mimeType: string, fileName: string}>} binaryItems
   */
  function renderPreviewsOnNode(nodeName, binaryItems) {
    if (!previewsEnabled) return;

    const node = findCanvasNode(nodeName);
    if (!node) return;

    // Remove existing preview for this node
    const existing = node.querySelector('.n8n-preview-container');
    if (existing) existing.remove();

    const imageItems = binaryItems.filter(b => b.mimeType.startsWith('image/'));
    if (imageItems.length === 0) return;

    const container = document.createElement('div');
    container.className = 'n8n-preview-container n8n-preview-fade-in';

    const visibleItems = imageItems.slice(0, MAX_IMAGES_VISIBLE);
    const remaining = imageItems.length - MAX_IMAGES_VISIBLE;

    for (const item of visibleItems) {
      const wrapper = document.createElement('div');
      wrapper.className = 'n8n-preview-item';

      const img = document.createElement('img');
      img.src = `/rest/data/binary-data?id=${encodeURIComponent(item.id)}&action=view`;
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

      container.appendChild(wrapper);
    }

    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'n8n-preview-more';
      more.textContent = `+${remaining} more`;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = imageItems[MAX_IMAGES_VISIBLE];
        if (next) {
          openLightbox(
            `/rest/data/binary-data?id=${encodeURIComponent(next.id)}&action=view`,
            next.mimeType,
            next.fileName || 'image'
          );
        }
      });
      container.appendChild(more);
    }

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
              for (const [_key, binaryData] of Object.entries(item.binary)) {
                if (binaryData.id && binaryData.mimeType) {
                  binaries.push({
                    id: binaryData.id,
                    mimeType: binaryData.mimeType,
                    fileName: binaryData.fileName || '',
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
  watchCanvasChanges();

  // Start polling after a brief delay
  setTimeout(() => {
    pollExecutions();
    setInterval(pollExecutions, POLL_INTERVAL);
  }, 2000);

})();
