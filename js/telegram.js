// ============================================================
// TELEGRAM.JS — Manual Telegram Chat ID connection + CRM tools UI
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

  function managementMarkup() {
    return `
      <div class="mt-4 pt-4 border-top" id="telegramManagementArea">
        <div class="d-flex align-items-start justify-content-between gap-3 mb-3">
          <div>
            <h5 class="mb-1"><i class="bi bi-people me-2"></i>Team Overdue Leads</h5>
            <p class="text-muted mb-0 small">Review overdue leads grouped by the assigned team member, then notify connected members.</p>
          </div>
          <span class="badge text-bg-dark">Admin</span>
        </div>

        <div id="telegramOverdueSummary" class="mb-3">
          <div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Checking overdue leads…</div>
        </div>

        <div id="telegramOverdueGroups" class="mb-3"></div>

        <div class="d-flex gap-2 flex-wrap mb-4">
          <button id="telegramNotifyTeamButton" class="btn btn-warning" onclick="notifyTelegramTeamOverdue()" disabled>
            <i class="bi bi-bell me-1"></i>Notify Team
          </button>
          <button class="btn btn-outline-secondary" onclick="loadTelegramTeamOverdue()">
            <i class="bi bi-arrow-clockwise me-1"></i>Refresh
          </button>
        </div>

        <div class="border rounded-3 overflow-hidden">
          <div class="p-3 bg-light border-bottom">
            <strong><i class="bi bi-clock-history me-2"></i>Notification History</strong>
          </div>
          <div id="telegramNotificationHistory" class="table-responsive">
            <div class="p-3 text-muted small">Loading history…</div>
          </div>
        </div>
      </div>`;
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
        action.innerHTML = isAdminRole(data.role) ? managementMarkup() : '';

        if (isAdminRole(data.role)) {
          await Promise.allSettled([
            loadTelegramTeamOverdue(),
            loadTelegramNotificationHistory()
          ]);
        }
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
    } catch (error) {
      if (typeof toast === 'function') toast(error.message, 'danger');
    }
  }

  async function loadTelegramTeamOverdue() {
    const summary = document.getElementById('telegramOverdueSummary');
    const groupsWrap = document.getElementById('telegramOverdueGroups');
    const button = document.getElementById('telegramNotifyTeamButton');
    if (!summary || !groupsWrap) return;

    summary.innerHTML = '<div class="text-muted small"><span class="spinner-border spinner-border-sm me-2"></span>Checking overdue leads…</div>';
    groupsWrap.innerHTML = '';
    if (button) button.disabled = true;

    try {
      const data = await telegramApi('/api/telegram/team-overdue');

      const connectedGroups = Number(data.connectedGroups || 0);
      const total = Number(data.total || 0);
      const unassigned = Number(data.unassigned || 0);

      summary.innerHTML = `
        <div class="row g-2">
          <div class="col-6 col-md-3">
            <div class="border rounded-3 p-3 bg-light h-100">
              <div class="text-muted small">Overdue Leads</div>
              <div class="fs-4 fw-bold">${total}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="border rounded-3 p-3 bg-light h-100">
              <div class="text-muted small">Team Members</div>
              <div class="fs-4 fw-bold">${data.groups?.length || 0}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="border rounded-3 p-3 bg-light h-100">
              <div class="text-muted small">Telegram Ready</div>
              <div class="fs-4 fw-bold">${connectedGroups}</div>
            </div>
          </div>
          <div class="col-6 col-md-3">
            <div class="border rounded-3 p-3 bg-light h-100">
              <div class="text-muted small">Unassigned</div>
              <div class="fs-4 fw-bold">${unassigned}</div>
            </div>
          </div>
        </div>`;

      if (!data.groups?.length) {
        groupsWrap.innerHTML = '<div class="alert alert-success mb-0">No overdue leads currently require team attention.</div>';
      } else {
        groupsWrap.innerHTML = data.groups.map(group => `
          <div class="border rounded-3 mb-2 overflow-hidden">
            <div class="d-flex align-items-center justify-content-between gap-2 p-3 bg-light">
              <div>
                <strong>${escapeHtml(group.memberName)}</strong>
                <span class="badge ${group.connected ? 'text-bg-success' : 'text-bg-secondary'} ms-2">${group.connected ? 'Telegram connected' : 'Telegram not connected'}</span>
              </div>
              <span class="badge text-bg-warning">${group.count} overdue</span>
            </div>
            <div class="table-responsive">
              <table class="table table-sm mb-0 align-middle">
                <thead>
                  <tr>
                    <th>Lead</th>
                    <th>Customer</th>
                    <th>Phone</th>
                    <th>Service</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${group.leads.map(lead => `
                    <tr>
                      <td>${escapeHtml(lead.slNo)}</td>
                      <td>${escapeHtml(lead.fullName)}</td>
                      <td>${escapeHtml(lead.phone)}</td>
                      <td>${escapeHtml(lead.service)}</td>
                      <td>${escapeHtml(lead.status)}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>
          </div>`).join('');
      }

      if (button) {
        button.disabled = !(total > 0 && connectedGroups > 0);
      }
    } catch (error) {
      summary.innerHTML = `<div class="alert alert-danger mb-0">${escapeHtml(error.message)}</div>`;
      if (button) button.disabled = true;
    }
  }

  async function notifyTelegramTeamOverdue() {
    const button = document.getElementById('telegramNotifyTeamButton');
    if (!button) return;

    if (!confirm('Send the current overdue lead list to each connected assigned team member?')) return;

    const original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sending…';

    try {
      const data = await telegramApi('/api/telegram/notify-team-overdue', {
        method: 'POST',
        body: '{}'
      });

      if (typeof toast === 'function') {
        toast(
          data.sent
            ? `Overdue notification sent to ${data.sentCount} team member(s).`
            : data.message || 'No notifications were sent.',
          data.sent ? 'success' : 'warning'
        );
      }

      await Promise.allSettled([
        loadTelegramTeamOverdue(),
        loadTelegramNotificationHistory()
      ]);
    } catch (error) {
      if (typeof toast === 'function') toast(error.message, 'danger');
      else alert(error.message);
    } finally {
      button.innerHTML = original;
      button.disabled = false;
      await loadTelegramTeamOverdue().catch(() => {});
    }
  }

  async function loadTelegramNotificationHistory() {
    const wrap = document.getElementById('telegramNotificationHistory');
    if (!wrap) return;

    try {
      const data = await telegramApi('/api/telegram/team-notification-history?limit=10');
      const rows = Array.isArray(data.history) ? data.history : [];

      if (!rows.length) {
        wrap.innerHTML = '<div class="p-3 text-muted small">No team notification history yet.</div>';
        return;
      }

      wrap.innerHTML = `
        <table class="table table-sm table-hover mb-0 align-middle">
          <thead>
            <tr>
              <th>Date</th>
              <th>Sent By</th>
              <th>Members</th>
              <th>Leads</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(item => {
              const failed = Number(item.failedCount || 0);
              const sent = Number(item.sentCount || 0);
              const status = failed && sent ? 'Partial' : failed ? 'Failed' : 'Sent';
              const badge = failed && sent ? 'text-bg-warning' : failed ? 'text-bg-danger' : 'text-bg-success';
              return `
                <tr>
                  <td>${escapeHtml(formatDateTime(item.createdAt))}</td>
                  <td>${escapeHtml(item.sentByName || '—')}</td>
                  <td>${sent}</td>
                  <td>${Number(item.sentLeadCount || 0)}</td>
                  <td><span class="badge ${badge}">${status}</span></td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>`;
    } catch (error) {
      wrap.innerHTML = `<div class="p-3 text-danger small">${escapeHtml(error.message)}</div>`;
    }
  }

  function isAdminRole(role) {
    const normalized = String(role || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
    return normalized === 'admin' || normalized === 'super_admin' || normalized === 'superadmin';
  }

  function formatDateTime(value) {
    if (!value) return '—';
    const date = new Date(Number(value));
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
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
  window.loadTelegramTeamOverdue = loadTelegramTeamOverdue;
  window.notifyTelegramTeamOverdue = notifyTelegramTeamOverdue;
  window.loadTelegramNotificationHistory = loadTelegramNotificationHistory;
})();
