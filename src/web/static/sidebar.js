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

  function init() {
    document.querySelectorAll('[data-filter-list]').forEach(initList);
    initAvatar();
    initResizer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
