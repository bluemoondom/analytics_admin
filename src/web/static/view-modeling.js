(function () {
  const t = window.I18n ? window.I18n.t : (k, p) => `{${k}}`;

  const API = '/api/views';

  let state = {
    tables: [],
    savedViews: [],
    connectors: [],
    currentConnectorId: null,
    viewId: null,
    viewConnectorId: null,
    tablesOnCanvas: [], // [{ name, isPrimary, isSubview, viewId, definition, columns: [{name, type, selected, alias, groupBy, aggregation}] }]
    joins: [],
    whereClauses: [],
    customColumns: [], // [{ alias, definition }]
    groupBy: [], // [{ table, column }]
    orderBy: [], // [{ table, column, desc }]
    columnAggregations: {}, // { "table.column": "SUM" }
    activeWhereValue: null, // { rowIndex, input } currently focused value input
    tableAliasTarget: null, // canvas table alias being renamed
    columnsCache: {},
    previewData: { columns: [], rows: [] },
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  async function api(method, path, body) {
    const opts = { method, headers: {} };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const token = csrfToken();
      if (token) opts.headers['X-CSRF-Token'] = token;
    }
    const res = await fetch(API + path, opts);
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  }

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  function esc(str) {
    return String(str || '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  }

  function escHtml(str) {
    // Escape only characters that are unsafe inside HTML text/content. Leaves
    // single quotes untouched so SQL literals such as '00100001' stay readable.
    return String(str || '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  }

  function typeLabel(col) {
    // Always show the raw database type (INT, NUMERIC, NVARCHAR, DATETIME, ...)
    // instead of a translated UI label.
    return col.raw_type || col.type || '';
  }

  function highlightSql(sql) {
    if (!sql) return '';
    const keywords = new Set([
      'SELECT', 'FROM', 'WHERE', 'JOIN', 'LEFT', 'INNER', 'RIGHT', 'FULL', 'OUTER', 'ON', 'AS',
      'GROUP', 'BY', 'ORDER', 'HAVING', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN',
      'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'TOP', 'DISTINCT', 'UNION', 'ALL', 'INSERT', 'UPDATE',
      'DELETE', 'CREATE', 'ALTER', 'DROP', 'TABLE', 'VIEW', 'INDEX', 'INTO', 'VALUES', 'SET',
      'OFFSET', 'ROWS', 'FETCH', 'NEXT', 'ONLY', 'WITH', 'OVER', 'PARTITION', 'EXISTS'
    ]);
    const joinWords = new Set(['JOIN', 'LEFT', 'RIGHT', 'INNER', 'FULL', 'OUTER', 'CROSS']);
    const groupOrderWords = new Set(['GROUP', 'ORDER', 'BY']);
    const functions = new Set([
      'SUM', 'COUNT', 'MIN', 'MAX', 'AVG', 'CAST', 'TRY_CAST', 'COALESCE', 'ISNULL', 'LEN',
      'UPPER', 'LOWER', 'REPLACE', 'CONVERT', 'DATEADD', 'DATEDIFF', 'GETDATE', 'ROW_NUMBER',
      'RANK', 'DENSE_RANK', 'NTILE', 'ROUND', 'FLOOR', 'CEILING', 'ABS'
    ]);

    let idx = 0;
    let out = '';
    const regex = /(--[^\r\n]*)|(\/\*[\s\S]*?\*\/)|('[^']*')|(\[[^\]]+\])|(\b\d+(?:\.\d+)?\b)|(\b[A-Za-z_][A-Za-z0-9_]*\b)|([(),.*=<>!+\-\/]+|\s+)/g;
    let match;
    while ((match = regex.exec(sql)) !== null) {
      if (match.index > idx) {
        out += esc(sql.slice(idx, match.index));
      }
      idx = regex.lastIndex;
      const token = match[0];
      if (match[1] || match[2]) {
        out += `<span class="cmt">${esc(token)}</span>`;
      } else if (match[3]) {
        out += `<span class="str">${esc(token)}</span>`;
      } else if (match[4]) {
        out += `<span class="id">${esc(token)}</span>`;
      } else if (match[5]) {
        out += `<span class="num">${esc(token)}</span>`;
      } else if (match[6]) {
        const upper = token.toUpperCase();
        if (upper === 'AS') {
          out += `<span class="kw kw-as">${esc(token)}</span>`;
        } else if (joinWords.has(upper)) {
          out += `<span class="kw kw-join">${esc(token)}</span>`;
        } else if (groupOrderWords.has(upper)) {
          out += `<span class="kw kw-group">${esc(token)}</span>`;
        } else if (keywords.has(upper)) {
          out += `<span class="kw">${esc(token)}</span>`;
        } else if (functions.has(upper)) {
          out += `<span class="fn">${esc(token)}</span>`;
        } else {
          out += esc(token);
        }
      } else {
        out += esc(token);
      }
    }
    if (idx < sql.length) {
      out += esc(sql.slice(idx));
    }
    return out;
  }

  function init() {
    bindViewModelingEvents();
    bindLanguageChange();

    if (window.I18n && window.I18n.isReady && window.I18n.isReady()) {
      loadConnectors().then(() => {
        loadTables();
        loadSavedViews();
        newView();
      });
    } else if (window.I18n) {
      const unsubscribe = window.I18n.onChange(() => {
        unsubscribe();
        loadConnectors().then(() => {
          loadTables();
          loadSavedViews();
          newView();
        });
      });
    } else {
      loadConnectors().then(() => {
        loadTables();
        loadSavedViews();
        newView();
      });
    }
  }

  function bindLanguageChange() {
    if (!window.I18n) return;
    window.I18n.onChange(() => {
      renderCanvas();
      renderJoinEditor();
      renderCustomColumns();
      renderWhereEditor();
      renderOrderByEditor();
      renderGroupByEditor();
    });
  }

  function bindViewModelingEvents() {
    bindControl('new-view', 'click', newView);
    bindControl('save-view', 'click', saveView);
    bindControl('preview-view', 'click', previewView);
    bindControl('preview-view-panel', 'click', previewView);
    bindControl('add-join', 'click', addJoinRow);
    bindControl('add-where', 'click', addWhereRow);
    bindControl('add-order-by', 'click', addOrderByRow);
    bindControl('add-subview', 'click', addSubview);
    bindControl('add-custom-column', 'click', addCustomColumn);
    bindControl('download-api-bat', 'click', downloadApiBat);
    bindControl('view-api-enabled', 'change', toggleApiPutVisibility);
    bindControl('view-api-put-enabled', 'change', toggleApiPutVisibility);
    bindControl('delete-view', 'click', deleteView);
    bindControl('table-search', 'input', filterTableList);
    bindControl('table-search', 'change', onTableSearchSelect);
    bindControl('view-search', 'input', filterViewList);
    bindControl('view-search', 'change', onViewSearchSelect);

    bindControl('table-alias-cancel', 'click', closeTableAliasModal);
    bindControl('table-alias-save', 'click', saveTableAlias);
    const tableAliasBackdrop = $('#table-alias-modal .modal-backdrop');
    if (tableAliasBackdrop) tableAliasBackdrop.addEventListener('click', closeTableAliasModal);
    bindControl('table-alias-input', 'keydown', (e) => {
      if (e.key === 'Enter') saveTableAlias();
      if (e.key === 'Escape') closeTableAliasModal();
    });
  }

  function toggleApiPutVisibility() {
    const apiEl = $('#view-api-enabled');
    const putLabel = $('#view-api-put-label');
    const putEl = $('#view-api-put-enabled');
    if (!apiEl || !putLabel || !putEl) return;
    const show = apiEl.checked;
    putLabel.classList.toggle('hidden', !show);
    if (!show) putEl.checked = false;
  }

  function addCustomColumn() {
    state.customColumns.push({ alias: '', definition: '' });
    renderCustomColumns();
  }

  function removeCustomColumn(idx) {
    state.customColumns.splice(idx, 1);
    renderCustomColumns();
  }

  function setCustomColumnAlias(idx, value) {
    state.customColumns[idx].alias = value;
  }

  function setCustomColumnDefinition(idx, value) {
    state.customColumns[idx].definition = value;
  }

  function renderCustomColumns() {
    const container = $('#custom-columns-list');
    if (!container) return;
    if (!state.customColumns.length) {
      container.innerHTML = `<p class="empty-hint">${esc(t('no_custom_columns_hint'))}</p>`;
      return;
    }
    container.innerHTML = state.customColumns.map((col, idx) => `
      <div class="custom-column-row" data-index="${idx}">
        <input type="text" class="custom-column-alias" data-index="${idx}" placeholder="${esc(t('custom_column_alias_placeholder'))}" value="${esc(col.alias || '')}">
        <textarea class="custom-column-definition" data-index="${idx}" rows="1" placeholder="${esc(t('custom_column_definition_placeholder'))}">${esc(col.definition || '')}</textarea>
        <button type="button" class="btn small danger remove-custom-column" data-index="${idx}">×</button>
      </div>
    `).join('');

    container.querySelectorAll('.custom-column-alias').forEach(inp => {
      inp.addEventListener('input', (e) => setCustomColumnAlias(parseInt(e.target.dataset.index), e.target.value));
    });
    container.querySelectorAll('.custom-column-definition').forEach(ta => {
      ta.addEventListener('input', (e) => {
        setCustomColumnDefinition(parseInt(e.target.dataset.index), e.target.value);
        autoResizeTextarea(e.target);
      });
      ta.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey) {
          // Allow multiline input.
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
        }
      });
      autoResizeTextarea(ta);
    });
    container.querySelectorAll('.remove-custom-column').forEach(btn => {
      btn.addEventListener('click', (e) => removeCustomColumn(parseInt(e.target.dataset.index)));
    });
  }

  function autoResizeTextarea(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function bindControl(id, event, handler) {
    const el = $('#' + id);
    if (!el) return;
    el.addEventListener(event, handler);
  }

  async function loadConnectors() {
    try {
      const userRes = await fetch('/auth/me');
      if (userRes.ok) {
        const user = await userRes.json();
        state.currentConnectorId = user.connector_id || null;
      }
      const res = await fetch('/api/connectors/');
      if (!res.ok) throw new Error(await res.text());
      state.connectors = await res.json();
      renderConnectorSelect();
    } catch (err) {
      console.error('Failed to load connectors', err);
    }
  }

  function renderConnectorSelect() {
    const sel = $('#view-connector-select');
    if (!sel) return;
    sel.innerHTML = '';
    state.connectors.forEach((c) => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      if (c.id === state.viewConnectorId || (state.viewConnectorId === null && c.id === state.currentConnectorId)) {
        opt.selected = true;
      }
      sel.appendChild(opt);
    });
    // Allow switching connectors even for saved views, but warn that it changes the data source.
    // Lock the connector selector when editing a saved view because the backend
    // forbids moving an existing view to a different connector to keep data sources
    // isolated and predictable.
    sel.disabled = state.viewId !== null;
    const box = sel.closest('.connector-select-box');
    if (box) box.classList.toggle('locked', state.viewId !== null);
    const warn = $('#view-connector-warning');
    if (warn) warn.classList.toggle('hidden', true);
  }



  function getSelectedConnectorId() {
    const sel = $('#view-connector-select');
    if (!sel) return state.viewConnectorId || state.currentConnectorId;
    return parseInt(sel.value, 10);
  }

  async function loadTables() {
    state.tables = await api('GET', '/tables');
    populateDatalist(state.tables, '#table-options');
    populateDatalist(state.tables, '#primary-table-options');
  }

  function populateDatalist(tables, datalistId) {
    const dl = $(datalistId);
    if (!dl) return;
    dl.innerHTML = tables.map(t =>
      `<option value="${esc(t.system_name)}" label="${esc(t.display_name)} (${t.kind})"></option>`
    ).join('');
  }

  function filterTableList() {
    const input = $('#table-search');
    const term = (input.value || '').trim().toLowerCase();
    const filtered = term
      ? state.tables.filter(t => t.system_name.toLowerCase().includes(term) || t.display_name.toLowerCase().includes(term))
      : state.tables.slice(0, 20);
    populateDatalist(filtered, '#table-options');
  }

  function filterViewList() {
    const input = $('#view-search');
    const term = (input.value || '').trim().toLowerCase();
    const filtered = term
      ? state.savedViews.filter(v => (v.NazevSys || v.Nazev || '').toLowerCase().includes(term))
      : state.savedViews.slice(0, 20);
    populateDatalist(
      filtered.map(v => ({
        system_name: String(v.ID || v.id || ''),
        display_name: v.NazevSys || v.Nazev || t('unnamed_view_fallback'),
        kind: 'view',
      })),
      '#view-options'
    );
  }

  async function onViewSearchSelect() {
    const value = $('#view-search').value.trim();
    const viewId = parseInt(value);
    if (!viewId) return;
    const match = state.savedViews.find(v => (v.ID || v.id) == viewId);
    if (match) {
      $('#subview-alias').value = match.NazevSys || match.Nazev || 'subview';
    }
  }

  async function loadSavedViews() {
    try {
      const views = await api('GET', '/saved');
      state.savedViews = views || [];
      const list = $('#view-list');
      if (!views.length) {
        list.innerHTML = `<p class="empty-hint">${esc(t('no_saved_views_hint'))}</p>`;
        return;
      }
      list.innerHTML = views.map(v => `
        <li data-id="${esc(v.ID || v.id || '')}" title="${esc((v.DefView || '').substring(0, 200))}">
          <div>
            <div>${esc(v.NazevSys || v.Nazev || t('unnamed_view_fallback'))}</div>
            <div class="meta">${esc(v.Autor || 'view')} · ${esc(v.DatPorizeni || '')}</div>
          </div>
          <button type="button" class="btn small edit-view" data-id="${esc(v.ID || v.id || '')}">${esc(t('edit_view_button'))}</button>
        </li>
      `).join('');
      list.querySelectorAll('.edit-view').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          loadViewForEdit(parseInt(btn.dataset.id));
        });
      });
      populateDatalist(
        state.savedViews.map(v => ({
          system_name: String(v.ID || v.id || ''),
          display_name: v.NazevSys || v.Nazev || t('unnamed_view_fallback'),
          kind: 'view',
        })),
        '#view-options'
      );
    } catch (err) {
      $('#view-list').innerHTML = `<p class="empty-hint">${esc(t('saved_views_load_error'))}</p>`;
    }
  }

  async function loadViewForEdit(viewId) {
    try {
      const parsed = await api('GET', '/saved/' + viewId);
      state.viewId = viewId;
      $('#view-name-input').value = parsed.name || '';
      $('#view-modeling-description').value = parsed.description || '';
      const apiEl = $('#view-api-enabled');
      if (apiEl) apiEl.checked = !!parsed.api_enabled;
      const apiTypeEl = $('#view-api-type');
      if (apiTypeEl) apiTypeEl.value = parsed.api_type || 'flat';
      const apiPutEl = $('#view-api-put-enabled');
      if (apiPutEl) apiPutEl.checked = !!parsed.api_put_enabled;
      toggleApiPutVisibility();
      state.viewConnectorId = parsed.connector_id || null;
      renderConnectorSelect();
      // Identify plain table names referenced by joins/columns, excluding subview aliases.
      const tableAliases = parsed.table_aliases || {};
      const subviewAliases = new Set((parsed.subviews || []).map(s => s.alias || s.name));
      const tableNames = new Set([parsed.primary_table]);
      parsed.joins.forEach(j => {
        if (!subviewAliases.has(j.right_table)) tableNames.add(j.right_table);
        if (!subviewAliases.has(j.left_table)) tableNames.add(j.left_table);
      });
      parsed.selected_columns.forEach(c => { if (c.table && !subviewAliases.has(c.table)) tableNames.add(c.table); });
      state.tablesOnCanvas = [];
      for (const name of tableNames) {
        if (!name) continue;
        const baseName = tableAliases[name] || name;
        try {
          const { columns } = await fetchColumnsFallback(baseName);
          state.tablesOnCanvas.push({
            name,
            baseName,
            isPrimary: name === parsed.primary_table,
            isSubview: false,
            columns: columns.map(c => ({ ...c, selected: false, alias: '', groupBy: false, aggregation: '' })),
          });
        } catch (err) {
          // If a referenced table/view does not exist (e.g. renamed subview), skip it.
          console.warn('Skipping missing table/view', name, err.message);
        }
      }
      // Add subviews from metadata.
      for (const sv of parsed.subviews || []) {
        const alias = sv.alias || sv.name;
        if (!alias) continue;
        const cols = (sv.columns || []).map(c => ({ ...c, selected: false, alias: c.alias || '', groupBy: false, aggregation: '' }));
        state.tablesOnCanvas.push({
          name: alias,
          baseName: alias,
          isPrimary: false,
          isSubview: true,
          viewId: sv.view_id,
          definition: sv.definition || '',
          columns: cols,
        });
      }
      // Mark selected columns and aliases.
      parsed.selected_columns.forEach(sel => {
        const table = state.tablesOnCanvas.find(t => t.name === (sel.table || parsed.primary_table));
        if (!table) return;
        const col = table.columns.find(c => c.name === sel.name);
        if (col) {
          col.selected = true;
          col.alias = sel.alias || '';
        }
      });
      // Rebuild joins.
      state.joins = (parsed.joins || []).map(j => ({
        left_table: j.left_table || parsed.primary_table,
        right_table: j.right_table,
        join_type: j.join_type || 'LEFT',
        conditions: (j.conditions || []).map(c => ({ ...c })),
        key_pairs: (j.key_pairs || []).map(p => ({ ...p })),
      }));
      state.whereClauses = (parsed.where_clauses || []).map(w => ({ ...w }));
      state.customColumns = (parsed.custom_columns || []).map(c => ({ ...c }));
      state.groupBy = (parsed.group_by || []).map(g => ({ table: g.table || parsed.primary_table, column: g.column }));
      state.orderBy = (parsed.order_by || []).map(o => ({ table: o.table || parsed.primary_table, column: o.column, aggregation: o.aggregation || '', desc: !!o.desc }));
      state.columnAggregations = { ...(parsed.aggregations || {}) };
      // Apply group-by and aggregation flags to column objects.
      state.tablesOnCanvas.forEach(t => {
        t.columns.forEach(c => {
          c.groupBy = state.groupBy.some(g => g.table === t.name && g.column === c.name);
          c.aggregation = state.columnAggregations[`${t.name}.${c.name}`] || '';
          if (c.groupBy) c.selected = true;
        });
      });
    renderCanvas();
    renderJoinEditor();
    renderCustomColumns();
    renderWhereEditor();
    renderOrderByEditor();
    renderGroupByEditor();
    clearPreview();
    } catch (err) {
      console.error('loadViewForEdit error', err);
      alert(t('load_view_for_edit_error', { error: err.message }));
    }
  }

  function newView() {
    state.viewId = null;
    state.viewConnectorId = null;
    state.tablesOnCanvas = [];
    state.joins = [];
    state.whereClauses = [];
    state.customColumns = [];
    state.groupBy = [];
    state.orderBy = [];
    state.columnAggregations = {};
    state.activeWhereValue = null;
    state.previewData = { columns: [], rows: [] };
    $('#view-name-input').value = '';
    $('#view-modeling-description').value = '';
    const apiEl = $('#view-api-enabled');
    if (apiEl) apiEl.checked = false;
    const apiTypeEl = $('#view-api-type');
    if (apiTypeEl) apiTypeEl.value = 'flat';
    $('#table-search').value = '';
    $('#preview-sql').innerHTML = '';
    $('#preview-table thead').innerHTML = '';
    $('#preview-table tbody').innerHTML = '';
    $('#preview-row-count').textContent = '';
    renderConnectorSelect();
    renderCanvas();
    renderJoinEditor();
    renderCustomColumns();
    renderWhereEditor();
    renderOrderByEditor();
    renderGroupByEditor();
  }

  async function addTableToCanvas(tableName) {
    // Allow adding the same base table multiple times; each instance gets a
    // unique alias so joins and columns can reference a specific copy.
    const alias = uniqueTableAlias(tableName);
    const isPrimary = state.tablesOnCanvas.length === 0;
    state.tablesOnCanvas.push(await buildTableCard(tableName, isPrimary, alias));
    renderCanvas();
    renderJoinEditor();
  }

  async function addSubview() {
    const value = $('#view-search').value.trim();
    const viewId = parseInt(value);
    const alias = $('#subview-alias').value.trim();
    if (!viewId) {
      alert(t('select_saved_view_alert'));
      return;
    }
    if (!alias) {
      alert(t('enter_subview_alias_alert'));
      return;
    }
    if (state.tablesOnCanvas.find(t => t.name === alias)) {
      alert(t('alias_must_be_unique_alert'));
      return;
    }
    const match = state.savedViews.find(v => (v.ID || v.id) == viewId);
    if (!match) {
      alert(t('selected_view_not_found_alert'));
      return;
    }
    try {
      const info = await api('GET', '/saved/' + viewId + '/columns');
      const columns = (info.columns || []).map(c => ({ ...c, selected: false, alias: '', groupBy: false, aggregation: '' }));
      state.tablesOnCanvas.push({
        name: alias,
        baseName: alias,
        isPrimary: false,
        isSubview: true,
        viewId,
        definition: match.DefView || '',
        columns,
      });
      $('#view-search').value = '';
      $('#subview-alias').value = '';
      renderCanvas();
      renderJoinEditor();
    } catch (err) {
      alert(t('subview_columns_load_error', { error: err.message }));
    }
  }

  // Fetch columns for a base table name.  If the name is not a physical
  // table/view but matches a saved view in this app, fall back to probing
  // that saved view's definition.
  async function fetchColumnsFallback(baseName) {
    if (state.columnsCache[baseName]) {
      return { columns: state.columnsCache[baseName], viewId: null };
    }
    try {
      const info = await api('GET', '/tables/' + encodeURIComponent(baseName) + '/columns');
      state.columnsCache[baseName] = info.columns;
      return { columns: info.columns, viewId: null };
    } catch (err) {
      const saved = (state.savedViews || []).find(v => (v.NazevSys || v.Nazev || '') === baseName);
      if (saved) {
        const vid = saved.ID || saved.id;
        const info = await api('GET', '/saved/' + vid + '/columns');
        const cols = (info.columns || []);
        state.columnsCache[baseName] = cols;
        return { columns: cols, viewId: vid };
      }
      throw err;
    }
  }

  async function buildTableCard(baseTableName, isPrimary, alias) {
    alias = alias || baseTableName;
    const { columns: baseColumns } = await fetchColumnsFallback(baseTableName);
    return {
      name: alias,
      baseName: baseTableName,
      isPrimary,
      isSubview: false,
      columns: baseColumns.map(c => ({ ...c, selected: false, alias: '', groupBy: false, aggregation: '' })),
    };
  }

  function removeTableFromCanvas(tableName) {
    state.tablesOnCanvas = state.tablesOnCanvas.filter(t => t.name !== tableName);
    state.joins = state.joins.filter(j => j.right_table !== tableName && j.left_table !== tableName);
    if (state.tablesOnCanvas.length && !state.tablesOnCanvas.some(t => t.isPrimary)) {
      state.tablesOnCanvas[0].isPrimary = true;
    }
    renderCanvas();
    renderJoinEditor();
  }

  // The real database name of a canvas card (alias -> base table/view).
  function tableBaseName(name) {
    const card = state.tablesOnCanvas.find(t => t.name === name);
    if (!card) return name;
    return card.baseName || card.name;
  }

  // Generate a unique canvas alias for a new card based on the table name.
  function uniqueTableAlias(baseName) {
    if (!state.tablesOnCanvas.some(t => t.name === baseName)) return baseName;
    let i = 2;
    let alias = `${baseName}${i}`;
    while (state.tablesOnCanvas.some(t => t.name === alias)) {
      i += 1;
      alias = `${baseName}${i}`;
    }
    return alias;
  }

  // Rename a canvas card alias and update all references in state.
  function renameTableAlias(oldName, newName) {
    newName = (newName || '').trim();
    if (!newName || newName === oldName) return;
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(newName)) {
      alert(t('custom_column_invalid_alias'));
      return;
    }
    if (state.tablesOnCanvas.some(t => t.name === newName)) {
      alert(t('alias_must_be_unique_alert'));
      return;
    }
    const ren = (v) => (v === oldName ? newName : v);
    const card = state.tablesOnCanvas.find(t => t.name === oldName);
    if (card) card.name = newName;
    state.joins.forEach(j => {
      j.left_table = ren(j.left_table);
      j.right_table = ren(j.right_table);
      (j.conditions || []).forEach(c => {
        c.left_table = ren(c.left_table);
        c.right_table = ren(c.right_table);
      });
    });
    // Update references keyed by the card alias in other editors.
    state.whereClauses.forEach(w => { w.table = ren(w.table); w.second_table = ren(w.second_table); });
    state.groupBy.forEach(g => { g.table = ren(g.table); });
    state.orderBy.forEach(o => { o.table = ren(o.table); });
    // Column aggregations are keyed by "table.column".
    const updatedAgg = {};
    Object.entries(state.columnAggregations || {}).forEach(([key, value]) => {
      const dot = key.indexOf('.');
      if (dot > 0) {
        const t = key.slice(0, dot);
        const c = key.slice(dot + 1);
        updatedAgg[(t === oldName ? newName : t) + '.' + c] = value;
      } else {
        updatedAgg[key] = value;
      }
    });
    state.columnAggregations = updatedAgg;
    renderCanvas();
    renderJoinEditor();
    renderWhereEditor();
    renderGroupByEditor();
    renderOrderByEditor();
    renderCustomColumns();
    if (state.tablesOnCanvas.length && state.tablesOnCanvas.some(t => t.columns.some(c => c.selected))) {
      previewView();
    }
  }

  // ---------------------------------------------------------------
  // Table alias modal (rename a canvas card / alias of a table)
  // ---------------------------------------------------------------
  function openTableAliasModal(tableName) {
    const card = state.tablesOnCanvas.find(t => t.name === tableName);
    if (!card) return;
    state.tableAliasTarget = tableName;
    const modal = $('#table-alias-modal');
    if (!modal) {
      // Fallback: simple prompt if modal markup is missing.
      const value = window.prompt(t('table_alias_modal_title'), card.name) || '';
      if (value) renameTableAlias(tableName, value);
      return;
    }
    const orig = $('#table-alias-original');
    if (orig) {
      const base = card.baseName || card.name;
      orig.textContent = t('table_alias_original_label', { name: base, alias: card.name });
    }
    $('#table-alias-input').value = card.name;
    modal.classList.remove('hidden');
    $('#table-alias-input').focus();
    $('#table-alias-input').select();
  }

  function closeTableAliasModal() {
    const modal = $('#table-alias-modal');
    if (modal) modal.classList.add('hidden');
    state.tableAliasTarget = null;
  }

  function saveTableAlias() {
    const target = state.tableAliasTarget;
    if (!target) return;
    const value = $('#table-alias-input').value.trim();
    if (value && value !== target) {
      renameTableAlias(target, value);
    }
    closeTableAliasModal();
  }

  function setColumnAlias(tableName, colName, alias) {
    const table = state.tablesOnCanvas.find(t => t.name === tableName);
    if (!table) return;
    const col = table.columns.find(c => c.name === colName);
    if (col && !col.selected) col.alias = alias;
  }

  function setPrimaryTable(tableName) {
    state.tablesOnCanvas.forEach(t => { t.isPrimary = t.name === tableName; });
    renderCanvas();
    renderJoinEditor();
  }

  function renderCanvas() {
    const canvas = $('#query-canvas');
    if (!canvas) return;
    if (!state.tablesOnCanvas.length) {
      canvas.innerHTML = `<p class="empty-hint">${esc(t('canvas_empty_hint'))}</p>`;
      drawJoinLines();
      return;
    }
    const primary = state.tablesOnCanvas.find(t => t.isPrimary);
    const primaryName = primary ? primary.name : '';
    // Resolve which side of each join is the "joined" table. Start with the
    // primary table as known; for every join the side that is not yet known is
    // the one being attached, so the badge belongs on that card. This keeps
    // the UI consistent regardless of whether the user drew the link from the
    // new table to the existing one or vice versa. Aliases are preserved because
    // we only compare the names that appear in state.joins/tablesOnCanvas.
    const joinedTables = new Set(primaryName ? [primaryName] : []);
    const joinTarget = new Map();
    state.joins.forEach(j => {
      const left = j.left_table || primaryName;
      const right = j.right_table;
      if (!right) return;
      const leftKnown = joinedTables.has(left);
      const rightKnown = joinedTables.has(right);
      const target = rightKnown && !leftKnown ? left : right;
      joinTarget.set(j, target);
      joinedTables.add(left);
      joinedTables.add(right);
    });
    const joinInfoForCard = (tableName) => {
      if (tableName === primaryName) return '';
      const joins = state.joins.filter(j => joinTarget.get(j) === tableName);
      if (!joins.length) return '';
      const badges = joins.map(j => {
        const target = joinTarget.get(j) || j.right_table;
        const other = target === j.right_table ? (j.left_table || primaryName) : j.right_table;
        const parts = [];
        const addPart = (txt) => { if (txt) parts.push(txt); };
        if (j.key_pairs && j.key_pairs.length) {
          j.key_pairs.forEach(p => {
            addPart(`${escHtml(other)}.${escHtml(p.left_column)} = ${escHtml(target)}.${escHtml(p.right_column)}`);
          });
        }
        if (j.conditions && j.conditions.length) {
          j.conditions.forEach(c => {
            const leftTable = c.left_table || j.left_table || primaryName;
            const rightTable = c.right_table || j.right_table;
            const leftCol = c.left_column;
            const rightCol = c.right_column;
            const op = c.operator || '=';
            if (leftTable === target || rightTable === target) {
              if (c.use_value || !rightCol) {
                const val = (c.value || '').trim();
                if (leftCol && val) {
                  addPart(`${escHtml(leftTable)}.${escHtml(leftCol)} ${escHtml(op)} ${escHtml(val)}`);
                }
              } else if (leftCol && rightCol) {
                addPart(`${escHtml(leftTable)}.${escHtml(leftCol)} ${escHtml(op)} ${escHtml(rightTable)}.${escHtml(rightCol)}`);
              }
            }
          });
        }
        if (!parts.length) return '';
        return `<span class="join-badge" title="${esc(j.join_type)} JOIN ${esc(other)}">${esc(j.join_type)} ${esc(other)}: ${escHtml(parts.join(' AND '))}</span>`;
      }).filter(Boolean);
      return `<div class="table-card-joins">${badges.join('')}</div>`;
    };

    canvas.innerHTML = state.tablesOnCanvas.map(table => `
      <div class="table-card ${table.isSubview ? 'subview-card' : ''}" data-table="${esc(table.name)}">
        <div class="table-card-header">
          <span class="table-name" role="button" title="${esc(t('table_rename_tooltip'))}" data-table="${esc(table.name)}">${esc(table.name)}${table.baseName && table.baseName !== table.name ? ' <span class="table-base-tag">(' + esc(table.baseName) + ')</span>' : ''}${table.isSubview ? ' <span class="subview-tag">' + esc(t('subview_tag')) + '</span>' : ''}</span>
          <label class="inline">
            <input type="radio" name="primary-table-radio" ${table.isPrimary ? 'checked' : ''} data-table="${esc(table.name)}">
            ${esc(t('primary_table_label'))}
          </label>
          <button type="button" class="btn small danger remove-table" data-table="${esc(table.name)}">×</button>
        </div>
        ${joinInfoForCard(table.name)}
        <div class="table-card-columns">
          ${table.columns.map(c => `
            <div class="column-item" title="${esc(c.type)}">
              <div class="column-main">
                <input type="checkbox" data-table="${esc(table.name)}" data-col="${esc(c.name)}" data-role="select" ${c.selected ? 'checked' : ''}>
                <span class="field-type">${esc(typeLabel(c))}</span>
                <span class="field-name ${c.is_indexed ? 'indexed' : ''}" title="${esc(c.name)}${c.is_indexed ? '\n' + esc(t('indexed_column_hint')) : ''}">${esc(c.name)}</span>
              </div>
              <input type="text" class="col-alias" data-table="${esc(table.name)}" data-col="${esc(c.name)}" placeholder="${esc(t('alias_input_placeholder'))}" value="${esc(c.alias || '')}" ${c.selected ? 'disabled' : ''}>
            </div>
          `).join('') || `<p class="empty-hint">${esc(t('no_columns_hint'))}</p>`}
        </div>
      </div>
    `).join('');

    canvas.querySelectorAll('.remove-table').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        removeTableFromCanvas(btn.dataset.table);
      });
    });
    canvas.querySelectorAll('input[name="primary-table-radio"]').forEach(r => {
      r.addEventListener('change', () => setPrimaryTable(r.dataset.table));
    });
    canvas.querySelectorAll('.table-name').forEach(el => {
      el.addEventListener('click', () => openTableAliasModal(el.dataset.table));
    });
    canvas.querySelectorAll('.column-item input[data-role="select"]').forEach(chk => {
      chk.addEventListener('change', () => {
        const scrollContainer = chk.closest('.table-card-columns');
        const scrollTop = scrollContainer ? scrollContainer.scrollTop : 0;
        const table = state.tablesOnCanvas.find(t => t.name === chk.dataset.table);
        if (!table) return;
        const col = table.columns.find(c => c.name === chk.dataset.col);
        if (!col) return;
        col.selected = chk.checked;
        if (!col.selected) {
          col.groupBy = false;
          col.aggregation = '';
          syncGroupByAndAggregations();
          renderGroupByEditor();
        }
        renderCanvas();
        const newScrollContainer = document.querySelector(`.table-card[data-table="${esc(table.name)}"] .table-card-columns`);
        if (newScrollContainer) newScrollContainer.scrollTop = scrollTop;
      });
    });
    canvas.querySelectorAll('.column-item .col-alias').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const table = state.tablesOnCanvas.find(t => t.name === e.target.dataset.table);
        if (!table) return;
        const col = table.columns.find(c => c.name === e.target.dataset.col);
        if (col && !col.selected) col.alias = e.target.value;
      });
    });

    // Double-click a column label to insert [Table].[Column] into the active WHERE value input.
    canvas.querySelectorAll('.column-item .field-name').forEach(span => {
      span.addEventListener('dblclick', (e) => {
        const label = e.target.closest('.column-item');
        if (!label) return;
        const table = label.querySelector('input').dataset.table;
        const col = label.querySelector('input').dataset.col;
        insertIntoActiveWhereValue(`[${table}].[${col}]`);
      });
    });

    // Draw join lines after cards are rendered and laid out.
    requestAnimationFrame(drawJoinLines);
  }

  function drawJoinLines() {
    const svg = $('#join-svg');
    const wrapper = $('#query-canvas-wrapper');
    if (!svg || !wrapper) return;
    svg.innerHTML = '';
    const wrapperRect = wrapper.getBoundingClientRect();
    state.joins.forEach((join, idx) => {
      const leftCard = wrapper.querySelector(`.table-card[data-table="${esc(join.left_table || '')}"]`);
      const rightCard = wrapper.querySelector(`.table-card[data-table="${esc(join.right_table || '')}"]`);
      if (!leftCard || !rightCard) return;
      const leftRect = getCardCenter(leftCard);
      const rightRect = getCardCenter(rightCard);
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      group.dataset.joinIndex = String(idx);

      const visibleLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      visibleLine.setAttribute('x1', leftRect.x);
      visibleLine.setAttribute('y1', leftRect.y);
      visibleLine.setAttribute('x2', rightRect.x);
      visibleLine.setAttribute('y2', rightRect.y);

      const hitLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      hitLine.setAttribute('x1', leftRect.x);
      hitLine.setAttribute('y1', leftRect.y);
      hitLine.setAttribute('x2', rightRect.x);
      hitLine.setAttribute('y2', rightRect.y);
      hitLine.setAttribute('class', 'join-hitline');

      group.appendChild(visibleLine);
      group.appendChild(hitLine);
      group.addEventListener('mouseenter', (e) => showJoinTooltip(e, join));
      group.addEventListener('mouseleave', hideJoinTooltip);
      group.addEventListener('mousemove', (e) => moveJoinTooltip(e));
      svg.appendChild(group);
    });
  }

  function getCardCenter(card) {
    const wrapper = $('#query-canvas-wrapper');
    const wrapperRect = wrapper.getBoundingClientRect();
    const rect = card.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - wrapperRect.left + wrapper.scrollLeft,
      y: rect.top + rect.height / 2 - wrapperRect.top + wrapper.scrollTop,
    };
  }

  function showJoinTooltip(e, join) {
    const tooltip = $('#join-tooltip');
    if (!tooltip) return;
    const conds = join.key_pairs.map(p => `${join.join_type}: ${p.left_column} = ${p.right_column}`).join('\n');
    tooltip.textContent = conds || t('join_no_conditions_tooltip');
    tooltip.classList.remove('hidden');
    moveJoinTooltip(e);
  }

  function moveJoinTooltip(e) {
    const tooltip = $('#join-tooltip');
    if (!tooltip) return;
    const wrapper = $('#query-canvas-wrapper');
    const rect = wrapper.getBoundingClientRect();
    tooltip.style.left = (e.clientX - rect.left + 12) + 'px';
    tooltip.style.top = (e.clientY - rect.top + 12) + 'px';
  }

  function hideJoinTooltip() {
    const tooltip = $('#join-tooltip');
    if (tooltip) tooltip.classList.add('hidden');
  }

  function addJoinRow() {
    if (state.tablesOnCanvas.length < 2) {
      alert(t('add_join_need_two_tables_alert'));
      return;
    }
    const primary = state.tablesOnCanvas.find(t => t.isPrimary);
    const firstNonPrimary = state.tablesOnCanvas.find(t => !t.isPrimary);
    state.joins.push({
      left_table: primary ? primary.name : '',
      right_table: firstNonPrimary ? firstNonPrimary.name : '',
      join_type: 'LEFT',
      conditions: [{
        left_column: '',
        operator: '=',
        right_column: '',
        value: '',
        use_value: false,
        open_paren: false,
        close_paren: false,
        logical_operator: 'AND',
      }],
      key_pairs: [],
    });
    renderJoinEditor();
  }

  function renderJoinEditor() {
    const container = $('#join-list');
    const allTables = state.tablesOnCanvas;
    const operators = ['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN'];

  function selectJoinColumnOptions(cols, selected) {
    return cols.map(c =>
      `<option value="${esc(c.name)}" data-indexed="${c.is_indexed ? '1' : ''}" class="${c.is_indexed ? 'option-indexed' : ''}" ${c.name === selected ? 'selected' : ''}>${esc(c.name)}</option>`
    ).join('');
  }

  function refreshJoinSelectStyle(selectEl) {
    if (!selectEl) return;
    const opt = selectEl.options[selectEl.selectedIndex];
    if (opt && opt.dataset.indexed === '1') {
      selectEl.classList.add('join-select-indexed');
    } else {
      selectEl.classList.remove('join-select-indexed');
    }
  }

  container.innerHTML = state.joins.map((join, idx) => {
    const leftTable = allTables.find(t => t.name === (join.left_table || ''));
    const rightTable = allTables.find(t => t.name === join.right_table);
    const leftCols = leftTable ? leftTable.columns : [];
    const rightCols = rightTable ? rightTable.columns : [];
      const conditions = join.conditions || [];
      return `
        <div class="join-row" data-index="${idx}">
          <div class="form-row join-header-row">
            <label>${esc(t('join_type_label'))}
              <select class="join-type" data-index="${idx}">
                <option value="LEFT" ${join.join_type === 'LEFT' ? 'selected' : ''}>${esc(t('join_type_left'))}</option>
                <option value="INNER" ${join.join_type === 'INNER' ? 'selected' : ''}>${esc(t('join_type_inner'))}</option>
                <option value="RIGHT" ${join.join_type === 'RIGHT' ? 'selected' : ''}>${esc(t('join_type_right'))}</option>
              </select>
            </label>
            <label>${esc(t('join_left_table_label'))}
              <select class="join-left" data-index="${idx}">
                ${allTables.map(t => `<option value="${esc(t.name)}" ${t.name === (join.left_table || '') ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              </select>
            </label>
            <label>${esc(t('join_right_table_label'))}
              <select class="join-right" data-index="${idx}">
                ${allTables.map(t => `<option value="${esc(t.name)}" ${t.name === join.right_table ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              </select>
            </label>
            <div class="join-actions-inline">
              <button type="button" class="btn small add-cond" data-index="${idx}">${esc(t('join_add_condition_button'))}</button>
              <button type="button" class="btn danger small remove-join" data-index="${idx}" title="${esc(t('join_remove_button'))}">×</button>
            </div>
          </div>
          <div class="join-conditions" data-index="${idx}">
            ${conditions.map((cond, cidx) => {
              const needsValue = !['IS NULL', 'IS NOT NULL'].includes(cond.operator || '=');
              const isBetween = cond.operator === 'BETWEEN';
              const useValue = cond.use_value || false;
              const hasValue = !!(cond.value || cond.from_value || cond.to_value);
              const valueDisabled = (!useValue && needsValue) || !needsValue;
              const rightColDisabled = useValue || !needsValue;
              return `
                <div class="join-condition" data-cidx="${cidx}">
                  <div class="join-cond-main">
                    <label class="inline paren">
                      <input type="checkbox" class="join-open" data-index="${idx}" data-cidx="${cidx}" ${cond.open_paren ? 'checked' : ''}> (
                    </label>
                    <label>${esc(join.left_table || t('join_left_table_fallback'))}
                      <select class="join-cond-left" data-index="${idx}" data-cidx="${cidx}">
                        <option value="">-- --</option>
                        ${selectJoinColumnOptions(leftCols, cond.left_column)}
                      </select>
                    </label>
                    <label>${esc(t('where_operator_header'))}
                      <select class="join-cond-operator" data-index="${idx}" data-cidx="${cidx}">
                        ${operators.map(op => `<option value="${esc(op)}" ${op === (cond.operator || '=') ? 'selected' : ''}>${esc(op)}</option>`).join('')}
                      </select>
                    </label>
                    <label class="inline radio-label">
                      <input type="radio" name="join-cond-side-${idx}-${cidx}" class="join-cond-use-col" data-index="${idx}" data-cidx="${cidx}" ${!useValue ? 'checked' : ''}> ${esc(t('join_use_column_radio'))}
                    </label>
                    <label>${esc(join.right_table || t('join_right_table_fallback'))}
                      <select class="join-cond-right" data-index="${idx}" data-cidx="${cidx}" ${rightColDisabled ? 'disabled' : ''}>
                        <option value="">-- --</option>
                        ${selectJoinColumnOptions(rightCols, cond.right_column)}
                      </select>
                    </label>
                    <label class="inline radio-label">
                      <input type="radio" name="join-cond-side-${idx}-${cidx}" class="join-cond-use-val" data-index="${idx}" data-cidx="${cidx}" ${useValue ? 'checked' : ''}> ${esc(t('join_use_value_radio'))}
                    </label>
                    <div class="join-cond-tail">
                      ${needsValue ? `
                        ${isBetween ? `
                          <input type="text" class="join-cond-from" data-index="${idx}" data-cidx="${cidx}" placeholder="${esc(t('join_from_placeholder'))}" value="${esc(cond.from_value || '')}" ${valueDisabled ? 'disabled' : ''}>
                          <span class="join-cond-sep">-</span>
                          <input type="text" class="join-cond-to" data-index="${idx}" data-cidx="${cidx}" placeholder="${esc(t('join_to_placeholder'))}" value="${esc(cond.to_value || '')}" ${valueDisabled ? 'disabled' : ''}>
                        ` : `
                          <input type="text" class="join-cond-value" data-index="${idx}" data-cidx="${cidx}" placeholder="${esc(t('join_value_placeholder'))}" value="${esc(cond.value || '')}" ${valueDisabled ? 'disabled' : ''}>
                        `}
                      ` : '<span class="muted">—</span>'}
                      <label class="inline paren">
                        <input type="checkbox" class="join-close" data-index="${idx}" data-cidx="${cidx}" ${cond.close_paren ? 'checked' : ''}> )
                      </label>
                      <label class="join-cond-logic-label">${esc(t('join_logical_label'))}
                        <select class="join-cond-logical" data-index="${idx}" data-cidx="${cidx}">
                          <option value="AND" ${cond.logical_operator === 'AND' ? 'selected' : ''}>${esc(t('where_logic_and'))}</option>
                          <option value="OR" ${cond.logical_operator === 'OR' ? 'selected' : ''}>${esc(t('where_logic_or'))}</option>
                        </select>
                      </label>
                      <button type="button" class="btn small danger remove-cond" data-index="${idx}" data-cidx="${cidx}">×</button>
                    </div>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.join-type').forEach(sel => {
      sel.addEventListener('change', (e) => {
        state.joins[parseInt(e.target.dataset.index)].join_type = e.target.value;
      });
    });
    container.querySelectorAll('.join-left').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        state.joins[idx].left_table = e.target.value;
        state.joins[idx].conditions.forEach(c => { c.left_column = ''; });
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.join-right').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        state.joins[idx].right_table = e.target.value;
        state.joins[idx].conditions.forEach(c => { c.right_column = ''; c.value = ''; });
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.join-cond-left').forEach(sel => {
      refreshJoinSelectStyle(sel);
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions[cidx].left_column = e.target.value;
        refreshJoinSelectStyle(e.target);
      });
    });
    container.querySelectorAll('.join-cond-operator').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions[cidx].operator = e.target.value;
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.join-cond-right').forEach(sel => {
      refreshJoinSelectStyle(sel);
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions[cidx].right_column = e.target.value;
        refreshJoinSelectStyle(e.target);
      });
    });
    container.querySelectorAll('.join-cond-use-col').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions[cidx].use_value = false;
        state.joins[idx].conditions[cidx].value = '';
        state.joins[idx].conditions[cidx].from_value = '';
        state.joins[idx].conditions[cidx].to_value = '';
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.join-cond-use-val').forEach(radio => {
      radio.addEventListener('change', (e) => {
        if (!e.target.checked) return;
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions[cidx].use_value = true;
        state.joins[idx].conditions[cidx].right_column = '';
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.join-cond-value').forEach(inp => {
      inp.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions[cidx].value = e.target.value;
      });
    });
    container.querySelectorAll('.join-cond-from').forEach(inp => {
      inp.addEventListener('input', (e) => {
        state.joins[parseInt(e.target.dataset.index)].conditions[parseInt(e.target.dataset.cidx)].from_value = e.target.value;
      });
    });
    container.querySelectorAll('.join-cond-to').forEach(inp => {
      inp.addEventListener('input', (e) => {
        state.joins[parseInt(e.target.dataset.index)].conditions[parseInt(e.target.dataset.cidx)].to_value = e.target.value;
      });
    });
    container.querySelectorAll('.join-open').forEach(chk => {
      chk.addEventListener('change', (e) => {
        state.joins[parseInt(e.target.dataset.index)].conditions[parseInt(e.target.dataset.cidx)].open_paren = e.target.checked;
      });
    });
    container.querySelectorAll('.join-close').forEach(chk => {
      chk.addEventListener('change', (e) => {
        state.joins[parseInt(e.target.dataset.index)].conditions[parseInt(e.target.dataset.cidx)].close_paren = e.target.checked;
      });
    });
    container.querySelectorAll('.join-cond-logical').forEach(sel => {
      sel.addEventListener('change', (e) => {
        state.joins[parseInt(e.target.dataset.index)].conditions[parseInt(e.target.dataset.cidx)].logical_operator = e.target.value;
      });
    });
    container.querySelectorAll('.add-cond').forEach(btn => {
      btn.addEventListener('click', (e) => {
        state.joins[parseInt(e.target.dataset.index)].conditions.push({
          left_column: '', operator: '=', right_column: '', value: '', use_value: false,
          open_paren: false, close_paren: false, logical_operator: 'AND'
        });
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.remove-cond').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const cidx = parseInt(e.target.dataset.cidx);
        state.joins[idx].conditions.splice(cidx, 1);
        if (!state.joins[idx].conditions.length) state.joins.splice(idx, 1);
        renderJoinEditor();
      });
    });
    container.querySelectorAll('.remove-join').forEach(btn => {
      btn.addEventListener('click', (e) => {
        state.joins.splice(parseInt(e.target.dataset.index), 1);
        renderJoinEditor();
      });
    });
  }

  function syncGroupByAndAggregations() {
    state.groupBy = [];
    state.columnAggregations = {};
    state.tablesOnCanvas.forEach(t => {
      t.columns.forEach(c => {
        if (c.groupBy) {
          state.groupBy.push({ table: t.name, column: c.name });
          c.aggregation = '';
        }
        if (c.aggregation) {
          state.columnAggregations[`${t.name}.${c.name}`] = c.aggregation;
        }
      });
    });
  }

  function buildPayload() {
    syncGroupByAndAggregations();
    const primaryTable = (state.tablesOnCanvas.find(t => t.isPrimary) || {}).name || '';
    const selectedColumns = [];
    state.tablesOnCanvas.forEach(t => {
      t.columns.filter(c => c.selected).forEach(c => {
        selectedColumns.push({ table: t.name, name: c.name, alias: c.alias || '' });
      });
    });
    const subviews = state.tablesOnCanvas
      .filter(t => t.isSubview)
      .map(t => ({
        view_id: t.viewId,
        name: t.name,
        alias: t.name,
        definition: t.definition,
        columns: t.columns.map(c => ({ name: c.name, type: c.type, alias: c.alias || '' })),
      }));
    const apiEl = $('#view-api-enabled');
    const apiTypeEl = $('#view-api-type');
    const apiPutEl = $('#view-api-put-enabled');
    const tableAliases = {};
    state.tablesOnCanvas.forEach(t => {
      if (t.isSubview) return;
      const base = t.baseName || t.name;
      if (base !== t.name) tableAliases[t.name] = base;
    });
    return {
      name: $('#view-name-input').value.trim(),
      description: ($('#view-modeling-description') || {}).value || '',
      primary_table: primaryTable,
      selected_columns: selectedColumns,
      joins: state.joins,
      where_clauses: state.whereClauses,
      custom_columns: state.customColumns,
      subviews,
      table_aliases: tableAliases,
      group_by: state.groupBy,
      order_by: state.orderBy,
      aggregations: state.columnAggregations,
      api_enabled: apiEl ? apiEl.checked : false,
      api_put_enabled: apiPutEl ? apiPutEl.checked : false,
      api_type: apiTypeEl ? (apiTypeEl.value || 'flat') : 'flat',
      connector_id: getSelectedConnectorId(),
    };
  }


  async function previewView() {
    const payload = buildPayload();
    try {
      const result = await api('POST', '/preview', payload);
      $('#preview-sql').innerHTML = highlightSql(result.sql);
      state.previewData = { columns: result.columns, rows: result.rows };
      renderPreviewTable();
      $('#preview-row-count').textContent = t('preview_row_count', { count: result.rows.length });
    } catch (err) {
      alert(t('preview_error_alert', { error: err.message }));
    }
  }

  async function saveView() {
    const payload = buildPayload();
    if (!payload.name) {
      alert(t('view_name_required_alert'));
      return;
    }
    if (!payload.primary_table) {
      alert(t('primary_table_required_alert'));
      return;
    }
    try {
      const result = state.viewId
        ? await api('PUT', '/saved/' + state.viewId, payload)
        : await api('POST', '/', payload);
      if (result.saved) {
        state.viewId = result.id || state.viewId;
        state.viewConnectorId = getSelectedConnectorId();
        renderConnectorSelect();
        alert(t('view_saved_success_alert', { name: result.name }));
        loadSavedViews();
      } else {
        alert(result.reason || t('view_save_failed_alert'));
      }
      $('#preview-sql').innerHTML = highlightSql(result.sql);
    } catch (err) {
      alert(t('view_save_error_alert', { error: err.message }));
    }
  }

  function renderPreviewTable() {
    const thead = $('#preview-table thead');
    const tbody = $('#preview-table tbody');
    thead.innerHTML = '';
    tbody.innerHTML = '';
    const cols = state.previewData.columns || [];
    if (!cols.length) return;
    const tr = document.createElement('tr');
    cols.forEach(col => {
      const th = document.createElement('th');
      th.textContent = col;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    (state.previewData.rows || []).forEach(row => {
      const r = document.createElement('tr');
      cols.forEach(col => {
        const td = document.createElement('td');
        td.textContent = row[col] == null ? '' : String(row[col]);
        r.appendChild(td);
      });
      tbody.appendChild(r);
    });
  }

  function clearPreview() {
    $('#preview-sql').innerHTML = '';
    $('#preview-table thead').innerHTML = '';
    $('#preview-table tbody').innerHTML = '';
    $('#preview-row-count').textContent = '';
  }

  function addWhereRow() {
      state.whereClauses.push({
      table: state.tablesOnCanvas.length ? state.tablesOnCanvas[0].name : '',
      column: '',
      operator: '=',
      second_table: '',
      second_column: '',
      value: '',
      from_value: '',
      to_value: '',
      open_paren: false,
      close_paren: false,
      logical_operator: 'AND',
    });
    renderWhereEditor();
  }


  function removeWhereRow(idx) {
    state.whereClauses.splice(idx, 1);
    renderWhereEditor();
  }

  const CUSTOM_COLUMNS_TABLE = '[custom_columns]';

  function renderWhereEditor() {
    const tbody = $('#where-list');
    const tables = state.tablesOnCanvas;
    const hasCustomColumns = state.customColumns.some(cc => (cc.alias || '').trim());
    const customTable = { name: CUSTOM_COLUMNS_TABLE, columns: state.customColumns.filter(cc => (cc.alias || '').trim()).map(cc => ({ name: cc.alias })) };
    const allTables = hasCustomColumns ? [...tables, customTable] : tables;
    tbody.innerHTML = state.whereClauses.map((wc, idx) => {
      const table = allTables.find(t => t.name === wc.table);
      const cols = table ? table.columns : [];
      const secondTable = allTables.find(t => t.name === wc.second_table);
      const secondCols = secondTable ? secondTable.columns : [];
      const needsValue = !['IS NULL', 'IS NOT NULL'].includes(wc.operator);
      const isBetween = wc.operator === 'BETWEEN';
      const hasSecondColumn = !!(wc.second_table && wc.second_column);
      const hasValue = !!(wc.value || wc.from_value || wc.to_value);
      const valueDisabled = hasSecondColumn || !needsValue;
      const secondDisabled = hasValue || !needsValue;
      return `
        <tr data-index="${idx}">
          <td><input type="checkbox" class="where-open" data-index="${idx}" ${wc.open_paren ? 'checked' : ''}></td>
          <td>
            <select class="where-table" data-index="${idx}">
              ${allTables.map(t => `<option value="${esc(t.name)}" ${t.name === wc.table ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </td>
          <td>
            <select class="where-column" data-index="${idx}">
              <option value="">${esc(t('where_column_placeholder'))}</option>
              ${cols.map(c => `<option value="${esc(c.name)}" ${c.name === wc.column ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </td>
          <td>
            <select class="where-operator" data-index="${idx}">
              ${['=', '!=', '<', '>', '<=', '>=', 'LIKE', 'IN', 'NOT IN', 'IS NULL', 'IS NOT NULL', 'BETWEEN'].map(op =>
                `<option value="${esc(op)}" ${op === wc.operator ? 'selected' : ''}>${esc(op)}</option>`
              ).join('')}
            </select>
          </td>
          <td>
            <select class="where-second-table" data-index="${idx}" ${secondDisabled ? 'disabled' : ''}>
              <option value="">${esc(t('where_table_placeholder'))}</option>
              ${allTables.map(t => `<option value="${esc(t.name)}" ${t.name === wc.second_table ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
            </select>
          </td>
          <td>
            <select class="where-second-column" data-index="${idx}" ${secondDisabled ? 'disabled' : ''}>
              <option value="">${esc(t('where_column_placeholder'))}</option>
              ${secondCols.map(c => `<option value="${esc(c.name)}" ${c.name === wc.second_column ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
            </select>
          </td>
          <td class="where-value-cell">
            ${isBetween ? `
              <input type="text" class="where-from-value" data-index="${idx}" placeholder="${esc(t('where_from_placeholder'))}" value="${esc(wc.from_value || '')}" ${valueDisabled ? 'disabled' : ''}>
              <span> - </span>
              <input type="text" class="where-to-value" data-index="${idx}" placeholder="${esc(t('where_to_placeholder'))}" value="${esc(wc.to_value || '')}" ${valueDisabled ? 'disabled' : ''}>
            ` : needsValue ? `
              <input type="text" class="where-value" data-index="${idx}" placeholder="${esc(t('where_value_placeholder'))}" value="${esc(wc.value || '')}" ${valueDisabled ? 'disabled' : ''}>
            ` : '<span class="muted">—</span>'}
          </td>
          <td><input type="checkbox" class="where-close" data-index="${idx}" ${wc.close_paren ? 'checked' : ''}></td>
          <td>
            <select class="where-logical" data-index="${idx}">
              <option value="AND" ${wc.logical_operator === 'AND' ? 'selected' : ''}>${esc(t('where_logic_and'))}</option>
              <option value="OR" ${wc.logical_operator === 'OR' ? 'selected' : ''}>${esc(t('where_logic_or'))}</option>
            </select>
          </td>
          <td><button type="button" class="btn small danger remove-where" data-index="${idx}">×</button></td>
        </tr>
      `;
    }).join('');

    tbody.querySelectorAll('.where-open').forEach(chk => {
      chk.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].open_paren = e.target.checked; });
    });
    tbody.querySelectorAll('.where-close').forEach(chk => {
      chk.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].close_paren = e.target.checked; });
    });
    tbody.querySelectorAll('.where-table').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        state.whereClauses[idx].table = e.target.value;
        state.whereClauses[idx].column = '';
        renderWhereEditor();
      });
    });
    tbody.querySelectorAll('.where-column').forEach(sel => {
      sel.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].column = e.target.value; });
    });
    tbody.querySelectorAll('.where-operator').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        state.whereClauses[idx].operator = e.target.value;
        renderWhereEditor();
      });
    });
    tbody.querySelectorAll('.where-second-table').forEach(sel => {
      sel.addEventListener('focus', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const wc = state.whereClauses[idx];
        if ((wc.value || '').trim() || (wc.from_value || '').trim() || (wc.to_value || '').trim()) {
          wc.value = '';
          wc.from_value = '';
          wc.to_value = '';
          renderWhereEditor();
        }
      });
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        state.whereClauses[idx].second_table = e.target.value;
        state.whereClauses[idx].second_column = '';
        renderWhereEditor();
      });
    });
    tbody.querySelectorAll('.where-second-column').forEach(sel => {
      sel.addEventListener('focus', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const wc = state.whereClauses[idx];
        if ((wc.value || '').trim() || (wc.from_value || '').trim() || (wc.to_value || '').trim()) {
          wc.value = '';
          wc.from_value = '';
          wc.to_value = '';
          renderWhereEditor();
        }
      });
      sel.addEventListener('change', (e) => {
        const idx = parseInt(e.target.dataset.index);
        state.whereClauses[idx].second_column = e.target.value;
        renderWhereEditor();
      });
    });

    tbody.querySelectorAll('.where-second-table').forEach(sel => {
      sel.addEventListener('focus', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const wc = state.whereClauses[idx];
        if ((wc.value || '').trim() || (wc.from_value || '').trim() || (wc.to_value || '').trim()) {
          wc.value = '';
          wc.from_value = '';
          wc.to_value = '';
          renderWhereEditor();
        }
      });
    });
    tbody.querySelectorAll('.where-second-column').forEach(sel => {
      sel.addEventListener('focus', (e) => {
        const idx = parseInt(e.target.dataset.index);
        const wc = state.whereClauses[idx];
        if ((wc.value || '').trim() || (wc.from_value || '').trim() || (wc.to_value || '').trim()) {
          wc.value = '';
          wc.from_value = '';
          wc.to_value = '';
          renderWhereEditor();
        }
      });
    });
    tbody.querySelectorAll('.where-value').forEach(inp => {
      inp.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].value = e.target.value; });
      inp.addEventListener('input', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].value = e.target.value; });
    });
    tbody.querySelectorAll('.where-from-value').forEach(inp => {
      inp.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].from_value = e.target.value; });
      inp.addEventListener('input', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].from_value = e.target.value; });
    });
    tbody.querySelectorAll('.where-to-value').forEach(inp => {
      inp.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].to_value = e.target.value; });
      inp.addEventListener('input', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].to_value = e.target.value; });
    });
    tbody.querySelectorAll('.where-logical').forEach(sel => {
      sel.addEventListener('change', (e) => { state.whereClauses[parseInt(e.target.dataset.index)].logical_operator = e.target.value; });
    });
    tbody.querySelectorAll('.remove-where').forEach(btn => {
      btn.addEventListener('click', (e) => removeWhereRow(parseInt(e.target.dataset.index)));
    });
  }

  function addOrderByRow() {
    const firstTable = state.tablesOnCanvas.length ? state.tablesOnCanvas[0].name : '';
    const firstCol = firstTable ? (state.tablesOnCanvas[0].columns[0] || {}).name || '' : '';
    state.orderBy.push({ table: firstTable, column: firstCol, aggregation: '', desc: false });
    renderOrderByEditor();
  }

  function removeOrderByRow(idx) {
    state.orderBy.splice(idx, 1);
    renderOrderByEditor();
  }

  function renderOrderByEditor() {
    const container = $('#order-by-list');
    if (!container) return;
    const tables = state.tablesOnCanvas;
    if (!tables.length) {
      container.innerHTML = `<p class="empty-hint">${esc(t('canvas_empty_hint'))}</p>`;
      return;
    }

    const aggs = ['SUM', 'COUNT', 'MIN', 'MAX', 'AVG'];

    function columnOptions(selectedOb) {
      const parts = [];
      for (const tbl of tables) {
        const cols = tbl.columns || [];
        parts.push(`<optgroup label="${esc(tbl.name)}">`);
        for (const c of cols) {
          const selected = selectedOb.table === tbl.name && selectedOb.column === c.name ? 'selected' : '';
          parts.push(`<option value="${esc(tbl.name + '|' + c.name)}" data-table="${esc(tbl.name)}" data-column="${esc(c.name)}" ${selected}>${esc(c.name)}</option>`);
        }
        parts.push('</optgroup>');
      }
      return parts.join('');
    }

    container.innerHTML = state.orderBy.map((ob, idx) => `
      <div class="order-by-row" data-index="${idx}">
        <select class="order-by-aggregation" data-index="${idx}">
          <option value="" ${!ob.aggregation ? 'selected' : ''}>${esc(t('no_grouping_option'))}</option>
          ${aggs.map(agg => `<option value="${esc(agg)}" ${ob.aggregation === agg ? 'selected' : ''}>${esc(agg)}</option>`).join('')}
        </select>
        <select class="order-by-column" data-index="${idx}">
          ${columnOptions(ob)}
        </select>
        <select class="order-by-direction" data-index="${idx}">
          <option value="ASC" ${!ob.desc ? 'selected' : ''}>ASC</option>
          <option value="DESC" ${ob.desc ? 'selected' : ''}>DESC</option>
        </select>
        <button type="button" class="btn small danger remove-order-by" data-index="${idx}">×</button>
      </div>
    `).join('');

    container.querySelectorAll('.order-by-aggregation').forEach(sel => {
      sel.addEventListener('change', (e) => {
        state.orderBy[parseInt(e.target.dataset.index)].aggregation = e.target.value;
      });
    });
    container.querySelectorAll('.order-by-column').forEach(sel => {
      sel.addEventListener('change', (e) => {
        const opt = e.target.selectedOptions[0];
        const ob = state.orderBy[parseInt(e.target.dataset.index)];
        if (opt) {
          ob.table = opt.dataset.table || '';
          ob.column = opt.dataset.column || '';
        }
      });
    });
    container.querySelectorAll('.order-by-direction').forEach(sel => {
      sel.addEventListener('change', (e) => { state.orderBy[parseInt(e.target.dataset.index)].desc = e.target.value === 'DESC'; });
    });
    container.querySelectorAll('.remove-order-by').forEach(btn => {
      btn.addEventListener('click', (e) => removeOrderByRow(parseInt(e.target.dataset.index)));
    });
  }

  function renderGroupByEditor() {
    const container = $('#group-by-list');
    if (!container) return;
    const tables = state.tablesOnCanvas;
    if (!tables.length) {
      container.innerHTML = `<p class="empty-hint">${esc(t('canvas_empty_hint'))}</p>`;
      return;
    }
    const rows = [];
    for (const tbl of tables) {
      for (const c of tbl.columns || []) {
        let value = '';
        if (c.groupBy) {
          value = 'GROUP_BY';
        } else if (c.aggregation) {
          value = c.aggregation;
        }
        rows.push(`
          <div class="group-by-row">
            <span class="col-name" title="${esc(tbl.name + '.' + c.name)}">${esc(tbl.name + ' / ' + c.name)}</span>
            <select data-table="${esc(tbl.name)}" data-column="${esc(c.name)}">
              <option value="" ${!value ? 'selected' : ''}>${esc(t('no_grouping_option'))}</option>
              <option value="GROUP_BY" ${value === 'GROUP_BY' ? 'selected' : ''}>${esc(t('group_by_option'))}</option>
              <optgroup label="${esc(t('aggregation_label'))}">
                <option value="COUNT" ${value === 'COUNT' ? 'selected' : ''}>COUNT</option>
                <option value="SUM" ${value === 'SUM' ? 'selected' : ''}>SUM</option>
                <option value="MIN" ${value === 'MIN' ? 'selected' : ''}>MIN</option>
                <option value="MAX" ${value === 'MAX' ? 'selected' : ''}>MAX</option>
                <option value="AVG" ${value === 'AVG' ? 'selected' : ''}>AVG</option>
              </optgroup>
            </select>
          </div>
        `);
      }
    }
    container.innerHTML = rows.join('');

    container.querySelectorAll('select').forEach(sel => {
      sel.addEventListener('change', () => {
        const table = state.tablesOnCanvas.find(t => t.name === sel.dataset.table);
        if (!table) return;
        const col = table.columns.find(c => c.name === sel.dataset.column);
        if (!col) return;
        const val = sel.value;
        if (val === '') {
          col.groupBy = false;
          col.aggregation = '';
        } else if (val === 'GROUP_BY') {
          col.groupBy = true;
          col.aggregation = '';
          col.selected = true;
        } else {
          col.groupBy = false;
          col.aggregation = val;
          col.selected = true;
        }
        syncGroupByAndAggregations();
        renderCanvas();
        previewView();
      });
    });
  }

  async function deleteView() {
    if (!state.viewId) {
      alert(t('delete_view_no_id_alert'));
      return;
    }
    if (!confirm(t('delete_view_confirm', { name: $('#view-name-input').value.trim() }))) {
      return;
    }
    try {
      await api('DELETE', '/saved/' + state.viewId);
      alert(t('delete_view_success_alert'));
      state.viewId = null;
      loadSavedViews();
      newView();
    } catch (err) {
      alert(t('delete_view_error_alert', { error: err.message }));
    }
  }

  async function downloadApiBat() {
    const viewName = $('#view-name-input').value.trim();
    if (!viewName) {
      alert(t('view_name_required_alert'));
      return;
    }
    const apiEl = $('#view-api-enabled');
    if (!apiEl || !apiEl.checked) {
      alert(t('api_not_enabled_alert'));
      return;
    }
    try {
      const connectorId = getSelectedConnectorId();
      const cfg = await api('GET', '/api-config' + (connectorId ? '?connector_id=' + encodeURIComponent(connectorId) : ''));
      const putEl = $('#view-api-put-enabled');
      if (putEl && putEl.checked) cfg.method = 'PUT';
      const bat = generateBatTemplate(viewName, cfg);
      const blob = new Blob([bat], { type: 'text/plain;charset=windows-1250' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `get_${viewName}.bat`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(t('download_api_bat_error', { error: err.message }));
    }
  }

  function generateBatTemplate(viewName, cfg) {
    // The server returns the base public API URL without a tenant. Append the
    // tenant from the active connector so each view points at its own API path.
    let baseUrl = (cfg.api_base_url || 'http://127.0.0.1:8000').replace(/\/$/, '');
    const tenant = (cfg.api_tenant || '').replace(/^\/+|\/+$/g, '');
    let finalUrl = tenant ? baseUrl + '/' + tenant : baseUrl;
    try {
      const parsed = new URL(finalUrl);
      finalUrl = parsed.toString().replace(/\/$/, '');
    } catch (_) {
      // Leave URL unchanged if parsing fails.
    }
    const apiKeyHeader = cfg.api_key_header || 'X-API-Key';
    const prefix = cfg.api_key_prefix || '';
    const rawMethod = (cfg.method || 'GET').toUpperCase();
    const method = ['GET', 'POST', 'PUT'].includes(rawMethod) ? rawMethod : 'GET';
    const useHttps = finalUrl.startsWith('https://');
    const hasCert = Boolean(cfg.ssl_certfile || cfg.ssl_pfx_path);
    const curlInsecure = useHttps && hasCert ? '-k ' : '';
    const hint = prefix
      ? `rem Napoveda: platny API klic zacina na ${prefix}...`
      : 'rem Doplnte platny API klic do promenne API_KEY nize.';
    const getBodyExample = 'rem set "BODY_GET={""sloupec1"":""hodnota1""}"\r\n';
    const variables = method === 'PUT'
      ? `\r\nrem Metoda: GET pro export, PUT pro insert. Pro PUT upravte BODY_PUT podle skutecnych sloupcu primarni tabulky.\r\nset "METHOD=${method}"\r\nset "BODY_PUT={""rows"":[{""sloupec1"":""hodnota1"",""sloupec2"":""hodnota2""}]}"\r\nrem Alternativne lze ulozit JSON do souboru (napr. payload.json) a pro PUT pouzit:\r\nrem set "BODY_PUT_FILE=%~dp0payload.json"\r\n${getBodyExample}`
      : method === 'POST'
      ? `\r\nrem Metoda: POST pro filtrovany export (vyzaduje BODY_GET), GET pro bezfiltry, PUT pro insert.\r\nset "METHOD=${method}"\r\nrem Pro filtrovany export vlozte JSON do BODY_GET (napr. {""sloupec"":""hodnota""}).\r\nset "BODY_GET="\r\n${getBodyExample}`
      : `\r\nrem Metoda: GET pro export, PUT pro insert.\r\nset "METHOD=${method}"\r\nrem Pro filtrovany GET vlozte JSON do BODY_GET (napr. {""sloupec"":""hodnota""}). Pokud je prazdne, pouzije se klasicky GET bez filtru.\r\nset "BODY_GET="\r\n${getBodyExample}`;
    return `@echo off\r\nrem Nastav pracovni adresar na slozku s timto bat souborem, aby se export ukladal vedle nej.\r\ncd /d "%~dp0"\r\n\r\nset "API_URL=${finalUrl}"\r\nset "API_KEY=<YOUR_API_KEY>"\r\nset "API_KEY_HEADER=${apiKeyHeader}"\r\nset "EXPORT_DIR=%~dp0export"\r\nset "VIEW_NAME=${viewName}"\r\n${variables}\r\n${hint}\r\n\r\nif not "%~1"=="" set "VIEW_NAME=%~1"\r\n\r\nsetlocal EnableExtensions\r\nset "URL=%API_URL%/%VIEW_NAME%"\r\n\r\nrem Nazev vystupniho souboru: parametr, nebo view_RRRRMMDD_HHMMSS.json\r\nif not "%~2"=="" (\r\n    set "OUTFILE=%~2"\r\n) else (\r\n    for /f %%T in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "TS=%%T"\r\n    if not exist "%EXPORT_DIR%" mkdir "%EXPORT_DIR%"\r\n    call set "OUTFILE=%EXPORT_DIR%\\%VIEW_NAME%_%%TS%%.json"\r\n)\r\n\r\necho Ladeni: OUTFILE=%OUTFILE%\r\n\r\nrem Overeni, ze je curl k dispozici\r\nwhere curl >nul 2>&1\r\nif errorlevel 1 (\r\n    echo Chyba: curl.exe nebyl nalezen. Je soucasti Windows 10/11. 1>&2\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\nrem Vyber metody. GET/POST vraci data do souboru (s volitelnym filtrovacim telem), PUT odesila zadane telo.\r\nif /I "%METHOD%"=="GET" (\r\n    call :do_get\r\n) else if /I "%METHOD%"=="POST" (\r\n    call :do_post\r\n) else if /I "%METHOD%"=="PUT" (\r\n    call :do_put\r\n) else (\r\n    echo Chyba: neznama metoda "%METHOD%". Pouzijte GET, POST nebo PUT. 1>&2\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\nendlocal\r\n\r\nrem Pro testovani ponechte pause, aby okno konzole zustalo otevrene.\r\nrem Odstrante, pokud bat pouzivate v automatizovane uloze.\r\npause\r\nexit /b 0\r\n\r\n:do_get\r\nrem Pokud je BODY_GET neprazdne, posle se jako JSON telo GET pozadavku (filtrovany vystup).\r\nif defined BODY_GET (\r\n    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X GET -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d "%BODY_GET%" ${curlInsecure}"%URL%"') do set "HTTP_CODE=%%H"\r\n) else (\r\n    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -H "%API_KEY_HEADER%: %API_KEY%" ${curlInsecure}"%URL%"') do set "HTTP_CODE=%%H"\r\n)\r\n\r\nif not defined HTTP_CODE set "HTTP_CODE=000"\r\n\r\nif "%HTTP_CODE%"=="000" (\r\n    echo Chyba: server neni dostupny ^(%URL%^) 1>&2\r\n    if exist "%OUTFILE%" del "%OUTFILE%"\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\nif not "%HTTP_CODE%"=="200" (\r\n    echo Chyba: server vratil HTTP %HTTP_CODE% 1>&2\r\n    type "%OUTFILE%" 1>&2\r\n    echo. 1>&2\r\n    del "%OUTFILE%"\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\necho Export ulozen: %OUTFILE%\r\ngoto :eof\r\n\r\n:do_post\r\nrem POST vzdy odesila BODY_GET jako filtrovaci JSON.\r\nif not defined BODY_GET (\r\n    echo Chyba: POST vyzaduje BODY_GET s filtraci. Pouzijte GET pro cely vystup. 1>&2\r\n    pause\r\n    exit /b 1\r\n)\r\nfor /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X POST -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d "%BODY_GET%" ${curlInsecure}"%URL%"') do set "HTTP_CODE=%%H"\r\n\r\nif not defined HTTP_CODE set "HTTP_CODE=000"\r\n\r\nif "%HTTP_CODE%"=="000" (\r\n    echo Chyba: server neni dostupny ^(%URL%^) 1>&2\r\n    if exist "%OUTFILE%" del "%OUTFILE%"\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\nif not "%HTTP_CODE%"=="200" (\r\n    echo Chyba: server vratil HTTP %HTTP_CODE% 1>&2\r\n    type "%OUTFILE%" 1>&2\r\n    echo. 1>&2\r\n    del "%OUTFILE%"\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\necho Export ulozen: %OUTFILE%\r\ngoto :eof\r\n\r\n:do_put\r\nif defined BODY_PUT_FILE (\r\n    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X PUT -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d @"%BODY_PUT_FILE%" ${curlInsecure}"%URL%"') do set "HTTP_CODE=%%H"\r\n) else (\r\n    for /f "delims=" %%H in ('curl -s -o "%OUTFILE%" -w "%%{http_code}" -X PUT -H "Content-Type: application/json" -H "%API_KEY_HEADER%: %API_KEY%" -d "%BODY_PUT%" ${curlInsecure}"%URL%"') do set "HTTP_CODE=%%H"\r\n)\r\n\r\nif not defined HTTP_CODE set "HTTP_CODE=000"\r\n\r\nif "%HTTP_CODE%"=="000" (\r\n    echo Chyba: server neni dostupny ^(%URL%^) 1>&2\r\n    if exist "%OUTFILE%" del "%OUTFILE%"\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\nif not "%HTTP_CODE%"=="200" (\r\n    echo Chyba: server vratil HTTP %HTTP_CODE% 1>&2\r\n    type "%OUTFILE%" 1>&2\r\n    echo. 1>&2\r\n    del "%OUTFILE%"\r\n    pause\r\n    exit /b 1\r\n)\r\n\r\necho Insert uspesny. Odpoved ulozena: %OUTFILE%\r\ngoto :eof\r\n`;
  }

  function insertIntoActiveWhereValue(text) {
    if (!state.activeWhereValue || !state.activeWhereValue.input) {
      alert(t('where_value_focus_alert'));
      return;
    }
    const input = state.activeWhereValue.input;
    const start = input.selectionStart || 0;
    const end = input.selectionEnd || 0;
    const before = input.value.slice(0, start);
    const after = input.value.slice(end);
    input.value = before + text + after;
    const pos = start + text.length;
    input.setSelectionRange(pos, pos);
    input.focus();
    state.whereClauses[state.activeWhereValue.rowIndex].value = input.value;
  }

  async function onTableSearchSelect() {
    const value = $('#table-search').value.trim();
    const match = state.tables.find(t => t.system_name === value || t.display_name === value);
    if (match) {
      await addTableToCanvas(match.system_name);
      $('#table-search').value = '';
      filterTableList();
    }
  }

  init();
})();
