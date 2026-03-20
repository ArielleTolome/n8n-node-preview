/**
 * N8N Node Preview Injector v2.0.0
 * Adds live image & video previews directly onto N8N canvas nodes.
 * Injected via Nginx sub_filter into the N8N HTML page.
 *
 * @license MIT
 * @author Ariel Tolome
 */
(function () {
  'use strict';

  const VERSION = '2.0.0';
  const COMPARE_ID = 'n8n-preview-compare';
  const HISTORY_ID = 'n8n-preview-history';
  const STORAGE_KEY = 'n8n-preview-settings';
  const API_KEY_STORAGE = 'n8n-preview-apikey';
  const STYLE_ID = 'n8n-preview-styles';
  const BADGE_ID = 'n8n-preview-badge';
  const TOGGLE_ID = 'n8n-preview-toggle';
  const SETTINGS_ID = 'n8n-preview-settings-panel';
  const LIGHTBOX_ID = 'n8n-preview-lightbox';
  const POLL_INTERVAL = 4000;
  const MAX_ITEMS_VISIBLE = 4;
  const MAX_CACHED_EXECUTIONS = 3;
  const VIDEO_INLINE_MAX_BYTES = 5 * 1024 * 1024;
  const DEBOUNCE_MS = 150;
  const WS_RECONNECT_DELAY = 3000;
  const WS_MAX_RETRIES = 5;
  const MAX_BINARY_ITEMS = 50;
  const MAX_BINARY_ITEMS = 50;

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
  /** @type {Map<string, {items: Array, timestamp: number, executionId: string}>} */
  const previewCache = new Map();
  let executionCount = 0;
  let wsConnection = null;
  let wsRetries = 0;
  let wsConnected = false;
  let pollingActive = true;
  let pollTimer = null;
  const executingNodes = new Set();
  let currentWorkflowUrl = location.href;

  function loadSettings() {
    try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem(STORAGE_KEY)) }; }
    catch { return { ...defaultSettings }; }
  }

  function saveSettings(s) {
    settings = { ...settings, ...s };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  const sizeMap = { small: 48, medium: 64, large: 96 };
  function getItemSize() { return sizeMap[settings.previewSize] || 64; }

  // ─── Debounce utility ───────────────────────────────────
  function debounce(fn, ms) {
    let timer;
    return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), ms); };
  }


  // --- Theme Detection ---
  function detectTheme() {
    const html = document.documentElement;
    if (html.getAttribute('data-theme') === 'light' || html.classList.contains('light') ||
        document.body.classList.contains('light')) return 'light';
    return 'dark';
  }
  function themeBg() { return detectTheme() === 'dark' ? '#1a1a2e' : '#f0f0f5'; }

  // --- API Auth Helper ---
  async function apiRequest(url, opts = {}) {
    const headers = { 'Accept': 'application/json', ...(opts.headers || {}) };
    const apiKey = localStorage.getItem(API_KEY_STORAGE);
    if (apiKey) headers['X-N8N-API-KEY'] = apiKey;
    const resp = await originalFetch(url, { ...opts, credentials: 'include', headers });
    if (resp.status === 401 && !localStorage.getItem(API_KEY_STORAGE)) {
      const key = prompt('[N8N Preview] Auth failed (401).\nEnter your N8N API key:');
      if (key && key.trim()) {
        localStorage.setItem(API_KEY_STORAGE, key.trim());
        headers['X-N8N-API-KEY'] = key.trim();
        return originalFetch(url, { ...opts, credentials: 'include', headers });
      }
    }
    return resp;
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
        white-space: nowrap; box-shadow: 0 1px 4px rgba(255,152,0,0.3);
        transition: opacity 0.3s; z-index: 9999; margin-left: 8px; line-height: 1;
      }
      #${BADGE_ID}:hover { opacity: 0.85; }
      .n8n-preview-ws-dot {
        width: 6px; height: 6px; border-radius: 50%;
        display: inline-block; margin-right: 2px;
        transition: background 0.3s;
      }
      .n8n-preview-ws-dot.connected { background: #4caf50; }
      .n8n-preview-ws-dot.polling { background: #ffc107; }
      .n8n-preview-ws-dot.disconnected { background: #f44336; }

      .n8n-preview-executing {
        position: relative;
      }
      .n8n-preview-executing::after {
        content: ''; position: absolute; inset: -3px;
        border-radius: inherit; border: 2px solid #ff9800;
        animation: n8nPreviewPulse 1.2s ease-in-out infinite;
        pointer-events: none; z-index: 1;
      }
      @keyframes n8nPreviewPulse {
        0%, 100% { opacity: 0.3; transform: scale(1); }
        50% { opacity: 0.8; transform: scale(1.02); }
      }
      .n8n-preview-spinner {
        display: flex; align-items: center; gap: 4px;
        padding: 4px 8px; font-size: 9px; color: #ff9800;
        font-family: monospace; animation: n8nPreviewFadeIn 0.2s ease-out;
      }
      .n8n-preview-spinner::before {
        content: ''; width: 10px; height: 10px;
        border: 2px solid rgba(255,152,0,0.3); border-top-color: #ff9800;
        border-radius: 50%; animation: n8nPreviewSpin 0.8s linear infinite;
      }
      @keyframes n8nPreviewSpin {
        to { transform: rotate(360deg); }
      }

      .n8n-preview-fade-in { animation: n8nPreviewFadeIn 0.3s ease-out; }
      @keyframes n8nPreviewFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }

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
      .n8n-preview-fab-primary { background: linear-gradient(135deg, #ff9800, #ff5722); }
      .n8n-preview-fab-primary.disabled { background: #666; opacity: 0.7; }
      .n8n-preview-fab-secondary {
        width: 36px; height: 36px; font-size: 16px;
        background: #333; border: 1px solid #555;
      }
      .n8n-preview-fab-secondary:hover { background: #444; }

      #${SETTINGS_ID} {
        position: fixed; bottom: 80px; right: 20px;
        width: 240px; background: #1e1e2e; border: 1px solid #333;
        border-radius: 12px; padding: 16px; z-index: 99998;
        box-shadow: 0 8px 24px rgba(0,0,0,0.4);
        font-family: system-ui, sans-serif; font-size: 12px; color: #ccc;
        display: none; animation: n8nPreviewFadeIn 0.2s ease-out;
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
        border-radius: 6px; padding: 3px 8px; font-size: 11px; cursor: pointer; outline: none;
      }
      .n8n-settings-btn {
        width: 100%; margin-top: 10px; padding: 6px 12px;
        background: #333; color: #ef5350; border: 1px solid #555;
        border-radius: 6px; cursor: pointer; font-size: 11px; transition: background 0.2s;
      }
      .n8n-settings-btn:hover { background: #444; }
      .n8n-settings-version {
        margin-top: 8px; text-align: center; font-size: 10px; color: #555;
      }

      .n8n-preview-container {
        display: flex; flex-wrap: nowrap; gap: 6px;
        padding: 6px 8px; margin-top: 4px;
        overflow-x: auto; overflow-y: hidden; max-width: 280px;
        scrollbar-width: thin; scrollbar-color: rgba(255,152,0,0.4) transparent;
        animation: n8nPreviewSlideIn 0.3s ease-out;
        -webkit-overflow-scrolling: touch;
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
      .n8n-preview-item-error {
        display: flex; align-items: center; justify-content: center;
        color: #ef5350; font-size: 9px; text-align: center;
        width: 100%; height: 100%; padding: 4px;
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

      /* History Panel */
      #${HISTORY_ID} {
        position: fixed; top: 0; right: -340px; width: 320px; height: 100vh;
        background: #1a1a2e; border-left: 1px solid rgba(255,152,0,0.2);
        z-index: 99998; overflow-y: auto; transition: right 0.3s ease;
        font-family: system-ui, sans-serif; font-size: 12px; color: #ccc;
        box-shadow: -4px 0 16px rgba(0,0,0,0.3);
      }
      #${HISTORY_ID}.open { right: 0; }
      .n8n-hist-header {
        position: sticky; top: 0; background: #1a1a2e;
        padding: 14px 16px; border-bottom: 1px solid rgba(255,255,255,0.05);
        display: flex; align-items: center; justify-content: space-between; z-index: 1;
      }
      .n8n-hist-title { font-size: 14px; font-weight: 600; color: #ff9800; }
      .n8n-hist-close {
        background: none; border: none; color: #888; font-size: 18px;
        cursor: pointer; line-height: 1; transition: color 0.15s;
      }
      .n8n-hist-close:hover { color: #fff; }
      .n8n-hist-empty {
        padding: 40px 16px; text-align: center; color: #666; font-size: 13px;
      }
      .n8n-hist-item {
        padding: 10px 16px; border-bottom: 1px solid rgba(255,255,255,0.03);
        cursor: pointer; transition: background 0.15s;
      }
      .n8n-hist-item:hover { background: rgba(255,152,0,0.06); }
      .n8n-hist-item.active { background: rgba(255,152,0,0.12); border-left: 3px solid #ff9800; }
      .n8n-hist-row {
        display: flex; align-items: center; gap: 8px; margin-bottom: 4px;
      }
      .n8n-hist-status {
        width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0;
      }
      .n8n-hist-status-success { background: #4caf50; }
      .n8n-hist-status-error { background: #ef5350; }
      .n8n-hist-status-running { background: #ff9800; animation: n8nPreviewPulse 1.5s infinite; }
      .n8n-hist-name {
        font-size: 12px; font-weight: 500; color: #ddd;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;
      }
      .n8n-hist-time { font-size: 10px; color: #888; font-family: monospace; flex-shrink: 0; }
      .n8n-hist-thumbs {
        display: flex; gap: 4px; overflow-x: auto; padding: 2px 0;
        scrollbar-width: none;
      }
      .n8n-hist-thumbs::-webkit-scrollbar { display: none; }
      .n8n-hist-thumb {
        width: 32px; height: 32px; border-radius: 4px; overflow: hidden;
        flex-shrink: 0; border: 1px solid rgba(255,255,255,0.08);
      }
      .n8n-hist-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .n8n-hist-nodes {
        font-size: 10px; color: #999; margin-top: 2px;
      }
      .n8n-hist-item.selected-compare {
        border-left: 3px solid #42a5f5; background: rgba(66,165,245,0.08);
      }
      .n8n-hist-compare-bar {
        display: none; padding: 8px 16px; background: #252535;
        border-bottom: 1px solid rgba(255,255,255,0.05);
        text-align: center;
      }
      .n8n-hist-compare-bar.visible { display: block; }
      .n8n-hist-compare-btn {
        padding: 6px 16px; border-radius: 6px; border: none;
        background: #42a5f5; color: #fff; font-size: 11px; font-weight: 600;
        cursor: pointer; transition: background 0.15s;
      }
      .n8n-hist-compare-btn:hover { background: #1e88e5; }
      .n8n-hist-compare-btn:disabled { background: #555; cursor: default; }
      .n8n-hist-compare-hint {
        font-size: 10px; color: #888; margin-top: 4px;
      }

      #${COMPARE_ID} {
        display: none; position: fixed; inset: 0; z-index: 999998;
        background: #111; flex-direction: column;
        font-family: system-ui, sans-serif;
      }
      #${COMPARE_ID}.active { display: flex; }
      .n8n-compare-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 20px; background: #1a1a2e;
        border-bottom: 1px solid #333;
      }
      .n8n-compare-title { color: #ff9800; font-size: 14px; font-weight: 600; }
      .n8n-compare-close {
        background: none; border: none; color: #888; font-size: 22px;
        cursor: pointer; line-height: 1;
      }
      .n8n-compare-close:hover { color: #fff; }
      .n8n-compare-body {
        display: flex; flex: 1; overflow: hidden;
      }
      .n8n-compare-side {
        flex: 1; overflow-y: auto; padding: 16px;
        border-right: 1px solid #333;
      }
      .n8n-compare-side:last-child { border-right: none; }
      .n8n-compare-side-title {
        font-size: 12px; font-weight: 600; color: #ccc;
        margin-bottom: 12px; padding-bottom: 6px;
        border-bottom: 1px solid #333;
      }
      .n8n-compare-node {
        margin-bottom: 12px; padding: 8px;
        background: #1a1a2e; border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.05);
      }
      .n8n-compare-node-name {
        font-size: 11px; font-weight: 600; color: #ff9800; margin-bottom: 6px;
      }
      .n8n-compare-thumbs {
        display: flex; gap: 4px; flex-wrap: wrap;
      }
      .n8n-compare-thumb {
        width: 48px; height: 48px; border-radius: 4px; overflow: hidden;
        border: 1px solid rgba(255,255,255,0.1);
      }
      .n8n-compare-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }

      .n8n-preview-error-state {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        padding: 6px 8px; margin-top: 4px; gap: 2px;
        background: rgba(239,83,80,0.08); border: 1px solid rgba(239,83,80,0.2);
        border-radius: 6px; animation: n8nPreviewFadeIn 0.3s ease-out;
      }
      .n8n-preview-error-icon { font-size: 16px; line-height: 1; }
      .n8n-preview-error-msg {
        font-size: 9px; color: #ef5350; font-family: monospace;
        max-width: 240px; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; text-align: center;
      }
      .n8n-preview-truncated {
        font-size: 9px; color: #ff9800; padding: 2px 8px;
        text-align: center; font-style: italic;
      }

      /* Dark/light theme adaptation */
      html[data-theme="light"] #${SETTINGS_ID},
      html[data-theme="light"] #${HISTORY_ID},
      body.light #${SETTINGS_ID},
      body.light #${HISTORY_ID} {
        background: #f5f5f5; color: #333; border-color: #ddd;
      }
      html[data-theme="light"] .n8n-preview-item,
      body.light .n8n-preview-item {
        background: #f0f0f0; border-color: rgba(0,0,0,0.1);
      }
      html[data-theme="light"] .n8n-settings-toggle,
      body.light .n8n-settings-toggle { background: #ccc; }
      html[data-theme="light"] .n8n-settings-select,
      body.light .n8n-settings-select { background: #e8e8e8; color: #333; border-color: #ccc; }
      html[data-theme="light"] .n8n-hist-item:hover,
      body.light .n8n-hist-item:hover { background: rgba(255,152,0,0.08); }
      html[data-theme="light"] .n8n-preview-json-box,
      body.light .n8n-preview-json-box { background: #f5f5f5; color: #0277bd; }
      html[data-theme="light"] .n8n-preview-csv-table,
      body.light .n8n-preview-csv-table { background: #f5f5f5; color: #333; }
      html[data-theme="light"] .n8n-preview-file-icon,
      body.light .n8n-preview-file-icon { background: #f0f0f0; }
      html[data-theme="light"] .n8n-preview-file-label,
      body.light .n8n-preview-file-label { color: #666; }

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

      .n8n-preview-file-icon {
        display: flex; flex-direction: column; align-items: center; justify-content: center;
        width: 100%; height: 100%; background: #1a1a2e; gap: 2px;
        font-size: 18px; line-height: 1;
      }
      .n8n-preview-file-label {
        font-size: 7px; font-weight: 600; color: #ccc;
        text-transform: uppercase; letter-spacing: 0.5px;
      }
      .n8n-preview-json-box {
        width: 100%; height: 100%; overflow: hidden;
        padding: 3px 4px; font-family: monospace; font-size: 6px;
        line-height: 1.3; color: #8be9fd; background: #1a1a2e;
        white-space: pre; text-align: left;
      }
      .n8n-preview-csv-table {
        width: 100%; height: 100%; overflow: hidden;
        font-family: monospace; font-size: 6px; color: #ccc;
        background: #1a1a2e; border-collapse: collapse;
      }
      .n8n-preview-csv-table td {
        padding: 1px 2px; border: 1px solid rgba(255,255,255,0.08);
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        max-width: 40px;
      }
      .n8n-preview-csv-table tr:first-child td {
        color: #ff9800; font-weight: 600;
      }
      .n8n-preview-audio-wave {
        display: flex; align-items: flex-end; justify-content: center;
        gap: 1px; width: 100%; height: 60%; padding: 0 4px;
      }
      .n8n-preview-audio-bar {
        width: 3px; background: #ff9800; border-radius: 1px;
        animation: n8nAudioPulse 1.2s ease-in-out infinite alternate;
      }
      @keyframes n8nAudioPulse {
        from { opacity: 0.4; } to { opacity: 1; }
      }
      .n8n-preview-actions {
        position: absolute; top: 2px; right: 2px;
        display: flex; gap: 2px; opacity: 0; transition: opacity 0.15s;
        z-index: 5;
      }
      .n8n-preview-item:hover .n8n-preview-actions { opacity: 1; }
      .n8n-preview-action-btn {
        width: 16px; height: 16px; border-radius: 3px;
        background: rgba(0,0,0,0.7); border: none; color: #fff;
        font-size: 9px; cursor: pointer; display: flex;
        align-items: center; justify-content: center;
        transition: background 0.15s; padding: 0; line-height: 1;
      }
      .n8n-preview-action-btn:hover { background: rgba(255,152,0,0.8); }
      .n8n-preview-size-label {
        position: absolute; bottom: 0; right: 0;
        padding: 0 3px; background: rgba(0,0,0,0.6);
        color: #aaa; font-size: 6px; font-family: monospace;
        border-radius: 3px 0 0 0; line-height: 1.4;
      }

      .n8n-lightbox-json {
        max-width: 80vw; max-height: 80vh; overflow: auto;
        background: #1e1e2e; border-radius: 8px; padding: 20px;
        font-family: monospace; font-size: 13px; color: #8be9fd;
        white-space: pre-wrap; word-break: break-word;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      .n8n-lightbox-csv {
        max-width: 90vw; max-height: 80vh; overflow: auto;
        background: #1e1e2e; border-radius: 8px; padding: 16px;
        box-shadow: 0 4px 20px rgba(0,0,0,0.5);
      }
      .n8n-lightbox-csv table {
        border-collapse: collapse; font-family: monospace; font-size: 12px; color: #ccc;
      }
      .n8n-lightbox-csv td, .n8n-lightbox-csv th {
        padding: 4px 8px; border: 1px solid #333; text-align: left;
      }
      .n8n-lightbox-csv th { color: #ff9800; font-weight: 600; background: #252535; }
    `;
    document.head.appendChild(style);
  };

  // ─── Badge ──────────────────────────────────────────────
  const injectBadge = () => {
    const tryInsert = () => {
      if (document.getElementById(BADGE_ID)) return true;
      for (const sel of [
        'header .actions', '[class*="header"] [class*="actions"]',
        '[class*="header"] [class*="right"]', '.el-header', 'header',
        '[data-test-id="main-sidebar-toggle"]',
      ]) {
        const target = document.querySelector(sel);
        if (target) {
          const badge = document.createElement('span');
          badge.id = BADGE_ID; badge.className = 'n8n-preview-fade-in';
          const wsDot = document.createElement('span');
          wsDot.className = 'n8n-preview-ws-dot polling';
          wsDot.title = 'Polling fallback';
          badge.appendChild(wsDot);
          badge.appendChild(document.createTextNode(' \u2728 Preview Active'));
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
        const wsDotFb = document.createElement('span');
        wsDotFb.className = 'n8n-preview-ws-dot polling';
        fb.appendChild(wsDotFb);
        fb.appendChild(document.createTextNode(' \u2728 Preview Active'));
        fb.title = `N8N Node Preview v${VERSION}`;
        Object.assign(fb.style, { position: 'fixed', top: '10px', right: '10px', zIndex: '99999' });
        document.body.appendChild(fb);
      }
    }, 10000);
  };

  // ─── FAB Group ──────────────────────────────────────────
  const injectFabGroup = () => {
    const group = document.createElement('div');
    group.className = 'n8n-preview-fab-group';
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

    const settingsBtn = document.createElement('button');
    settingsBtn.className = 'n8n-preview-fab n8n-preview-fab-secondary';
    settingsBtn.title = 'Preview Settings'; settingsBtn.textContent = '\u2699';
    settingsBtn.addEventListener('click', () => {
      const panel = document.getElementById(SETTINGS_ID);
      if (panel) panel.classList.toggle('open');
    });
    group.appendChild(settingsBtn);

    // History button
    const histBtn = document.createElement('button');
    histBtn.className = 'n8n-preview-fab n8n-preview-fab-secondary';
    histBtn.title = 'Execution History (Ctrl+Shift+H)';
    histBtn.textContent = '\uD83D\uDCCB';
    histBtn.addEventListener('click', toggleHistory);
    group.appendChild(histBtn);

    document.body.appendChild(group);

    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey && e.shiftKey && e.key === 'P') { e.preventDefault(); toggleBtn.click(); }
    });
  };

  // ─── Settings Panel ─────────────────────────────────────
  const injectSettingsPanel = () => {
    const panel = document.createElement('div');
    panel.id = SETTINGS_ID;
    const title = document.createElement('div');
    title.className = 'n8n-settings-title'; title.textContent = '\u2699 Preview Settings';
    panel.appendChild(title);

    panel.appendChild(createSettingsRow('Auto-show on run', settings.autoShow, v => saveSettings({ autoShow: v })));
    panel.appendChild(createSettingsRow('Show video previews', settings.showVideos, v => saveSettings({ showVideos: v })));

    const sizeRow = document.createElement('div'); sizeRow.className = 'n8n-settings-row';
    const sizeLabel = document.createElement('span'); sizeLabel.textContent = 'Preview size';
    const sizeSelect = document.createElement('select'); sizeSelect.className = 'n8n-settings-select';
    for (const opt of ['small', 'medium', 'large']) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = opt; if (settings.previewSize === opt) o.selected = true;
      sizeSelect.appendChild(o);
    }
    sizeSelect.addEventListener('change', () => {
      saveSettings({ previewSize: sizeSelect.value });
      const sz = getItemSize();
      document.querySelectorAll('.n8n-preview-item, .n8n-preview-more').forEach(el => {
        el.style.width = sz + 'px'; el.style.height = sz + 'px';
      });
    });
    sizeRow.appendChild(sizeLabel); sizeRow.appendChild(sizeSelect);
    panel.appendChild(sizeRow);

    const clearBtn = document.createElement('button');
    clearBtn.className = 'n8n-settings-btn'; clearBtn.textContent = 'Clear All Previews';
    clearBtn.addEventListener('click', () => {
      previewCache.clear();
      document.querySelectorAll('.n8n-preview-container, .n8n-preview-header, .n8n-preview-count-badge').forEach(el => el.remove());
    });
    panel.appendChild(clearBtn);

    const ver = document.createElement('div');
    ver.className = 'n8n-settings-version';
    ver.textContent = `v${VERSION}`;
    panel.appendChild(ver);

    document.body.appendChild(panel);
  };

  function createSettingsRow(label, value, onChange) {
    const row = document.createElement('div'); row.className = 'n8n-settings-row';
    const lbl = document.createElement('span'); lbl.textContent = label;
    const toggle = document.createElement('button');
    toggle.className = 'n8n-settings-toggle' + (value ? ' on' : '');
    toggle.addEventListener('click', () => {
      const v = !toggle.classList.contains('on');
      toggle.classList.toggle('on', v); onChange(v);
    });
    row.appendChild(lbl); row.appendChild(toggle);
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
    const lb = document.createElement('div'); lb.id = LIGHTBOX_ID;
    const closeBtn = document.createElement('button');
    closeBtn.className = 'n8n-lightbox-close'; closeBtn.textContent = '\u00D7';
    lb.appendChild(closeBtn);
    lb.appendChild(Object.assign(document.createElement('div'), { className: 'n8n-lightbox-content' }));
    lb.appendChild(Object.assign(document.createElement('div'), { className: 'n8n-lightbox-info' }));
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
      const v = document.createElement('video');
      v.src = src; v.controls = true; v.autoplay = true; v.loop = true;
      content.appendChild(v);
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

  function binaryUrl(id) { return `/rest/data/binary-data?id=${encodeURIComponent(id)}&action=view`; }

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
    // Retry once on error
    let retried = false;
    img.onerror = () => {
      if (!retried) {
        retried = true;
        setTimeout(() => { img.src = binaryUrl(item.id); }, 1000);
      } else {
        while (w.firstChild) w.removeChild(w.firstChild);
        const errEl = document.createElement('div');
        errEl.className = 'n8n-preview-item-error';
        errEl.textContent = 'Preview unavailable';
        w.appendChild(errEl);
      }
    };
    const ov = document.createElement('div');
    ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || (item.mimeType.split('/')[1] || '').toUpperCase();
    w.appendChild(img); w.appendChild(ov);
    w.appendChild(createActionButtons(item));
    const szLabel = createSizeLabel(item);
    if (szLabel) w.appendChild(szLabel);
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
    const meta = document.createElement('div'); meta.className = 'n8n-preview-meta';
    const szStr = item.fileSize ? formatSize(item.fileSize) : '';
    meta.textContent = szStr ? `${ext} \u2022 ${szStr}` : ext;
    w.appendChild(meta);
    const ov = document.createElement('div'); ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || ext.toUpperCase();
    w.appendChild(ov);
    w.appendChild(createActionButtons(item));
    w.addEventListener('click', (e) => {
      e.stopPropagation(); openLightbox(src, item.mimeType, item.fileName || 'video');
    });
    return w;
  }

  // ─── Download + Copy Helpers ────────────────────────────
  function createActionButtons(item) {
    const actions = document.createElement('div');
    actions.className = 'n8n-preview-actions';
    // Download
    const dlBtn = document.createElement('button');
    dlBtn.className = 'n8n-preview-action-btn'; dlBtn.textContent = '\u2B07';
    dlBtn.title = 'Download';
    dlBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const a = document.createElement('a');
      a.href = binaryUrl(item.id); a.download = item.fileName || 'download';
      a.style.display = 'none'; document.body.appendChild(a); a.click(); a.remove();
    });
    actions.appendChild(dlBtn);
    // Copy (images only)
    if (item.mimeType.startsWith('image/') && navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const cpBtn = document.createElement('button');
      cpBtn.className = 'n8n-preview-action-btn'; cpBtn.textContent = '\uD83D\uDCCB';
      cpBtn.title = 'Copy to clipboard';
      cpBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        try {
          const resp = await originalFetch(binaryUrl(item.id));
          const blob = await resp.blob();
          const pngBlob = blob.type === 'image/png' ? blob :
            await new Promise(resolve => {
              const img = new Image(); img.crossOrigin = 'anonymous';
              img.onload = () => {
                const c = document.createElement('canvas');
                c.width = img.naturalWidth; c.height = img.naturalHeight;
                c.getContext('2d').drawImage(img, 0, 0);
                c.toBlob(resolve, 'image/png');
              };
              img.src = URL.createObjectURL(blob);
            });
          await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
          cpBtn.textContent = '\u2705';
          setTimeout(() => { cpBtn.textContent = '\uD83D\uDCCB'; }, 1500);
        } catch { cpBtn.textContent = '\u274C'; setTimeout(() => { cpBtn.textContent = '\uD83D\uDCCB'; }, 1500); }
      });
      actions.appendChild(cpBtn);
    }
    return actions;
  }

  function createSizeLabel(item) {
    if (!item.fileSize) return null;
    const el = document.createElement('div');
    el.className = 'n8n-preview-size-label';
    el.textContent = formatSize(item.fileSize);
    return el;
  }

  function makeFileIcon(emoji, label) {
    const icon = document.createElement('div');
    icon.className = 'n8n-preview-file-icon';
    const emoSpan = document.createElement('span');
    emoSpan.textContent = emoji;
    const lblSpan = document.createElement('span');
    lblSpan.className = 'n8n-preview-file-label';
    lblSpan.textContent = label;
    icon.appendChild(emoSpan);
    icon.appendChild(lblSpan);
    return icon;
  }

  // ─── PDF Preview ──────────────────────────────────────
  function createPdfPreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';

    w.appendChild(makeFileIcon('\uD83D\uDCC4', 'PDF'));
    w.appendChild(createActionButtons(item));
    const szLabel = createSizeLabel(item);
    if (szLabel) w.appendChild(szLabel);

    // Attempt pdf.js rendering
    (async () => {
      try {
        if (!window.pdfjsLib) {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          await new Promise((resolve, reject) => {
            script.onload = resolve; script.onerror = reject;
            document.head.appendChild(script);
          });
          if (window.pdfjsLib) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc =
              'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
          }
        }
        if (!window.pdfjsLib) return;
        const pdfData = await originalFetch(binaryUrl(item.id)).then(r => r.arrayBuffer());
        const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
        const page = await pdf.getPage(1);
        const viewport = page.getViewport({ scale: sz / page.getViewport({ scale: 1 }).width });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width; canvas.height = viewport.height;
        canvas.style.width = '100%'; canvas.style.height = '100%';
        canvas.style.objectFit = 'cover'; canvas.style.display = 'block';
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        while (w.firstChild) w.removeChild(w.firstChild);
        w.appendChild(canvas);
        w.appendChild(createActionButtons(item));
        const ov = document.createElement('div');
        ov.className = 'n8n-preview-overlay';
        ov.textContent = pdf.numPages + ' page' + (pdf.numPages > 1 ? 's' : '');
        w.appendChild(ov);
        if (szLabel) w.appendChild(createSizeLabel(item));
      } catch { /* keep icon fallback */ }
    })();

    w.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(binaryUrl(item.id), '_blank');
    });
    return w;
  }

  // ─── JSON Preview ─────────────────────────────────────
  function createJsonPreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';

    w.appendChild(makeFileIcon('{ }', 'JSON'));
    w.appendChild(createActionButtons(item));

    (async () => {
      try {
        const text = await originalFetch(binaryUrl(item.id)).then(r => r.text());
        const parsed = JSON.parse(text);
        const entries = Object.entries(parsed).slice(0, 5);
        const box = document.createElement('div');
        box.className = 'n8n-preview-json-box';
        box.textContent = entries.map(([k, v]) => {
          const val = typeof v === 'object' ? JSON.stringify(v).slice(0, 20) : String(v).slice(0, 20);
          return '"' + k + '": ' + val;
        }).join('\n');
        while (w.firstChild) w.removeChild(w.firstChild);
        w.appendChild(box);
        w.appendChild(createActionButtons(item));
        const szLabel2 = createSizeLabel(item);
        if (szLabel2) w.appendChild(szLabel2);
        w._jsonData = text;
      } catch { /* keep icon */ }
    })();

    w.addEventListener('click', (e) => {
      e.stopPropagation();
      const lb = document.getElementById(LIGHTBOX_ID);
      if (!lb) return;
      const content = lb.querySelector('.n8n-lightbox-content');
      const info = lb.querySelector('.n8n-lightbox-info');
      while (content.firstChild) content.removeChild(content.firstChild);
      const pre = document.createElement('div');
      pre.className = 'n8n-lightbox-json';
      try { pre.textContent = JSON.stringify(JSON.parse(w._jsonData || '{}'), null, 2); }
      catch { pre.textContent = w._jsonData || 'Unable to parse JSON'; }
      content.appendChild(pre);
      info.textContent = (item.fileName || 'data.json') + ' \u2022 JSON';
      lb.classList.add('active');
    });
    return w;
  }

  // ─── CSV Preview ──────────────────────────────────────
  function createCsvPreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';

    w.appendChild(makeFileIcon('\uD83D\uDCCA', 'CSV'));
    w.appendChild(createActionButtons(item));

    (async () => {
      try {
        const text = await originalFetch(binaryUrl(item.id)).then(r => r.text());
        const lines = text.split('\n').filter(l => l.trim());
        const rows = lines.slice(0, 3).map(l => l.split(',').slice(0, 4));
        const table = document.createElement('table');
        table.className = 'n8n-preview-csv-table';
        for (const row of rows) {
          const tr = document.createElement('tr');
          for (const cell of row) {
            const td = document.createElement('td');
            td.textContent = cell.trim().replace(/^"|"$/g, '').slice(0, 10);
            tr.appendChild(td);
          }
          table.appendChild(tr);
        }
        while (w.firstChild) w.removeChild(w.firstChild);
        w.appendChild(table);
        w.appendChild(createActionButtons(item));
        const meta = document.createElement('div'); meta.className = 'n8n-preview-meta';
        meta.textContent = lines.length + ' rows';
        w.appendChild(meta);
        w._csvData = text;
      } catch { /* keep icon */ }
    })();

    w.addEventListener('click', (e) => {
      e.stopPropagation();
      const lb = document.getElementById(LIGHTBOX_ID);
      if (!lb) return;
      const content = lb.querySelector('.n8n-lightbox-content');
      const info = lb.querySelector('.n8n-lightbox-info');
      while (content.firstChild) content.removeChild(content.firstChild);
      const wrap = document.createElement('div');
      wrap.className = 'n8n-lightbox-csv';
      const csvText = w._csvData || '';
      const lines = csvText.split('\n').filter(l => l.trim());
      const table = document.createElement('table');
      lines.forEach((line, i) => {
        const tr = document.createElement('tr');
        const cells = line.split(',');
        for (const cell of cells) {
          const el = document.createElement(i === 0 ? 'th' : 'td');
          el.textContent = cell.trim().replace(/^"|"$/g, '');
          tr.appendChild(el);
        }
        table.appendChild(tr);
      });
      wrap.appendChild(table);
      content.appendChild(wrap);
      info.textContent = (item.fileName || 'data.csv') + ' \u2022 ' + lines.length + ' rows';
      lb.classList.add('active');
    });
    return w;
  }

  // ─── Audio Preview ────────────────────────────────────
  function createAudioPreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';

    const wave = document.createElement('div');
    wave.className = 'n8n-preview-audio-wave';
    const barCount = Math.max(5, Math.floor(sz / 6));
    for (let i = 0; i < barCount; i++) {
      const bar = document.createElement('div');
      bar.className = 'n8n-preview-audio-bar';
      const h = 20 + Math.random() * 60;
      bar.style.height = h + '%';
      bar.style.animationDelay = (i * 0.1) + 's';
      wave.appendChild(bar);
    }
    w.appendChild(wave);

    const meta = document.createElement('div'); meta.className = 'n8n-preview-meta';
    const ext = item.mimeType.split('/')[1] || 'audio';
    meta.textContent = ext;
    w.appendChild(meta);

    const ov = document.createElement('div'); ov.className = 'n8n-preview-overlay';
    ov.textContent = item.fileName || 'Audio';
    w.appendChild(ov);
    w.appendChild(createActionButtons(item));
    const szLabel = createSizeLabel(item);
    if (szLabel) w.appendChild(szLabel);

    w.addEventListener('click', (e) => {
      e.stopPropagation();
      const lb = document.getElementById(LIGHTBOX_ID);
      if (!lb) return;
      const content = lb.querySelector('.n8n-lightbox-content');
      const info = lb.querySelector('.n8n-lightbox-info');
      while (content.firstChild) content.removeChild(content.firstChild);
      const audio = document.createElement('audio');
      audio.src = binaryUrl(item.id); audio.controls = true; audio.autoplay = true;
      audio.style.minWidth = '300px';
      content.appendChild(audio);
      info.textContent = (item.fileName || 'audio') + ' \u2022 ' + ext.toUpperCase();
      lb.classList.add('active');
    });
    return w;
  }

  // ─── Generic File Preview ─────────────────────────────
  function createErrorPreview(nodeName, errorMsg) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.cssText = 'width:' + sz + 'px;height:' + sz + 'px;background:#2e1a1a;border-color:rgba(239,83,80,0.3)';
    w.title = errorMsg || 'Node error';
    const err = document.createElement('div');
    err.className = 'n8n-preview-item-error';
    err.innerHTML = '<span style="font-size:16px">\u274C</span><span>' + (errorMsg || 'Error').slice(0, 30) + '</span>';
    w.appendChild(err);
    return w;
  }

  function createGenericPreview(item) {
    const sz = getItemSize();
    const w = document.createElement('div');
    w.className = 'n8n-preview-item';
    w.style.width = sz + 'px'; w.style.height = sz + 'px';
    const ext = (item.mimeType.split('/')[1] || item.fileName?.split('.').pop() || 'file').toUpperCase();
    w.appendChild(makeFileIcon('\uD83D\uDCC1', ext.slice(0, 5)));
    w.appendChild(createActionButtons(item));
    const szLabel = createSizeLabel(item);
    if (szLabel) w.appendChild(szLabel);
    w.addEventListener('click', (e) => {
      e.stopPropagation();
      window.open(binaryUrl(item.id), '_blank');
    });
    return w;
  }

  function createPreviewForItem(item) {
    const mime = item.mimeType || '';
    if (mime.startsWith('image/')) return createImagePreview(item);
    if (mime.startsWith('video/') && settings.showVideos) return createVideoPreview(item);
    if (mime === 'application/pdf') return createPdfPreview(item);
    if (mime === 'application/json' || mime.endsWith('+json')) return createJsonPreview(item);
    if (mime === 'text/csv' || mime === 'application/csv') return createCsvPreview(item);
    if (mime.startsWith('audio/')) return createAudioPreview(item);
    return createGenericPreview(item);
  }

  // ─── Rendering ──────────────────────────────────────────
  function renderPreviewsOnNode(nodeName, binaryItems, timestamp, errorMsg) {
    if (!previewsEnabled && !settings.autoShow) return;
    const node = findCanvasNode(nodeName);
    if (!node) return;

    for (const sel of ['.n8n-preview-container', '.n8n-preview-header', '.n8n-preview-count-badge']) {
      const el = node.querySelector(sel);
      if (el) el.remove();
    }

    // Accept all binary items now (not just image/video)
    const previewItems = binaryItems.filter(b => {
      const m = b.mimeType || '';
      if (m.startsWith('video/') && !settings.showVideos) return false;
      return true;
    });
    if (previewItems.length === 0) return;

    const header = document.createElement('div'); header.className = 'n8n-preview-header';
    const tsEl = document.createElement('span'); tsEl.className = 'n8n-preview-timestamp';
    tsEl.textContent = timestamp ? timeAgo(timestamp) : '';
    const countEl = document.createElement('span'); countEl.className = 'n8n-preview-output-label';
    const ic = previewItems.filter(b => b.mimeType.startsWith('image/')).length;
    const vc = previewItems.filter(b => b.mimeType.startsWith('video/')).length;
    const fc = previewItems.length - ic - vc;
    const parts = [];
    if (ic > 0) parts.push(ic + ' img');
    if (vc > 0) parts.push(vc + ' vid');
    if (fc > 0) parts.push(fc + ' file');
    countEl.textContent = parts.join(' \u2022 ');
    const dismiss = document.createElement('button');
    dismiss.className = 'n8n-preview-dismiss'; dismiss.textContent = '\u2715';
    dismiss.title = 'Dismiss preview';
    dismiss.addEventListener('click', (e) => {
      e.stopPropagation(); previewCache.delete(nodeName);
      for (const s of ['.n8n-preview-container', '.n8n-preview-header', '.n8n-preview-count-badge']) {
        const el = node.querySelector(s); if (el) el.remove();
      }
    });
    header.appendChild(tsEl); header.appendChild(countEl); header.appendChild(dismiss);

    const container = document.createElement('div');
    container.className = 'n8n-preview-container n8n-preview-fade-in';
    const visible = previewItems.slice(0, MAX_ITEMS_VISIBLE);
    const remaining = previewItems.length - MAX_ITEMS_VISIBLE;
    const sz = getItemSize();

    for (const item of visible) {
      container.appendChild(createPreviewForItem(item));
    }

    if (remaining > 0) {
      const more = document.createElement('div');
      more.className = 'n8n-preview-more';
      more.style.width = sz + 'px'; more.style.height = sz + 'px';
      more.textContent = '+' + remaining;
      more.addEventListener('click', (e) => {
        e.stopPropagation();
        const next = previewItems[MAX_ITEMS_VISIBLE];
        if (next) openLightbox(binaryUrl(next.id), next.mimeType, next.fileName || 'media');
      });
      container.appendChild(more);
    }

    const badge = document.createElement('div');
    badge.className = 'n8n-preview-count-badge';
    badge.textContent = String(previewItems.length);
    badge.style.display = previewsEnabled ? 'none' : 'flex';

    node.style.position = node.style.position || 'relative';
    node.appendChild(badge);
    if (previewsEnabled) { node.appendChild(header); node.appendChild(container); }

    const tsTimer = setInterval(() => {
      if (!document.contains(tsEl)) { clearInterval(tsTimer); return; }
      if (timestamp) tsEl.textContent = timeAgo(timestamp);
    }, 30000);
  }

  // ─── Execution Extraction ───────────────────────────────
  function extractBinaryFromExecution(executionData) {
    const nodeMap = new Map();
    const errorMap = new Map();
    try {
      const runData = executionData?.data?.resultData?.runData;
      if (!runData) return nodeMap;
      for (const [nodeName, runs] of Object.entries(runData)) {
        const binaries = [];
        let nodeError = null;
        for (const run of runs) {
          if (run.error) nodeError = run.error.message || run.error.description || 'Error';
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
        else if (nodeError) errorMap.set(nodeName, nodeError);
      }
    } catch (err) { console.warn('[N8N Preview] Extraction error:', err); }
    return { nodeMap, errorMap };
  }

  function processExecution(executionData) {
    const result = extractBinaryFromExecution(executionData);
    const nodeMap = result.nodeMap || result;
    const errorMap = result.errorMap || new Map();
    if (nodeMap.size === 0 && errorMap.size === 0) return;
    const ts = Date.now();
    executionCount++;

    // Limit cached executions
    if (executionCount > MAX_CACHED_EXECUTIONS) {
      const entries = [...previewCache.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = entries.slice(0, entries.length - MAX_CACHED_EXECUTIONS * 5);
      for (const [key] of toRemove) previewCache.delete(key);
    }

    for (const [nodeName, binaries] of nodeMap) {
      previewCache.set(nodeName, { items: binaries, timestamp: ts });
      renderPreviewsOnNode(nodeName, binaries, ts);
    }
    for (const [nodeName, msg] of errorMap) renderPreviewsOnNode(nodeName, [], ts, msg);
    console.log(`[N8N Preview] Rendered: ${nodeMap.size} node(s), ${errorMap.size} error(s)`);
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
      const resp = await apiRequest('/rest/executions?limit=5&includeData=true');
      if (!resp.ok) return;
      const body = await resp.json();
      const execs = (body?.data || []).sort((a, b) => new Date(b.startedAt || 0) - new Date(a.startedAt || 0));
      for (const exec of execs) {
        if (!exec.id || exec.id === lastExecutionId) continue;
        if (exec.status !== 'success' && exec.finished !== true) continue;
        lastExecutionId = exec.id;
        processExecution(exec);
        break;
      }
    } catch (err) { console.warn('[N8N Preview] Poll error:', err.message); }
  }

  // ─── Canvas Watcher (debounced) ─────────────────────────
  function watchCanvasChanges() {
    const rerender = debounce(() => {
      if (!previewsEnabled) return;
      for (const [nodeName, data] of previewCache) {
        const node = findCanvasNode(nodeName);
        if (node && !node.querySelector('.n8n-preview-container')) {
          renderPreviewsOnNode(nodeName, data.items, data.timestamp);
        }
      }
    }, DEBOUNCE_MS);

    const observer = new MutationObserver(rerender);

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

    // Clean up when navigating away from editor
    setInterval(() => {
      if (!document.querySelector('.vue-flow') && previewCache.size > 0) {
        observer.disconnect();
      } else if (document.querySelector('.vue-flow') && !observer.takeRecords) {
        start();
      }
    }, 5000);
  }

  // ─── Lazy loading with IntersectionObserver ─────────────
  if ('IntersectionObserver' in window) {
    const lazyObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          const img = entry.target;
          if (img.dataset.lazySrc) {
            img.src = img.dataset.lazySrc;
            delete img.dataset.lazySrc;
            lazyObserver.unobserve(img);
          }
        }
      }
    }, { rootMargin: '100px' });

    // Expose for use in createImagePreview
    window.__n8nPreviewLazyObserver = lazyObserver;
  }

  // ─── WebSocket ─────────────────────────────────────────
  function updateWsDot(state) {
    const dot = document.querySelector('.n8n-preview-ws-dot');
    if (!dot) return;
    dot.className = 'n8n-preview-ws-dot ' + state;
    dot.title = state === 'connected' ? 'WebSocket live' :
                state === 'polling' ? 'Polling fallback' : 'Disconnected';
  }

  function addNodeSpinner(nodeName) {
    const node = findCanvasNode(nodeName);
    if (!node) return;
    node.classList.add('n8n-preview-executing');
    if (node.querySelector('.n8n-preview-spinner')) return;
    const spinner = document.createElement('div');
    spinner.className = 'n8n-preview-spinner';
    spinner.textContent = 'Running\u2026';
    node.appendChild(spinner);
  }

  function removeNodeSpinner(nodeName) {
    const node = findCanvasNode(nodeName);
    if (!node) {
      executingNodes.delete(nodeName);
      return;
    }
    node.classList.remove('n8n-preview-executing');
    const spinner = node.querySelector('.n8n-preview-spinner');
    if (spinner) spinner.remove();
    executingNodes.delete(nodeName);
  }

  function startPollingFallback() {
    if (pollingActive) return;
    pollingActive = true;
    updateWsDot('polling');
    console.log('[N8N Preview] Falling back to polling');
    pollTimer = setInterval(pollExecutions, POLL_INTERVAL);
  }

  function stopPolling() {
    pollingActive = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  function connectWebSocket() {
    if (wsConnection && wsConnection.readyState <= 1) return;

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/push`;

    try {
      wsConnection = new WebSocket(wsUrl);
    } catch (err) {
      console.warn('[N8N Preview] WS creation failed:', err.message);
      startPollingFallback();
      return;
    }

    wsConnection.onopen = () => {
      wsConnected = true;
      wsRetries = 0;
      stopPolling();
      updateWsDot('connected');
      console.log('[N8N Preview] WebSocket connected');
    };

    wsConnection.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleWsMessage(msg);
      } catch { /* ignore non-JSON frames */ }
    };

    wsConnection.onclose = () => {
      wsConnected = false;
      startPollingFallback();
      scheduleReconnect();
    };

    wsConnection.onerror = () => {
      wsConnected = false;
      updateWsDot('disconnected');
    };
  }

  function scheduleReconnect() {
    if (wsRetries >= WS_MAX_RETRIES) {
      console.warn('[N8N Preview] Max WS retries reached, staying on polling');
      updateWsDot('polling');
      return;
    }
    wsRetries++;
    const delay = WS_RECONNECT_DELAY * wsRetries;
    setTimeout(connectWebSocket, delay);
  }

  function handleWsMessage(msg) {
    // N8N push messages can have different structures
    const type = msg.type || msg.eventName || (msg.data && msg.data.type);
    const payload = msg.data || msg;

    switch (type) {
      case 'executionFinished':
      case 'executionCompleted': {
        const execId = payload.executionId || payload.data?.executionId;
        if (execId && execId !== lastExecutionId) {
          lastExecutionId = execId;
          fetchAndProcessExecution(execId);
        }
        // Clear all executing spinners
        for (const name of executingNodes) removeNodeSpinner(name);
        break;
      }

      case 'nodeExecuteAfter': {
        const nodeName = payload.nodeName || payload.data?.nodeName;
        if (nodeName) {
          removeNodeSpinner(nodeName);
          // If payload contains binary data, inject preview immediately
          const nodeData = payload.data || payload;
          if (nodeData.data?.main || nodeData.executionData?.data?.main) {
            const runData = {};
            runData[nodeName] = [{ data: nodeData.data || nodeData.executionData?.data }];
            const fakeExec = { data: { resultData: { runData } } };
            processExecution(fakeExec);
          }
        }
        break;
      }

      case 'nodeExecuteBefore':
      case 'workflowExecutingNode': {
        const nodeName = payload.nodeName || payload.data?.nodeName;
        if (nodeName) {
          executingNodes.add(nodeName);
          addNodeSpinner(nodeName);
        }
        break;
      }

      case 'executionStarted':
      case 'workflowExecuteStart':
        // Workflow started — nothing to preview yet
        break;

      default:
        break;
    }
  }

  async function fetchAndProcessExecution(executionId) {
    try {
      const resp = await apiRequest(`/rest/executions/${encodeURIComponent(executionId)}?includeData=true`);
      if (!resp.ok) return;
      const body = await resp.json();
      const execData = body.data || body;
      processExecution(execData);
    } catch (err) {
      console.warn('[N8N Preview] Fetch execution error:', err.message);
    }
  }

  // ─── Execution History ──────────────────────────────────

  /** @type {Array<{id: string, status: string, workflowName: string, startedAt: string, stoppedAt: string, nodes: Map}>} */
  const executionHistory = [];
  const MAX_HISTORY = 20;

  function injectHistoryPanel() {
    const panel = document.createElement('div');
    panel.id = HISTORY_ID;

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'n8n-hist-header';
    const title = document.createElement('span');
    title.className = 'n8n-hist-title';
    title.textContent = '\uD83D\uDCCB Execution History';
    hdr.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'n8n-hist-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));
    hdr.appendChild(closeBtn);
    panel.appendChild(hdr);

    // Compare bar
    const compareBar = document.createElement('div');
    compareBar.className = 'n8n-hist-compare-bar';
    const compareBtn = document.createElement('button');
    compareBtn.className = 'n8n-hist-compare-btn';
    compareBtn.textContent = 'Compare \u25B6';
    compareBtn.disabled = true;
    compareBtn.addEventListener('click', openCompareMode);
    compareBar.appendChild(compareBtn);
    const compareHint = document.createElement('div');
    compareHint.className = 'n8n-hist-compare-hint';
    compareHint.textContent = 'Select 2 executions to compare';
    compareBar.appendChild(compareHint);
    panel.appendChild(compareBar);

    // List container
    const list = document.createElement('div');
    list.className = 'n8n-hist-list';
    panel.appendChild(list);

    document.body.appendChild(panel);
  }

  // ─── Compare Mode ─────────────────────────────────────
  const compareSelection = new Set();

  function toggleCompareSelect(execId) {
    if (compareSelection.has(execId)) {
      compareSelection.delete(execId);
    } else {
      if (compareSelection.size >= 2) {
        // Remove oldest selection
        const first = compareSelection.values().next().value;
        compareSelection.delete(first);
        const oldEl = document.querySelector('.n8n-hist-item[data-exec-id="' + first + '"]');
        if (oldEl) oldEl.classList.remove('selected-compare');
      }
      compareSelection.add(execId);
    }
    // Update visual state
    document.querySelectorAll('.n8n-hist-item').forEach(el => {
      el.classList.toggle('selected-compare', compareSelection.has(el.getAttribute('data-exec-id')));
    });
    // Update compare button
    const compareBtn = document.querySelector('.n8n-hist-compare-btn');
    const compareBar = document.querySelector('.n8n-hist-compare-bar');
    if (compareBtn) compareBtn.disabled = compareSelection.size !== 2;
    if (compareBar) compareBar.classList.toggle('visible', compareSelection.size > 0);
  }

  function openCompareMode() {
    if (compareSelection.size !== 2) return;
    const ids = [...compareSelection];
    const execA = executionHistory.find(e => e.id === ids[0]);
    const execB = executionHistory.find(e => e.id === ids[1]);
    if (!execA || !execB) return;

    let overlay = document.getElementById(COMPARE_ID);
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = COMPARE_ID;
      document.body.appendChild(overlay);
    }
    while (overlay.firstChild) overlay.removeChild(overlay.firstChild);

    // Header
    const hdr = document.createElement('div');
    hdr.className = 'n8n-compare-header';
    const title = document.createElement('span');
    title.className = 'n8n-compare-title';
    title.textContent = 'Compare Executions';
    hdr.appendChild(title);
    const closeBtn = document.createElement('button');
    closeBtn.className = 'n8n-compare-close';
    closeBtn.textContent = '\u00D7';
    closeBtn.addEventListener('click', () => overlay.classList.remove('active'));
    hdr.appendChild(closeBtn);
    overlay.appendChild(hdr);

    // Body
    const body = document.createElement('div');
    body.className = 'n8n-compare-body';

    for (const exec of [execA, execB]) {
      const side = document.createElement('div');
      side.className = 'n8n-compare-side';
      const sideTitle = document.createElement('div');
      sideTitle.className = 'n8n-compare-side-title';
      const statusIcon = exec.status === 'success' || exec.finished ? '\u2705' :
                          exec.status === 'error' || exec.status === 'failed' ? '\u274C' : '\u23F3';
      sideTitle.textContent = statusIcon + ' ' + (exec.workflowName || 'Workflow') + ' \u2022 ' +
        (exec.stoppedAt ? timeAgo(new Date(exec.stoppedAt).getTime()) : 'running');
      side.appendChild(sideTitle);

      if (exec.nodes && exec.nodes.size > 0) {
        for (const [nodeName, bins] of exec.nodes) {
          const nodeEl = document.createElement('div');
          nodeEl.className = 'n8n-compare-node';
          const nameEl = document.createElement('div');
          nameEl.className = 'n8n-compare-node-name';
          nameEl.textContent = nodeName + ' (' + bins.length + ' output' + (bins.length > 1 ? 's' : '') + ')';
          nodeEl.appendChild(nameEl);
          const thumbs = document.createElement('div');
          thumbs.className = 'n8n-compare-thumbs';
          for (const bin of bins.slice(0, 8)) {
            if (bin.mimeType.startsWith('image/')) {
              const thumb = document.createElement('div');
              thumb.className = 'n8n-compare-thumb';
              const img = document.createElement('img');
              img.src = binaryUrl(bin.id); img.loading = 'lazy';
              img.addEventListener('click', () => openLightbox(img.src, bin.mimeType, bin.fileName || 'image'));
              thumb.appendChild(img);
              thumbs.appendChild(thumb);
            } else {
              const thumb = document.createElement('div');
              thumb.className = 'n8n-compare-thumb';
              thumb.style.background = '#1a1a2e';
              thumb.style.display = 'flex';
              thumb.style.alignItems = 'center';
              thumb.style.justifyContent = 'center';
              thumb.style.fontSize = '8px';
              thumb.style.color = '#888';
              thumb.textContent = (bin.mimeType.split('/')[1] || 'file').toUpperCase().slice(0, 4);
              thumbs.appendChild(thumb);
            }
          }
          nodeEl.appendChild(thumbs);
          side.appendChild(nodeEl);
        }
      } else {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding: 20px; text-align: center; color: #666;';
        empty.textContent = 'No binary data in this execution';
        side.appendChild(empty);
      }
      body.appendChild(side);
    }
    overlay.appendChild(body);
    overlay.classList.add('active');

    // Close on Escape
    const escHandler = (e) => {
      if (e.key === 'Escape' && overlay.classList.contains('active')) {
        overlay.classList.remove('active');
        document.removeEventListener('keydown', escHandler);
      }
    };
    document.addEventListener('keydown', escHandler);
  }

  function toggleHistory() {
    const panel = document.getElementById(HISTORY_ID);
    if (!panel) return;
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      refreshHistoryList();
      fetchRecentExecutions();
    }
  }

  function refreshHistoryList() {
    const panel = document.getElementById(HISTORY_ID);
    if (!panel) return;
    const list = panel.querySelector('.n8n-hist-list');
    if (!list) return;

    while (list.firstChild) list.removeChild(list.firstChild);

    if (executionHistory.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'n8n-hist-empty';
      empty.textContent = 'No executions yet.\nRun a workflow to see history.';
      list.appendChild(empty);
      return;
    }

    for (let i = 0; i < executionHistory.length; i++) {
      const exec = executionHistory[i];
      list.appendChild(createHistoryItem(exec));
    }
  }

  function createHistoryItem(exec) {
    const item = document.createElement('div');
    item.className = 'n8n-hist-item';
    item.setAttribute('data-exec-id', exec.id);

    // Top row: status + name + time
    const row = document.createElement('div');
    row.className = 'n8n-hist-row';

    const status = document.createElement('div');
    status.className = 'n8n-hist-status';
    if (exec.status === 'success' || exec.finished === true) {
      status.classList.add('n8n-hist-status-success');
    } else if (exec.status === 'error' || exec.status === 'failed') {
      status.classList.add('n8n-hist-status-error');
    } else {
      status.classList.add('n8n-hist-status-running');
    }
    row.appendChild(status);

    const name = document.createElement('span');
    name.className = 'n8n-hist-name';
    name.textContent = exec.workflowName || exec.workflowData?.name || 'Workflow';
    row.appendChild(name);

    const time = document.createElement('span');
    time.className = 'n8n-hist-time';
    time.textContent = exec.stoppedAt ? timeAgo(new Date(exec.stoppedAt).getTime()) : 'running';
    row.appendChild(time);

    item.appendChild(row);

    // Thumbnail strip (from cached binary data)
    if (exec.nodes && exec.nodes.size > 0) {
      const thumbs = document.createElement('div');
      thumbs.className = 'n8n-hist-thumbs';

      let thumbCount = 0;
      for (const [, bins] of exec.nodes) {
        for (const bin of bins) {
          if (thumbCount >= 6) break;
          if (bin.mimeType.startsWith('image/')) {
            const thumb = document.createElement('div');
            thumb.className = 'n8n-hist-thumb';
            const img = document.createElement('img');
            img.src = binaryUrl(bin.id);
            img.loading = 'lazy';
            thumb.appendChild(img);
            thumbs.appendChild(thumb);
            thumbCount++;
          }
        }
      }

      if (thumbCount > 0) item.appendChild(thumbs);

      // Node count
      const nodesLabel = document.createElement('div');
      nodesLabel.className = 'n8n-hist-nodes';
      const nodeNames = [...exec.nodes.keys()];
      nodesLabel.textContent = nodeNames.slice(0, 3).join(', ') + (nodeNames.length > 3 ? ` +${nodeNames.length - 3} more` : '');
      item.appendChild(nodesLabel);
    }

    // Compare checkbox
    const cmpChk = document.createElement('input');
    cmpChk.type = 'checkbox';
    cmpChk.style.cssText = 'position: absolute; top: 10px; right: 12px; accent-color: #42a5f5; cursor: pointer;';
    cmpChk.title = 'Select for compare';
    cmpChk.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCompareSelect(exec.id);
      cmpChk.checked = compareSelection.has(exec.id);
    });
    item.style.position = 'relative';
    item.appendChild(cmpChk);

    // Click to load previews
    item.addEventListener('click', () => {
      // Deselect others
      document.querySelectorAll('.n8n-hist-item.active').forEach(el => el.classList.remove('active'));
      item.classList.add('active');

      if (exec.nodes && exec.nodes.size > 0) {
        // Clear current previews
        document.querySelectorAll('.n8n-preview-container, .n8n-preview-header, .n8n-preview-count-badge').forEach(el => el.remove());
        previewCache.clear();

        // Load this execution's previews
        const ts = exec.stoppedAt ? new Date(exec.stoppedAt).getTime() : Date.now();
        for (const [nodeName, bins] of exec.nodes) {
          previewCache.set(nodeName, { items: bins, timestamp: ts });
          renderPreviewsOnNode(nodeName, bins, ts);
        }
      } else {
        // Fetch full execution data
        fetchAndLoadExecution(exec.id);
      }
    });

    return item;
  }

  async function fetchAndLoadExecution(execId) {
    try {
      const resp = await apiRequest(`/rest/executions/${encodeURIComponent(execId)}?includeData=true`);
      if (!resp.ok) return;
      const body = await resp.json();
      const data = body.data || body;
      processExecution(data);
    } catch (err) {
      console.warn('[N8N Preview] History load error:', err.message);
    }
  }

  async function fetchRecentExecutions() {
    try {
      const resp = await apiRequest('/rest/executions?limit=20&includeData=true');
      if (!resp.ok) return;
      const body = await resp.json();
      const execs = body.data || [];

      // Merge into history
      for (const exec of execs) {
        if (!exec.id) continue;
        const exists = executionHistory.find(e => e.id === exec.id);
        if (exists) continue;

        const { nodeMap } = extractBinaryFromExecution(exec);
        executionHistory.unshift({
          id: exec.id,
          status: exec.status || (exec.finished ? 'success' : 'unknown'),
          workflowName: exec.workflowData?.name || '',
          startedAt: exec.startedAt || '',
          stoppedAt: exec.stoppedAt || '',
          nodes: nodeMap,
        });
      }

      // Trim
      while (executionHistory.length > MAX_HISTORY) executionHistory.pop();

      refreshHistoryList();
    } catch (err) {
      console.warn('[N8N Preview] History fetch error:', err.message);
    }
  }

  // Also record executions as they're processed
  const origProcessExecution = processExecution;
  processExecution = function (executionData) {
    origProcessExecution(executionData);

    const { nodeMap } = extractBinaryFromExecution(executionData);
    const id = executionData.id || ('t' + Date.now());
    const exists = executionHistory.find(e => e.id === id);
    if (!exists && nodeMap.size > 0) {
      executionHistory.unshift({
        id: id,
        status: executionData.status || (executionData.finished ? 'success' : 'unknown'),
        workflowName: executionData.workflowData?.name || '',
        startedAt: executionData.startedAt || '',
        stoppedAt: executionData.stoppedAt || '',
        nodes: nodeMap,
      });
      while (executionHistory.length > MAX_HISTORY) executionHistory.pop();

      // Refresh if panel is open
      const panel = document.getElementById(HISTORY_ID);
      if (panel?.classList.contains('open')) refreshHistoryList();
    }
  };

  // Keyboard: Ctrl+Shift+H
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'H') {
      e.preventDefault();
      toggleHistory();
    }
  });

  // ─── Error Node Rendering ──────────────────────────────
  function renderErrorOnNode(nodeName, errorMessage) {
    const node = findCanvasNode(nodeName);
    if (!node) return;
    // Remove existing error state
    const existing = node.querySelector('.n8n-preview-error-state');
    if (existing) existing.remove();

    const errWrap = document.createElement('div');
    errWrap.className = 'n8n-preview-error-state';
    const icon = document.createElement('div');
    icon.className = 'n8n-preview-error-icon';
    icon.textContent = '\u274C';
    const msg = document.createElement('div');
    msg.className = 'n8n-preview-error-msg';
    msg.textContent = errorMessage || 'Node execution failed';
    msg.title = errorMessage || '';
    errWrap.appendChild(icon);
    errWrap.appendChild(msg);
    node.appendChild(errWrap);
  }

  // Extract error info from execution data
  function extractErrorsFromExecution(executionData) {
    const errors = new Map();
    try {
      const runData = executionData?.data?.resultData?.runData;
      if (!runData) return errors;
      for (const [nodeName, runs] of Object.entries(runData)) {
        for (const run of runs) {
          if (run.error) {
            errors.set(nodeName, run.error.message || run.error.description || 'Error');
          }
        }
      }
      // Also check top-level execution error
      const lastErr = executionData?.data?.resultData?.error;
      if (lastErr) {
        const lastNode = executionData?.data?.resultData?.lastNodeExecuted;
        if (lastNode && !errors.has(lastNode)) {
          errors.set(lastNode, lastErr.message || 'Workflow error');
        }
      }
    } catch { /* ignore */ }
    return errors;
  }

  // Patch processExecution to also show errors
  const _origProcExec = processExecution;
  processExecution = function (executionData) {
    _origProcExec(executionData);
    const errors = extractErrorsFromExecution(executionData);
    for (const [nodeName, errMsg] of errors) {
      renderErrorOnNode(nodeName, errMsg);
    }
  };

  // ─── API Key Fallback ─────────────────────────────────
  let apiKeyPrompted = false;
  const origPollExecutions = pollExecutions;
  pollExecutions = async function () {
    if (!previewsEnabled) return;
    try {
      const headers = { 'Accept': 'application/json' };
      const apiKey = localStorage.getItem('n8n-preview-apikey');
      if (apiKey) headers['X-N8N-API-KEY'] = apiKey;
      const resp = await originalFetch('/rest/executions?limit=5&includeData=true', {
        credentials: 'include', headers,
      });
      if (resp.status === 401 && !apiKeyPrompted) {
        apiKeyPrompted = true;
        const key = prompt('[N8N Preview] API authentication required.\nEnter your N8N API key:');
        if (key) {
          localStorage.setItem('n8n-preview-apikey', key);
          console.log('[N8N Preview] API key saved');
          return pollExecutions();
        }
        return;
      }
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
  };

  // ─── Multi-Workflow URL Change Detection ──────────────
  let lastWorkflowUrl = window.location.pathname;

  function checkWorkflowChange() {
    const current = window.location.pathname;
    if (current !== lastWorkflowUrl) {
      lastWorkflowUrl = current;
      // Clear previews on workflow switch
      previewCache.clear();
      lastExecutionId = null;
      document.querySelectorAll(
        '.n8n-preview-container, .n8n-preview-header, .n8n-preview-count-badge, .n8n-preview-error-state, .n8n-preview-spinner'
      ).forEach(el => el.remove());
      document.querySelectorAll('.n8n-preview-executing').forEach(el => el.classList.remove('n8n-preview-executing'));
      executingNodes.clear();
      console.log('[N8N Preview] Workflow changed, cleared previews');
    }
  }

  // Listen for SPA navigation
  const origPushState = history.pushState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    checkWorkflowChange();
  };
  const origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    checkWorkflowChange();
  };
  window.addEventListener('popstate', checkWorkflowChange);

  // ─── Large Execution Cap ──────────────────────────────
  // Patch extractBinaryFromExecution to cap at MAX_BINARY_ITEMS
  const _origExtract = extractBinaryFromExecution;
  extractBinaryFromExecution = function (executionData) {
    const nodeMap = _origExtract(executionData);
    let totalItems = 0;
    for (const [, bins] of nodeMap) totalItems += bins.length;

    if (totalItems > MAX_BINARY_ITEMS) {
      console.warn('[N8N Preview] Large execution: ' + totalItems + ' items, capping at ' + MAX_BINARY_ITEMS);
      let remaining = MAX_BINARY_ITEMS;
      for (const [nodeName, bins] of nodeMap) {
        if (remaining <= 0) {
          nodeMap.delete(nodeName);
          continue;
        }
        if (bins.length > remaining) {
          nodeMap.set(nodeName, bins.slice(0, remaining));
        }
        remaining -= Math.min(bins.length, remaining);
      }
    }
    return nodeMap;
  };


  // --- Workflow Change Detection ---
  function watchWorkflowChanges() {
    const check = () => {
      const url = location.href;
      if (url !== currentWorkflowUrl) {
        const oldWf = currentWorkflowUrl.split('/workflow/')[1]?.split(/[?#]/)[0] || '';
        const newWf = url.split('/workflow/')[1]?.split(/[?#]/)[0] || '';
        currentWorkflowUrl = url;
        if (oldWf !== newWf && oldWf && newWf) {
          previewCache.clear();
          for (const n of executingNodes) removeNodeSpinner(n);
          executingNodes.clear();
          document.querySelectorAll('.n8n-preview-container, .n8n-preview-header, .n8n-preview-count-badge').forEach(el => el.remove());
          lastExecutionId = null;
          console.log('[N8N Preview] Workflow changed, cleared previews');
        }
      }
    };
    for (const m of ['pushState', 'replaceState']) {
      const orig = history[m];
      history[m] = function (...a) { const r = orig.apply(this, a); check(); return r; };
    }
    window.addEventListener('popstate', check);
    setInterval(check, 2000);
  }

  // ─── Init ───────────────────────────────────────────────
  injectStyles();
  injectBadge();
  injectFabGroup();
  injectSettingsPanel();
  injectLightbox();
  injectHistoryPanel();
  watchCanvasChanges();
  watchWorkflowChanges();
  // Start WS, fall back to polling
  setTimeout(() => {
    connectWebSocket();
    // Initial poll + fallback timer (WS onopen will stop polling if connected)
    pollExecutions();
    pollTimer = setInterval(pollExecutions, POLL_INTERVAL);
  }, 2000);

})();
