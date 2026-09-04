// ============================================================
// SCREENSHOT PROTECTION
// ============================================================
// Best-effort browser-side detection for:
//   - Print Screen / PrtSc
//   - Windows + Shift + S / Snipping Tool shortcut
//   - Common browser screenshot shortcut: Ctrl/Cmd + Shift + S
//
// A normal web page cannot receive a guaranteed OS-level screenshot
// event from every browser/OS. When a supported shortcut is observed,
// this module asks the authenticated server to activate Maintenance Mode.
// The server performs the authoritative state change and broadcasts the
// alert to the whole active CRM team via Firestore + Telegram.
// ============================================================
(function () {
  'use strict';

  const API_BASE = String(window.TELEGRAM_API_BASE_URL || '').replace(/\/$/, '');
  const TRIGGER_COOLDOWN_MS = 10000;
  let lastTriggerAt = 0;
  let currentUser = null;
  let notificationUnsubscribe = null;
  let notificationsReady = false;

  function getApiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function getFirebaseToken() {
    const user = window.auth?.currentUser || currentUser;
    if (!user) throw new Error('No authenticated CRM session.');
    return user.getIdToken();
  }

  function isPrivilegedUser() {
    const role = String(window.CURRENT_USER?.role || currentUser?.role || '')
      .trim().toLowerCase().replace(/[-\s]+/g, '_');
    return role === 'admin' || role === 'superadmin' || role === 'super_admin';
  }

  async function triggerScreenshotProtection(source) {
    if (!currentUser || isPrivilegedUser()) return;

    const now = Date.now();
    if (now - lastTriggerAt < TRIGGER_COOLDOWN_MS) return;
    lastTriggerAt = now;

    try {
      const token = await getFirebaseToken();
      const response = await fetch(getApiUrl('/api/security/screenshot-detected'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ source: source || 'screenshot-shortcut' })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Screenshot protection request failed (${response.status})`);
      }
    } catch (error) {
      console.error('Screenshot protection error:', error);
      // Do not block CRM interaction if the protection endpoint is temporarily unavailable.
    }
  }

  function handleKeydown(event) {
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    const hasMeta = event.metaKey || event.ctrlKey;

    // Windows Print Screen / PrtSc.
    if (key === 'printscreen' || code === 'printscreen') {
      triggerScreenshotProtection('Print Screen / PrtSc');
      return;
    }

    // Windows + Shift + S / Snipping Tool.
    // Browser key events expose the Windows key as metaKey in Chromium/Edge.
    if (event.shiftKey && key === 's' && event.metaKey) {
      triggerScreenshotProtection('Windows + Shift + S / Snipping Tool');
      return;
    }

    // Common browser screenshot shortcut. This is necessarily best-effort:
    // some browsers use this combination for other commands.
    if (event.shiftKey && key === 's' && hasMeta) {
      triggerScreenshotProtection('Browser screenshot shortcut');
    }
  }

  function subscribeScreenshotNotifications() {
    if (!window.notificationsRef || !currentUser?.uid) return;
    if (notificationUnsubscribe) notificationUnsubscribe();

    notificationsReady = false;
    notificationUnsubscribe = window.notificationsRef
      .where('userId', '==', currentUser.uid)
      .where('type', '==', 'screenshot-security')
      .limit(20)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added' || !notificationsReady) return;
          const data = change.doc.data() || {};
          const title = data.title || 'CRM Security Alert';
          const message = String(data.message || '');
          if (typeof toast === 'function') toast(message, 'danger');
          if (typeof browserNotify === 'function') browserNotify(title, message);
        });
        notificationsReady = true;
      }, error => console.error('Screenshot notification listener error:', error));
  }

  function init() {
    document.addEventListener('keydown', handleKeydown, { capture: true });

    if (window.auth?.onAuthStateChanged) {
      window.auth.onAuthStateChanged(user => {
        currentUser = user || null;
        if (!user) {
          if (notificationUnsubscribe) notificationUnsubscribe();
          notificationUnsubscribe = null;
          return;
        }
        subscribeScreenshotNotifications();
      });
    }

    document.addEventListener('fbReady', () => {
      if (window.auth?.currentUser) {
        currentUser = window.auth.currentUser;
        subscribeScreenshotNotifications();
      }
    });
  }

  window.triggerScreenshotProtection = triggerScreenshotProtection;
  init();
})();
