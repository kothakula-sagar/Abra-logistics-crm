// ============================================================
// MAINTENANCE MODE
// Admin / Super Admin can keep using the CRM while all other
// authenticated roles are locked to the Dashboard message.
// The state is driven by crmSettings/general via onSnapshot(),
// so switching maintenance mode requires no page refresh.
// ============================================================
(function () {
  'use strict';

  const BYPASS_ROLES = ['admin', 'superadmin'];
  const MESSAGE = 'The CRM is under the maintance if there is any operation pending just contact to admin or superadmin';
  let active = false;
  let observerBound = false;

  function isBypassRole() {
    return BYPASS_ROLES.includes(window.CURRENT_USER?.role);
  }

  function isMaintenanceModeActive() {
    return active && !isBypassRole();
  }

  function ensureOverlay() {
    let overlay = document.getElementById('crmMaintenanceOverlay');
    if (overlay) return overlay;

    overlay = document.createElement('div');
    overlay.id = 'crmMaintenanceOverlay';
    overlay.setAttribute('role', 'alert');
    overlay.setAttribute('aria-live', 'polite');
    overlay.innerHTML = `
      <div class="crm-maintenance-card">
        <div class="crm-maintenance-image-wrap">
          <img src="assets/crm-maintenance.png" alt="CRM maintenance illustration" class="crm-maintenance-image">
        </div>
        <div class="crm-maintenance-content">
          <div class="crm-maintenance-icon"><i class="bi bi-tools"></i></div>
          <div class="crm-maintenance-eyebrow">CRM Maintenance Mode</div>
          <h1>CRM temporarily unavailable</h1>
          <p>${MESSAGE}</p>
          <div class="crm-maintenance-note"><i class="bi bi-shield-lock-fill me-2"></i>Only Admin and Super Admin can use the CRM while maintenance mode is ON.</div>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return overlay;
  }

  function closeOpenModals() {
    document.querySelectorAll('.modal.show').forEach(modalEl => {
      try { bootstrap.Modal.getInstance(modalEl)?.hide(); } catch (_) {}
    });
    document.querySelectorAll('.modal-backdrop').forEach(el => el.remove());
    document.body.classList.remove('modal-open');
    document.body.style.removeProperty('padding-right');
  }

  function updateUI() {
    const locked = isMaintenanceModeActive();
    document.body.classList.toggle('crm-maintenance-active', locked);

    if (locked) {
      closeOpenModals();
      const overlay = ensureOverlay();
      overlay.classList.add('is-visible');
      if (typeof window.buildNav === 'function') window.buildNav();
      if (typeof window.showView === 'function') window.showView('dashboard');
    } else {
      const overlay = document.getElementById('crmMaintenanceOverlay');
      overlay?.classList.remove('is-visible');
      if (typeof window.buildNav === 'function' && window.CURRENT_USER) window.buildNav();
    }
  }

  function setMaintenanceMode(enabled) {
    active = enabled === true;
    updateUI();
  }

  window.isMaintenanceModeActive = isMaintenanceModeActive;
  window.setMaintenanceMode = setMaintenanceMode;

  window.addEventListener('crmsettingsupdated', () => {
    const value = typeof window.getCRMSetting === 'function'
      ? window.getCRMSetting('maintenanceMode')
      : false;
    setMaintenanceMode(value === true);
  });

  // The settings snapshot is normally delivered after initApp(), but this
  // makes the listener resilient if settings.js dispatches before this file
  // has finished binding in a future script-order change.
  document.addEventListener('fbReady', () => {
    if (observerBound) return;
    observerBound = true;
  });
})();
