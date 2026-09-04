// ============================================================
// SCREENSHOT PROTECTION / EMERGENCY MAINTENANCE MODE
// ============================================================
// Detects screenshot attempts that are observable from the browser:
//   - Print Screen / PrtSc (keydown + keyup + legacy keyCode 44)
//   - Windows + Shift + S / Snipping Tool (when Chromium exposes the
//     Windows/Meta modifier; also uses a guarded focus-loss heuristic)
//   - Common browser screenshot shortcut Ctrl/Cmd + Shift + S
//
// IMPORTANT: Windows can consume a screenshot shortcut before the page
// receives the key event. A website cannot receive a universal OS-level
// screenshot notification. The guarded blur heuristic improves detection
// for Snipping Tool without treating every normal blur as a screenshot.
// The server remains authoritative and activates Maintenance Mode for the
// entire CRM. Admin/Super Admin are bypassed server-side.
// ============================================================
(function () {
  'use strict';

  const API_BASE = String(window.TELEGRAM_API_BASE_URL || '').replace(/\/$/, '');
  const TRIGGER_COOLDOWN_MS = 10000;
  const SNIP_FOCUS_LOSS_WINDOW_MS = 1800;

  let lastTriggerAt = 0;
  let currentUser = null;
  let notificationUnsubscribe = null;
  let notificationsReady = false;
  let shiftPressedAt = 0;
  let sPressedAfterShift = false;
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

  function isWindowsLike() {
    return /Win/i.test(navigator.platform || navigator.userAgent || '');
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
        body: JSON.stringify({ source: source || 'screenshot-shortcut' }),
        credentials: 'same-origin',
        keepalive: true
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false) {
        throw new Error(data.error || `Screenshot protection request failed (${response.status})`);
      }

      // Do not wait for the Firestore settings listener before locking the
      // current browser. Other users will receive the Firestore update.
      if (data.activated && typeof window.setMaintenanceMode === 'function') {
        window.setMaintenanceMode(true);
      }
    } catch (error) {
      console.error('Screenshot protection error:', error);
      // The server remains authoritative. Do not break normal CRM usage if
      // the API is temporarily unavailable.
    }
  }

  function getMetaOrOSModifier(event) {
    return !!(
      event.metaKey ||
      event.getModifierState?.('Meta') ||
      event.getModifierState?.('OS')
    );
  }

  function getPrintScreenEvent(event) {
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '').toLowerCase();
    return key === 'printscreen' || code === 'printscreen' || event.keyCode === 44 || event.which === 44;
  }

  function handleKeydown(event) {
    const key = String(event.key || '').toLowerCase();
    const hasWindowsModifier = getMetaOrOSModifier(event);

    // Windows Print Screen / PrtSc.
    if (getPrintScreenEvent(event)) {
      triggerScreenshotProtection('Print Screen / PrtSc');
      return;
    }

    // Remember Shift briefly. Snipping Tool may consume the S/Windows key
    // before the browser gets the complete shortcut.
    if (event.shiftKey || key === 'shift') {
      if (!shiftPressedAt) shiftPressedAt = performance.now();
    }

    if (shiftPressedAt && key === 's') {
      sPressedAfterShift = true;
    }

    // Windows + Shift + S / Snipping Tool when Chromium exposes Meta/OS.
    if (event.shiftKey && key === 's' && hasWindowsModifier) {
      triggerScreenshotProtection('Windows + Shift + S / Snipping Tool');
      return;
    }

    // Browser screenshot shortcut: Ctrl/Cmd + Shift + S.
    if (event.shiftKey && key === 's' && event.ctrlKey) {
      triggerScreenshotProtection('Browser screenshot shortcut');
    }
  }

  function handleKeyup(event) {
    // Some Chromium/Edge builds expose Print Screen on keyup instead of
    // keydown, so listen to both.
    if (getPrintScreenEvent(event)) {
      triggerScreenshotProtection('Print Screen / PrtSc');
    }

    const key = String(event.key || '').toLowerCase();
    if (key === 'shift') {
      shiftPressedAt = 0;
      sPressedAfterShift = false;
    }
  }

  function handleBlur() {
    if (!isWindowsLike() || !currentUser || isPrivilegedUser()) return;
    if (!shiftPressedAt) return;

    const elapsed = performance.now() - shiftPressedAt;
    if (elapsed > SNIP_FOCUS_LOSS_WINDOW_MS) return;

    // Snipping Tool can take focus before the browser receives the S key.
    // A Shift-held focus loss in this very short window is treated as a
    // Snipping Tool attempt. This is deliberately narrow to reduce false
    // positives from ordinary tab switching.
    clearTimeout(blurTimer);
    blurTimer = setTimeout(() => {
      const age = performance.now() - shiftPressedAt;
      if (shiftPressedAt && age <= SNIP_FOCUS_LOSS_WINDOW_MS) {
        triggerScreenshotProtection(
          sPressedAfterShift
            ? 'Windows + Shift + S / Snipping Tool'
            : 'Windows + Shift + S / Snipping Tool (focus-loss detection)'
        );
      }
    }, 50);
  }

  function handleFocus() {
    clearTimeout(blurTimer);
  }

  function subscribeScreenshotNotifications() {
    if (!window.notificationsRef || !currentUser?.uid) return;
    if (notificationUnsubscribe) notificationUnsubscribe();

    notificationsReady = false;
    // Query only by userId so this does not require a composite Firestore
    // index for userId + type. Filter the security notification client-side.
    notificationUnsubscribe = window.notificationsRef
      .where('userId', '==', currentUser.uid)
      .limit(50)
      .onSnapshot(snapshot => {
        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added' || !notificationsReady) return;
          const data = change.doc.data() || {};
          if (data.type !== 'screenshot-security') return;
          const title = data.title || 'CRM Security Alert';
          const message = String(data.message || '');
          if (typeof toast === 'function') toast(message, 'danger');
          if (typeof browserNotify === 'function') browserNotify(title, message);
        });
        notificationsReady = true;
      }, error => console.error('Screenshot notification listener error:', error));
  }

  function init() {
    // Capture phase gives this handler the earliest practical chance to see
    // screenshot-related keyboard events before CRM controls process them.
    document.addEventListener('keydown', handleKeydown, { capture: true });
    document.addEventListener('keyup', handleKeyup, { capture: true });
    window.addEventListener('blur', handleBlur, { capture: true });
    window.addEventListener('focus', handleFocus, { capture: true });

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
