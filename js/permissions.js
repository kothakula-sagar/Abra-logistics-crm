// ============================================================
// PERMISSIONS.JS — role-based authorization layer for CRM UI
// ============================================================

(function() {
  'use strict';

  const PERMISSION_SETTINGS_COLLECTION = 'permissionSettings';
  const PERMISSION_SETTINGS_DOC = 'roles';

  const DEFAULT_PERMISSIONS = {
    admin: {
      dashboard: { view: true },
      leads: {
        view: true,
        viewAll: true,
        create: true,
        edit: true,
        changeStatus: true,
        assign: true,
        reassign: true,
        viewHistory: true,
        delete: false
      },
      followups: { view: false },
      urgent: { view: true },
      callAudit: { view: true, submit: false, approve: true, reject: true, recall: true, viewRecording: true },
      reports: { view: true, export: true },
      emailMarketing: { view: true },
      whatsappMarketing: { view: true },
      customers: { view: true },
      docs: { view: true },
      leave: { view: true, apply: true, cancelOwn: true, viewAll: true, approve: false, reject: false },
      hrTransfers: { view: true, request: false, approve: true, reject: true, assign: true, viewHistory: true },
      training: { view: true, takeCourse: true, takeQuiz: true, viewCertificate: true, manageCourses: false, manageCategories: false, viewTeamProgress: true },
      auditLog: { view: true },
      manageTeam: { view: false, createUser: false, changeRole: false, activateDeactivate: false },
      campaignManagement: { view: false, create: false, edit: false, activateDeactivate: false, archive: false },
      campaignReports: { view: true, export: true },
      crmSettings: { view: true, edit: false },
      aiSettings: { view: true, editOwn: true },
      permissionSettings: { view: false, edit: false }
    },
    member: {
      dashboard: { view: true },
      leads: {
        view: true,
        viewAll: false,
        create: false,
        edit: false,
        changeStatus: true,
        assign: false,
        reassign: false,
        viewHistory: true,
        delete: false
      },
      followups: { view: true },
      urgent: { view: true },
      callAudit: { view: false, submit: true, approve: false, reject: false, recall: false, viewRecording: false },
      reports: { view: false, export: false },
      emailMarketing: { view: true },
      whatsappMarketing: { view: true },
      customers: { view: true },
      docs: { view: true },
      leave: { view: true, apply: true, cancelOwn: true, viewAll: false, approve: false, reject: false },
      hrTransfers: { view: false, request: true, approve: false, reject: false, assign: false, viewHistory: false },
      training: { view: true, takeCourse: true, takeQuiz: true, viewCertificate: true, manageCourses: false, manageCategories: false, viewTeamProgress: false },
      auditLog: { view: false },
      manageTeam: { view: false, createUser: false, changeRole: false, activateDeactivate: false },
      campaignManagement: { view: false, create: false, edit: false, activateDeactivate: false, archive: false },
      campaignReports: { view: false, export: false },
      crmSettings: { view: true, edit: false },
      aiSettings: { view: true, editOwn: true },
      permissionSettings: { view: false, edit: false }
    },
    hr: {
      dashboard: { view: true },
      leads: {
        view: true,
        viewAll: false,
        create: false,
        edit: false,
        changeStatus: true,
        assign: false,
        reassign: false,
        viewHistory: true,
        delete: false
      },
      followups: { view: true },
      urgent: { view: true },
      callAudit: { view: false, submit: false, approve: false, reject: false, recall: false, viewRecording: false },
      reports: { view: false, export: false },
      emailMarketing: { view: true },
      whatsappMarketing: { view: true },
      customers: { view: true },
      docs: { view: true },
      leave: { view: true, apply: true, cancelOwn: true, viewAll: false, approve: false, reject: false },
      hrTransfers: { view: true, request: false, approve: false, reject: false, assign: false, viewHistory: true },
      training: { view: true, takeCourse: true, takeQuiz: true, viewCertificate: true, manageCourses: false, manageCategories: false, viewTeamProgress: false },
      auditLog: { view: false },
      manageTeam: { view: false, createUser: false, changeRole: false, activateDeactivate: false },
      campaignManagement: { view: false, create: false, edit: false, activateDeactivate: false, archive: false },
      campaignReports: { view: false, export: false },
      crmSettings: { view: true, edit: false },
      aiSettings: { view: true, editOwn: true },
      permissionSettings: { view: false, edit: false }
    }
  };

  let ROLE_PERMISSIONS = clone(DEFAULT_PERMISSIONS);
  let PERMISSION_UI_STATE = null;
  let PERMISSION_UI_DIRTY = false;
  let PERMISSIONS_SUBSCRIPTION = null;
  let PERMISSIONS_READY = false;

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function deepMerge(base, incoming) {
    const result = clone(base);
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) return result;

    Object.keys(incoming).forEach((key) => {
      const value = incoming[key];
      const existing = result[key];
      const shouldMerge = value && typeof value === 'object' && !Array.isArray(value) && existing && typeof existing === 'object' && !Array.isArray(existing);
      if (shouldMerge) {
        result[key] = deepMerge(existing, value);
      } else if (Object.prototype.hasOwnProperty.call(incoming, key)) {
        result[key] = clone(value);
      }
    });

    return result;
  }

  function normalizePermissions(raw) {
    const merged = deepMerge(clone(DEFAULT_PERMISSIONS), raw || {});
    return merged;
  }

  function getPermissionDocRef() {
    if (!window.db || typeof window.db.collection !== 'function') return null;
    return window.db.collection(PERMISSION_SETTINGS_COLLECTION).doc(PERMISSION_SETTINGS_DOC);
  }

  function getRolePermissions(role) {
    if (!role) return {};
    return ROLE_PERMISSIONS[role] || {};
  }

  function getPermissionValue(role, permissionPath) {
    if (!role || !permissionPath) return false;
    const parts = permissionPath.split('.');
    const rolePerms = getRolePermissions(role);
    let current = rolePerms;

    for (let i = 0; i < parts.length; i += 1) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return false;
      if (!Object.prototype.hasOwnProperty.call(current, parts[i])) return false;
      current = current[parts[i]];
    }

    return current === true;
  }

  function hasPermission(permissionPath) {
    const user = window.CURRENT_USER || null;
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    if (!permissionPath) return true;

    const role = user.role;
    const rolePerms = getRolePermissions(role);
    if (!rolePerms) return false;

    const parts = permissionPath.split('.');
    if (parts.length > 1) {
      const moduleName = parts[0];
      const modulePerms = rolePerms[moduleName] || {};
      if (modulePerms.view === false && parts[parts.length - 1] !== 'view') {
        return false;
      }
    }

    return getPermissionValue(role, permissionPath);
  }

  function requirePermission(permissionPath, options = {}) {
    const allowed = hasPermission(permissionPath);
    if (!allowed && options.showToast !== false) {
      if (typeof window.toast === 'function') {
        window.toast("You don't have permission to perform this action.", 'warning');
      }
    }
    return allowed;
  }

  function setPermissionStateFromLive() {
    if (!PERMISSION_UI_STATE) {
      PERMISSION_UI_STATE = clone(ROLE_PERMISSIONS);
    } else {
      PERMISSION_UI_STATE = deepMerge(clone(DEFAULT_PERMISSIONS), clone(PERMISSION_UI_STATE));
    }
  }

  function getPermissionUiState() {
    if (!PERMISSION_UI_STATE) {
      PERMISSION_UI_STATE = clone(ROLE_PERMISSIONS);
    }
    return clone(PERMISSION_UI_STATE);
  }

  function togglePermissionValue(permissionPath, roleName, checked) {
    const state = getPermissionUiState();
    const parts = permissionPath.split('.');
    let cursor = state[roleName];
    if (!cursor) cursor = {};

    parts.slice(0, -1).forEach((part) => {
      if (!cursor[part] || typeof cursor[part] !== 'object' || Array.isArray(cursor[part])) {
        cursor[part] = {};
      }
      cursor = cursor[part];
    });

    cursor[parts[parts.length - 1]] = checked;
    PERMISSION_UI_STATE = state;
    PERMISSION_UI_DIRTY = true;
    renderPermissionSettingsView();
  }

  function savePermissionSettings() {
    if (PERMISSION_UI_DIRTY === false) {
      return Promise.resolve(true);
    }

    const ref = getPermissionDocRef();
    if (!ref) {
      if (typeof window.toast === 'function') window.toast('Permission settings storage is unavailable.', 'danger');
      return Promise.resolve(false);
    }

    const state = getPermissionUiState();
    const payload = {
      admin: state.admin || {},
      member: state.member || {},
      hr: state.hr || {}
    };

    if (typeof window.toast === 'function') window.toast('Saving permission settings...', 'info');

    return ref.set(payload, { merge: true }).then(() => {
      PERMISSION_UI_DIRTY = false;
      if (typeof window.toast === 'function') window.toast('Permission settings saved.', 'success');
      return true;
    }).catch((err) => {
      console.error('Permission settings save failed:', err);
      if (typeof window.toast === 'function') window.toast('Failed to save permission settings.', 'danger');
      return false;
    });
  }

  function resetPermissionSettings() {
    if (!confirm('Reset permissions to the CRM default configuration?')) return Promise.resolve(false);
    const ref = getPermissionDocRef();
    if (!ref) return Promise.resolve(false);

    const payload = {
      admin: clone(DEFAULT_PERMISSIONS.admin),
      member: clone(DEFAULT_PERMISSIONS.member),
      hr: clone(DEFAULT_PERMISSIONS.hr)
    };

    return ref.set(payload, { merge: true }).then(() => {
      PERMISSION_UI_STATE = clone(DEFAULT_PERMISSIONS);
      PERMISSION_UI_DIRTY = false;
      renderPermissionSettingsView();
      if (typeof window.toast === 'function') window.toast('Permissions reset to defaults.', 'success');
      return true;
    }).catch((err) => {
      console.error('Permission reset failed:', err);
      if (typeof window.toast === 'function') window.toast('Failed to reset permission settings.', 'danger');
      return false;
    });
  }

  function getPermissionCardRows() {
    return [
      { title: 'Lead Management', key: 'leads', permissions: [
        ['leads.view', 'View Leads'],
        ['leads.viewAll', 'View All Leads'],
        ['leads.create', 'Create Leads'],
        ['leads.edit', 'Edit Leads'],
        ['leads.changeStatus', 'Change Status'],
        ['leads.assign', 'Assign Leads'],
        ['leads.reassign', 'Reassign Leads'],
        ['leads.viewHistory', 'View History'],
        ['leads.delete', 'Delete Leads']
      ] },
      { title: 'Follow-ups & Urgent Actions', key: 'followups', permissions: [
        ['followups.view', 'View Follow-ups'],
        ['urgent.view', 'View Urgent Actions']
      ] },
      { title: 'Call Audit', key: 'callAudit', permissions: [
        ['callAudit.view', 'View Call Audit'],
        ['callAudit.submit', 'Submit Audit'],
        ['callAudit.approve', 'Approve Audit'],
        ['callAudit.reject', 'Reject Audit'],
        ['callAudit.recall', 'Recall Audit']
      ] },
      { title: 'Reports', key: 'reports', permissions: [
        ['reports.view', 'View Reports'],
        ['reports.export', 'Export Reports']
      ] },
      { title: 'Email Marketing', key: 'emailMarketing', permissions: [
        ['emailMarketing.view', 'View Email Marketing']
      ] },
      { title: 'WhatsApp Marketing', key: 'whatsappMarketing', permissions: [
        ['whatsappMarketing.view', 'View WhatsApp Marketing']
      ] },
      { title: 'Leave Management', key: 'leave', permissions: [
        ['leave.view', 'View Leave'],
        ['leave.apply', 'Apply Leave'],
        ['leave.cancelOwn', 'Cancel Own Leave'],
        ['leave.approve', 'Approve Leave'],
        ['leave.reject', 'Reject Leave']
      ] },
      { title: 'HR Transfers', key: 'hrTransfers', permissions: [
        ['hrTransfers.view', 'View HR Transfers'],
        ['hrTransfers.request', 'Request Transfer'],
        ['hrTransfers.approve', 'Approve Transfer'],
        ['hrTransfers.reject', 'Reject Transfer'],
        ['hrTransfers.assign', 'Assign HR']
      ] },
      { title: 'Team & System', key: 'manageTeam', permissions: [
        ['manageTeam.view', 'View Manage Team'],
        ['manageTeam.createUser', 'Create Users'],
        ['manageTeam.changeRole', 'Change Roles'],
        ['manageTeam.activateDeactivate', 'Activate / Deactivate']
      ] },
      { title: 'Campaigns', key: 'campaignManagement', permissions: [
        ['campaignManagement.view', 'View Campaign Management'],
        ['campaignManagement.create', 'Create Campaigns'],
        ['campaignManagement.edit', 'Edit Campaigns'],
        ['campaignManagement.activateDeactivate', 'Activate / Deactivate'],
        ['campaignManagement.archive', 'Archive Campaigns']
      ] },
      { title: 'CRM Settings', key: 'crmSettings', permissions: [
        ['crmSettings.view', 'View CRM Settings'],
        ['crmSettings.edit', 'Edit CRM Settings']
      ] },
      { title: 'AI Settings', key: 'aiSettings', permissions: [
        ['aiSettings.view', 'View AI Settings'],
        ['aiSettings.editOwn', 'Edit Own AI Settings']
      ] }
    ];
  }

  function renderPermissionSettingsView() {
    const wrap = document.getElementById('view-permissions');
    if (!wrap) return;

    const currentUser = window.CURRENT_USER || null;
    if (!currentUser || currentUser.role !== 'superadmin') {
      wrap.innerHTML = '<div class="alert alert-danger">Only the Super Admin can manage permissions.</div>';
      return;
    }

    if (!PERMISSIONS_READY) {
      wrap.innerHTML = '<div class="text-center py-5 text-muted"><div class="spinner-border spinner-border-sm me-2"></div>Loading permission settings…</div>';
      return;
    }

    const state = getPermissionUiState();
    const cards = getPermissionCardRows().map((group) => {
      const rows = group.permissions.map(([path, label]) => {
        const renderCell = (role) => {
          const parts = path.split('.');
          let value = false;
          if (state && state[role]) {
            let cursor = state[role];
            parts.forEach((part) => {
              if (!cursor || typeof cursor !== 'object' || Array.isArray(cursor)) {
                cursor = null;
                return;
              }
              cursor = cursor[part];
            });
            value = cursor === true;
          }
          return `
            <td class="text-center">
              <input class="form-check-input" type="checkbox" ${value ? 'checked' : ''} onchange="togglePermissionValue('${path}', '${role}', this.checked)">
            </td>`;
        };

        return `
          <tr>
            <td>${label}</td>
            ${renderCell('admin')}
            ${renderCell('member')}
            ${renderCell('hr')}
          </tr>`;
      }).join('');

      return `
        <div class="crm-settings-card mb-4">
          <div class="crm-settings-card-header">${group.title}</div>
          <div class="crm-settings-card-body">
            <div class="table-responsive">
              <table class="table table-sm align-middle mb-0">
                <thead>
                  <tr>
                    <th>Permission</th>
                    <th>Admin</th>
                    <th>Sales Member</th>
                    <th>HR</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>
            </div>
          </div>
        </div>`;
    }).join('');

    wrap.innerHTML = `
      <div class="d-flex justify-content-between align-items-start flex-wrap gap-2 mb-4">
        <div>
          <h1 class="page-title"><i class="bi bi-shield-lock me-2"></i>Permission Settings</h1>
          <p class="page-subtitle">Manage module access and action permissions for Admin, Sales Member, and HR roles.</p>
        </div>
        <div class="d-flex gap-2">
          <button class="btn btn-outline-secondary" onclick="resetPermissionSettings()"><i class="bi bi-arrow-counterclockwise me-1"></i>Reset to Defaults</button>
          <button class="btn btn-brand" onclick="savePermissionSettings()" ${PERMISSION_UI_DIRTY ? '' : 'disabled'}><i class="bi bi-floppy-fill me-1"></i>Save Permissions</button>
        </div>
      </div>
      <div class="alert alert-info mb-4">
        <i class="bi bi-info-circle me-2"></i>Super Admin always retains unrestricted access and cannot be modified here.
      </div>
      ${PERMISSION_UI_DIRTY ? '<div class="alert alert-warning mb-4"><i class="bi bi-exclamation-triangle me-2"></i>You have unsaved permission changes.</div>' : ''}
      ${cards}
    `;
  }

  function subscribePermissionSettings() {
    const ref = getPermissionDocRef();
    if (!ref) {
      ROLE_PERMISSIONS = normalizePermissions();
      PERMISSION_UI_STATE = clone(ROLE_PERMISSIONS);
      PERMISSIONS_READY = true;
      renderPermissionSettingsView();
      return Promise.resolve(false);
    }

    if (PERMISSIONS_SUBSCRIPTION) {
      try { PERMISSIONS_SUBSCRIPTION(); } catch (_) {}
      PERMISSIONS_SUBSCRIPTION = null;
    }

    PERMISSIONS_SUBSCRIPTION = ref.onSnapshot((snap) => {
      const saved = snap.exists ? snap.data() : {};
      ROLE_PERMISSIONS = normalizePermissions(saved);
      PERMISSION_UI_STATE = clone(ROLE_PERMISSIONS);
      PERMISSIONS_READY = true;
      renderPermissionSettingsView();
      if (typeof window.rebuildPermissionAwareNav === 'function') {
        window.rebuildPermissionAwareNav();
      }
    }, (err) => {
      console.error('Permission settings snapshot failed:', err);
      ROLE_PERMISSIONS = normalizePermissions();
      PERMISSION_UI_STATE = clone(ROLE_PERMISSIONS);
      PERMISSIONS_READY = true;
      renderPermissionSettingsView();
    });

    return Promise.resolve(true);
  }

  window.DEFAULT_PERMISSIONS = DEFAULT_PERMISSIONS;
  window.ROLE_PERMISSIONS = ROLE_PERMISSIONS;
  window.hasPermission = hasPermission;
  window.requirePermission = requirePermission;
  window.subscribePermissionSettings = subscribePermissionSettings;
  window.renderPermissionSettingsView = renderPermissionSettingsView;
  window.refreshPermissionUI = renderPermissionSettingsView;
  window.togglePermissionValue = togglePermissionValue;
  window.savePermissionSettings = savePermissionSettings;
  window.resetPermissionSettings = resetPermissionSettings;
  window.getRolePermissions = getRolePermissions;
  window.getPermissionUiState = getPermissionUiState;
  window.PERMISSION_VIEW_PATHS = {
    dashboard: 'dashboard.view',
    leads: 'leads.view',
    myfollowups: 'followups.view',
    urgent: 'urgent.view',
    callaudit: 'callAudit.view',
    report: 'reports.view',
    emailmarketing: 'emailMarketing.view',
    whatsappmarketing: 'whatsappMarketing.view',
    customers: 'customers.view',
    docs: 'docs.view',
    leave: 'leave.view',
    hrtransfers: 'hrTransfers.view',
    training: 'training.view',
    auditlog: 'auditLog.view',
    users: 'manageTeam.view',
    campaigns: 'campaignManagement.view',
    campaignreports: 'campaignReports.view',
    crmsettings: 'crmSettings.view',
    aisettings: 'aiSettings.view',
    permissions: 'permissionSettings.view'
  };
})();