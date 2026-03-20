/**
 * N8N Node Preview Injector v0.1.0
 * Adds live image & video previews directly onto N8N canvas nodes.
 * Injected via Nginx sub_filter into the N8N HTML page.
 *
 * @license MIT
 * @author Ariel Tolome
 */
(function () {
  'use strict';

  const VERSION = '0.1.0';
  const STORAGE_KEY = 'n8n-preview-settings';
  const STYLE_ID = 'n8n-preview-styles';
  const BADGE_ID = 'n8n-preview-badge';

  /** @returns {boolean} True if injector already initialized */
  const isAlreadyLoaded = () => !!document.getElementById(STYLE_ID);

  if (isAlreadyLoaded()) return;

  console.log(`%c[N8N Preview] Injector v${VERSION} loaded`, 'color: #ff9800; font-weight: bold;');

  /**
   * Injects base styles for the preview system.
   */
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

      #${BADGE_ID}:hover {
        opacity: 0.85;
      }

      .n8n-preview-fade-in {
        animation: n8nPreviewFadeIn 0.3s ease-out;
      }

      @keyframes n8nPreviewFadeIn {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  };

  /**
   * Finds the N8N top toolbar and injects the status badge.
   * Uses MutationObserver to wait for the toolbar to appear.
   */
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

          console.log(`[N8N Preview] Badge injected via selector: ${sel}`);
          return true;
        }
      }
      return false;
    };

    if (tryInsert()) return;

    const observer = new MutationObserver((_mutations, obs) => {
      if (tryInsert()) {
        obs.disconnect();
      }
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
        Object.assign(fallback.style, {
          position: 'fixed',
          top: '10px',
          right: '10px',
          zIndex: '99999',
        });
        document.body.appendChild(fallback);
        console.log('[N8N Preview] Badge injected as fixed fallback');
      }
    }, 10000);
  };

  injectStyles();
  injectBadge();
})();
