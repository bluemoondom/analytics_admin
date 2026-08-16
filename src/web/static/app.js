(function () {
  const t = window.I18n ? window.I18n.t : (k, p) => `{${k}}`;

  const API = '/api/dashboards';

  const DEFAULT_COLORS = [
    'rgba(37, 99, 235, 0.7)',
    'rgba(220, 38, 38, 0.7)',
    'rgba(16, 185, 129, 0.7)',
    'rgba(245, 158, 11, 0.7)',
    'rgba(139, 92, 246, 0.7)',
    'rgba(6, 182, 212, 0.7)',
    'rgba(236, 72, 153, 0.7)',
    'rgba(99, 102, 241, 0.7)',
  ];

  const CHART_TYPES = [
    { value: 'bar', labelKey: 'chart_type_bar' },
    { value: 'stacked_bar', labelKey: 'chart_type_stacked_bar' },
    { value: 'grouped_bar', labelKey: 'chart_type_grouped_bar' },
    { value: 'percent_bar', labelKey: 'chart_type_percent_bar' },
    { value: 'horizontal_bar', labelKey: 'chart_type_horizontal_bar' },
    { value: 'stacked_horizontal_bar', labelKey: 'chart_type_stacked_horizontal_bar' },
    { value: 'grouped_horizontal_bar', labelKey: 'chart_type_grouped_horizontal_bar' },
    { value: 'percent_horizontal_bar', labelKey: 'chart_type_percent_horizontal_bar' },
    { value: 'line', labelKey: 'chart_type_line' },
    { value: 'area', labelKey: 'chart_type_area' },
    { value: 'stacked_area', labelKey: 'chart_type_stacked_area' },
    { value: 'percent_area', labelKey: 'chart_type_percent_area' },
    { value: 'pie', labelKey: 'chart_type_pie' },
    { value: 'doughnut', labelKey: 'chart_type_doughnut' },
    { value: 'gauge', labelKey: 'chart_type_gauge' },
    { value: 'funnel', labelKey: 'chart_type_funnel' },
    { value: 'scatter', labelKey: 'chart_type_scatter' },
  ];

  const SERIES_AGGREGATION_LABELS = {
    sum: 'series_aggregation_sum',
    count: 'series_aggregation_count',
    avg: 'series_aggregation_avg',
    min: 'series_aggregation_min',
    max: 'series_aggregation_max',
  };

  const SERIES_RENDER_LABELS = {
    bar: 'series_render_bar',
    line: 'series_render_line',
  };

  const COLOR_SCHEMES = {
    default: DEFAULT_COLORS,
    warm: [
      'rgba(185, 28, 28, 0.7)',
      'rgba(217, 119, 6, 0.7)',
      'rgba(250, 204, 21, 0.7)',
      'rgba(124, 45, 18, 0.7)',
      'rgba(159, 18, 57, 0.7)',
      'rgba(220, 38, 38, 0.7)',
      'rgba(245, 158, 11, 0.7)',
      'rgba(252, 211, 77, 0.7)',
    ],
    cool: [
      'rgba(30, 64, 175, 0.7)',
      'rgba(37, 99, 235, 0.7)',
      'rgba(14, 165, 233, 0.7)',
      'rgba(13, 148, 136, 0.7)',
      'rgba(99, 102, 241, 0.7)',
      'rgba(6, 182, 212, 0.7)',
      'rgba(59, 130, 246, 0.7)',
      'rgba(45, 212, 191, 0.7)',
    ],
    pastel: [
      'rgba(251, 113, 133, 0.7)',
      'rgba(244, 114, 182, 0.7)',
      'rgba(192, 132, 252, 0.7)',
      'rgba(129, 140, 248, 0.7)',
      'rgba(96, 165, 250, 0.7)',
      'rgba(103, 232, 249, 0.7)',
      'rgba(167, 243, 208, 0.7)',
      'rgba(253, 224, 71, 0.7)',
    ],
  };

  let state = {
    dashboards: [],
    views: [],
    currentDashboard: null,
    columns: [],
    data: { columns: [], rows: [], column_types: {} },
    chartInstances: {},
    aliasColumn: null,
    expandedChart: null,
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function parseBool(value, defaultValue) {
    if (typeof value === 'boolean') return value;
    if (value === null || value === undefined) return defaultValue;
    return [1, '1', true, 'true', 'TRUE', 'yes', 'YES'].includes(value);
  }

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET' && method !== 'HEAD') {
      const token = csrfToken();
      if (token) opts.headers['X-CSRF-Token'] = token;
    }
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  async function apiRaw(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (method !== 'GET' && method !== 'HEAD') {
      const token = csrfToken();
      if (token) opts.headers['X-CSRF-Token'] = token;
    }
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return { blob: await res.blob(), filename: extractFilename(res.headers.get('content-disposition')) };
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function extractFilename(header) {
    if (!header) return 'download';
    const m = header.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    return m ? m[1].replace(/['"]/g, '') : 'download';
  }

  function init() {
    bindLanguageSwitcher();
    bindUserMenu();
    if (window.ConnectorManager) window.ConnectorManager.init();
    if (window.I18n && window.I18n.isReady && window.I18n.isReady()) {
      loadViews();
      loadDashboards();
    } else if (window.I18n) {
      const unsubscribe = window.I18n.onChange(() => {
        unsubscribe();
        loadViews();
        loadDashboards();
      });
    } else {
      loadViews();
      loadDashboards();
    }
    bindEvents();
    bindMenuSwitch();
  }

  function bindUserMenu() {
    const section = $('#user-section');
    const trigger = $('#user-trigger');
    const logoutButton = $('#logout-button');
    if (!section || !trigger) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = section.classList.toggle('open');
      trigger.setAttribute('aria-expanded', String(open));
    });
    document.addEventListener('click', (e) => {
      if (!section.contains(e.target)) {
        section.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
      }
    });

    if (logoutButton) {
      logoutButton.addEventListener('click', async () => {
        try {
          const headers = {};
          const token = csrfToken();
          if (token) headers['X-CSRF-Token'] = token;
          const res = await fetch('/auth/logout', { method: 'POST', headers });
          if (res.ok) {
            window.location.href = '/login';
          }
        } catch (err) {
          console.error('Logout failed', err);
        }
      });
    }
  }

  function bindLanguageSwitcher() {
    const container = $('#lang-switcher');
    const trigger = $('#lang-switcher-trigger');
    const options = $('#lang-switcher-options');
    if (!container || !trigger || !options) return;

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      container.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        container.classList.remove('open');
      }
    });
    options.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.addEventListener('click', (e) => {
        e.stopPropagation();
        if (window.I18n) window.I18n.setLanguage(opt.dataset.lang);
        options.classList.remove('open');
      });
      opt.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (window.I18n) window.I18n.setLanguage(opt.dataset.lang);
          options.classList.remove('open');
        }
      });
    });

    if (window.I18n) {
      window.I18n.onChange(updateLanguageActiveState);
      window.I18n.onChange(() => {
        renderDashboardList();
        if (state.currentDashboard) {
          renderAllFieldPanels();
          renderFilters();
          renderChartControls();
          translateSeriesRowLabels();
          renderCharts();
        }
      });
      updateLanguageActiveState(window.I18n.getLang());
    }
  }

  const LANG_LABELS = {
    cs: { name: 'Čeština', flag: '/static/icons/flag-cs.svg' },
    en: { name: 'English', flag: '/static/icons/flag-en.svg' },
    de: { name: 'Deutsch', flag: '/static/icons/flag-de.svg' },
    fr: { name: 'Français', flag: '/static/icons/flag-fr.svg' },
  };

  function updateLanguageActiveState(language) {
    const trigger = $('#lang-switcher-trigger');
    const options = $('#lang-switcher-options');
    if (!trigger || !options) return;
    const info = LANG_LABELS[language] || LANG_LABELS.en;
    trigger.innerHTML = `
      <img src="${esc(info.flag)}" alt="" class="flag-icon" />
      <span>${esc(info.name)}</span>
    `;
    options.querySelectorAll('.custom-select-option').forEach(opt => {
      opt.classList.toggle('active', opt.dataset.lang === language);
    });
  }

  function translateSeriesRowLabels() {
    $('#chart-series-list').querySelectorAll('.chart-series-row').forEach(row => {
      row.querySelectorAll('.series-agg').forEach(sel => {
        try {
          const labels = JSON.parse(sel.dataset.i18nOpts || '{}');
          Array.from(sel.options).forEach(opt => {
            const key = labels[opt.value];
            if (key) opt.textContent = t(key);
          });
        } catch (e) { /* ignore parse errors */ }
      });
      row.querySelectorAll('.series-render').forEach(sel => {
        try {
          const labels = JSON.parse(sel.dataset.i18nOpts || '{}');
          Array.from(sel.options).forEach(opt => {
            const key = labels[opt.value];
            if (key) opt.textContent = t(key);
          });
        } catch (e) { /* ignore parse errors */ }
      });
    });
  }

  function bindMenuSwitch() {
    const dashBtn = $('#menu-dashboards');
    const viewBtn = $('#menu-view-modeling');
    const connBtn = $('#menu-connectors');
    if (!dashBtn || !viewBtn) return;
    dashBtn.addEventListener('click', () => {
      hideConnectorSection();
      showDashboardSection();
    });
    viewBtn.addEventListener('click', () => {
      hideConnectorSection();
      showViewModelingSection();
    });
    if (connBtn) {
      connBtn.addEventListener('click', () => {
        showConnectorSection();
      });
    }
  }

  function hideConnectorSection() {
    $('#connectors-menu-section')?.classList.add('hidden');
    $('#connectors-page')?.classList.add('hidden');
  }

  function showConnectorSection() {
    document.querySelectorAll('.top-menu button').forEach((btn) => btn.classList.remove('active', 'primary'));
    $('#menu-connectors')?.classList.add('active', 'primary');
    $('#dashboard-menu-section').classList.add('hidden');
    $('#view-menu-section').classList.add('hidden');
    $('#connectors-menu-section')?.classList.remove('hidden');
    $('#builder').classList.add('hidden');
    $('#view-modeling-page').classList.add('hidden');
    $('#empty-state').classList.add('hidden');
    $('#connectors-page')?.classList.remove('hidden');
    if (window.ConnectorManager) window.ConnectorManager.onShow();
  }

  function showDashboardSection() {
    const dashBtn = $('#menu-dashboards');
    const viewBtn = $('#menu-view-modeling');
    const connBtn = $('#menu-connectors');
    $('#dashboard-menu-section').classList.remove('hidden');
    $('#view-menu-section').classList.add('hidden');
    $('#view-modeling-page').classList.add('hidden');
    dashBtn.classList.add('active', 'primary');
    viewBtn.classList.remove('active', 'primary');
    if (connBtn) connBtn.classList.remove('active', 'primary');
    if (!state.currentDashboard) {
      $('#builder').classList.add('hidden');
      $('#empty-state').classList.remove('hidden');
    } else {
      $('#builder').classList.remove('hidden');
      $('#empty-state').classList.add('hidden');
    }
  }

  function showViewModelingSection() {
    const dashBtn = $('#menu-dashboards');
    const viewBtn = $('#menu-view-modeling');
    const connBtn = $('#menu-connectors');
    $('#dashboard-menu-section').classList.add('hidden');
    $('#view-menu-section').classList.remove('hidden');
    $('#builder').classList.add('hidden');
    $('#empty-state').classList.add('hidden');
    $('#view-modeling-page').classList.remove('hidden');
    dashBtn.classList.remove('active', 'primary');
    viewBtn.classList.add('active', 'primary');
    if (connBtn) connBtn.classList.remove('active', 'primary');
  }

  function bindEvents() {
    bindControl('new-dashboard', 'click', newDashboard);
    bindControl('save-dashboard', 'click', saveDashboard);
    bindControl('delete-dashboard', 'click', deleteDashboard);
    bindControl('view-select', 'change', () => onViewChange(true));
    bindControl('add-chart', 'click', addChart);
    bindControl('add-series', 'click', () => addSeriesRow());
    bindCustomChartTypeSelect();
    bindControl('export-excel', 'click', exportExcel);
    bindControl('export-pdf', 'click', exportPdf);
    bindControl('copy-dashboard', 'click', copyDashboard);
    bindControl('right-panel-open', 'click', openRightPanel);
    bindControl('right-panel-close', 'click', closeRightPanel);
    bindControl('right-panel-handle', 'mousedown', startResize);

    bindControl('alias-cancel', 'click', closeAliasModal);
    bindControl('alias-save', 'click', saveAlias);
    const aliasBackdrop = $('#alias-modal .modal-backdrop');
    if (aliasBackdrop) aliasBackdrop.addEventListener('click', closeAliasModal);
    bindControl('alias-input', 'keydown', (e) => {
      if (e.key === 'Enter') saveAlias();
      if (e.key === 'Escape') closeAliasModal();
    });

    $$('.rp-accordion-header').forEach(header => {
      header.addEventListener('click', () => toggleAccordion(header));
    });

    bindSetting('setting-number-format', 'change', (el) => {
      state.currentDashboard.number_format = el.value;
      refreshData();
    });
    bindSetting('setting-date-time-format', 'change', (el) => {
      state.currentDashboard.date_time_format = el.value;
      refreshData();
    });
    bindSetting('setting-color-scheme', 'change', (el) => {
      state.currentDashboard.color_scheme = el.value;
      renderCharts();
    });
    bindSetting('setting-row-limit', 'change', (el) => {
      const v = parseInt(el.value, 10);
      state.currentDashboard.row_limit = Number.isNaN(v) ? 1000 : Math.max(0, v);
      refreshData();
    });
    bindSetting('setting-charts-per-row', 'change', (el) => {
      state.currentDashboard.charts_per_row = parseInt(el.value) || 3;
      updateChartsPerRowStyle();
    });
    bindSetting('setting-chart-height', 'change', (el) => {
      state.currentDashboard.chart_card_height = parseInt(el.value) || 360;
      updateChartsPerRowStyle();
    });
    bindSetting('setting-show-grid', 'change', (el) => {
      state.currentDashboard.show_grid = el.checked;
      renderCharts();
    });
    bindSetting('setting-replace-null', 'change', (el) => {
      state.currentDashboard.replace_null_with_empty = el.checked;
      refreshData();
    });
    bindSetting('setting-color-numeric-sign', 'change', (el) => {
      state.currentDashboard.color_numeric_sign = el.checked;
      refreshData();
    });
  }

  function bindControl(id, event, handler) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(event, handler);
  }

  function bindSetting(id, event, handler) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(event, () => handler(el));
  }

  // ------------------------------------------------------------------
  // Right panel: open/close/resize
  // ------------------------------------------------------------------
  function openRightPanel() {
    $('#right-panel').classList.remove('collapsed');
  }

  function closeRightPanel() {
    $('#right-panel').classList.add('collapsed');
  }

  function startResize(e) {
    e.preventDefault();
    const panel = $('#right-panel');
    const handle = $('#right-panel-handle');
    handle.classList.add('resizing');
    const startX = e.clientX;
    const startWidth = panel.offsetWidth;

    function onMove(ev) {
      const delta = startX - ev.clientX;
      const newWidth = Math.max(280, Math.min(window.innerWidth * 0.8, startWidth + delta));
      panel.style.width = newWidth + 'px';
    }

    function onUp() {
      handle.classList.remove('resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }

  function toggleAccordion(header) {
    const section = header.dataset.section;
    const body = $('#rp-section-' + section);
    const willOpen = !body.classList.contains('open');
    // Close all accordions first so only one section is open at a time.
    $$('.rp-accordion-body').forEach(b => b.classList.remove('open'));
    $$('.rp-accordion-header').forEach(h => h.classList.remove('active'));
    if (willOpen) {
      header.classList.add('active');
      body.classList.add('open');
    }
  }

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------
  async function loadViews() {
    state.views = await api('GET', '/views');
    const sel = $('#view-select');
    sel.innerHTML = '<option value="">' + esc(t('view_select_placeholder')) + '</option>' +
      state.views.map(v => `<option value="${esc(v.system_name)}">${esc(v.display_name)}</option>`).join('');
  }

  async function loadDashboards() {
    state.dashboards = await api('GET', '/');
    renderDashboardList();
  }

  function renderDashboardList() {
    const list = $('#dashboard-list');
    list.innerHTML = state.dashboards.map(d => {
      const active = state.currentDashboard && state.currentDashboard.id === d.id ? 'active' : '';
      return `<li class="${active}" data-id="${d.id}">
        <div>
          <div>${esc(d.name)}</div>
          <div class="meta">${esc(d.view_name)}</div>
        </div>
      </li>`;
    }).join('');
    list.querySelectorAll('li').forEach(li => {
      li.addEventListener('click', () => openDashboard(parseInt(li.dataset.id)));
    });
  }

  function newDashboard() {
    showDashboardSection();
    state.currentDashboard = {
      id: null,
      name: t('default_dashboard_name'),
      view_name: '',
      view_display_name: '',
      visible_columns: [],
      filters: [],
      sort_by: '',
      sort_desc: false,
      sort: [],
      group_by: [],
      aggregations: {},
      column_aliases: {},
      charts: [],
      number_format: '#,##0.00',
      date_time_format: 'dd.MM.yyyy HH:mm',
      color_scheme: 'default',
      charts_per_row: 3,
      chart_card_height: 360,
      show_grid: true,
      replace_null_with_empty: true,
      color_numeric_sign: false,
      row_limit: 1000,
      dimension_columns: [],
      drill_down_sort_desc: false,
    };
    state.columns = [];
    state.chartInstances = {};
    $('#empty-state').classList.add('hidden');
    $('#builder').classList.remove('hidden');
    $('#delete-dashboard').classList.add('hidden');
    $('#dashboard-name').value = state.currentDashboard.name;
    $('#view-select').value = '';
    $('#charts-panel').classList.add('hidden');
    closeRightPanel();
    clearTable();
    clearCharts();
    renderSourcePanel();
    renderDimensionPanel();
    renderMeasurePanel();
    $('#workspace').scrollTop = 0;
  }

  async function openDashboard(id) {
    const dash = await api('GET', '/' + id);
    state.currentDashboard = dash;
    state.chartInstances = {};
    $('#empty-state').classList.add('hidden');
    $('#builder').classList.remove('hidden');
    $('#delete-dashboard').classList.remove('hidden');
    $('#dashboard-name').value = dash.name;
    $('#view-select').value = dash.view_name;
    migrateLegacyDrillDown();
    await onViewChange(false);
    applyStoredFilters(dash.filters);
    state.currentDashboard.show_grid = parseBool(dash.show_grid, true);
    state.currentDashboard.replace_null_with_empty = parseBool(dash.replace_null_with_empty, true);
    state.currentDashboard.date_time_format = dash.date_time_format || 'dd.MM.yyyy HH:mm';
      state.currentDashboard.color_numeric_sign = parseBool(dash.color_numeric_sign, false);
      const rl = parseInt(dash.row_limit, 10);
      state.currentDashboard.row_limit = Number.isNaN(rl) ? 1000 : Math.max(0, rl);
    clearTable();
    clearCharts();
    await refreshData();
    renderDashboardList();
    $('#workspace').scrollTop = 0;
  }

  function migrateLegacyDrillDown() {
    const dash = state.currentDashboard;
    // Legacy single drill_down_column is appended to dimension_columns.
    if (dash.drill_down_column && typeof dash.drill_down_column === 'string') {
      if (!dash.dimension_columns) dash.dimension_columns = [];
      if (!dash.dimension_columns.includes(dash.drill_down_column)) {
        dash.dimension_columns.push(dash.drill_down_column);
      }
      delete dash.drill_down_column;
    }
  }


  function drillDownColumns(dash) {
    // Drill-down = all dimensions except the first one.
    const dims = dash.dimension_columns || [];
    return dims.slice(1);
  }

  async function onViewChange(refresh = true) {
    const viewName = $('#view-select').value;
    const dash = state.currentDashboard;
    const previousView = dash.view_name;
    dash.view_name = viewName;
    const match = state.views.find(v => v.system_name === viewName);
    dash.view_display_name = match ? match.display_name : viewName;

    // Clear previous data/charts when switching to a different view.
    if (previousView && previousView !== viewName) {
      clearTable();
      clearCharts();
      dash.charts = [];
      dash.aggregations = {};
      dash.column_aliases = {};
      dash.filters = [];
      dash.group_by = [];
      dash.dimension_columns = [];
      dash.sort_by = '';
      dash.sort_desc = false;
      dash.sort = [];
    }

    if (!viewName) {
      $('#charts-panel').classList.add('hidden');
      clearTable();
      return;
    }
    const info = await api('GET', '/views/' + encodeURIComponent(viewName) + '/columns');
    state.columns = info.columns;

    if (!dash.aggregations) dash.aggregations = {};
    if (!dash.column_aliases) dash.column_aliases = {};
    if (!dash.dimension_columns) dash.dimension_columns = [];
    migrateLegacyDrillDown();
    const storedVisible = new Set(dash.visible_columns || []);
    const storedAggs = { ...(dash.aggregations || {}) };
    dash.visible_columns = state.columns.map(c => c.name);
    dash.aggregations = {};
    state.columns.forEach(c => {
      dash.aggregations[c.name] = storedAggs[c.name] || '';
    });
    if (storedVisible.size > 0) {
      dash.visible_columns = state.columns
        .map(c => c.name)
        .filter(name => storedVisible.has(name));
    }
    // Ensure active dimensions are visible.
    (dash.dimension_columns || []).forEach(col => {
      if (col && !dash.visible_columns.includes(col)) dash.visible_columns.push(col);
    });

    renderSourcePanel();
    renderDimensionPanel();
    renderMeasurePanel();
    renderFilters();
    renderChartControls();
    $('#charts-panel').classList.remove('hidden');
    renderMoreSettings();
    $('#chart-series-list').innerHTML = '';
    addSeriesRow();
    if (refresh) await refreshData();
  }

  // ------------------------------------------------------------------
  // Field panel (Source / Dimensions / Measures)
  // ------------------------------------------------------------------
  function renderAllFieldPanels() {
    renderSourcePanel();
    renderDimensionPanel();
    renderMeasurePanel();
    renderChartControls();
  }

  function renderSourcePanel() {
    const dash = state.currentDashboard;
    const visibleSet = new Set(dash.visible_columns || []);
    const sourceCols = state.columns.map(c => enrichColumn(c));
    const visibleCols = sourceCols.filter(c => visibleSet.has(c.name));
    const hiddenCols = sourceCols.filter(c => !visibleSet.has(c.name));

    const sourceContainer = $('#source-list');
    sourceContainer.innerHTML = visibleCols.map((c, idx) => renderSourceItem(c, idx, visibleCols.length)).join('') || '<p class="empty-hint">' + esc(t('all_columns_hidden_hint')) + '</p>';
    bindSourceItemEvents(sourceContainer);
    setupSourceReorderDrop(sourceContainer);

    const hiddenContainer = $('#hidden-list');
    if (hiddenContainer) {
      hiddenContainer.innerHTML = hiddenCols.map((c, idx) => renderSourceItem(c, idx, hiddenCols.length)).join('') || '<p class="empty-hint">' + esc(t('no_hidden_columns_hint')) + '</p>';
      bindSourceItemEvents(hiddenContainer);
      setupSourceReorderDrop(hiddenContainer);
    }
  }

  function renderDimensionPanel() {
    const dash = state.currentDashboard;
    const dims = (dash.dimension_columns || [])
      .map(name => state.columns.find(c => c.name === name))
      .filter(Boolean)
      .map(c => enrichColumn(c));
    const container = $('#dimension-list');
    container.innerHTML = dims.map((c, idx) => renderOrderedItem(c, idx, dims.length, 'dimension')).join('') ||
      '<p class="empty-hint">' + esc(t('dimension_drop_hint')) + '</p>';
    bindOrderedItemEvents(container, 'dimension_columns');
    setupReorderDrop(container, 'dimension_columns');
  }

  function renderMeasurePanel() {
    const dash = state.currentDashboard;
    const measures = Object.entries(dash.aggregations || {})
      .filter(([name, agg]) => agg)
      .map(([name]) => state.columns.find(c => c.name === name))
      .filter(Boolean)
      .map(c => enrichColumn(c));
    const container = $('#measure-list');
    container.innerHTML = measures.map(renderMeasureItem).join('') ||
      '<p class="empty-hint">' + esc(t('measure_drop_hint')) + '</p>';
    bindMeasureItemEvents(container);
    setupDropZone(container, 'measure');
  }

  function enrichColumn(c) {
    const dash = state.currentDashboard;
    return {
      ...c,
      visible: dash.visible_columns.includes(c.name),
      agg: dash.aggregations[c.name] || '',
      alias: dash.column_aliases[c.name] || '',
      isDimension: (dash.dimension_columns || []).includes(c.name),
      isDrillDown: (dash.dimension_columns || []).slice(1).includes(c.name),
      isMeasure: !!(dash.aggregations || {})[c.name],
    };
  }

  function typeLabel(col) {
    // Always show the raw database type (INT, NUMERIC, NVARCHAR, DATETIME, ...)
    // instead of a translated UI label.
    return col.raw_type || col.type || '';
  }

  function renderSourceItem(c, idx, total) {
    const display = c.alias || c.name;
    return `
      <div class="field-item ${c.visible ? '' : 'disabled'}" data-col="${esc(c.name)}" data-index="${idx}">
        <span class="field-visibility" title="${esc(c.visible ? t('hide_in_table_tooltip') : t('show_in_table_tooltip'))}">${c.visible ? '&#9670;' : '&#9671;'}</span>
        <span class="field-type" title="${esc(c.raw_type || c.type)}">${esc(typeLabel(c))}</span>
        <span class="field-name" title="${esc(c.name)}">${esc(display)}</span>
        <button type="button" class="field-action dim" title="${esc(t('move_to_dimension_tooltip'))}">${esc(t('move_to_dimension_button'))}</button>
        <button type="button" class="field-action measure" title="${esc(t('move_to_measure_tooltip'))}">${esc(t('move_to_measure_button'))}</button>
        <button type="button" class="field-alias" title="${esc(t('rename_for_display_tooltip'))}">✎</button>
        <button type="button" class="reorder-btn up" title="${esc(t('move_up_tooltip'))}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="reorder-btn down" title="${esc(t('move_down_tooltip'))}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        <span class="drag-handle" draggable="true" title="${esc(t('drag_to_reorder_tooltip'))}">☰</span>
      </div>`;
  }

  function renderOrderedItem(c, idx, total, kind) {
    const display = c.alias || c.name;
    return `
      <div class="field-item" data-col="${esc(c.name)}" data-index="${idx}">
        <span class="field-type" title="${esc(c.raw_type || c.type)}">${esc(typeLabel(c))}</span>
        <span class="field-name alias-trigger" title="${esc(t('ordered_item_rename_tooltip', { column: c.name }))}">${esc(display)}</span>
        <button type="button" class="reorder-btn up" title="${esc(t('move_up_tooltip'))}" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="reorder-btn down" title="${esc(t('move_down_tooltip'))}" ${idx === total - 1 ? 'disabled' : ''}>▼</button>
        <button type="button" class="remove-btn" title="${esc(t('remove_tooltip'))}">×</button>
        <span class="drag-handle" draggable="true" title="${esc(t('drag_to_reorder_tooltip'))}">☰</span>
      </div>`;
  }

  function renderMeasureItem(c) {
    const display = c.alias || c.name;
    const aggOptions = Object.entries(SERIES_AGGREGATION_LABELS)
      .map(([value, labelKey]) => `<option value="${esc(value)}" ${c.agg === value ? 'selected' : ''}>${esc(t(labelKey))}</option>`)
      .join('');
    return `
      <div class="field-item ${c.visible ? '' : 'disabled'}" data-col="${esc(c.name)}">
        <span class="field-visibility" title="${esc(c.visible ? t('hide_in_table_tooltip') : t('show_in_table_tooltip'))}">${c.visible ? '&#9670;' : '&#9671;'}</span>
        <span class="field-type" title="${esc(c.raw_type || c.type)}">${esc(typeLabel(c))}</span>
        <span class="field-name alias-trigger" title="${esc(t('ordered_item_rename_tooltip', { column: c.name }))}">${esc(display)}</span>
        <select class="field-agg" title="${esc(t('series_aggregation_sum'))}">${aggOptions}</select>
        <button type="button" class="remove-btn" title="${esc(t('remove_tooltip'))}">×</button>
        <span class="drag-handle" draggable="true" title="${esc(t('drag_to_reorder_tooltip'))}">☰</span>
      </div>`;
  }

  function bindSourceItemEvents(container) {
    container.querySelectorAll('.field-visibility').forEach(icon => {
      icon.addEventListener('click', (e) => {
        e.stopPropagation();
        const col = icon.closest('.field-item').dataset.col;
        toggleVisible(col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-action.dim').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        moveToDimension(btn.closest('.field-item').dataset.col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-action.measure').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        moveToMeasure(btn.closest('.field-item').dataset.col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-alias').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(btn.closest('.field-item').dataset.col);
      });
    });

    const isHidden = container.id === 'hidden-list';
    container.querySelectorAll('.drag-handle').forEach(handle => {
      const item = handle.closest('.field-item');
      handle.addEventListener('dragstart', (e) => {
        state.dragItem = item;
        e.dataTransfer.setData('text/plain', JSON.stringify({ col: item.dataset.col, source: isHidden ? 'hidden' : 'source', index: parseInt(item.dataset.index) }));
        item.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => {
        item.classList.remove('dragging');
        state.dragItem = null;
      });
    });

    container.querySelectorAll('.reorder-btn.up').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderVisible(btn.closest('.field-item').dataset.col, -1);
      });
    });
    container.querySelectorAll('.reorder-btn.down').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderVisible(btn.closest('.field-item').dataset.col, 1);
      });
    });
  }

  function reorderVisible(col, delta) {
    const dash = state.currentDashboard;
    const order = dash.visible_columns.length ? dash.visible_columns : state.columns.map(c => c.name);
    const idx = order.indexOf(col);
    if (idx < 0) return;
    const newIdx = Math.max(0, Math.min(order.length - 1, idx + delta));
    if (newIdx === idx) return;
    order.splice(idx, 1);
    order.splice(newIdx, 0, col);
    dash.visible_columns = order;
    renderAllFieldPanels();
    refreshData();
  }

  function bindOrderedItemEvents(container, listProp) {
    const dash = state.currentDashboard;
    container.querySelectorAll('.field-item').forEach(item => {
      const col = item.dataset.col;
      item.querySelector('.up').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderArray(dash[listProp], col, -1);
        renderAllFieldPanels();
        refreshData();
      });
      item.querySelector('.down').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        reorderArray(dash[listProp], col, 1);
        renderAllFieldPanels();
        refreshData();
      });
      item.querySelector('.remove-btn').addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        dash[listProp] = dash[listProp].filter(name => name !== col);
        renderAllFieldPanels();
        refreshData();
      });
      item.querySelector('.alias-trigger').addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(col);
      });
      const handle = item.querySelector('.drag-handle');
      if (!handle) return;
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ col, source: listProp, index: parseInt(item.dataset.index) }));
        item.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => item.classList.remove('dragging'));
    });
  }

  function bindMeasureItemEvents(container) {
    const dash = state.currentDashboard;
    container.querySelectorAll('.field-agg').forEach(sel => {
      sel.addEventListener('change', () => {
        const col = sel.closest('.field-item').dataset.col;
        dash.aggregations[col] = sel.value;
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.field-visibility').forEach(icon => {
      icon.addEventListener('click', () => {
        const col = icon.closest('.field-item').dataset.col;
        toggleVisible(col);
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const col = btn.closest('.field-item').dataset.col;
        dash.aggregations[col] = '';
        renderAllFieldPanels();
        refreshData();
      });
    });

    container.querySelectorAll('.alias-trigger').forEach(el => {
      el.addEventListener('click', () => openAliasModal(el.closest('.field-item').dataset.col));
    });

    container.querySelectorAll('.drag-handle').forEach(handle => {
      const item = handle.closest('.field-item');
      handle.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ col: item.dataset.col, source: 'measure' }));
        item.classList.add('dragging');
      });
      handle.addEventListener('dragend', () => item.classList.remove('dragging'));
    });
  }

  function setupDropZone(container, kind) {
    container.addEventListener('dragover', (e) => e.preventDefault());
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        data = { col: e.dataTransfer.getData('text/plain') };
      }
      const col = data.col;
      if (!col) return;
      if (kind === 'dimension') moveToDimension(col);
      else if (kind === 'measure') moveToMeasure(col);
      renderAllFieldPanels();
      refreshData();
    });
  }



  function setupSourceReorderDrop(container) {
    const isHidden = container.id === 'hidden-list';
    container.addEventListener('dragover', (e) => {
      e.preventDefault();
      const dragging = state.dragItem;
      if (!dragging) return;
      const srcList = dragging.closest('.field-list');
      if (srcList !== container && !isHidden) return;
      const after = getDragAfterElement(container, e.clientY);
      if (after) {
        container.insertBefore(dragging, after);
      } else {
        container.appendChild(dragging);
      }
    });
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        data = { col: e.dataTransfer.getData('text/plain') };
      }
      const col = data.col;
      if (!col) return;
      const dash = state.currentDashboard;
      if (data.source !== (isHidden ? 'hidden' : 'source')) {
        removeFromActiveRoles(col);
      }
      if (isHidden) {
        dash.visible_columns = (dash.visible_columns || []).filter(name => name !== col);
      } else {
        const visible = [...container.querySelectorAll('.field-item')].map(el => el.dataset.col);
        dash.visible_columns = visible;
      }
      const payload = { ...dash, filters: collectFilters(), charts: collectCharts() };
      api(dash.id ? 'PUT' : 'POST', dash.id ? '/' + dash.id : '/', payload)
        .then(saved => {
          state.currentDashboard.id = saved.id;
          state.currentDashboard.updated_at = saved.updated_at;
        })
        .catch(err => console.error('Failed to save column order:', err));
      renderAllFieldPanels();
      renderTable();
      renderCharts();
      refreshData();
    });
  }

  function setupReorderDrop(container, listProp) {
    container.addEventListener('dragover', (e) => e.preventDefault());
    container.addEventListener('drop', (e) => {
      e.preventDefault();
      let data;
      try {
        data = JSON.parse(e.dataTransfer.getData('text/plain'));
      } catch {
        data = { col: e.dataTransfer.getData('text/plain') };
      }
      const col = data.col;
      if (!col) return;
      const list = state.currentDashboard[listProp];
      // If coming from another list, move it into this list at the end.
      if (data.source !== listProp) {
        removeFromActiveRoles(col);
        list.push(col);
        if (!state.currentDashboard.visible_columns.includes(col)) {
          state.currentDashboard.visible_columns.push(col);
        }
      }
      // Determine target index from drop position.
      const after = getDragAfterElement(container, e.clientY);
      const currentIndex = list.indexOf(col);
      let targetIndex = after ? list.indexOf(after.dataset.col) : list.length;
      if (currentIndex >= 0 && targetIndex > currentIndex) targetIndex--;
      if (currentIndex >= 0) list.splice(currentIndex, 1);
      list.splice(targetIndex, 0, col);
      renderAllFieldPanels();
      refreshData();
    });
  }

  function getDragAfterElement(container, y) {
    const items = [...container.querySelectorAll('.field-item:not(.dragging)')];
    return items.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  }

  function toggleVisible(col) {
    const dash = state.currentDashboard;
    if (dash.visible_columns.includes(col)) {
      dash.visible_columns = dash.visible_columns.filter(name => name !== col);
    } else {
      dash.visible_columns.push(col);
    }
  }

  function moveToDimension(col) {
    const dash = state.currentDashboard;
    if (dash.dimension_columns.includes(col)) return;
    removeFromActiveRoles(col);
    // When moving the first explicit dimension, preserve all visible non-aggregated
    // columns as dimensions so the table keeps showing them in the right order.
    if (!dash.dimension_columns.length) {
      const newDims = state.columns
        .map(c => c.name)
        .filter(name => name !== col && dash.visible_columns.includes(name) && !dash.aggregations[name]);
      dash.dimension_columns = newDims;
    }
    if (!dash.dimension_columns.includes(col)) dash.dimension_columns.push(col);
    if (!dash.visible_columns.includes(col)) dash.visible_columns.push(col);
  }

  function moveToMeasure(col) {
    const dash = state.currentDashboard;
    removeFromActiveRoles(col);
    const colInfo = state.columns.find(c => c.name === col);
    dash.aggregations[col] = colInfo && colInfo.type === 'number' ? 'sum' : 'count';
    if (!dash.visible_columns.includes(col)) dash.visible_columns.push(col);
  }

  function removeFromActiveRoles(col) {
    const dash = state.currentDashboard;
    dash.dimension_columns = (dash.dimension_columns || []).filter(name => name !== col);
    dash.aggregations[col] = '';
  }

  function reorderArray(arr, item, direction) {
    const idx = arr.indexOf(item);
    if (idx < 0) return;
    const newIdx = idx + direction;
    if (newIdx < 0 || newIdx >= arr.length) return;
    arr.splice(newIdx, 0, arr.splice(idx, 1)[0]);
  }

  function isDrillDownColumn(col) {
    return (state.currentDashboard.dimension_columns || []).slice(1).includes(col);
  }

  // ------------------------------------------------------------------
  // Column aliases
  // ------------------------------------------------------------------
  function openAliasModal(col) {
    state.aliasColumn = col;
    const dash = state.currentDashboard;
    $('#alias-original').textContent = t('alias_original_label', { column: col });
    $('#alias-input').value = dash.column_aliases[col] || '';
    $('#alias-modal').classList.remove('hidden');
    $('#alias-input').focus();
  }

  function closeAliasModal() {
    $('#alias-modal').classList.add('hidden');
    state.aliasColumn = null;
  }

  function saveAlias() {
    if (!state.aliasColumn) return;
    const value = $('#alias-input').value.trim();
    const dash = state.currentDashboard;
    if (value && value !== state.aliasColumn) {
      dash.column_aliases[state.aliasColumn] = value;
    } else {
      delete dash.column_aliases[state.aliasColumn];
    }
    closeAliasModal();
    renderAllFieldPanels();
    renderFilters();
    renderChartControls();
    renderTable();
    renderCharts();
  }

  function displayName(col) {
    const dash = state.currentDashboard;
    return (dash.column_aliases || {})[col] || col;
  }

  // ------------------------------------------------------------------
  // Filters
  // ------------------------------------------------------------------
  function renderFilters() {
    const container = $('#filter-bar');
    container.innerHTML = state.columns.map(c => {
      const colId = esc(c.name);
      const label = esc(displayName(c.name));
      if (c.type === 'number') {
        return `<div class="filter-group" data-col="${colId}">
          <label>${label}</label>
          <div class="filter-range">
            <input type="number" data-col="${colId}" data-type="number" data-role="min" placeholder="${esc(t('number_min_placeholder'))}">
            <input type="number" data-col="${colId}" data-type="number" data-role="max" placeholder="${esc(t('number_max_placeholder'))}">
          </div>
        </div>`;
      }
      if (c.type === 'date') {
        return `<div class="filter-group" data-col="${colId}">
          <label>${label}</label>
          <div class="filter-range">
            <input type="date" data-col="${colId}" data-type="date" data-role="from" placeholder="${esc(t('date_from_placeholder'))}">
            <input type="date" data-col="${colId}" data-type="date" data-role="to" placeholder="${esc(t('date_to_placeholder'))}">
          </div>
        </div>`;
      }
      return `<div class="filter-group" data-col="${colId}">
        <label>${label}</label>
        <div class="text-filter-rows" data-col="${colId}"></div>
        <button type="button" class="btn small add-text-filter" data-col="${colId}">${esc(t('text_filter_add_button'))}</button>
      </div>`;
    }).join('');
    container.querySelectorAll('input').forEach(inp => {
      inp.addEventListener('input', debounce(refreshData, 300));
    });
    container.querySelectorAll('.add-text-filter').forEach(btn => {
      btn.addEventListener('click', () => addTextFilterRow(btn.dataset.col));
    });
    state.columns.filter(c => c.type === 'text').forEach(c => addTextFilterRow(c.name, { operator: 'contains' }));
  }

  function addTextFilterRow(col, initial = {}) {
    const rowsContainer = $(`#filter-bar .text-filter-rows[data-col="${esc(col)}"]`);
    if (!rowsContainer) return;
    const row = document.createElement('div');
    row.className = 'text-filter-row';
    row.innerHTML = `
      <select class="text-filter-op" data-col="${esc(col)}">
        <option value="=" ${initial.operator === '=' ? 'selected' : ''}>${esc(t('text_filter_operator_equals'))}</option>
        <option value="contains" ${initial.operator === 'contains' ? 'selected' : ''}>${esc(t('text_filter_operator_contains'))}</option>
        <option value="not_contains" ${initial.operator === 'not_contains' ? 'selected' : ''}>${esc(t('text_filter_operator_not_contains'))}</option>
      </select>
      <input type="text" class="text-filter-value" data-col="${esc(col)}" value="${esc(initial.value || '')}" placeholder="${esc(t('text_filter_value_placeholder'))}">
      <button type="button" class="btn danger small remove-filter-row" title="${esc(t('text_filter_remove_title'))}">×</button>
    `;
    row.querySelector('.remove-filter-row').addEventListener('click', () => {
      row.remove();
      refreshData();
    });
    row.querySelectorAll('input, select').forEach(el => {
      el.addEventListener('input', debounce(refreshData, 300));
    });
    rowsContainer.appendChild(row);
  }

  function applyStoredFilters(filters) {
    filters = filters || [];
    $$('#filter-bar .text-filter-rows').forEach(el => { el.innerHTML = ''; });
    filters.forEach(f => {
      if (f.type === 'number') {
        const min = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="min"]`);
        const max = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="max"]`);
        if (min) min.value = f.min_value || '';
        if (max) max.value = f.max_value || '';
      } else if (f.type === 'date') {
        const from = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="from"]`);
        const to = $(`#filter-bar input[data-col="${esc(f.column)}"][data-role="to"]`);
        if (from) from.value = f.from_value || '';
        if (to) to.value = f.to_value || '';
      } else {
        const container = $(`#filter-bar .text-filter-rows[data-col="${esc(f.column)}"]`);
        if (!container) return;
        if (!container.children.length) {
          addTextFilterRow(f.column, { operator: f.operator || '=', value: f.value || '' });
        } else {
          const first = container.querySelector('.text-filter-row');
          if (first) {
            first.querySelector('.text-filter-op').value = f.operator || '=';
            first.querySelector('.text-filter-value').value = f.value || '';
          }
        }
      }
    });
  }

  function collectFilters() {
    const filters = [];
    function findOrCreate(col, type) {
      let entry = filters.find(f => f.column === col && f.type === type);
      if (!entry) {
        entry = { column: col, type: type };
        filters.push(entry);
      }
      return entry;
    }
    $('#filter-bar').querySelectorAll('input[data-role]').forEach(inp => {
      const col = inp.dataset.col;
      const type = inp.dataset.type;
      if (!inp.value) return;
      const entry = findOrCreate(col, type);
      entry[inp.dataset.role + '_value'] = inp.value;
    });
    $('#filter-bar').querySelectorAll('.text-filter-row').forEach(row => {
      const op = row.querySelector('.text-filter-op').value;
      const val = row.querySelector('.text-filter-value').value.trim();
      const col = row.querySelector('.text-filter-value').dataset.col;
      if (!val) return;
      filters.push({ column: col, type: 'text', operator: op, value: val });
    });
    return filters;
  }

  // ------------------------------------------------------------------
  // Data table
  // ------------------------------------------------------------------
  async function refreshData() {
    const dash = state.currentDashboard;
    if (!dash.view_name) return;
    if (!dash.visible_columns.length) {
      clearTable();
      $('#row-count').textContent = t('select_at_least_one_column');
      return;
    }
    const payload = {
      view_name: dash.view_name,
      visible_columns: dash.visible_columns,
      filters: collectFilters(),
      sort_by: dash.sort_by,
      sort_desc: dash.sort_desc,
      sort: dash.sort || [],
      group_by: dash.group_by,
      aggregations: dash.aggregations,
      number_format: dash.number_format || '#,##0.00',
      dimension_columns: dash.dimension_columns || [],
      // First dimension is the main grouping; the rest are nested drill-down levels.
      drill_down_columns: (dash.dimension_columns || []).slice(1),
      drill_down_sort_desc: dash.drill_down_sort_desc || false,
      replace_null_with_empty: dash.replace_null_with_empty !== false,
      row_limit: dash.row_limit,
    };
    try {
      state.data = await api('POST', '/data', payload);
      if (state.data.error) {
        clearTable();
        $('#row-count').textContent = state.data.error;
        renderCharts();
        return;
      }
      renderTable();
      renderCharts();
    } catch (err) {
      clearTable();
      $('#row-count').textContent = t('data_load_error', { error: err.message });
      console.error(err);
    }
  }

  function renderTable() {
    const thead = $('#data-table thead');
    const tbody = $('#data-table tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const dash = state.currentDashboard;
    const rawCols = state.data.columns || [];
    if (!rawCols.length) {
      $('#row-count').textContent = t('no_data_hint');
      return;
    }
    // Dimensions are explicit only. If none are set, the table is a simple detail grid.
    const explicitDimCols = state.data.dimension_columns || dash.dimension_columns || [];
    const measureCols = rawCols.filter(c => dash.aggregations[c]);
    const dimCols = explicitDimCols.filter(c => rawCols.includes(c));
    const drillCols = dimCols.slice(1);
    const rows = state.data.rows || [];

    // Detail-group mode: dimensions without measures => show raw rows grouped by the first dimension.
    if (dimCols.length && !measureCols.length) {
      renderGroupedDetailTable(thead, tbody, rawCols, dimCols[0], rows);
      renderRowCount(rows.length, drillCols.length);
      return;
    }

    // Pivot mode: dimensions + measures + optional attribute columns shown at the leaf level.
    const attrCols = rawCols.filter(c =>
      !dimCols.includes(c) && !measureCols.includes(c)
    );
    const mainHeaderCols = dimCols.length
      ? [...dimCols, ...measureCols, ...attrCols].filter((c, i, arr) => arr.indexOf(c) === i)
      : [...rawCols];

    // Header
    const tr = document.createElement('tr');
    mainHeaderCols.forEach(col => {
      const th = document.createElement('th');
      const agg = dash.aggregations[col];
      let headerHtml = `<span class="col-header-name" data-col="${esc(col)}" title="${esc(t('column_header_rename_tooltip'))}">${esc(displayName(col))}</span>` +
        (agg ? `<span class="col-header-agg">${esc(agg.toUpperCase())}</span>` : '');
      headerHtml += ` <span class="sort-hint" title="${esc(t('sort_click_hint'))}">↕</span>`;
      th.innerHTML = headerHtml;
      const sortEntry = (dash.sort || []).find(s => s.column === col);
      if (sortEntry) {
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = (sortEntry.desc ? ' ▼' : ' ▲') + ((dash.sort || []).indexOf(sortEntry) + 1);
        th.appendChild(indicator);
      }
      th.addEventListener('click', () => sortBy(col));
      th.querySelector('.col-header-name').addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(col);
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    if (dimCols.length >= 1) {
      const mainDim = dimCols[0];
      const groups = groupByKeys(rows, [mainDim]);
      groups.forEach(({ keyValues, rows: groupRows }) => {
        const mainRow = buildSummaryRow(groupRows, mainHeaderCols, [mainDim], drillCols);
        const groupKey = keyValues.join('|');
        const expandable = dimCols.length > 1 || attrCols.length > 0;
        const r = createTableRow(mainHeaderCols, mainRow, 'group-row', expandable, groupKey, groupRows.length, drillCols);
        tbody.appendChild(r);
        if (expandable) {
          const detailContainer = document.createElement('tbody');
          detailContainer.className = 'drill-down-rows hidden';
          detailContainer.dataset.groupKey = groupKey;
          renderDrillLevel(groupRows, 1, dimCols, detailContainer, '', attrCols);
          r.after(detailContainer);
        }
      });
    } else {
      rows.forEach((row, idx) => tbody.appendChild(createTableRow(mainHeaderCols, row, idx % 2 === 1 ? 'data-row' : '')));
    }

    renderRowCount(rows.length, drillCols.length);
  }

  function renderGroupedDetailTable(thead, tbody, cols, mainDim, rows) {
    const dash = state.currentDashboard;
    // Header with all visible columns.
    const tr = document.createElement('tr');
    cols.forEach(col => {
      const th = document.createElement('th');
      let headerHtml = `<span class="col-header-name" data-col="${esc(col)}" title="${esc(t('column_header_rename_tooltip'))}">${esc(displayName(col))}</span>` +
        ` <span class="sort-hint" title="${esc(t('sort_click_hint'))}">↕</span>`;
      th.innerHTML = headerHtml;
      const sortEntry = (dash.sort || []).find(s => s.column === col);
      if (sortEntry) {
        const indicator = document.createElement('span');
        indicator.className = 'sort-indicator';
        indicator.textContent = (sortEntry.desc ? ' ▼' : ' ▲') + ((dash.sort || []).indexOf(sortEntry) + 1);
        th.appendChild(indicator);
      }
      th.addEventListener('click', () => sortBy(col));
      th.querySelector('.col-header-name').addEventListener('click', (e) => {
        e.stopPropagation();
        openAliasModal(col);
      });
      tr.appendChild(th);
    });
    thead.appendChild(tr);

    // Group header rows followed by raw detail rows for each group.
    const groups = groupByKeys(rows, [mainDim]);
    groups.forEach(({ keyValues, rows: groupRows }) => {
      const groupTr = document.createElement('tr');
      groupTr.className = 'group-header-row';
      const groupTd = document.createElement('td');
      groupTd.colSpan = cols.length;
      groupTd.innerHTML = `<strong>${esc(displayName(mainDim))}: ${esc(formatTableValue(keyValues[0], mainDim))}</strong> <span class="drill-count">(${groupRows.length})</span>`;
      groupTr.appendChild(groupTd);
      tbody.appendChild(groupTr);

      groupRows.forEach((row, idx) => {
        tbody.appendChild(createTableRow(cols, row, idx % 2 === 1 ? 'data-row' : ''));
      });
    });
  }

  function renderRowCount(count, hasDrill) {
    const dash = state.currentDashboard;
    const rowCount = $('#row-count');
    rowCount.innerHTML = '';
    rowCount.appendChild(document.createTextNode(t('rows_shown_label', { count })));
    if (hasDrill) {
      const sortBtn = document.createElement('button');
      sortBtn.type = 'button';
      sortBtn.className = 'btn small drill-sort-btn';
      sortBtn.style.marginLeft = '0.75rem';
      sortBtn.title = t('drill_down_sort_title');
      sortBtn.textContent = dash.drill_down_sort_desc ? t('drill_down_sort_desc') : t('drill_down_sort_asc');
      sortBtn.addEventListener('click', sortByDrillDown);
      rowCount.appendChild(sortBtn);
    }
  }

  function groupByKeys(rows, keys) {
    const map = new Map();
    rows.forEach(row => {
      const keyValues = keys.map(k => row[k]);
      const key = keyValues.map(v => (v === null || v === undefined ? '\x00' : String(v))).join('\x01');
      if (!map.has(key)) map.set(key, { keyValues: keyValues.slice(), rows: [] });
      map.get(key).rows.push(row);
    });
    return [...map.values()];
  }

  function renderDrillLevel(rowsAtThisLevel, level, dimCols, parentElement, parentKeyValues, leafAttrCols) {
    const dash = state.currentDashboard;
    const currentDim = dimCols[level];
    const remainingDims = dimCols.slice(level + 1);
    const groups = groupByKeys(rowsAtThisLevel, currentDim ? [currentDim] : []);
    const measureCols = Object.keys(dash.aggregations).filter(c => dash.aggregations[c]);
    const isLeaf = !remainingDims.length;
    // Attribute columns are shown only at the leaf level, after dimensions and measures.
    const attrCols = isLeaf ? (leafAttrCols || []) : [];
    // Each nested level shows only the current dimension and deeper dimensions plus measures.
    // Higher-level dimensions (e.g. Nazev) are already known from the parent row and are hidden here.
    const headerCols = [currentDim, ...remainingDims, ...measureCols, ...attrCols]
      .filter((c, i, arr) => c && arr.indexOf(c) === i);

    // Add a header row for every nested block so each drill-down level has its own column titles.
    parentElement.appendChild(createDrillHeaderRow(headerCols));

    // Sort groups according to the active multi-column sort rules.
    const sortRules = (state.currentDashboard.sort || []).filter(s => headerCols.includes(s.column));
    if (sortRules.length) {
      groups.sort((a, b) => compareRows(a.rows[0], b.rows[0], sortRules));
    }

    groups.forEach(({ keyValues, rows }) => {
      const value = keyValues[0];
      const groupKey = (parentKeyValues ? parentKeyValues + '|' : '') + String(value);
      const summary = buildSummaryRow(rows, headerCols, dimCols.slice(0, level + 1), remainingDims.concat(attrCols));
      summary[currentDim] = value;
      const rowClass = `drill-summary-row drill-level-${level}`;
      const expandable = !isLeaf || attrCols.length > 0;
      const rowEl = createTableRow(headerCols, summary, rowClass, expandable, groupKey, rows.length, remainingDims.concat(attrCols));
      parentElement.appendChild(rowEl);

      if (!isLeaf) {
        const nextLevelContainer = document.createElement('tbody');
        nextLevelContainer.className = 'drill-down-rows hidden';
        nextLevelContainer.dataset.groupKey = groupKey;
        rowEl.after(nextLevelContainer);
        renderDrillLevel(rows, level + 1, dimCols, nextLevelContainer, groupKey, leafAttrCols);
      } else if (attrCols.length > 0) {
        // At the leaf level, show raw detail rows with the attribute columns if there is more
        // than one underlying row. When there is exactly one row the summary already contains
        // the attribute values.
        const detailRows = rows;
        if (detailRows.length > 1) {
          const nextLevelContainer = document.createElement('tbody');
          nextLevelContainer.className = 'drill-down-rows hidden';
          nextLevelContainer.dataset.groupKey = groupKey;
          rowEl.after(nextLevelContainer);
          detailRows.forEach((row, idx) => {
            const attrOnlyRow = {};
            attrCols.forEach(c => { attrOnlyRow[c] = row[c]; });
            const tr = createTableRow(attrCols, attrOnlyRow, idx % 2 === 1 ? 'data-row' : '', false, '', 0, []);
            // Indent the attribute row by adding an empty cell for each parent dimension.
            for (let i = 0; i < level + 1; i++) {
              const emptyTd = document.createElement('td');
              emptyTd.innerHTML = '<span class="indent-spacer"></span>';
              tr.insertBefore(emptyTd, tr.firstChild);
            }
            nextLevelContainer.appendChild(tr);
          });
        }
      }
    });
  }

  function createDrillHeaderRow(cols) {
    const dash = state.currentDashboard;
    const r = document.createElement('tr');
    r.className = 'drill-header-row';
    cols.forEach(col => {
      const td = document.createElement('td');
      const agg = dash.aggregations[col];
      const sortEntry = (dash.sort || []).find(s => s.column === col);
      let html = `${esc(displayName(col))}${agg ? ` <span class="col-header-agg">${esc(agg.toUpperCase())}</span>` : ''}`;
      if (sortEntry) {
        html += ` <span class="sort-indicator" title="${esc(t('drill_sort_change_title'))}">${sortEntry.desc ? '▼' : '▲'}${(dash.sort || []).indexOf(sortEntry) + 1}</span>`;
      } else {
        html += ` <span class="sort-hint" title="${esc(t('sort_click_hint'))}">↕</span>`;
      }
      td.innerHTML = html;
      td.addEventListener('click', () => sortBy(col));
      r.appendChild(td);
    });
    return r;
  }

  function compareRows(a, b, rules) {
    for (const rule of rules) {
      const col = rule.column;
      const va = a[col] ?? '';
      const vb = b[col] ?? '';
      const na = parseFloat(va), nb = parseFloat(vb);
      let cmp = 0;
      if (!isNaN(na) && !isNaN(nb)) {
        cmp = na - nb;
      } else {
        cmp = String(va).localeCompare(String(vb));
      }
      if (cmp !== 0) return rule.desc ? -cmp : cmp;
    }
    return 0;
  }

  function buildSummaryRow(rows, cols, dimCols, drillCols, seriesAggs) {
    const replaceNull = state.currentDashboard.replace_null_with_empty !== false;
    const summary = { ...rows[0] };
    cols.forEach(col => {
      if (dimCols.includes(col)) {
        const v = rows[0][col];
        summary[col] = replaceNull && (v === null || v === undefined) ? '' : v;
        return;
      }
      const agg = seriesAggs ? seriesAggs[col] : state.currentDashboard.aggregations[col];
      if (!agg) {
        // Attribute column (not dimension, not measure): keep a representative value.
        const v = rows[0][col];
        summary[col] = replaceNull && (v === null || v === undefined) ? '' : v;
        return;
      }
      if (drillCols.includes(col)) {
        summary[col] = replaceNull ? '' : null;
        return;
      }
      const colInfo = state.columns.find(c => c.name === col);
      const isDate = colInfo && colInfo.type === 'date';
      if (isDate) {
        const dates = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && String(v).trim() !== '').map(v => new Date(v)).filter(d => !Number.isNaN(d.getTime()));
        switch (agg) {
          case 'min': summary[col] = dates.length ? dates.reduce((a, b) => (a < b ? a : b)) : (replaceNull ? '' : null); break;
          case 'max': summary[col] = dates.length ? dates.reduce((a, b) => (a > b ? a : b)) : (replaceNull ? '' : null); break;
          case 'count': summary[col] = rows.length; break;
          default: summary[col] = replaceNull ? '' : null;
        }
        return;
      }
      const values = rows.map(r => parseFloat(r[col]) || 0);
      switch (agg) {
        case 'sum': summary[col] = values.reduce((a, b) => a + b, 0); break;
        case 'count': summary[col] = rows.length; break;
        case 'avg': summary[col] = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; break;
        case 'min': summary[col] = values.length ? Math.min(...values) : 0; break;
        case 'max': summary[col] = values.length ? Math.max(...values) : 0; break;
      }
    });
    return summary;
  }

  function createTableRow(cols, row, rowClass = '', expandable = false, groupKey = '', childCount = 0, drillCols = []) {
    const r = document.createElement('tr');
    if (rowClass) r.className = rowClass;
    cols.forEach((col, idx) => {
      const td = document.createElement('td');
      const isDim = !state.currentDashboard.aggregations[col];
      if (expandable && isDim && idx === 0) {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'drill-toggle';
        toggle.textContent = '▸';
        toggle.title = t('expand_collapse_title');
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleDrillDown(toggle, groupKey);
        });
        td.appendChild(toggle);
      }
      const val = row[col];
      const valSpan = document.createElement('span');
      const replaceNull = state.currentDashboard.replace_null_with_empty !== false;
      if (val === null || val === undefined) {
        if (replaceNull) {
          valSpan.textContent = '';
        } else {
          valSpan.className = 'null';
          valSpan.textContent = t('table_null_value');
        }
      } else {
        valSpan.textContent = formatTableValue(val, col);
        if (state.currentDashboard.color_numeric_sign) {
          const colInfo = state.columns.find(c => c.name === col);
          if (colInfo && colInfo.type === 'number') {
            const num = parseFloat(val);
            if (!Number.isNaN(num)) {
              if (num > 0) valSpan.classList.add('numeric-positive');
              else if (num < 0) valSpan.classList.add('numeric-negative');
            }
          }
        }
      }
      td.appendChild(valSpan);
      const isMeasure = !!state.currentDashboard.aggregations[col];
      td.addEventListener('click', (e) => {
        e.stopPropagation();
        quickFilter(col, row[col], isMeasure);
      });
      r.appendChild(td);
    });
    if (expandable) {
      const countTd = document.createElement('td');
      countTd.className = 'drill-count';
      countTd.textContent = `(${childCount})`;
      r.appendChild(countTd);
    }
    return r;
  }

  function sortByDrillDown() {
    const dash = state.currentDashboard;
    dash.drill_down_sort_desc = !dash.drill_down_sort_desc;
    refreshData();
  }

  function toggleDrillDown(btn, groupKey) {
    const row = btn.closest('tr');
    if (!row) return;
    // Find the immediate next tbody sibling that is a drill-down container for this key.
    const allDetails = [...document.querySelectorAll('tbody.drill-down-rows')];
    const detail = allDetails.find(tb => tb.dataset.groupKey === String(groupKey) && tb.previousElementSibling === row);
    if (!detail) return;
    const hidden = detail.classList.toggle('hidden');
    btn.textContent = hidden ? '▸' : '▼';
  }

  function quickFilter(col, value, isMeasure = false) {
    if (value === null || value === undefined) return;
    if (isMeasure) return;
    const dash = state.currentDashboard;
    const colInfo = state.columns.find(c => c.name === col);
    if (!colInfo) return;
    const type = colInfo.type;
    const existing = dash.filters.find(f => f.column === col);
    if (type === 'number') {
      if (existing) {
        existing.min_value = value;
        existing.max_value = value;
      } else {
        dash.filters.push({ column: col, type: 'number', min_value: value, max_value: value });
      }
    } else if (type === 'date') {
      const strVal = String(value).split('T')[0];
      if (existing) {
        existing.from_value = strVal;
        existing.to_value = strVal;
      } else {
        dash.filters.push({ column: col, type: 'date', from_value: strVal, to_value: strVal });
      }
    } else {
      const strVal = String(value);
      if (existing) {
        existing.value = strVal;
      } else {
        dash.filters.push({ column: col, type: 'text', value: strVal });
      }
    }
    applyStoredFilters(dash.filters);
    refreshData();
  }

  function clearTable() {
    $('#data-table thead').innerHTML = '';
    $('#data-table tbody').innerHTML = '';
    $('#row-count').textContent = '';
  }

  function sortBy(col) {
    const dash = state.currentDashboard;
    let list = dash.sort || [];
    const idx = list.findIndex(s => s.column === col);
    if (idx >= 0) {
      if (list[idx].desc) {
        // Third click removes the sort rule.
        list = list.filter((_, i) => i !== idx);
      } else {
        list[idx].desc = true;
      }
    } else {
      list.push({ column: col, desc: false });
    }
    dash.sort = list;
    refreshData();
  }

  // ------------------------------------------------------------------
  // Dashboard persistence
  // ------------------------------------------------------------------
  async function saveDashboard() {
    const dash = state.currentDashboard;
    dash.name = $('#dashboard-name').value.trim() || t('dashboard_unnamed_fallback');
    dash.filters = collectFilters();
    dash.charts = collectCharts();
    dash.number_format = valueOr('#setting-number-format', dash.number_format || '#,##0.00');
    dash.date_time_format = valueOr('#setting-date-time-format', dash.date_time_format || 'dd.MM.yyyy HH:mm');
    dash.color_scheme = valueOr('#setting-color-scheme', dash.color_scheme || 'default');
    const rowLimitVal = parseInt(valueOr('#setting-row-limit', String(dash.row_limit !== null && dash.row_limit !== undefined ? dash.row_limit : 1000)), 10);
    dash.row_limit = Number.isNaN(rowLimitVal) ? 1000 : Math.max(0, rowLimitVal);
    dash.charts_per_row = parseInt(valueOr('#setting-charts-per-row', '3')) || 3;
    dash.chart_card_height = parseInt(valueOr('#setting-chart-height', '360')) || 360;
    const gridEl = $('#setting-show-grid');
    dash.show_grid = gridEl ? gridEl.checked : dash.show_grid;
    const nullEl = $('#setting-replace-null');
    dash.replace_null_with_empty = nullEl ? nullEl.checked : dash.replace_null_with_empty;
    const colorSignEl = $('#setting-color-numeric-sign');
    dash.color_numeric_sign = colorSignEl ? colorSignEl.checked : dash.color_numeric_sign;
    dash.group_by = dash.dimension_columns || [];
    try {
      const saved = dash.id
        ? await api('PUT', '/' + dash.id, dash)
        : await api('POST', '/', dash);
      state.currentDashboard = saved;
      await loadDashboards();
      $('#delete-dashboard').classList.remove('hidden');
      renderDashboardList();
      renderCharts();
    } catch (err) {
      alert(t('dashboard_save_error', { error: err.message }));
      console.error(err);
    }
  }

  async function deleteDashboard() {
    if (!state.currentDashboard || !state.currentDashboard.id) return;
    if (!confirm(t('dashboard_delete_confirm'))) return;
    await api('DELETE', '/' + state.currentDashboard.id);
    state.currentDashboard = null;
    $('#builder').classList.add('hidden');
    $('#empty-state').classList.remove('hidden');
    clearCharts();
    await loadDashboards();
  }

  async function copyDashboard() {
    const dash = state.currentDashboard;
    if (!dash || !dash.id) {
      alert(t('save_dashboard_first_generic'));
      return;
    }
    try {
      const copied = await api('POST', '/' + dash.id + '/copy');
      await loadDashboards();
      await openDashboard(copied.id);
      renderDashboardList();
    } catch (err) {
      alert(t('dashboard_copy_error', { error: err.message }));
      console.error(err);
    }
  }

  // ------------------------------------------------------------------
  // Export
  // ------------------------------------------------------------------
  async function exportExcel() {
    if (!state.currentDashboard || !state.currentDashboard.id) {
      alert(t('save_dashboard_first_generic'));
      return;
    }
    try {
      const { blob, filename } = await apiRaw('POST', '/' + state.currentDashboard.id + '/export/excel');
      downloadBlob(blob, filename);
    } catch (err) {
      alert(t('excel_export_error', { error: err.message }));
    }
  }

  async function exportPdf() {
    if (!state.currentDashboard || !state.currentDashboard.charts.length) {
      alert(t('pdf_export_no_charts'));
      return;
    }
    try {
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 15;
      const gap = 10;
      const cols = 2;
      const cardWidth = (pageWidth - margin * 2 - gap * (cols - 1)) / cols;
      const cardHeight = 80;
      let x = margin;
      let y = margin;

      state.currentDashboard.charts.forEach((chart, idx) => {
        const canvas = document.getElementById('chart-canvas-' + idx);
        if (!canvas) return;
        const img = canvas.toDataURL('image/png');
        pdf.addImage(img, 'PNG', x, y, cardWidth, cardHeight);
        pdf.setFontSize(10);
        pdf.text(chart.title || t('chart_fallback_title'), x, y - 2);
        x += cardWidth + gap;
        if (x + cardWidth > pageWidth - margin) {
          x = margin;
          y += cardHeight + gap;
          if (y + cardHeight > pageHeight - margin) {
            pdf.addPage();
            y = margin;
          }
        }
      });

      const filename = (state.currentDashboard.name || 'dashboard').replace(/\s+/g, '_') + '_grafy.pdf';
      pdf.save(filename);
    } catch (err) {
      alert(t('pdf_export_error', { error: err.message }));
      console.error(err);
    }
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ------------------------------------------------------------------
  // Charts
  // ------------------------------------------------------------------
  function bindCustomChartTypeSelect() {
    const trigger = $('#chart-type-trigger');
    const options = $('#chart-type-options');
    const input = $('#chart-type');
    if (!trigger || !options || !input) return;

    function renderOptions() {
      options.innerHTML = CHART_TYPES.map(ct => `
        <div class="custom-select-option" data-value="${esc(ct.value)}" tabindex="0">
          <img src="/static/icons/${esc(ct.value)}.svg" alt="" class="chart-icon" />
          <span>${esc(ct.labelKey.replace(/^chart_type_/, '').replace(/_/g, ' '))}</span>
        </div>`).join('');
      options.querySelectorAll('.custom-select-option').forEach(opt => {
        opt.addEventListener('click', () => {
          input.value = opt.dataset.value;
          updateTrigger();
          options.classList.remove('open');
        });
        opt.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            input.value = opt.dataset.value;
            updateTrigger();
            options.classList.remove('open');
          }
        });
      });
    }

    function updateTrigger() {
      const ct = CHART_TYPES.find(x => x.value === input.value) || CHART_TYPES[0];
      const labelText = ct.labelKey.replace(/^chart_type_/, '').replace(/_/g, ' ');
      trigger.innerHTML = `
        <img src="/static/icons/${esc(ct.value)}.svg" alt="" class="chart-icon" />
        <span id="chart-type-trigger-label">${esc(labelText)}</span>`;
    }

    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      options.classList.toggle('open');
    });
    document.addEventListener('click', (e) => {
      if (!trigger.contains(e.target) && !options.contains(e.target)) {
        options.classList.remove('open');
      }
    });
    renderOptions();
    updateTrigger();
  }

  function renderChartControls() {
    const dash = state.currentDashboard;
    // Any table column may be used for charting, not just dimensions.
    const allCols = (state.columns || []).map(c => c.name);
    // Use all available columns for chart dimension selection, not just visible ones,
    // so hidden dimensions (e.g. used as split) can still be chosen.
    const chartCols = allCols;
    const xEl = $('#chart-x');
    const splitEl = $('#chart-split');
    const xCol = xEl ? xEl.value : (chartCols[0] || '');
    const options = chartCols
      .map(c => `<option value="${esc(c)}"${c === xCol ? ' selected' : ''}>${esc(displayName(c))}</option>`)
      .join('');
    if (xEl) {
      xEl.innerHTML = options || '<option value="">' + esc(t('chart_x_no_columns')) + '</option>';
      if (!chartCols.includes(xEl.value)) xEl.value = chartCols[0] || '';
    }
    if (splitEl) {
      // Keep both axes independent: all columns are available in both dropdowns.
      const splitOptions = chartCols
        .map(c => `<option value="${esc(c)}">${esc(displayName(c))}</option>`)
        .join('');
      splitEl.innerHTML = '<option value="">' + esc(t('chart_split_none')) + '</option>' + splitOptions;
      splitEl.disabled = !chartCols.length;
    }
  }

  function addSeriesRow(series) {
    const container = $('#chart-series-list');
    const id = 'series-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    const yCol = series ? series.y_column : '';
    const agg = series ? series.aggregation : 'sum';
    const label = series ? series.label : '';
    const renderAs = series ? series.render_as || 'bar' : 'bar';
    const dash = state.currentDashboard;
    const dimCols = dash.dimension_columns || [];
    const exclude = new Set(dimCols);
    const measureCols = state.columns
      .filter(c => c.type === 'number' && !exclude.has(c.name))
      .map(c => `<option value="${esc(c.name)}" ${c.name === yCol ? 'selected' : ''}>${esc(displayName(c.name))}</option>`)
      .join('');
    const div = document.createElement('div');
    div.className = 'chart-series-row';
    div.dataset.seriesId = id;
    div.innerHTML = `
      <select class="series-y">${measureCols || '<option value="">' + esc(t('no_numeric_column_option')) + '</option>'}</select>
      <select class="series-agg" data-i18n-opts="${esc(JSON.stringify(SERIES_AGGREGATION_LABELS))}">
        <option value="sum" ${agg === 'sum' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.sum))}</option>
        <option value="count" ${agg === 'count' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.count))}</option>
        <option value="avg" ${agg === 'avg' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.avg))}</option>
        <option value="min" ${agg === 'min' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.min))}</option>
        <option value="max" ${agg === 'max' ? 'selected' : ''}>${esc(t(SERIES_AGGREGATION_LABELS.max))}</option>
      </select>
      <select class="series-render" data-i18n-opts="${esc(JSON.stringify(SERIES_RENDER_LABELS))}">
        <option value="bar" ${renderAs === 'bar' ? 'selected' : ''}>${esc(t(SERIES_RENDER_LABELS.bar))}</option>
        <option value="line" ${renderAs === 'line' ? 'selected' : ''}>${esc(t(SERIES_RENDER_LABELS.line))}</option>
      </select>
      <input type="text" class="series-label" placeholder="${esc(t('series_label_placeholder'))}" value="${esc(label)}">
      <button class="btn danger remove-series" type="button">×</button>
    `;
    div.querySelector('.remove-series').addEventListener('click', () => div.remove());
    container.appendChild(div);
  }

  function collectCharts() {
    return (state.currentDashboard.charts || []).map(c => ({ ...c }));
  }

  function renderMoreSettings() {
    const dash = state.currentDashboard;
    setValue('#setting-number-format', dash.number_format || '#,##0.00');
    setValue('#setting-date-time-format', dash.date_time_format || 'dd.MM.yyyy HH:mm');
    setValue('#setting-color-scheme', dash.color_scheme || 'default');
    setValue('#setting-row-limit', String(dash.row_limit !== null && dash.row_limit !== undefined ? dash.row_limit : 1000));
    setValue('#setting-charts-per-row', String(dash.charts_per_row || 3));
    setValue('#setting-chart-height', String(dash.chart_card_height || 360));
    const gridEl = $('#setting-show-grid');
    if (gridEl) gridEl.checked = parseBool(dash.show_grid, true);
    const nullEl = $('#setting-replace-null');
    if (nullEl) nullEl.checked = parseBool(dash.replace_null_with_empty, true);
    const colorSignEl = $('#setting-color-numeric-sign');
    if (colorSignEl) colorSignEl.checked = parseBool(dash.color_numeric_sign, false);
    updateChartsPerRowStyle();
  }

  function setValue(sel, value) {
    const el = $(sel);
    if (el) el.value = value;
  }

  function updateChartsPerRowStyle() {
    const perRowEl = $('#setting-charts-per-row');
    const heightEl = $('#setting-chart-height');
    const perRow = perRowEl ? parseInt(perRowEl.value) || 3 : 3;
    const height = heightEl ? parseInt(heightEl.value) || 360 : 360;
    const list = $('#chart-list');
    if (list) {
      list.style.gridTemplateColumns = `repeat(${perRow}, minmax(0, 1fr))`;
      list.style.setProperty('--card-height', height + 'px');
      list.querySelectorAll('.chart-card').forEach(card => {
        card.style.height = height + 'px';
      });
    }
  }

  function addChart() {
    const xColumn = $('#chart-x').value;
    const splitColumn = $('#chart-split').value;
    const title = $('#chart-title').value.trim() || t('new_chart_default_title');
    const type = $('#chart-type').value;
    const xLabel = $('#chart-x-label').value.trim();
    const yLabel = $('#chart-y-label').value.trim();
    const series = [];
    $('#chart-series-list').querySelectorAll('.chart-series-row').forEach(row => {
      const y = row.querySelector('.series-y').value;
      if (!y) return;
      series.push({
        y_column: y,
        aggregation: row.querySelector('.series-agg').value,
        render_as: row.querySelector('.series-render').value || 'bar',
        label: row.querySelector('.series-label').value.trim() || y,
      });
    });
    if (!series.length) {
      alert(t('add_chart_no_series_error'));
      return;
    }

    const dash = state.currentDashboard;
    ensureVisible(xColumn);
    if (splitColumn) ensureVisible(splitColumn);
    series.forEach(s => ensureVisible(s.y_column));

    const chart = {
      chart_type: type,
      x_column: xColumn,
      split_by_column: splitColumn,
      title: title,
      series: series,
      x_label: xLabel,
      y_label: yLabel,
    };
    state.currentDashboard.charts.push(chart);
    saveDashboard();
  }

  function expandChart(idx) {
    state.expandedChart = idx;
    renderCharts();
  }

  function closeExpandedChart() {
    state.expandedChart = null;
    renderCharts();
  }

  function ensureVisible(colName) {
    const dash = state.currentDashboard;
    if (!colName || dash.visible_columns.includes(colName)) return;
    dash.visible_columns.push(colName);
    const colInfo = state.columns.find(c => c.name === colName);
    // Only aggregate if the user is in pivot mode (has other aggregations).
    const hasOtherAggs = Object.values(dash.aggregations).some(Boolean);
    if (colInfo && colInfo.type === 'number' && !dash.aggregations[colName] && hasOtherAggs) {
      dash.aggregations[colName] = 'sum';
    }
  }

  function clearCharts() {
    Object.values(state.chartInstances).forEach(c => c.destroy());
    state.chartInstances = {};
    $('#chart-list').innerHTML = '';
  }

  function renderCharts() {
    clearCharts();
    const list = $('#chart-list');
    list.innerHTML = '';
    updateChartsPerRowStyle();
    if (!(state.data.rows || []).length) return;
    const expanded = state.expandedChart;
    if (expanded !== null) {
      list.classList.add('has-expanded');
    } else {
      list.classList.remove('has-expanded');
    }
    (state.currentDashboard.charts || []).forEach((chart, idx) => {
      if (expanded !== null && expanded !== idx) return;
      const card = document.createElement('div');
      card.className = 'chart-card' + (expanded === idx ? ' expanded' : '');
      const title = document.createElement('h4');
      title.innerHTML = `${esc(chart.title)}
        ${expanded === idx ? '<button id="close-expanded-chart" class="btn icon" type="button">✕</button>' : `<button data-idx="${idx}" class="btn icon expand-chart" type="button" title="${esc(t('chart_expand_title'))}">⤢</button>`}
        <button data-idx="${idx}" class="btn danger remove-chart" type="button">×</button>`;
      card.appendChild(title);
      const chartArea = document.createElement('div');
      chartArea.className = 'chart-area';
      const canvas = document.createElement('canvas');
      canvas.id = 'chart-canvas-' + idx;
      chartArea.appendChild(canvas);
      card.appendChild(chartArea);
      const legendContainer = document.createElement('div');
      legendContainer.className = 'chart-legend';
      legendContainer.id = 'chart-legend-' + idx;
      card.appendChild(legendContainer);
      list.appendChild(card);

      if (chart.chart_type === 'gauge') {
        drawGauge(canvas, chart, getChartRows(chart));
      } else if (chart.chart_type === 'funnel') {
        drawFunnel(canvas, chart, getChartRows(chart));
      } else if (chart.chart_type === 'scatter') {
        drawScatter(canvas, chart, legendContainer, getChartRows(chart));
      } else {
        drawChart(canvas, chart, legendContainer, getChartRows(chart));
      }
    });

    list.querySelectorAll('.remove-chart').forEach(btn => {
      btn.addEventListener('click', () => {
        state.currentDashboard.charts.splice(parseInt(btn.dataset.idx), 1);
        saveDashboard();
      });
    });
    list.querySelectorAll('.expand-chart').forEach(btn => {
      btn.addEventListener('click', () => expandChart(parseInt(btn.dataset.idx)));
    });
    const closeBtn = $('#close-expanded-chart');
    if (closeBtn) closeBtn.addEventListener('click', closeExpandedChart);
  }

  function getChartRows(chart) {
    const dash = state.currentDashboard;
    const rawCols = state.data.columns || [];
    const rows = state.data.rows;
    if (!rows.length) return rows;
    const xCol = chart ? chart.x_column : (rawCols[0] || '');
    if (!xCol || !rawCols.includes(xCol)) return rows;
    const splitCol = chart ? chart.split_by_column : '';
    const measureCols = chart
      ? chart.series.map(s => s.y_column)
      : Object.keys(dash.aggregations).filter(c => dash.aggregations[c]);
    const seriesAggs = chart
      ? Object.fromEntries(chart.series.map(s => [s.y_column, s.aggregation]))
      : null;
    const dimCols = splitCol ? [xCol, splitCol] : [xCol];
    const groups = groupByKeys(rows, dimCols);
    return groups.map(g => buildSummaryRow(g.rows, [...dimCols, ...measureCols], dimCols, [], seriesAggs));
  }

  function drawChart(canvas, chart, legendContainer, rows) {
    if (typeof Chart === 'undefined') return;
    rows = rows || state.data.rows || [];
    const xCol = chart.x_column;
    const splitCol = chart.split_by_column;
    if (splitCol) {
      const seriesAggs = Object.fromEntries(chart.series.map(s => [s.y_column, s.aggregation]));
      rows = groupByKeys(rows, [xCol, splitCol]).map(g => buildSummaryRow(g.rows, [xCol, splitCol, ...chart.series.map(s => s.y_column)], [xCol, splitCol], [], seriesAggs));
    }
    const xValues = [...new Set(rows.map(r => r[xCol]))];
    const rawLabels = xValues.slice().sort((a, b) => {
      const na = parseFloat(a), nb = parseFloat(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(a).localeCompare(String(b));
    });
    const labels = rawLabels.map(v => String(v));
    const labelLookup = new Map();
    rawLabels.forEach((raw, i) => labelLookup.set(labels[i], raw));

    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const colors = [...scheme];

    function aggregate(relevant, yCol, aggregation) {
      const values = relevant.map(r => parseFloat(r[yCol]) || 0);
      switch (aggregation) {
        case 'count': return relevant.length;
        case 'avg': return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
        case 'min': return values.length ? Math.min(...values) : 0;
        case 'max': return values.length ? Math.max(...values) : 0;
        case 'sum': default: return values.reduce((a, b) => a + b, 0);
      }
    }

    const type = chart.chart_type;
    const isHorizontal = type.includes('horizontal');
    const isStacked = type.includes('stacked') || type.includes('percent') || (type === 'bar' && splitCol);
    const isPercent = type.includes('percent');
    const isArea = type.includes('area');
    const isLine = type === 'line' || isArea;
    const baseType = type.startsWith('percent') || type.startsWith('stacked') || type.startsWith('grouped') || type.startsWith('horizontal')
      ? type.split('_').slice(-1)[0]
      : type;
    const chartJsType = isArea ? 'line' : (baseType === 'bar' || baseType === 'horizontal' ? 'bar' : baseType);

    let datasets = [];
    if (splitCol) {
      const splitValues = [...new Set(rows.map(r => r[splitCol]))].sort();
      datasets = chart.series.flatMap((s, si) =>
        splitValues.map((sv, vi) => {
          const data = labels.map(label => {
            const rawLabel = labelLookup.get(label);
            const relevant = rows.filter(r => r[xCol] === rawLabel && r[splitCol] === sv);
            return aggregate(relevant, s.y_column, s.aggregation);
          });
          const colorIndex = (si * splitValues.length + vi) % colors.length;
          return buildDataset(data, s, colorIndex, `${esc(s.label || s.y_column)} / ${esc(sv)}`, isHorizontal, isArea, isLine);
        })
      );
    } else {
      datasets = chart.series.map((s, i) => {
        const data = labels.map(label => {
          const rawLabel = labelLookup.get(label);
          const relevant = rows.filter(r => r[xCol] === rawLabel);
          return aggregate(relevant, s.y_column, s.aggregation);
        });
        const colorIndex = i % colors.length;
        const preferLine = s.render_as === 'line';
        return buildDataset(data, s, colorIndex, s.label || s.y_column, isHorizontal, isArea, isLine || preferLine);
      });
    }

    const showGrid = parseBool(dash.show_grid, true);
    const indexAxis = isHorizontal ? 'y' : 'x';
    const gridOptions = { color: '#e5e7eb', drawBorder: false, tickLength: 8 };
    const scales = (type === 'pie' || type === 'doughnut') ? {} : {
      [indexAxis]: {
        stacked: isStacked,
        title: { display: !!chart.x_label, text: chart.x_label || '', font: { size: 13, weight: '600' } },
        grid: showGrid ? gridOptions : { display: false },
        ticks: { font: { size: 11 }, maxRotation: 45, minRotation: 0 },
      },
      [isHorizontal ? 'x' : 'y']: {
        beginAtZero: true,
        stacked: isStacked,
        title: { display: !!chart.y_label, text: chart.y_label || '', font: { size: 13, weight: '600' } },
        grid: showGrid ? gridOptions : { display: false },
        ticks: { font: { size: 11 } },
        ...(isPercent ? { max: 100, ticks: { callback: v => v + '%' } } : {}),
      },
    };

    const config = {
      type: chartJsType,
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        indexAxis,
        layout: { padding: { top: 8, right: 16, bottom: 4, left: 8 } },
        plugins: {
          title: { display: false },
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(17,24,39,0.92)',
            titleFont: { size: 13 },
            bodyFont: { size: 13 },
            padding: 10,
            cornerRadius: 8,
            mode: 'nearest',
            intersect: false,
            callbacks: isPercent ? { label: ctx => `${ctx.dataset.label}: ${ctx.raw.toFixed ? ctx.raw.toFixed(2) : ctx.raw}%` } : {},
          },
        },
        scales,
      },
    };
    const instance = new Chart(canvas, config);
    state.chartInstances[canvas.id] = instance;
    renderCustomLegend(legendContainer, instance, datasets);
  }

  function buildDataset(data, series, colorIndex, label, isHorizontal, isArea, forceLine) {
    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const color = scheme[colorIndex % scheme.length];
    const isLine = forceLine || series.render_as === 'line';
    const base = {
      label,
      data,
      backgroundColor: isLine ? color.replace('0.7', '0.2') : color,
      borderColor: color.replace('0.7', '1'),
      borderWidth: 2,
      tension: 0.3,
      fill: isArea,
      borderRadius: isLine ? 0 : 4,
      barPercentage: 0.65,
      categoryPercentage: 0.8,
      pointRadius: isLine ? 4 : 0,
      pointHoverRadius: isLine ? 6 : 0,
    };
    if (isLine) {
      base.type = 'line';
    }
    if (isArea) {
      base.type = 'line';
      base.fill = true;
    }
    return base;
  }

  function drawScatter(canvas, chart, legendContainer, rows) {
    if (typeof Chart === 'undefined') return;
    rows = rows || state.data.rows || [];
    const xCol = chart.x_column;
    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const colors = [...scheme];
    const datasets = chart.series.map((s, i) => ({
      label: s.label || s.y_column,
      data: rows.map(r => ({ x: r[xCol], y: parseFloat(r[s.y_column]) || 0 })),
      backgroundColor: colors[i % colors.length],
      borderColor: colors[i % colors.length].replace('0.7', '1'),
      borderWidth: 2,
    }));
    const showGrid = parseBool(dash.show_grid, true);
    const config = {
      type: 'scatter',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          title: { display: false },
          legend: { display: false },
          tooltip: { mode: 'nearest', intersect: false },
        },
        scales: {
          x: {
            type: 'category',
            title: { display: !!chart.x_label, text: chart.x_label || '' },
            grid: { display: showGrid },
          },
          y: {
            beginAtZero: true,
            title: { display: !!chart.y_label, text: chart.y_label || '' },
            grid: { display: showGrid },
          },
        },
      },
    };
    const instance = new Chart(canvas, config);
    state.chartInstances[canvas.id] = instance;
    renderCustomLegend(legendContainer, instance, datasets);
  }

  function renderCustomLegend(container, chart, datasets) {
    container.innerHTML = '';
    datasets.forEach((ds, i) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'legend-item';
      item.dataset.datasetIndex = String(i);
      const color = typeof ds.backgroundColor === 'string' ? ds.backgroundColor : ds.borderColor;
      item.innerHTML = `<span class="legend-color" style="background:${esc(color)}"></span>
        <span class="legend-label">${esc(ds.label)}</span>`;
      item.addEventListener('click', () => {
        const index = parseInt(item.dataset.datasetIndex);
        chart.setDatasetVisibility(index, !chart.isDatasetVisible(index));
        chart.update();
        item.classList.toggle('hidden', !chart.isDatasetVisible(index));
      });
      container.appendChild(item);
    });
  }

  function drawGauge(canvas, chart, rows) {
    rows = rows || state.data.rows || [];
    if (!rows.length) return;
    const dash = state.currentDashboard;
    const nf = dash.number_format || '#,##0.00';
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 240, height: 160 };
    const width = Math.max(rect.width || 240, 120);
    const height = Math.max(Math.min(width * 0.55, rect.height || 200), 100);
    canvas.width = width;
    canvas.height = height;

    chart.series.forEach((s, si) => {
      const total = rows.reduce((acc, r) => acc + (parseFloat(r[s.y_column]) || 0), 0);
      const cx = width / 2;
      const cy = height * 0.85;
      const radius = Math.min(width, height) * 0.65;
      const startAngle = Math.PI;
      const max = Math.max(total * 1.2, 1);
      const endAngle = startAngle + (total / max) * Math.PI;

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, 0);
      ctx.strokeStyle = '#e5e7eb';
      ctx.lineWidth = Math.max(12, radius * 0.18);
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, endAngle);
      ctx.strokeStyle = scheme[si % scheme.length].replace('0.7', '1');
      ctx.lineWidth = Math.max(12, radius * 0.18);
      ctx.stroke();

      ctx.fillStyle = '#111827';
      ctx.font = 'bold 20px sans-serif';
      ctx.textAlign = 'center';
      const isInt = isIntegerColumn(s.y_column);
      const label = s.label || s.y_column;
      ctx.fillText(formatNumber(total, nf, isInt), cx, cy - radius * 0.25);
      ctx.font = '12px sans-serif';
      ctx.fillStyle = '#6b7280';
      ctx.fillText(esc(label), cx, cy + 12);
    });
  }

  function drawFunnel(canvas, chart, rows) {
    rows = rows || state.data.rows || [];
    if (!rows.length) return;
    const xCol = chart.x_column;
    const s = chart.series[0];
    if (!s) return;
    const labels = [...new Set(rows.map(r => r[xCol]))].sort();
    const values = labels.map(label => {
      return rows.filter(r => r[xCol] === label).reduce((a, r) => a + (parseFloat(r[s.y_column]) || 0), 0);
    });

    const ctx = canvas.getContext('2d');
    const rect = canvas.parentElement ? canvas.parentElement.getBoundingClientRect() : { width: 300, height: 200 };
    const width = Math.max(rect.width || 300, 200);
    const rowHeight = Math.max(34, Math.min(50, (rect.height || 200) / labels.length));
    canvas.width = width;
    canvas.height = labels.length * rowHeight + 20;
    const max = Math.max(...values, 1);
    const dash = state.currentDashboard;
    const scheme = COLOR_SCHEMES[dash.color_scheme || 'default'] || DEFAULT_COLORS;
    const colors = [...scheme].map(c => c.replace('0.7', '1'));
    const nf = dash.number_format || '#,##0.00';

    labels.forEach((label, i) => {
      const h = rowHeight - 10;
      const w = (values[i] / max) * (width - 120);
      const y = i * rowHeight + 10;
      const x = (width - w) / 2;
      ctx.fillStyle = colors[i % colors.length];
      ctx.fillRect(x, y, w, h);
      ctx.fillStyle = '#111827';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'left';
      const isInt = isIntegerColumn(s.y_column);
      ctx.fillText(`${esc(label)}: ${formatNumber(values[i], nf, isInt)}`, 10, y + h / 2 + 4);
    });
  }

  function formatNumber(value, format, isInteger = false) {
    if (value === null || value === undefined || isNaN(value)) return value;
    const floatVal = parseFloat(value);
    if (isNaN(floatVal)) return value;
    if (format === '#,##0' || isInteger) return Math.round(floatVal).toLocaleString();
    if (format === '#,##0.00') return floatVal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (format === '#,##0.0000') return floatVal.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    if (format === '0%') return (floatVal * 100).toFixed(0) + '%';
    if (format === '0.00%') return (floatVal * 100).toFixed(2) + '%';
    return isInteger ? Math.round(floatVal).toLocaleString() : floatVal.toLocaleString();
  }

  function isIntegerColumn(col) {
    const colInfo = state.columns.find(c => c.name === col);
    return !!(colInfo && colInfo.is_integer);
  }

  function valueOr(sel, defaultValue) {
    const el = $(sel);
    return el && el.value ? el.value : defaultValue;
  }

  function formatTableValue(value, col) {
    const dash = state.currentDashboard;
    const nf = dash.number_format || '#,##0.00';
    if (value === null || value === undefined) return null;
    const colInfo = state.columns.find(c => c.name === col);
    if (colInfo && colInfo.type === 'number') {
      return formatNumber(value, nf, isIntegerColumn(col));
    }
    if (colInfo && colInfo.type === 'date') {
      return formatDateTime(value, dash.date_time_format || 'dd.MM.yyyy HH:mm');
    }
    return value;
  }

  function formatDateTime(value, pattern) {
    if (!value) return value;
    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return value;
    }
    let d = value instanceof Date ? value : null;
    let strValue = value;
    if (typeof value === 'string') {
      // SQL Server datetime strings like "2026-07-27 13:23:05.123000".
      // Trim trailing zeros after the decimal point and parse as ISO-like.
      const normalized = value.replace(/(\d{2}):(\d{2}):(\d{2})\.(\d+)/, (_, h, m, s, ms) => {
        return `${h}:${m}:${s}.${ms.slice(0, 3)}`;
      });
      d = new Date(normalized.replace(' ', 'T'));
      strValue = normalized;
    }
    if (!d || Number.isNaN(d.getTime())) {
      // Fallback: try to format the raw SQL string directly without parsing.
      if (typeof strValue === 'string') {
        const m = strValue.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/);
        if (m) {
          const pad2 = (n) => String(n).padStart(2, '0');
          const map = {
            yyyy: m[1], MM: m[2], dd: m[3], HH: m[4], mm: m[5], ss: m[6],
          };
          return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, key => map[key]);
        }
      }
      return value;
    }
    const pad2 = (n) => String(n).padStart(2, '0');
    const map = {
      yyyy: d.getFullYear(),
      MM: pad2(d.getMonth() + 1),
      dd: pad2(d.getDate()),
      HH: pad2(d.getHours()),
      mm: pad2(d.getMinutes()),
      ss: pad2(d.getSeconds()),
    };
    return pattern.replace(/yyyy|MM|dd|HH|mm|ss/g, m => map[m]);
  }

  function debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, arguments), ms);
    };
  }

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  init();
})();
