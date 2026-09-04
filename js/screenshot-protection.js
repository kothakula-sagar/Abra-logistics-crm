// ============================================================
// SCREENSHOT SECURITY / EMERGENCY MAINTENANCE MODE
// ============================================================
// Browser-side security layer. It detects screenshot shortcuts that
// Chromium exposes and immediately asks the server to enable global
// Maintenance Mode for non-admin users.
//
// NOTE: Windows may consume Win+PrtSc / Win+Shift+S before Chrome gets
// the event. A normal webpage cannot block an OS screenshot globally.
// The code below therefore uses every browser-observable signal without
// breaking ordinary CRM typing/navigation.
// ============================================================
(function () {
  'use strict';

  const API_BASE = String(window.TELEGRAM_API_BASE_URL || '').replace(/\/$/, '');
  const TRIGGER_COOLDOWN_MS = 10000;
  const SNIP_FOCUS_LOSS_WINDOW_MS = 5000;
  const MODIFIER_MEMORY_MS = 5000;

  let lastTriggerAt = 0;
  let currentUser = null;
  let notificationUnsubscribe = null;
  let notificationListenerReady = false;
  let shiftDownAt = 0;
  let metaDownAt = 0;
  let winShiftComboArmed = false;
  let blurTimer = null;

  function getApiUrl(path) {
    return `${API_BASE}${path}`;
  }

  async function getFirebaseToken() {
    const user = window.auth?.currentUser || currentUser;
    if (!user) throw new Error('No authenticated CRM session.');
    return user.getIdToken();
  }

  function normalizeRole(role) {
    return String(role || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  }

  function isPrivilegedUser() {
    const role = normalizeRole(window.CURRENT_USER?.role || currentUser?.role);
    return role === 'admin' || role === 'superadmin' || role === 'super_admin';
  }

  function isWindows() {
    return /Win/i.test(navigator.userAgent || navigator.platform || '');
  }

  function isPrintScreen(event) {
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    return key === 'printscreen' || code === 'printscreen' ||
      event.keyCode === 44 || event.which === 44;
  }

  function markModifierState(event) {
    const key = String(event.key || '').toLowerCase();
    const now = performance.now();
    if (key === 'shift' || event.shiftKey) shiftDownAt = now;
    if (key === 'meta' || event.getModifierState?.('Meta') || event.getModifierState?.('OS')) {
      metaDownAt = now;
    }
  }

  function hasRecentShift() {
    return shiftDownAt > 0 && performance.now() - shiftDownAt <= MODIFIER_MEMORY_MS;
  }

  function hasRecentWindowsKey() {
    return metaDownAt > 0 && performance.now() - metaDownAt <= MODIFIER_MEMORY_MS;
  }

  async function triggerScreenshotProtection(source) {
    if (!currentUser || isPrivilegedUser()) return;

    const now = Date.now();
    if (now - lastTriggerAt < TRIGGER_COOLDOWN_MS) return;
    lastTriggerAt = now;

    // Lock this browser immediately if the maintenance UI is available.
    // The server remains authoritative and updates Firestore for everyone.
    if (typeof window.setMaintenanceMode === 'function') {
      window.setMaintenanceMode(true);
    }

    try {
      const token = await getFirebaseToken();
      const response = await fetch(getApiUrl('/api/security/screenshot-detected'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ source: source || 'screenshot-shortcut' }),
        credentials: 'same-origin',
        keepalive: true
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Screenshot protection request failed (${response.status})`);
      }

      if (data.activated && typeof window.setMaintenanceMode === 'function') {
        window.setMaintenanceMode(true);
      }
    } catch (error) {
      console.error('Screenshot protection error:', error);
    }
  }

  function consumeScreenshotShortcut(event, source) {
    // Stop CRM controls from handling the shortcut too.
    try {
      event.preventDefault();
      event.stopImmediatePropagation();
    } catch (_) {}
    triggerScreenshotProtection(source);
  }

  function handleKeydown(event) {
    if (!currentUser || isPrivilegedUser()) return;

    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    markModifierState(event);

    // PrtSc / Print Screen in Chrome.
    if (isPrintScreen(event)) {
      consumeScreenshotShortcut(event, 'Print Screen / PrtSc');
      return;
    }

    // Track the Windows modifier even when Chrome does not expose it on S.
    if (key === 'meta' || code === 'metaleft' || code === 'metaright') {
      metaDownAt = performance.now();
      return;
    }

    if (key === 'shift' || code === 'shiftleft' || code === 'shiftright') {
      shiftDownAt = performance.now();
      return;
    }

    // Best case: Chromium exposes Win/Meta + Shift + S.
    if (key === 's' && event.shiftKey &&
        (event.metaKey || event.getModifierState?.('Meta') || event.getModifierState?.('OS'))) {
      consumeScreenshotShortcut(event, 'Windows + Shift + S / Snipping Tool');
      return;
    }

    // If the Windows key is exposed as a preceding keydown but is absent
    // from the S event, use the short-lived modifier memory.
    if (isWindows() && key === 's' && event.shiftKey && hasRecentWindowsKey()) {
      consumeScreenshotShortcut(event, 'Windows + Shift + S / Snipping Tool');
      return;
    }

    // Ctrl+Shift+S / browser screenshot shortcut.
    if (key === 's' && event.shiftKey && event.ctrlKey) {
      consumeScreenshotShortcut(event, 'Browser screenshot shortcut');
    }
  }

  function handleKeyup(event) {
    if (!currentUser || isPrivilegedUser()) return;

    if (isPrintScreen(event)) {
      consumeScreenshotShortcut(event, 'Print Screen / PrtSc');
      return;
    }

    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    if (key === 'shift' || code === 'shiftleft' || code === 'shiftright') shiftDownAt = 0;
    if (key === 'meta' || code === 'metaleft' || code === 'metaright') metaDownAt = 0;
  }

  function handleBlur() {
    if (!isWindows() || !currentUser || isPrivilegedUser()) return;

    // Snipping Tool can steal focus before Chrome receives S.
    // Only arm this when Shift + Windows was observed very recently.
    const shiftRecent = hasRecentShift();
    const windowsRecent = hasRecentWindowsKey();
    if (!shiftRecent && !windowsRecent) return;

    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      if (hasRecentShift() && (hasRecentWindowsKey() || winShiftComboArmed || document.hidden)) {
        triggerScreenshotProtection('Windows + Shift + S / Snipping Tool');
      }
    }, 40);
  }

  function handleVisibilityChange() {
    if (!document.hidden || !currentUser || isPrivilegedUser()) return;
    if (hasRecentShift() && (hasRecentWindowsKey() || winShiftComboArmed)) {
      triggerScreenshotProtection('Windows + Shift + S / Snipping Tool');
    }
  }

  function subscribeScreenshotNotifications() {
    if (!window.notificationsRef || !currentUser?.uid) return;
    if (notificationUnsubscribe) notificationUnsubscribe();

    notificationListenerReady = false;
    notificationUnsubscribe = window.notificationsRef
      .where('userId', '==', currentUser.uid)
      .limit(50)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added' || !notificationListenerReady) return;
          const data = change.doc.data() || {};
          if (data.type !== 'screenshot-security') return;
          const title = data.title || 'CRM Security Alert';
          const message = String(data.message || '');
          if (typeof toast === 'function') toast(message, 'danger');
          if (typeof browserNotify === 'function') browserNotify(title, message);
        });
        notificationListenerReady = true;
      }, error => console.error('Screenshot notification listener error:', error));
  }

  function bindAuth() {
    if (!window.auth?.onAuthStateChanged) return false;
    window.auth.onAuthStateChanged(user => {
      currentUser = user || null;
      if (!user) {
        if (notificationUnsubscribe) notificationUnsubscribe();
        notificationUnsubscribe = null;
        return;
      }
      subscribeScreenshotNotifications();
    });
    return true;
  }

  function init() {
    document.addEventListener('keydown', handleKeydown, { capture: true });
    document.addEventListener('keyup', handleKeyup, { capture: true });
    window.addEventListener('blur', handleBlur, { capture: true });
    document.addEventListener('visibilitychange', handleVisibilityChange, { capture: true });

    // Script is now loaded after Firebase/Auth, but keep a small fallback for
    // deployments that reorder scripts.
    if (!bindAuth()) {
      const retry = setInterval(() => {
        if (bindAuth()) clearInterval(retry);
      }, 100);
      setTimeout(() => clearInterval(retry), 10000);
    }
  }

  window.triggerScreenshotProtection = triggerScreenshotProtection;
  init();
})();
