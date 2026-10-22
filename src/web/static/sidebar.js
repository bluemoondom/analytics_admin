// Sidebar helpers: per-list search filter, item counts, user avatar initials
// and the drag handle that resizes the sidebar.
// Lists are re-rendered by app.js / view-modeling.js / connectors.js, so the
// filter and counts are re-applied whenever a list's children change.
(function () {
  function applyFilter(list, term) {
    const needle = (term || '').trim().toLowerCase();
    list.querySelectorAll(':scope > li').forEach(li => {
      const match = !needle || li.textContent.toLowerCase().includes(needle);
      li.classList.toggle('nav-filtered-out', !match);
    });
  }

  function updateCount(list) {
    const badge = document.querySelector(`[data-count-for="${list.id}"]`);
    if (!badge) return;
    const n = list.querySelectorAll(':scope > li').length;
    badge.textContent = n ? String(n) : '';
  }

  function initList(input) {
    const list = document.getElementById(input.dataset.filterList);
    if (!list) return;
    input.addEventListener('input', () => applyFilter(list, input.value));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        input.value = '';
        applyFilter(list, '');
      }
    });
    new MutationObserver(() => {
      applyFilter(list, input.value);
      updateCount(list);
    }).observe(list, { childList: true });
    updateCount(list);
  }

  function initAvatar() {
    const trigger = document.getElementById('user-trigger');
    const email = trigger && trigger.querySelector('.user-email');
    if (!trigger || !email || trigger.querySelector('.user-avatar')) return;
    const local = (email.textContent || '').trim().split('@')[0];
    const parts = local.split(/[._-]+/).filter(Boolean);
    const initials = (parts.length > 1 ? parts[0][0] + parts[1][0] : local.slice(0, 1)) || '?';
    const avatar = document.createElement('span');
    avatar.className = 'user-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = initials;
    trigger.insertBefore(avatar, trigger.firstChild);
  }

  // ---------------------------------------------------------------
  // Resizable width (mouse, touch, keyboard); remembered per browser.
  // ---------------------------------------------------------------
  const WIDTH_KEY = 'analytics_sidebar_width';
  const DEFAULT_WIDTH = 280;
  const MIN_WIDTH = 220;
  const KEY_STEP = 16;

  function maxWidth() {
    return Math.max(MIN_WIDTH, Math.min(560, Math.round(window.innerWidth * 0.45)));
  }

  function clampWidth(w) {
    return Math.round(Math.max(MIN_WIDTH, Math.min(maxWidth(), w)));
  }

  function readStoredWidth() {
    try {
      const v = parseInt(localStorage.getItem(WIDTH_KEY), 10);
      return Number.isFinite(v) ? v : null;
    } catch (e) {
      return null;
    }
  }

  function storeWidth(w) {
    try {
      if (w === null) localStorage.removeItem(WIDTH_KEY);
      else localStorage.setItem(WIDTH_KEY, String(w));
    } catch (e) {
      // Private mode / blocked storage: the width just is not remembered.
    }
  }

  function setWidth(w, handle) {
    const width = clampWidth(w);
    document.documentElement.style.setProperty('--sidebar-width', width + 'px');
    if (handle) {
      handle.setAttribute('aria-valuenow', String(width));
      handle.setAttribute('aria-valuemax', String(maxWidth()));
    }
    return width;
  }

  function initResizer() {
    const handle = document.getElementById('sidebar-resizer');
    const sidebar = handle && handle.closest('.sidebar');
    if (!handle || !sidebar) return;
    handle.setAttribute('aria-valuemin', String(MIN_WIDTH));
    let current = setWidth(readStoredWidth() || DEFAULT_WIDTH, handle);

    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebar.getBoundingClientRect().width;
      handle.setPointerCapture(e.pointerId);
      handle.classList.add('resizing');
      document.body.classList.add('sidebar-resizing');

      function onMove(ev) {
        current = setWidth(startWidth + (ev.clientX - startX), handle);
      }
      function onUp() {
        handle.classList.remove('resizing');
        document.body.classList.remove('sidebar-resizing');
        handle.removeEventListener('pointermove', onMove);
        handle.removeEventListener('pointerup', onUp);
        handle.removeEventListener('pointercancel', onUp);
        storeWidth(current);
        // Let charts and other size-dependent widgets re-layout.
        window.dispatchEvent(new Event('resize'));
      }
      handle.addEventListener('pointermove', onMove);
      handle.addEventListener('pointerup', onUp);
      handle.addEventListener('pointercancel', onUp);
    });

    handle.addEventListener('dblclick', () => {
      current = setWidth(DEFAULT_WIDTH, handle);
      storeWidth(null);
      window.dispatchEvent(new Event('resize'));
    });

    handle.addEventListener('keydown', (e) => {
      let next = null;
      if (e.key === 'ArrowLeft') next = current - KEY_STEP;
      else if (e.key === 'ArrowRight') next = current + KEY_STEP;
      else if (e.key === 'Home') next = MIN_WIDTH;
      else if (e.key === 'End') next = maxWidth();
      if (next === null) return;
      e.preventDefault();
      current = setWidth(next, handle);
      storeWidth(current);
    });

    // Keep the stored width valid when the window gets smaller.
    window.addEventListener('resize', () => {
      const fitted = clampWidth(current);
      if (fitted !== current) current = setWidth(fitted, handle);
    });
  }

  // ---------------------------------------------------------------
  // Responsive shell
  //  * wide screens: the sidebar can be collapsed to an icon rail
  //    (remembered per browser);
  //  * narrow screens: the sidebar is a drawer opened from the top bar;
  //  * a backdrop covers the page while the drawer or the dashboard
  //    settings panel is open on a narrow screen.
  // ---------------------------------------------------------------
  const COLLAPSED_KEY = 'analytics_sidebar_collapsed';
  const DRAWER_QUERY = window.matchMedia('(max-width: 1023.98px)');
  const root = document.documentElement;

  function tr(key, fallback) {
    return window.I18n && window.I18n.isReady() ? window.I18n.t(key) : fallback;
  }

  function readCollapsed() {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === '1';
    } catch (e) {
      return false;
    }
  }

  function storeCollapsed(value) {
    try {
      if (value) localStorage.setItem(COLLAPSED_KEY, '1');
      else localStorage.removeItem(COLLAPSED_KEY);
    } catch (e) {
      // Not remembered without storage.
    }
  }

  // Apply the remembered rail state before the first paint of the content.
  root.classList.toggle('sidebar-collapsed', readCollapsed());

  function notifyResize() {
    // Charts and the table navigation re-measure after the transition.
    window.setTimeout(() => window.dispatchEvent(new Event('resize')), 260);
  }

  function initShell() {
    const sidebar = document.getElementById('app-sidebar');
    const collapseBtn = document.getElementById('sidebar-collapse');
    const toggleBtn = document.getElementById('sidebar-toggle');
    const backdrop = document.getElementById('shell-backdrop');
    const title = document.getElementById('topbar-title');
    const panel = document.getElementById('right-panel');
    if (!sidebar || !collapseBtn) return;
    const navItems = Array.from(sidebar.querySelectorAll('.side-nav .nav-item'));

    function navLabel(item) {
      const span = item.querySelector('span[data-i18n]');
      return span ? span.textContent.trim() : '';
    }

    function syncLabels() {
      const collapsed = root.classList.contains('sidebar-collapsed') && !DRAWER_QUERY.matches;
      const key = DRAWER_QUERY.matches ? 'sidebar_close_title'
        : collapsed ? 'sidebar_expand_title' : 'sidebar_collapse_title';
      const fallback = DRAWER_QUERY.matches ? 'Zavřít menu' : collapsed ? 'Rozbalit menu' : 'Sbalit menu';
      collapseBtn.dataset.i18n = key;
      collapseBtn.setAttribute('title', tr(key, fallback));
      const sr = collapseBtn.querySelector('.sr-only');
      if (sr) {
        sr.dataset.i18n = key;
        sr.textContent = tr(key, fallback);
      }
      collapseBtn.setAttribute('aria-expanded', String(DRAWER_QUERY.matches ? root.classList.contains('sidebar-open') : !collapsed));
      // Icon-only navigation shows its labels as tooltips.
      navItems.forEach(item => {
        if (collapsed) item.setAttribute('title', navLabel(item));
        else item.removeAttribute('title');
      });
      const active = navItems.find(item => item.classList.contains('active'));
      if (title && active) title.textContent = navLabel(active);
    }

    function updateBackdrop() {
      const narrow = DRAWER_QUERY.matches;
      const panelOpen = narrow && panel && !panel.classList.contains('collapsed');
      root.classList.toggle('panel-open', Boolean(panelOpen));
      if (backdrop) backdrop.classList.toggle('visible', narrow && (root.classList.contains('sidebar-open') || Boolean(panelOpen)));
    }

    function setDrawer(open) {
      root.classList.toggle('sidebar-open', open);
      if (toggleBtn) toggleBtn.setAttribute('aria-expanded', String(open));
      syncLabels();
      updateBackdrop();
      if (open) {
        const focusTarget = sidebar.querySelector('.nav-item.active') || collapseBtn;
        window.setTimeout(() => focusTarget.focus({ preventScroll: true }), 50);
      }
    }

    function closePanel() {
      const close = document.getElementById('right-panel-close');
      if (close) close.click();
    }

    collapseBtn.addEventListener('click', () => {
      if (DRAWER_QUERY.matches) {
        setDrawer(false);
        if (toggleBtn) toggleBtn.focus({ preventScroll: true });
        return;
      }
      const collapsed = !root.classList.contains('sidebar-collapsed');
      root.classList.toggle('sidebar-collapsed', collapsed);
      storeCollapsed(collapsed);
      syncLabels();
      notifyResize();
    });

    if (toggleBtn) toggleBtn.addEventListener('click', () => setDrawer(!root.classList.contains('sidebar-open')));

    if (backdrop) {
      backdrop.addEventListener('click', () => {
        if (root.classList.contains('sidebar-open')) setDrawer(false);
        else if (root.classList.contains('panel-open')) closePanel();
      });
    }

    // Picking an item (or creating a new one) in the drawer shows the work area.
    // Capture phase: row buttons stop propagation of their clicks.
    sidebar.addEventListener('click', (e) => {
      if (!DRAWER_QUERY.matches || !root.classList.contains('sidebar-open')) return;
      const item = e.target.closest('.nav-list li, .nav-add');
      if (item && !e.target.closest('input, select, textarea')) window.setTimeout(() => setDrawer(false), 0);
    }, true);

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !DRAWER_QUERY.matches) return;
      if (root.classList.contains('sidebar-open')) {
        setDrawer(false);
        if (toggleBtn) toggleBtn.focus({ preventScroll: true });
      } else if (root.classList.contains('panel-open') && !document.querySelector('.modal:not(.hidden)')) {
        closePanel();
      }
    });

    const onMediaChange = () => {
      if (!DRAWER_QUERY.matches) setDrawer(false);
      syncLabels();
      updateBackdrop();
      notifyResize();
    };
    if (DRAWER_QUERY.addEventListener) DRAWER_QUERY.addEventListener('change', onMediaChange);
    else if (DRAWER_QUERY.addListener) DRAWER_QUERY.addListener(onMediaChange);

    // Active module and translated labels change the top bar title and tooltips.
    const nav = sidebar.querySelector('.side-nav');
    if (nav) {
      new MutationObserver(syncLabels).observe(nav, {
        subtree: true, attributes: true, attributeFilter: ['class'], childList: true, characterData: true,
      });
    }
    if (panel) new MutationObserver(updateBackdrop).observe(panel, { attributes: true, attributeFilter: ['class'] });

    // Opaque drawer and top bar in the colour of the selected page background.
    const syncBackground = () => {
      const bg = window.getComputedStyle(document.body).backgroundColor;
      root.style.setProperty('--shell-bg', bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent' ? bg : '#ffffff');
    };
    new MutationObserver(syncBackground).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    syncBackground();

    syncLabels();
    updateBackdrop();
    window.addEventListener('load', () => {
      if (window.I18n && window.I18n.onChange) window.I18n.onChange(() => window.setTimeout(syncLabels, 0));
      syncLabels();
    });
  }

  function init() {
    // Each part is independent: a failure in one must not leave the menu
    // button (or the others) without their handlers.
    [
      () => document.querySelectorAll('[data-filter-list]').forEach(initList),
      initShell,
      initAvatar,
      initResizer,
    ].forEach((fn) => {
      try {
        fn();
      } catch (e) {
        if (window.console) console.error('Sidebar initialisation failed', e);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
