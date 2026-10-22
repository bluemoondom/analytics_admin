// Sharing whole dashboards with other users (see services/dashboard_sharing.py).
//
// Author: "Share" next to Copy opens a dialog: e-mail of the recipient, a check
// whether the recipient has the dashboard's view (offering to share the view
// together with the dashboard), the list of shares with Revoke.
// Recipient: invitations and updates appear above the dashboard list (with a
// badge on "Dashboards"); the preview lets them pick the connector the copy
// reads data through, and accept or decline.
(function () {
  const app = () => window.DashboardApp;
  const t = (key, params) => (window.I18n ? window.I18n.t(key, params) : key);
  const $ = (sel) => document.querySelector(sel);
  const esc = (v) => (app() ? app().esc(v) : String(v || ''));

  const state = {
    checkedEmail: '',
    check: null,
    incoming: [],
    preview: null,
  };

  function api(method, path, body) {
    return app().api(method, path, body);
  }

  function errorText(err) {
    const raw = (err && err.message) || String(err || '');
    try {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.detail) return typeof parsed.detail === 'string' ? parsed.detail : JSON.stringify(parsed.detail);
    } catch (e) {
      // plain text
    }
    return raw;
  }

  function showResult(el, html, kind) {
    if (!el) return;
    el.innerHTML = html;
    el.className = 'share-result ' + (kind || '');
  }

  function hideResult(el) {
    if (!el) return;
    el.innerHTML = '';
    el.className = 'share-result hidden';
  }

  function statusLabel(share) {
    if (share.status === 'accepted' && share.update_available) return t('share_status_update');
    return t('share_status_' + share.status);
  }

  // ------------------------------------------------------------------
  // Author
  // ------------------------------------------------------------------
  function currentDashboard() {
    return app() ? app().currentDashboard() : null;
  }

  function openShareModal() {
    const dash = currentDashboard();
    if (!dash || !dash.id) return;
    state.checkedEmail = '';
    state.check = null;
    $('#dshare-name').textContent = t('dashboard_share_name_label', { name: dash.name || '' });
    $('#dshare-email').value = '';
    $('#dshare-send').disabled = true;
    $('#dshare-view-option').classList.add('hidden');
    hideResult($('#dshare-result'));
    $('#dshare-list').innerHTML = '';
    hideResult($('#dpublic-result'));
    $('#dpublic-label').value = '';
    $('#dpublic-expiry').value = 'never';
    $('#dpublic-date').value = '';
    $('.dpublic-date').classList.add('hidden');
    $('#dpublic-list').innerHTML = '';
    showPane('users');
    $('#dshare-modal').classList.remove('hidden');
    $('#dshare-email').focus();
    renderShareList();
    renderPublicLinks();
  }

  function showPane(name) {
    document.querySelectorAll('#dshare-modal .dshare-tab').forEach(tab => {
      const active = tab.dataset.pane === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    document.querySelectorAll('#dshare-modal .dshare-pane').forEach(pane => {
      pane.classList.toggle('hidden', pane.dataset.pane !== name);
    });
    // "Share" belongs to the e-mail tab only.
    $('#dshare-send').classList.toggle('hidden', name !== 'users');
    if (name === 'public') $('#dpublic-label').focus();
    else $('#dshare-email').focus();
  }

  // ----- public links -----
  function formatDate(text) {
    if (!text) return '';
    const d = new Date(String(text).replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return text;
    const lang = (window.I18n && window.I18n.getLang && window.I18n.getLang()) || undefined;
    try {
      return d.toLocaleString(lang, { day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return d.toLocaleString();
    }
  }

  async function renderPublicLinks() {
    const dash = currentDashboard();
    const list = $('#dpublic-list');
    if (!dash || !dash.id) return;
    try {
      const links = await api('GET', '/' + dash.id + '/public-links');
      if (!links.length) {
        list.innerHTML = `<li class="empty-hint">${esc(t('public_link_none'))}</li>`;
        return;
      }
      list.innerHTML = links.map(l => {
        const title = l.label || t('public_link_untitled', { id: l.id });
        const expiry = l.expires_at
          ? t(l.status === 'expired' ? 'public_link_expired_at' : 'public_link_valid_until', { date: formatDate(l.expires_at) })
          : t('public_link_no_expiry');
        const usage = t('public_link_views', { n: l.access_count })
          + (l.last_access_at ? ' · ' + t('public_link_last_view', { date: formatDate(l.last_access_at) }) : '');
        return `<li class="share-row dpublic-row status-${esc(l.status)}">
          <div class="share-row-main">
            <strong>${esc(title)}</strong>
            <span class="meta">${esc(expiry)} · ${esc(usage)}</span>
            ${l.url ? `<span class="dpublic-url"><input type="text" readonly value="${esc(l.url)}" aria-label="${esc(t('public_link_url'))}"><button type="button" class="btn small dpublic-copy">${esc(t('public_link_copy'))}</button></span>` : ''}
          </div>
          <span class="share-status dpublic-status-${esc(l.status)}">${esc(t('public_link_status_' + l.status))}</span>
          <span class="dpublic-actions">
            ${l.status === 'active' ? `<button type="button" class="btn small dpublic-revoke" data-id="${esc(l.id)}">${esc(t('public_link_revoke'))}</button>` : ''}
            <button type="button" class="btn small danger dpublic-delete" data-id="${esc(l.id)}">${esc(t('public_link_delete'))}</button>
          </span>
        </li>`;
      }).join('');
      list.querySelectorAll('.dpublic-copy').forEach(btn => {
        btn.addEventListener('click', async () => {
          const input = btn.parentElement.querySelector('input');
          const ok = await copyText(input.value, input);
          btn.textContent = t(ok ? 'public_link_copied' : 'cell_copy_failed_toast');
          setTimeout(() => { btn.textContent = t('public_link_copy'); }, 1600);
        });
      });
      list.querySelectorAll('.dpublic-url input').forEach(input => {
        input.addEventListener('focus', () => input.select());
      });
      list.querySelectorAll('.dpublic-revoke').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('public_link_revoke_confirm'))) return;
          try {
            await api('POST', '/public-links/' + btn.dataset.id + '/revoke');
            await renderPublicLinks();
          } catch (err) {
            showResult($('#dpublic-result'), esc(errorText(err)), 'error');
          }
        });
      });
      list.querySelectorAll('.dpublic-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('public_link_delete_confirm'))) return;
          try {
            await api('DELETE', '/public-links/' + btn.dataset.id);
            await renderPublicLinks();
          } catch (err) {
            showResult($('#dpublic-result'), esc(errorText(err)), 'error');
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<li class="empty-hint">${esc(errorText(err))}</li>`;
    }
  }

  async function copyText(text, input) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) {
      // fall back below
    }
    try {
      input.focus();
      input.select();
      return document.execCommand('copy');
    } catch (e) {
      return false;
    }
  }

  async function createPublicLink() {
    const dash = currentDashboard();
    if (!dash || !dash.id) return;
    const choice = $('#dpublic-expiry').value;
    let expires = choice;
    if (choice === 'date') {
      const day = $('#dpublic-date').value;
      // Valid through the whole chosen day in the author's time zone.
      expires = day ? new Date(day + 'T23:59:59').toISOString() : '';
    }
    if (choice === 'date' && !expires) {
      showResult($('#dpublic-result'), esc(t('public_link_pick_date')), 'error');
      return;
    }
    const btn = $('#dpublic-create');
    btn.disabled = true;
    try {
      const link = await api('POST', '/' + dash.id + '/public-links', {
        label: $('#dpublic-label').value.trim(),
        expires,
      });
      showResult($('#dpublic-result'), esc(t('public_link_created')), 'success');
      $('#dpublic-label').value = '';
      await renderPublicLinks();
      const input = document.querySelector('#dpublic-list .dpublic-url input[value="' + CSS.escape(link.url) + '"]');
      if (input) {
        input.focus();
        input.select();
      }
    } catch (err) {
      showResult($('#dpublic-result'), esc(errorText(err)), 'error');
    } finally {
      btn.disabled = false;
    }
  }

  function closeShareModal() {
    $('#dshare-modal').classList.add('hidden');
  }

  async function renderShareList() {
    const dash = currentDashboard();
    const list = $('#dshare-list');
    if (!dash || !dash.id) return;
    try {
      const shares = await api('GET', '/' + dash.id + '/shares');
      const visible = shares.filter(s => s.status !== 'revoked');
      if (!visible.length) {
        list.innerHTML = `<li class="empty-hint">${esc(t('share_none'))}</li>`;
        return;
      }
      list.innerHTML = visible.map(s => `
        <li class="share-row">
          <div class="share-row-main">
            <strong>${esc(s.target_email)}</strong>
            <span class="meta">${s.target_connector_name ? esc(s.target_connector_name) + ' · ' : ''}${esc(s.view_name)}${s.share_view ? ' · ' + esc(t('dashboard_share_with_view_tag')) : ''}</span>
            ${s.message ? `<span class="meta share-row-error">${esc(s.message)}</span>` : ''}
          </div>
          <span class="share-status status-${esc(s.status)}${s.update_available ? ' status-update' : ''}">${esc(statusLabel(s))}</span>
          ${['pending', 'accepted'].includes(s.status)
            ? `<button type="button" class="btn small dshare-revoke" data-id="${esc(s.id)}" data-email="${esc(s.target_email)}">${esc(t('share_revoke_button'))}</button>`
            : ''}
        </li>`).join('');
      list.querySelectorAll('.dshare-revoke').forEach(btn => {
        btn.addEventListener('click', async () => {
          if (!confirm(t('dashboard_share_revoke_confirm', { email: btn.dataset.email }))) return;
          try {
            await api('POST', '/shares/' + btn.dataset.id + '/revoke');
            await renderShareList();
          } catch (err) {
            alert(t('share_error', { error: errorText(err) }));
          }
        });
      });
    } catch (err) {
      list.innerHTML = `<li class="empty-hint">${esc(t('share_error', { error: errorText(err) }))}</li>`;
    }
  }

  function checkSummary(c) {
    const lines = [`<strong>${esc(t('dashboard_share_recipient', { email: c.email }))}</strong>`];  // escaped as a whole
    const view = `<code>${esc(c.view_name)}</code>`;
    if (c.view_kind === 'table') {
      lines.push(t('dashboard_share_view_table', { view }));
    } else if (c.connectors_total && c.connectors_with_view >= c.connectors_total) {
      lines.push(t('dashboard_share_view_present', { view }));
    } else if (c.can_share_view) {
      lines.push(c.connectors_with_view
        ? t('dashboard_share_view_partial', { view, n: c.connectors_with_view, total: c.connectors_total })
        : t('dashboard_share_view_missing', { view }));
    } else if (c.connectors_with_view) {
      lines.push(t('dashboard_share_view_partial', { view, n: c.connectors_with_view, total: c.connectors_total }));
    } else {
      lines.push(t('dashboard_share_view_foreign', { view, email: esc(c.view_shared_by || '?') }));
    }
    if (!c.connectors_total) lines.push(t('dashboard_share_no_connectors'));
    if (c.existing_status === 'accepted') lines.push(t('dashboard_share_already_accepted'));
    else if (c.existing_status === 'pending') lines.push(t('dashboard_share_already_pending'));
    return lines.map(l => `<span class="dshare-line">${l}</span>`).join('');
  }

  async function checkRecipient() {
    const dash = currentDashboard();
    const email = $('#dshare-email').value.trim();
    const result = $('#dshare-result');
    if (!dash || !dash.id || !email) return;
    try {
      const c = await api('POST', '/' + dash.id + '/shares/check', { email });
      state.checkedEmail = email;
      state.check = c;
      const kind = c.view_kind === 'saved' && !c.can_share_view && c.connectors_with_view === 0 ? 'error' : 'info';
      showResult(result, checkSummary(c), kind);
      const option = $('#dshare-view-option');
      option.classList.toggle('hidden', !c.can_share_view);
      $('#dshare-share-view').checked = !!c.suggest_share_view;
      $('#dshare-share-view-label').innerHTML = t('dashboard_share_view_option', { view: `<code>${esc(c.view_name)}</code>` });
      $('#dshare-send').disabled = false;
      $('#dshare-send').focus();
    } catch (err) {
      state.checkedEmail = '';
      state.check = null;
      $('#dshare-send').disabled = true;
      $('#dshare-view-option').classList.add('hidden');
      showResult(result, esc(errorText(err)), 'error');
    }
  }

  async function sendShare() {
    const dash = currentDashboard();
    if (!dash || !dash.id || !state.checkedEmail) return;
    const btn = $('#dshare-send');
    btn.disabled = true;
    try {
      await api('POST', '/' + dash.id + '/shares', {
        email: state.checkedEmail,
        share_view: !$('#dshare-view-option').classList.contains('hidden') && $('#dshare-share-view').checked,
      });
      showResult($('#dshare-result'), esc(t('dashboard_share_sent', { email: state.checkedEmail })), 'success');
      $('#dshare-email').value = '';
      $('#dshare-view-option').classList.add('hidden');
      state.checkedEmail = '';
      state.check = null;
      await renderShareList();
    } catch (err) {
      showResult($('#dshare-result'), esc(errorText(err)), 'error');
      btn.disabled = false;
    }
  }

  // ------------------------------------------------------------------
  // Recipient
  // ------------------------------------------------------------------
  async function loadIncoming() {
    if (!app()) return;
    try {
      state.incoming = await api('GET', '/shares/incoming');
    } catch (err) {
      state.incoming = [];
    }
    renderIncoming();
  }

  function renderIncoming() {
    const shares = state.incoming || [];
    const badge = $('#incoming-dashboard-badge');
    if (badge) {
      badge.textContent = shares.length ? String(shares.length) : '';
      badge.classList.toggle('hidden', !shares.length);
      badge.title = t('incoming_shares_heading');
    }
    const box = $('#incoming-dashboard-shares');
    const list = $('#incoming-dashboard-list');
    if (!box || !list) return;
    box.classList.toggle('hidden', !shares.length);
    const count = $('#incoming-dashboard-count');
    if (count) count.textContent = shares.length ? String(shares.length) : '';
    list.innerHTML = shares.map(s => `
      <li data-id="${esc(s.id)}" tabindex="0" role="button">
        <div>
          <div>${esc(s.dashboard_name)}</div>
          <div class="meta">${s.update_available ? `<span class="share-tag update">${esc(t('update_tag'))}</span> ` : ''}${esc(t('dashboard_shared_by', { email: s.source_email }))}</div>
        </div>
      </li>`).join('');
    list.querySelectorAll('li').forEach(li => {
      const open = () => openPreview(parseInt(li.dataset.id, 10));
      li.addEventListener('click', open);
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      });
    });
  }

  function connectorStatusText(c, viewName) {
    const view = `<code>${esc(viewName)}</code>`;
    switch (c.status) {
      case 'ready': return t('dashboard_share_conn_ready', { view });
      case 'will_share': return t('dashboard_share_conn_will_share', { view });
      case 'missing_columns':
      case 'conflict':
        return t('dashboard_share_conn_missing_columns', { columns: esc((c.missing_columns || []).join(', ')) });
      default: return t('dashboard_share_conn_missing', { view });
    }
  }

  function renderConnectors(d) {
    const list = $('#dshare-connectors');
    const conns = d.connectors || [];
    const usable = conns.filter(c => c.status === 'ready' || c.status === 'will_share');
    const preferred = usable.find(c => c.connector_id === d.active_connector_id && c.status === 'ready')
      || usable.find(c => c.status === 'ready')
      || usable.find(c => c.connector_id === d.active_connector_id)
      || usable[0];
    if (!conns.length) {
      list.innerHTML = `<li class="dshare-conn disabled">${esc(t('dashboard_share_no_connectors_recipient'))}</li>`;
      return null;
    }
    list.innerHTML = conns.map(c => {
      const ok = c.status === 'ready' || c.status === 'will_share';
      const checked = preferred && preferred.connector_id === c.connector_id;
      return `<li class="dshare-conn status-${esc(c.status)}${ok ? '' : ' disabled'}">
        <label>
          <input type="radio" name="dshare-connector" value="${esc(c.connector_id)}" ${ok ? '' : 'disabled'} ${checked ? 'checked' : ''} ${d.is_update ? 'disabled' : ''}>
          <span class="dshare-conn-main">
            <strong>${esc(c.connector_name)}</strong>
            <span class="meta">${connectorStatusText(c, d.view_name)}</span>
          </span>
        </label>
      </li>`;
    }).join('');
    return preferred || null;
  }

  async function openPreview(shareId) {
    try {
      const d = await api('GET', '/shares/' + shareId);
      state.preview = { id: shareId, data: d };
      $('#dshare-preview-title').textContent = d.dashboard_name;
      $('#dshare-preview-meta').innerHTML = esc(t('dashboard_shared_by', { email: d.source_email }))
        + (d.is_update ? ` · <span class="share-tag update">${esc(t('update_tag'))}</span>` : '');
      $('#dshare-preview-view').innerHTML = t('dashboard_share_preview_view', { view: `<code>${esc(d.view_name)}</code>` });
      const chips = (items) => (items || []).filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('') || '<li>–</li>';
      $('#dshare-preview-kpis').innerHTML = chips(d.kpi_cards);
      $('#dshare-preview-charts').innerHTML = chips(d.charts);
      const preferred = renderConnectors(d);
      $('#dshare-update-note').classList.toggle('hidden', !d.is_update);
      hideResult($('#dshare-preview-result'));
      const accept = $('#dshare-preview-accept');
      const decline = $('#dshare-preview-decline');
      accept.textContent = t(d.is_update ? 'share_accept_update_button' : 'share_accept_button');
      decline.textContent = t(d.is_update ? 'share_skip_update_button' : 'share_decline_button');
      accept.disabled = !preferred;
      decline.disabled = false;
      if (!preferred && (d.connectors || []).length) {
        showResult($('#dshare-preview-result'), esc(t('dashboard_share_no_usable_connector')), 'error');
      }
      $('#dshare-preview-modal').classList.remove('hidden');
    } catch (err) {
      alert(t('share_error', { error: errorText(err) }));
    }
  }

  function closePreview() {
    $('#dshare-preview-modal').classList.add('hidden');
    state.preview = null;
  }

  async function acceptPreview() {
    const p = state.preview;
    if (!p) return;
    const picked = document.querySelector('input[name="dshare-connector"]:checked');
    const accept = $('#dshare-preview-accept');
    const decline = $('#dshare-preview-decline');
    accept.disabled = true;
    decline.disabled = true;
    showResult($('#dshare-preview-result'), esc(t('share_accepting')), 'info');
    try {
      const res = await api('POST', '/shares/' + p.id + '/accept', {
        connector_id: picked ? parseInt(picked.value, 10) : null,
      });
      await app().reloadDashboards();
      await loadIncoming();
      closePreview();
      if (res.dashboard_id) await app().openDashboard(res.dashboard_id);
    } catch (err) {
      showResult($('#dshare-preview-result'), esc(errorText(err)), 'error');
      accept.disabled = false;
      decline.disabled = false;
    }
  }

  async function declinePreview() {
    const p = state.preview;
    if (!p) return;
    try {
      await api('POST', '/shares/' + p.id + '/decline');
      closePreview();
      await loadIncoming();
      await app().reloadDashboards();
    } catch (err) {
      showResult($('#dshare-preview-result'), esc(errorText(err)), 'error');
    }
  }

  // ------------------------------------------------------------------
  // Wiring
  // ------------------------------------------------------------------
  function bind(id, event, fn) {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
  }

  function init() {
    if (!app()) return;
    bind('share-dashboard', 'click', openShareModal);
    bind('dshare-close', 'click', closeShareModal);
    bind('dshare-check', 'click', checkRecipient);
    bind('dshare-send', 'click', sendShare);
    bind('dshare-email', 'input', () => {
      state.checkedEmail = '';
      $('#dshare-send').disabled = true;
      $('#dshare-view-option').classList.add('hidden');
      hideResult($('#dshare-result'));
    });
    bind('dshare-email', 'keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (state.checkedEmail) sendShare(); else checkRecipient();
    });
    document.querySelectorAll('#dshare-modal .dshare-tab').forEach(tab => {
      tab.addEventListener('click', () => showPane(tab.dataset.pane));
    });
    bind('dpublic-create', 'click', createPublicLink);
    bind('dpublic-expiry', 'change', () => {
      const custom = $('#dpublic-expiry').value === 'date';
      $('.dpublic-date').classList.toggle('hidden', !custom);
      if (custom) {
        const tomorrow = new Date(Date.now() + 86400000);
        $('#dpublic-date').min = tomorrow.toISOString().slice(0, 10);
        $('#dpublic-date').focus();
      }
    });
    bind('dpublic-label', 'keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        createPublicLink();
      }
    });
    bind('dshare-preview-close', 'click', closePreview);
    bind('dshare-preview-accept', 'click', acceptPreview);
    bind('dshare-preview-decline', 'click', declinePreview);
    const b1 = $('#dshare-modal .modal-backdrop');
    if (b1) b1.addEventListener('click', closeShareModal);
    const b2 = $('#dshare-preview-modal .modal-backdrop');
    if (b2) b2.addEventListener('click', closePreview);
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (!$('#dshare-modal').classList.contains('hidden')) closeShareModal();
      if (!$('#dshare-preview-modal').classList.contains('hidden')) closePreview();
    });

    // "Share" is offered for saved dashboards, exactly like "Delete", but not
    // for a copy someone shared with the user (only its author shares it).
    const del = $('#delete-dashboard');
    const share = $('#share-dashboard');
    if (del && share) {
      const sync = () => {
        const dash = currentDashboard();
        const summary = dash && dash.id ? app().dashboardSummary(dash.id) : null;
        share.classList.toggle('hidden', del.classList.contains('hidden') || !!(summary && summary.shared_by));
      };
      new MutationObserver(sync).observe(del, { attributes: true, attributeFilter: ['class'] });
      window.addEventListener('analytics:dashboard-opened', sync);
      sync();
    }

    // Invitations may arrive while the page is open.
    window.addEventListener('focus', loadIncoming);
    setInterval(loadIncoming, 120000);
    if (window.I18n && window.I18n.onChange) window.I18n.onChange(() => renderIncoming());
    loadIncoming();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
