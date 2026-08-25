// ============================================================
// TELEGRAM.JS — Telegram connection + team overdue management
// ============================================================

(function () {
  'use strict';

  function apiBase() {
    return String(window.TELEGRAM_API_BASE_URL || '').replace(/\/$/, '');
  }

  async function firebaseToken() {
    const user = window.auth?.currentUser;
    if (!user) throw new Error('Your CRM session has expired. Please sign in again.');
    return user.getIdToken(true);
  }

  async function telegramApi(path, options = {}) {
    const token = await firebaseToken();
    const response = await fetch(`${apiBase()}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
  }

  function currentCRMUser() {
    return window.CURRENT_USER || window.currentUser || window.crmUser || {};
  }

  function isAdminOrSuperAdmin() {
    const role = String(currentCRMUser().role || '')
      .trim()
      .toLowerCase()
      .replace(/[-\s]+/g, '_');
    return role === 'admin' || role === 'superadmin' || role === 'super_admin';
  }

  function renderTelegramView() {
    const wrap = document.getElementById('telegramSettingsBody');
    if (!wrap) return;

    wrap.innerHTML = `
      <div class="row g-4">
        <div class="col-12 col-lg-7">
          <div class="p-4 rounded-4 border bg-white h-100 shadow-sm">
            <div class="d-flex align-items-center gap-3 mb-3">
              <div class="rounded-circle d-flex align-items-center justify-content-center bg-primary text-white" style="width:52px;height:52px;font-size:24px;">
                <i class="bi bi-telegram"></i>
              </div>
              <div>
                <h4 class="mb-1">Connect Telegram</h4>
                <p class="text-muted mb-0">Enter the Chat ID from your Telegram bot.</p>
              </div>
            </div>

            <div class="alert alert-warning mb-3">
              <strong>How to find your Telegram Chat ID</strong>
              <ol class="mb-0 mt-2 ps-3">
                <li>Open the Abra Logistics Telegram bot.</li>
                <li>Press <b>Start</b>.</li>
                <li>Send <code>/id</code>.</li>
                <li>Copy the numeric Chat ID.</li>
                <li>Paste it below.</li>
              </ol>
            </div>

            <div id="telegramConnectionStatus" class="mb-3"></div>
            <div id="telegramActionArea"></div>

            ${isAdminOrSuperAdmin() ? `
              <hr class="my-4">
              <div id="telegramTeamOverdueSection"></div>
            ` : ''}
          </div>
        </div>

        <div class="col-12 col-lg-5">
          <div class="p-4 rounded-4 border bg-light h-100">
            <h5><i class="bi bi-bell me-2"></i>What you will receive</h5>
            <ul class="mb-0 ps-3">
              <li class="mb-2">🔔 New lead assigned to you</li>
              <li class="mb-2">⚠️ Reminder when a lead becomes overdue</li>
              <li class="mb-2">👤 Customer name and phone</li>
              <li class="mb-2">🛠 Requested service</li>
              <li class="mb-2">📊 Management alerts and daily reports where applicable</li>
              <li>🔗 Link back to the CRM</li>
            </ul>
          </div>
        </div>
      </div>`;

    refreshTelegramStatus();
    if (isAdminOrSuperAdmin()) refreshTeamOverdue();
  }

  function connectedMarkup(data) {
    return `
      <div class="alert alert-success mb-3">
        <strong>🟢 Telegram connected</strong><br>
        <span class="small">Chat ID: <code>${escapeHtml(data.chatId || '')}</code></span>
        ${data.username ? `<br><span class="small">Username: @${escapeHtml(data.username)}</span>` : ''}
      </div>
      <div class="d-flex gap-2 flex-wrap">
        <button class="btn btn-primary" onclick="sendTelegramTestMessage()">
          <i class="bi bi-send me-1"></i>Send Test Message
        </button>
        <button class="btn btn-outline-danger" onclick="disconnectTelegram()">
          <i class="bi bi-plug me-1"></i>Disconnect Telegram
        </button>
      </div>`;
  }

  function formMarkup(chatId = '') {
    return `
      <label for="telegramChatId" class="form-label fw-semibold">Telegram Chat ID</label>
      <input id="telegramChatId" type="text" inputmode="numeric" autocomplete="off"
             class="form-control form-control-lg" value="${escapeHtml(chatId)}"
             placeholder="e.g. 8505912770">
      <div class="form-text mb-3">Enter the numeric Chat ID exactly as Telegram provides it.</div>
      <button class="btn btn-primary" onclick="connectTelegramManually()">
        <i class="bi bi-telegram me-1"></i>Save Telegram Chat ID
      </button>
      <div id="telegramConnectResult" class="mt-3"></div>`;
  }

  async function refreshTelegramStatus() {
    const status = document.getElementById('telegramConnectionStatus');
    const action = document.getElementById('telegramActionArea');
    if (!status || !action) return;

    status.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Checking Telegram connection…';
    action.innerHTML = '';

    try {
      const data = await telegramApi('/api/telegram/status');
      if (data.connected) {
        status.innerHTML = connectedMarkup(data);
        action.innerHTML = '';
      } else {
        status.innerHTML = `
          <div class="alert alert-secondary mb-3">
            <strong>Telegram not connected</strong><br>
            <span class="small">Connect using the Chat ID returned by the bot's <code>/id</code> command.</span>
          </div>`;
        action.innerHTML = formMarkup(data.chatId || '');
      }
    } catch (error) {
      status.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
      action.innerHTML = '';
    }
  }

  async function connectTelegramManually() {
    const input = document.getElementById('telegramChatId');
    const result = document.getElementById('telegramConnectResult');
    const chatId = String(input?.value || '').trim();

    if (!/^-?\d+$/.test(chatId)) {
      if (result) result.innerHTML = '<div class="alert alert-danger">Enter a valid numeric Telegram Chat ID.</div>';
      return;
    }

    if (result) result.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Verifying Chat ID with Telegram…';

    try {
      await telegramApi('/api/telegram/connect', {
        method: 'POST',
        body: JSON.stringify({ chatId })
      });
      if (typeof toast === 'function') toast('Telegram connected successfully.', 'success');
      await refreshTelegramStatus();
      if (isAdminOrSuperAdmin()) await refreshTeamOverdue();
    } catch (error) {
      if (result) result.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message)}</div>`;
    }
  }

  async function sendTelegramTestMessage() {
    try {
      await telegramApi('/api/telegram/test', { method: 'POST', body: '{}' });
      if (typeof toast === 'function') toast('Telegram test message sent.', 'success');
    } catch (error) {
      if (typeof toast === 'function') toast(error.message, 'danger');
      else alert(error.message);
    }
  }

  async function disconnectTelegram() {
    if (!confirm('Disconnect Telegram notifications from your CRM account?')) return;
    try {
      await telegramApi('/api/telegram/disconnect', { method: 'POST', body: '{}' });
      if (typeof toast === 'function') toast('Telegram disconnected.', 'success');
      await refreshTelegramStatus();
      if (isAdminOrSuperAdmin()) await refreshTeamOverdue();
    } catch (error) {
      if (typeof toast === 'function') toast(error.message, 'danger');
    }
  }

  function teamOverdueShell() {
    const section = document.getElementById('telegramTeamOverdueSection');
    if (!section) return null;

    section.innerHTML = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <div>
          <h5 class="mb-1"><i class="bi bi-people me-2"></i>Team Overdue Leads <span class="badge text-bg-dark ms-1">Admin</span></h5>
          <p class="text-muted small mb-0">Review overdue leads grouped by the assigned team member, then notify connected members.</p>
        </div>
        <div class="d-flex gap-2">
          <button id="telegramNotifyTeamBtn" class="btn btn-warning btn-sm" onclick="notifyTeamOverdue()">
            <i class="bi bi-bell me-1"></i>Notify Team
          </button>
          <button class="btn btn-outline-secondary btn-sm" onclick="refreshTeamOverdue(true)">
            <i class="bi bi-arrow-clockwise me-1"></i>Refresh
          </button>
        </div>
      </div>
      <div id="telegramTeamOverdueError"></div>
      <div id="telegramTeamOverdueSummary" class="mb-3"></div>
      <div id="telegramTeamOverdueTable"></div>
      <div class="mt-3">
        <div class="card border bg-light">
          <div class="card-header bg-transparent"><i class="bi bi-clock-history me-2"></i>Notification History</div>
          <div id="telegramTeamNotificationHistory" class="card-body p-0"></div>
        </div>
      </div>`;

    return section;
  }

  async function refreshTeamOverdue(forceRefresh = false) {
    if (!isAdminOrSuperAdmin()) return;
    const section = teamOverdueShell();
    if (!section) return;

    const errorBox = document.getElementById('telegramTeamOverdueError');
    const summary = document.getElementById('telegramTeamOverdueSummary');
    const table = document.getElementById('telegramTeamOverdueTable');

    table.innerHTML = '<div class="text-muted py-3"><span class="spinner-border spinner-border-sm me-2"></span>Loading overdue leads…</div>';
    errorBox.innerHTML = '';

    try {
      const data = await telegramApi(`/api/telegram/team-overdue${forceRefresh ? '?refresh=1' : ''}`);
      summary.innerHTML = `
        <div class="row g-2">
          <div class="col-6 col-md-3"><div class="border rounded-3 p-2"><div class="small text-muted">Total overdue</div><strong>${Number(data.total || 0)}</strong></div></div>
          <div class="col-6 col-md-3"><div class="border rounded-3 p-2"><div class="small text-muted">Connected members</div><strong>${Number(data.connectedGroups || 0)}</strong></div></div>
          <div class="col-6 col-md-3"><div class="border rounded-3 p-2"><div class="small text-muted">Unassigned</div><strong>${Number(data.unassigned || 0)}</strong></div></div>
          <div class="col-6 col-md-3"><div class="border rounded-3 p-2"><div class="small text-muted">Updated</div><strong>${formatDateTime(data.generatedAt)}</strong></div></div>
        </div>`;

      if (!Array.isArray(data.groups) || !data.groups.length) {
        table.innerHTML = '<div class="alert alert-success mb-0">No overdue leads found.</div>';
      } else {
        table.innerHTML = renderOverdueGroups(data.groups);
      }

      await refreshTeamNotificationHistory();
    } catch (error) {
      errorBox.innerHTML = `<div class="alert alert-danger">${escapeHtml(error.message)}</div>`;
      table.innerHTML = '';
      summary.innerHTML = '';
    }
  }

  function renderOverdueGroups(groups) {
    return groups.map(group => {
      const badge = group.connected
        ? '<span class="badge text-bg-success">Telegram connected</span>'
        : '<span class="badge text-bg-secondary">Telegram not connected</span>';

      const rows = (group.leads || []).map((lead, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${escapeHtml(lead.fullName || '—')}</td>
          <td>${escapeHtml(lead.phone || '—')}</td>
          <td>${escapeHtml(lead.service || '—')}</td>
          <td>${escapeHtml(lead.status || '—')}</td>
          <td>${escapeHtml(formatDateTime(lead.dueAt))}</td>
        </tr>`).join('');

      return `
        <div class="card border mb-3">
          <div class="card-header bg-transparent d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div><strong>${escapeHtml(group.memberName || 'Unknown member')}</strong> <span class="badge text-bg-warning ms-1">${Number(group.count || 0)}</span></div>
            ${badge}
          </div>
          <div class="table-responsive">
            <table class="table table-sm table-hover mb-0">
              <thead><tr><th>#</th><th>Customer</th><th>Phone</th><th>Service</th><th>Status</th><th>Due</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6" class="text-center text-muted">No overdue leads.</td></tr>'}</tbody>
            </table>
          </div>
        </div>`;
    }).join('');
  }

  async function notifyTeamOverdue() {
    if (!isAdminOrSuperAdmin()) return;

    const button = document.getElementById('telegramNotifyTeamBtn');
    if (button) {
      button.disabled = true;
      button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sending…';
    }

    try {
      const data = await telegramApi('/api/telegram/notify-team-overdue', {
        method: 'POST',
        body: '{}'
      });

      const message = data.sent
        ? `Sent ${Number(data.sentLeadCount || 0)} overdue leads to ${Number(data.sentCount || 0)} team members.`
        : (data.message || 'Nothing was sent.');

      if (typeof toast === 'function') toast(message, data.sent ? 'success' : 'warning');
      await refreshTeamOverdue(true);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message, 'danger');
      else alert(error.message);
    } finally {
      if (button) {
        button.disabled = false;
        button.innerHTML = '<i class="bi bi-bell me-1"></i>Notify Team';
      }
    }
  }

  async function refreshTeamNotificationHistory() {
    const wrap = document.getElementById('telegramTeamNotificationHistory');
    if (!wrap || !isAdminOrSuperAdmin()) return;

    try {
      const data = await telegramApi('/api/telegram/team-notification-history?limit=20');
      const history = Array.isArray(data.history) ? data.history : [];

      if (!history.length) {
        wrap.innerHTML = '<div class="p-3 text-muted">No team notification history yet.</div>';
        return;
      }

      const rows = history.map((item, index) => {
        const recipients = Array.isArray(item.recipients) ? item.recipients : [];
        const sentTo = recipients.length
          ? recipients.map(r => `${escapeHtml(r.memberName || r.memberId)} (${Number(r.leadCount || 0)})`).join('<br>')
          : '—';
        const sentCount = Number(item.sentLeadCount || 0);
        const status = Number(item.failedCount || 0) > 0
          ? '<span class="badge text-bg-warning">Partial</span>'
          : (sentCount ? '<span class="badge text-bg-success">Sent</span>' : '<span class="badge text-bg-secondary">No send</span>');

        return `
          <tr>
            <td>${index + 1}</td>
            <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
            <td>${escapeHtml(item.sentByName || item.sentBy || '—')}</td>
            <td>${sentTo}</td>
            <td>${sentCount}</td>
            <td>${status}</td>
          </tr>`;
      }).join('');

      wrap.innerHTML = `
        <div class="table-responsive">
          <table class="table table-sm table-hover mb-0 align-middle">
            <thead><tr><th>Sl No</th><th>Date</th><th>Sent By</th><th>Sent To</th><th>Number Sent</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    } catch (error) {
      wrap.innerHTML = `<div class="p-3 text-danger">${escapeHtml(error.message)}</div>`;
    }
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(typeof value === 'number' ? value : value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  window.renderTelegramView = renderTelegramView;
  window.loadTelegramView = renderTelegramView;
  window.connectTelegramManually = connectTelegramManually;
  window.sendTelegramTestMessage = sendTelegramTestMessage;
  window.disconnectTelegram = disconnectTelegram;
  window.refreshTelegramStatus = refreshTelegramStatus;
  window.refreshTeamOverdue = refreshTeamOverdue;
  window.notifyTeamOverdue = notifyTeamOverdue;
  window.refreshTeamNotificationHistory = refreshTeamNotificationHistory;
})();
