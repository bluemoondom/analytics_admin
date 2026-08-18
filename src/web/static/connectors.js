(function () {
  const API = '/api/connectors';
  const t = window.I18n ? window.I18n.t : (k, p) => `{${k}}`;

  let state = {
    connectors: [],
    currentConnectorId: null,
    editingConnector: null,
    initialized: false,
  };

  const $ = (sel) => document.querySelector(sel);

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

  function csrfToken() {
    const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : '';
  }

  async function loadUser() {
    try {
      const res = await fetch('/auth/me');
      if (!res.ok) return;
      const user = await res.json();
      state.currentConnectorId = user.connector_id || null;
    } catch (err) {
      console.error('Failed to load user', err);
    }
  }

  function getFormData() {
    return {
      name: $('#connector-name').value.trim(),
      db_type: $('#connector-db-type').value,
      db_host: $('#connector-db-host').value.trim(),
      db_port: parseInt($('#connector-db-port').value, 10) || 1433,
      db_name: $('#connector-db-name').value.trim(),
      db_user: $('#connector-db-user').value.trim(),
      db_password: $('#connector-db-password').value,
      db_driver: $('#connector-db-driver').value.trim(),
      view_discovery_mode: $('#connector-view-mode').value,
      api_tenant: $('#connector-api-tenant').value.trim(),
      api_key: $('#connector-api-key').value,
      api_key_header: $('#connector-api-key-header').value.trim() || 'X-API-Key',
      api_allowed_ips: ($('#connector-api-allowed-ips').value || '').split(',').map((s) => s.trim()).filter(Boolean),
      api_max_requests_per_minute: parseInt($('#connector-api-rate-limit').value, 10) || 0,
    };
  }

  function maskSecret(value) {
    if (!value) return '';
    if (value.length <= 8) return value.slice(0, 2) + '*'.repeat(Math.max(0, value.length - 2));
    return value.slice(0, 4) + '*'.repeat(Math.max(0, value.length - 8)) + value.slice(-4);
  }

  function setFormData(connector) {
    state.editingConnector = connector || null;
    $('#connector-id').value = connector ? connector.id : '';
    $('#connector-name').value = connector ? connector.name : '';
    $('#connector-db-type').value = (connector && connector.db_type) || 'mssql';
    $('#connector-db-host').value = connector ? connector.db_host : '';
    $('#connector-db-port').value = connector ? connector.db_port : 1433;
    $('#connector-db-name').value = connector ? connector.db_name : '';
    $('#connector-db-user').value = connector ? connector.db_user : '';
    // Never render saved secrets in the form. An empty value means "keep existing".
    const pwdInput = $('#connector-db-password');
    pwdInput.value = '';
    pwdInput.placeholder = connector && connector.has_db_password ? '•••••••• (uloženo)' : '';
    $('#connector-db-driver').value = connector ? connector.db_driver : 'ODBC Driver 17 for SQL Server';
    $('#connector-view-mode').value = connector ? connector.view_discovery_mode : 'tabobecny_prehled';
    $('#connector-api-tenant').value = connector ? connector.api_tenant : '';
    const keyInput = $('#connector-api-key');
    keyInput.value = '';
    keyInput.placeholder = connector && connector.api_key ? maskSecret(connector.api_key) : '';
    $('#connector-api-key-header').value = connector ? connector.api_key_header : 'X-API-Key';
    $('#connector-api-allowed-ips').value = connector ? (connector.api_allowed_ips || []).join(', ') : '';
    $('#connector-api-rate-limit').value = connector ? connector.api_max_requests_per_minute : 0;

    applyDbTypeVisibility();

    const deleteBtn = $('#delete-connector');
    if (deleteBtn) {
      const isActive = connector && connector.id === state.currentConnectorId;
      deleteBtn.classList.toggle('hidden', !connector || isActive);
    }

    const testBtn = $('#test-connector');
    if (testBtn) {
      testBtn.disabled = false;
      // Let the static data-i18n attribute translate the label.
      if (window.I18n && window.I18n.applyTranslations) {
        window.I18n.applyTranslations();
      }
    }
    const testResult = $('#connector-test-result');
    if (testResult) testResult.className = 'connector-test-result hidden';
  }

  // Show/hide host/auth fields based on the selected database type and suggest
  // default ports.
  function applyDbTypeVisibility() {
    const type = $('#connector-db-type').value;
    const isFile = type === 'sqlite';
    const toggle = (sel, hidden) => { const el = $(sel); if (el) el.closest('label').classList.toggle('hidden', hidden); };
    toggle('#connector-db-host', isFile);
    toggle('#connector-db-port', isFile);
    toggle('#connector-db-user', isFile);
    toggle('#connector-db-password', isFile);
    toggle('#connector-db-driver', type !== 'mssql');
    toggle('#connector-view-mode', type !== 'mssql');
    const portInput = $('#connector-db-port');
    if (!isFile && portInput && !state.editingConnector) {
      const defaults = { mssql: 1433, mysql: 3306, postgresql: 5432 };
      if (defaults[type]) portInput.value = defaults[type];
    }
    const nameInput = $('#connector-db-name');
    if (nameInput) {
      nameInput.placeholder = isFile ? (t('connector_db_name_placeholder_sqlite', {}) || '') : '';
    }
  }

  function generateApiKey() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let key = '';
    const crypto = window.crypto || window.msCrypto;
    if (crypto && crypto.getRandomValues) {
      const values = new Uint32Array(32);
      crypto.getRandomValues(values);
      for (let i = 0; i < 32; i++) {
        key += chars[values[i] % chars.length];
      }
    } else {
      for (let i = 0; i < 32; i++) {
        key += chars[Math.floor(Math.random() * chars.length)];
      }
    }
    return key;
  }

  async function loadConnectors() {
    try {
      state.connectors = await api('GET', '/');
      await loadUser();
      renderConnectorList();
    } catch (err) {
      console.error('Failed to load connectors', err);
    }
  }

  function renderConnectorList() {
    const list = $('#connector-list');
    if (!list) return;
    list.innerHTML = '';
    if (!state.connectors.length) {
      list.innerHTML = `<li class="hint">${t('no_connectors_hint', {}) || 'Žádné konektory'}</li>`;
      return;
    }
    state.connectors.forEach((c) => {
      const isActive = c.id === state.currentConnectorId;
      const li = document.createElement('li');
      li.className = 'dashboard-item' + (isActive ? ' active' : '');
      li.innerHTML = `
        <div class="dashboard-item-main">
          <span class="dashboard-name">${escapeHtml(c.name)}</span>
          <span class="dashboard-meta">${escapeHtml(c.db_host)} / ${escapeHtml(c.db_name)}</span>
        </div>
        <div class="dashboard-item-actions">
          <button type="button" class="btn small edit-connector" data-id="${c.id}">${t('edit_connector_button', {}) || 'Upravit'}</button>
          ${isActive ? '' : `<button type="button" class="btn small activate-connector" data-id="${c.id}">${t('activate_connector_button', {}) || 'Aktivovat'}</button>`}
        </div>
      `;
      list.appendChild(li);
    });

    list.querySelectorAll('.edit-connector').forEach((btn) => {
      btn.addEventListener('click', () => {
        const connector = state.connectors.find((c) => String(c.id) === btn.dataset.id);
        if (connector) setFormData(connector);
      });
    });

    list.querySelectorAll('.activate-connector').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          await api('POST', `/${btn.dataset.id}/activate`);
          state.currentConnectorId = parseInt(btn.dataset.id, 10);
          renderConnectorList();
          window.location.reload();
        } catch (err) {
          alert(t('activate_connector_error', { error: err.message }) || err.message);
        }
      });
    });
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function onShow() {
    setFormData(null);
    loadConnectors();
  }

  function bindEvents() {
    const newBtn = $('#new-connector');
    if (newBtn) newBtn.addEventListener('click', () => setFormData(null));

    const typeSel = $('#connector-db-type');
    if (typeSel) typeSel.addEventListener('change', applyDbTypeVisibility);

    const saveBtn = $('#save-connector');
    if (saveBtn) {
      saveBtn.addEventListener('click', async () => {
        const data = getFormData();
        if (!data.name) {
          alert(t('connector_name_required', {}) || 'Zadejte název konektoru.');
          return;
        }
        const id = $('#connector-id').value;
        try {
          const saved = id
            ? await api('PUT', `/${id}`, data)
            : await api('POST', '/', data);
          await api('POST', `/${saved.id}/activate`);
          state.currentConnectorId = saved.id;
          await loadConnectors();
          // Keep the saved connector in the form instead of resetting it.
          const updated = state.connectors.find((c) => c.id === saved.id) || saved;
          setFormData(updated);
          renderConnectorList();
          window.location.reload();
        } catch (err) {
          alert(t('connector_save_error', { error: err.message }) || err.message);
        }
      });
    }

    const deleteBtn = $('#delete-connector');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', async () => {
        const id = $('#connector-id').value;
        if (!id) return;
        if (!confirm(t('delete_connector_confirm', {}) || 'Opravdu smazat konektor?')) return;
        try {
          await api('DELETE', `/${id}`);
          setFormData(null);
          await loadConnectors();
        } catch (err) {
          alert(t('connector_delete_error', { error: err.message }) || err.message);
        }
      });
    }

    const cancelBtn = $('#cancel-connector');
    if (cancelBtn) cancelBtn.addEventListener('click', () => setFormData(null));

    const generateBtn = $('#generate-api-key');
    if (generateBtn) {
      generateBtn.addEventListener('click', () => {
        $('#connector-api-key').value = generateApiKey();
      });
    }

    const testBtn = $('#test-connector');
    if (testBtn) {
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = t('test_connector_running', {}) || 'Ověřuji...';
        const id = $('#connector-id').value;
        const data = { ...getFormData(), connector_id: id || undefined };
        try {
          const result = await api('POST', '/test', data);
          showTestResult(result.message || t('test_connector_ok', {}) || 'Připojení bylo úspěšné.', 'success');
        } catch (err) {
          showTestResult(err.message || t('test_connector_error', {}) || 'Připojení selhalo.', 'error');
        } finally {
          testBtn.disabled = false;
          if (window.I18n && window.I18n.applyTranslations) {
            window.I18n.applyTranslations();
          }
        }
      });
    }
  }

  function showTestResult(message, type) {
    const el = $('#connector-test-result');
    if (!el) return;
    el.textContent = message;
    el.className = 'connector-test-result ' + (type || '');
    el.classList.remove('hidden');
  }

  function init() {
    if (state.initialized) return;
    state.initialized = true;
    loadUser().then(() => {
      bindEvents();
    });
  }

  window.ConnectorManager = { init, onShow, loadConnectors };
})();
