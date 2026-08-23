// ============================================================
// TELEGRAM.JS — Manual Telegram Chat ID connection UI
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
})();
