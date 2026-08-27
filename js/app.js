// ============================================================
// APP.JS — Shell: role-based nav, view switching, current user
// ============================================================

let CURRENT_USER = null; // { uid, email, name, role, active }
let CURRENT_VIEW = "leads";

const ROLE_LABELS = {
  superadmin: "Super Admin",
  admin: "Admin",
  member: "Sales Member",
  hr: "HR"
};

async function initApp() {
  CURRENT_USER = await requireAuth();
  window.CURRENT_USER = CURRENT_USER;

  document.getElementById("userName").textContent =
    CURRENT_USER.name || CURRENT_USER.email;
  document.getElementById("userRole").textContent =
    ROLE_LABELS[CURRENT_USER.role] || CURRENT_USER.role;

  if (typeof window.subscribePermissionSettings === "function") {
    await window.subscribePermissionSettings();
  }

  syncAddLeadButton();
  buildNav();
  showView("leads");
  requestNotificationPermission();

  // Subscribe to CRM Settings in real time (all roles)
  subscribeCRMSettings();

  // Subscribe to Campaigns + Campaign Fields (all roles need the cache;
  // only Super Admin sees the management UI)
  subscribeCampaigns();

  // Load personal AI settings
  await loadAISettings();

  // These two run a full unfiltered leads-collection scan, which Firestore
  // rules only allow for staff (superadmin/admin). Running them for every
  // role used to throw an uncaught permission-denied for Member/HR and
  // silently abort the rest of initApp() before loadLeadsView() ever ran.
  if (CURRENT_USER.role === "superadmin" || CURRENT_USER.role === "admin") {
    await migratePendingAssignmentLeadState();
    await assignPendingLeads();
  }
  await loadLeadsView();

  if (CURRENT_USER.role === "superadmin") {
    await loadUsersView();
  }

  // Subscribe to Call Audits (for users who can view it)
  if (CURRENT_USER.role === "superadmin" || hasPermission("callAudit.view")) {
    subscribeCallAudits();
  }

  // Start background watchers
  startReminderWatcher();
  startPendingAssignmentPoller();

  // Post-login checks
  await checkAISetupPrompt();
  await checkHolidayWelcome();       // show welcome popup if yesterday was a holiday
  await checkAndRunMigration();      // one-time migration: Not Picking Call → No Response
}

function syncAddLeadButton() {
  const wrap = document.getElementById("addLeadBtnWrap");
  if (!wrap) return;

  const canCreateLead = CURRENT_USER && (CURRENT_USER.role === "superadmin" || (typeof hasPermission === "function" && hasPermission("leads.create")));
  wrap.innerHTML = canCreateLead ? `
    <button class="btn btn-brand"
            data-bs-toggle="modal"
            data-bs-target="#addLeadModal">
      <i class="bi bi-plus-lg"></i> Add Lead
    </button>` : "";
}

function rebuildPermissionAwareNav() {
  buildNav();
  syncAddLeadButton();
  if (CURRENT_VIEW && !canAccessView(CURRENT_VIEW)) {
    const fallback = ["leads", "dashboard", "crmsettings"].find((candidate) => canAccessView(candidate));
    if (fallback) {
      showView(fallback);
    }
  }
}

function buildNav() {
  const nav     = document.getElementById("sideNav");
  const isSA    = CURRENT_USER.role === "superadmin";
  const canViewLeads = isSA || hasPermission("leads.view");
  const canViewDashboard = !!CURRENT_USER?.active;
  const canViewFollowups = isSA || hasPermission("followups.view");
  const canViewUrgent = isSA || hasPermission("urgent.view");
  const canViewCallAudit = isSA || hasPermission("callAudit.view");
  const canViewReport = isSA || hasPermission("reports.view");
  const canViewLeave = isSA || hasPermission("leave.view");
  const canViewHRTransfers = isSA || hasPermission("hrTransfers.view");
  const canViewAuditLog = isSA || hasPermission("auditLog.view");
  const canViewUsers = isSA || hasPermission("manageTeam.view");
  const canViewCampaigns = isSA || hasPermission("campaignManagement.view");
  const canViewCampaignReports = isSA || hasPermission("campaignReports.view");
  const canViewCRMSettings = isSA || hasPermission("crmSettings.view");
  const canViewAISettings = isSA || hasPermission("aiSettings.view");
  const canViewPermissions = isSA;
  const canViewEmailMarketing = !!CURRENT_USER?.active;
  const canViewWhatsAppMarketing = !!CURRENT_USER?.active;
  const canViewCustomers = !!CURRENT_USER?.active;
  const canViewDocs = !!CURRENT_USER?.active;

  let html = "";

  // Telegram is available to every authenticated CRM user.
  html += `
    <a href="#" class="nav-link nav-item-link" data-view="telegram">
      <i class="bi bi-telegram"></i> Telegram
    </a>`;

  if (canViewLeads) {
    html += `
    <a href="#" class="nav-link nav-item-link active" data-view="leads">
      <i class="bi bi-list-task"></i> Leads
    </a>`;
  }

  if (canViewFollowups || canViewUrgent) {
    if (canViewFollowups) {
      html += `
      <a href="#" class="nav-link nav-item-link" data-view="myfollowups">
        <i class="bi bi-clock-history"></i> Follow-ups
      </a>`;
    }
    if (canViewUrgent) {
      html += `
      <a href="#" class="nav-link nav-item-link" data-view="urgent">
        <i class="bi bi-exclamation-triangle"></i>
        ${CURRENT_USER.role === "member" || CURRENT_USER.role === "hr" ? "My Urgent Actions" : "Urgent Actions"}
        <span id="urgentBadge" class="urgent-nav-badge d-none"></span>
      </a>`;
    }
  }

  if (canViewDashboard || canViewCallAudit || canViewReport) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="dashboard">
      <i class="bi bi-speedometer2"></i> Dashboard
    </a>`;
    if (canViewCallAudit) {
      html += `
      <a href="#" class="nav-link nav-item-link" data-view="callaudit">
        <i class="bi bi-clipboard-check"></i> Call Audit
      </a>`;
    }
    if (canViewReport) {
      html += `
      <a href="#" class="nav-link nav-item-link" data-view="report">
        <i class="bi bi-file-earmark-text"></i> Daily Report
      </a>`;
    }
  }

  if (canViewLeave) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="leave">
      <i class="bi bi-calendar2-check"></i> Leave Management
    </a>`;
  }

  if (canViewHRTransfers) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="hrtransfers">
      <i class="bi bi-arrow-left-right"></i> HR Transfers
    </a>`;
  }

  if (canViewAuditLog) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="auditlog">
      <i class="bi bi-journal-text"></i> Audit Log
    </a>`;
  }

  if (canViewUsers) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="users">
      <i class="bi bi-people"></i> Manage Team
    </a>`;
  }

  if (canViewEmailMarketing) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="emailmarketing">
      <i class="bi bi-envelope-at"></i> Email Marketing
    </a>`;
  }

  if (canViewWhatsAppMarketing) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="whatsappmarketing">
      <i class="bi bi-whatsapp"></i> WhatsApp Marketing
    </a>`;
  }

  if (canViewCustomers) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="customers">
      <i class="bi bi-people"></i> Customers
    </a>`;
  }

  if (canViewDocs) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="docs">
      <i class="bi bi-book"></i> Docs
    </a>`;
  }

  if (canViewCampaigns) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="campaigns">
      <i class="bi bi-columns-gap"></i> Campaign Management
    </a>`;
  }

  if (canViewCampaignReports) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="campaignreports">
      <i class="bi bi-file-earmark-bar-graph"></i> Campaign Reports
    </a>`;
  }

  if (canViewCRMSettings) {
    html += `
    <a href="#" class="nav-link nav-item-link nav-crm-settings" data-view="crmsettings">
      <i class="bi bi-gear-fill"></i> CRM Settings
    </a>`;
  }

  if (canViewAISettings) {
    html += `
    <a href="#" class="nav-link nav-item-link nav-ai-settings" data-view="aisettings">
      <i class="bi bi-robot"></i> AI Settings
    </a>`;
  }

  if (canViewPermissions) {
    html += `
    <a href="#" class="nav-link nav-item-link" data-view="permissions">
      <i class="bi bi-shield-lock"></i> Permission Settings
    </a>`;
  }

  nav.innerHTML = html;

  document.querySelectorAll(".nav-item-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      document.querySelectorAll(".nav-item-link").forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
      showView(link.dataset.view);
    });
  });
}

function canAccessView(viewName) {
  if (!viewName) return false;
  if (CURRENT_USER && CURRENT_USER.role === "superadmin") return true;
  if (CURRENT_USER?.active && ["dashboard", "customers", "docs", "emailmarketing", "whatsappmarketing"].includes(viewName)) return true;
  const requiredPermission = window.PERMISSION_VIEW_PATHS && window.PERMISSION_VIEW_PATHS[viewName];
  return !requiredPermission || hasPermission(requiredPermission);
}

function showView(viewName) {
  CURRENT_VIEW = viewName || CURRENT_VIEW || "leads";

  // Respect role/permission settings before switching views.
  if (!canAccessView(viewName)) {
    if (typeof window.toast === "function") {
      window.toast("You don't have permission to access this module.", "warning");
    }
    const fallback = ["leads", "dashboard", "crmsettings"].find((candidate) => canAccessView(candidate));
    if (fallback && fallback !== viewName) {
      showView(fallback);
    }
    return;
  }

  // Hide all views first.
  document.querySelectorAll(".view-section").forEach((v) => v.classList.add("d-none"));

  // Show requested view.
  const el = document.getElementById("view-" + viewName);
  if (el) {
    el.classList.remove("d-none");
  } else {
    console.error("View element not found:", "view-" + viewName);
    return;
  }

  // Dynamic view renderers. Every module is guarded so one missing script
  // does not leave the entire CRM looking blank.
  try {
    if (viewName === "urgent") {
      const isMember = CURRENT_USER.role === "member" || CURRENT_USER.role === "hr";
      const titleEl = document.getElementById("urgentViewTitle");
      const subtitleEl = document.getElementById("urgentViewSubtitle");
      if (titleEl) titleEl.textContent = isMember ? "My Urgent Actions" : "Urgent Actions";
      if (subtitleEl) subtitleEl.textContent = isMember
        ? "Your leads that need immediate attention."
        : "All team leads that need immediate attention — sorted by most overdue first.";
      if (typeof renderUrgentActions === "function") renderUrgentActions();
    }

    if (viewName === "myfollowups") {
      if (typeof renderMyFollowUps === "function") renderMyFollowUps();
    }

    if (viewName === "report") {
      if (typeof initReportControls === "function") initReportControls();
      const campaignPanel = document.getElementById("campaignReportsPanel");
      if (campaignPanel && !campaignPanel.classList.contains("d-none") && typeof renderCampaignReportsPanel === "function") {
        renderCampaignReportsPanel();
      }
    }

    if (viewName === "aisettings") {
      if (typeof renderAISettingsView === "function") renderAISettingsView();
    }

    if (viewName === "crmsettings") {
      if (typeof renderCRMSettingsView === "function") {
        renderCRMSettingsView();
      } else {
        console.error("CRM Settings renderer is not loaded: settings.js");
      }
    }

    if (viewName === "permissions") {
      if (typeof renderPermissionSettingsView === "function") renderPermissionSettingsView();
    }

    if (viewName === "leave") {
      if (typeof loadLeaveView === "function") {
        loadLeaveView();
      } else if (typeof renderLeaveView === "function") {
        renderLeaveView();
      } else {
        console.error("Leave Management renderer is not loaded: leave.js");
      }
    }

    if (viewName === "hrtransfers") {
      if (typeof loadHRTransfersView === "function") {
        loadHRTransfersView();
      } else if (typeof renderHRTransferRequests === "function") {
        renderHRTransferRequests();
      } else {
        console.error("HR Transfers renderer is not loaded: hr-transfers.js");
      }
    }

    if (viewName === "dashboard") {
      if (window.SuperDashboard?.render) window.SuperDashboard.render();
    }

    if (viewName === "customers") {
      if (window.Customers?.init) window.Customers.init();
    }

    if (viewName === "docs") {
      // Static documentation view; no Firebase read required.
    }

    if (viewName === "auditlog") {
      if (typeof renderAuditLog === "function") renderAuditLog();
    }

    if (viewName === "callaudit") {
      if (typeof renderCallAuditDashboard === "function") {
        renderCallAuditDashboard();
      } else {
        console.error("Call Audit renderer is not loaded: call-audit.js");
      }
    }

    if (viewName === "campaigns") {
      if (typeof renderCampaignsView === "function") {
        renderCampaignsView();
      } else {
        console.error("Campaign Management renderer is not loaded: campaigns.js");
      }
    }

    if (viewName === "campaignreports") {
      if (typeof renderCampaignReportsPanel === "function") {
        renderCampaignReportsPanel();
      } else {
        console.error("Campaign Reports renderer is not loaded: campaign-reports.js");
      }
    }

    if (viewName === "telegram") {
      if (typeof renderTelegramView === "function") {
        renderTelegramView();
      } else if (typeof loadTelegramView === "function") {
        loadTelegramView();
      } else {
        console.error("Telegram renderer is not loaded: telegram.js");
      }
    }

    if (viewName === "emailmarketing") {
      if (window.MarketingChannels) window.MarketingChannels.openView("email");
    }

    if (viewName === "whatsappmarketing") {
      if (window.MarketingChannels) window.MarketingChannels.openView("whatsapp");
    }

    if (viewName === "users") {
      if (typeof loadUsersView === "function") loadUsersView();
    }
  } catch (error) {
    console.error("Failed to render view:", viewName, error);
    const target = el.querySelector("[id$='ContentArea'], [id$='Body'], .view-content") || el;
    if (target && !target.innerHTML.trim()) {
      target.innerHTML = `<div class="alert alert-danger m-3">Unable to load this section. Please refresh the page and check the browser console.</div>`;
    }
  }
}
window.rebuildPermissionAwareNav = rebuildPermissionAwareNav;
window.syncAddLeadButton = syncAddLeadButton;

// ── Dashboard Cards ───────────────────────────────────────────
async function renderDashboardCards() {
  const grid = document.getElementById("dashboardCardsGrid");
  const listWrap = document.getElementById("dashboardPendingList");
  if (!grid) return;

  // These stats (assignment queue, today's auto-assignments, leave approvals)
  // are staff-only operational metrics, and the underlying leadsRef queries
  // below are shaped for staff-only access per Firestore rules. Running this
  // for Member/HR used to throw an uncaught permission-denied (fire-and-forget,
  // uncaught) every time the leads list refreshed.
  if (!(CURRENT_USER.role === "superadmin" || CURRENT_USER.role === "admin")) {
    grid.innerHTML = "";
    return;
  }

  grid.innerHTML = `<div class="col-12 text-center text-muted py-3">
    <span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>`;

  const today = new Date().toISOString().slice(0, 10);

  // Parallel fetches
  const [pendingSnap, assignedSnap, queueSnap, leaveSnapSingle, leaveSnapMultiple] = await Promise.all([
    leadsRef.where("assignmentPending", "==", true).get(),
    leadsRef.where("assignedAt", ">=", firebase.firestore.Timestamp.fromDate(
      new Date(today + "T00:00:00"))).get(),
    assignmentQueueRef.get(),
    leavesRef.where("date", "==", today).where("status", "==", "Approved").get(),
    leavesRef.where("leaveType", "==", "Multiple Days").where("status", "==", "Approved").get()
  ]);

  // Calculate leave statistics
  const leavesToday = [];
  const halfDayToday = [];
  
  // Single day leaves
  leaveSnapSingle.forEach(d => {
    const leave = d.data();
    leavesToday.push(leave);
    if (leave.leaveType === "Half Day Morning" || leave.leaveType === "Half Day Afternoon") {
      halfDayToday.push(leave);
    }
  });
  
  // Multiple day leaves that include today
  leaveSnapMultiple.forEach(d => {
    const leave = d.data();
    if (leave.dateFrom && leave.dateTo) {
      if (today >= leave.dateFrom && today <= leave.dateTo) {
        leavesToday.push(leave);
      }
    }
  });

  const pendingCount  = pendingSnap.size;
  const assignedToday = assignedSnap.size;
  const onLeaveCount  = leavesToday.length;
  const halfDayCount  = halfDayToday.length;
  const queueCount    = queueSnap.size;

  // Calculate available members now
  const todayLeaves = leavesToday;
  let availableNow = 0;
  ACTIVE_MEMBERS.forEach(member => {
    if (isMemberAvailableNow(member.id, todayLeaves)) {
      availableNow++;
    }
  });

  const workingToday = ACTIVE_MEMBERS.length - (onLeaveCount - halfDayCount);

  // ✅ NEW: Calculate follow-up statistics
  const now = Date.now();
  let todayFollowups = 0;
  let dueNowFollowups = 0;
  let overdueFollowups = 0;
  let completedTodayFollowups = 0;
  
  ALL_LEADS.forEach(lead => {
    if (lead.hasPendingFollowUp && lead.followUp) {
      // Check if scheduled for today
      if (lead.followUp.scheduledDate === today && lead.followUp.status === "Pending") {
        todayFollowups++;
        
        // Check if due now or overdue
        const scheduledTime = new Date(`${lead.followUp.scheduledDate}T${lead.followUp.scheduledTime}`).getTime();
        if (scheduledTime <= now) {
          dueNowFollowups++;
          if (scheduledTime < now - 15 * 60000) { // overdue by more than 15 min
            overdueFollowups++;
          }
        }
      }
      
      // Check if completed today
      if (lead.followUp.status === "Completed" && lead.followUp.completedAt) {
        const completedDate = lead.followUp.completedAt.toDate().toISOString().slice(0, 10);
        if (completedDate === today) {
          completedTodayFollowups++;
        }
      }
    }
  });

  const cards = [
    { icon: "bi-people-fill",     label: "Working Today",      value: workingToday < 0 ? 0 : workingToday, color: "#1E7A34", tooltip: "Members not on full-day leave" },
    { icon: "bi-person-dash",     label: "On Leave Today",     value: onLeaveCount,    color: "#B23434", tooltip: "Full day + Half day leaves" },
    { icon: "bi-clock",           label: "Half Day Leave",     value: halfDayCount,    color: "#C05621", tooltip: "Morning/Afternoon half days" },
    { icon: "bi-person-check-fill", label: "Available Now",    value: availableNow,    color: "#1E7A34", tooltip: "Available for assignment right now" },
    { icon: "bi-hourglass-split", label: "Pending Assignment", value: pendingCount,    color: "var(--amber)", tooltip: "Waiting for assignment" },
    { icon: "bi-calendar2-x",     label: "In Assignment Queue",value: queueCount,      color: "var(--steel)", tooltip: "Queued for gradual dispatch" },
    // ✅ NEW: Follow-up KPI cards
    { icon: "bi-calendar-check",  label: "Today's Follow-ups", value: todayFollowups,  color: "#3E6D9C", tooltip: "Follow-ups scheduled for today" },
    { icon: "bi-alarm",           label: "Due Now",            value: dueNowFollowups, color: "#C05621", tooltip: "Follow-ups due right now" },
    { icon: "bi-exclamation-triangle", label: "Overdue",       value: overdueFollowups,color: "#B23434", tooltip: "Follow-ups overdue by 15+ min" },
    { icon: "bi-check-circle",    label: "Completed Today",    value: completedTodayFollowups, color: "#1E7A34", tooltip: "Follow-ups completed today" }
  ];

  grid.innerHTML = cards.map(c => `
    <div class="col-6 col-md-4 col-lg-2">
      <div class="dash-stat-card" title="${c.tooltip}">
        <div class="dash-stat-icon" style="color:${c.color}">
          <i class="bi ${c.icon}"></i>
        </div>
        <div class="dash-stat-value" style="color:${c.color}">${c.value}</div>
        <div class="dash-stat-label">${c.label}</div>
      </div>
    </div>`).join("");

  // Team Availability Details
  if (onLeaveCount > 0 || halfDayCount > 0) {
    const availabilityHtml = `
    <div class="crm-settings-card mb-4">
      <div class="crm-settings-card-header">
        <i class="bi bi-people me-2"></i>Team Availability Today
      </div>
      <div class="crm-settings-card-body">
        <div class="row g-3">
          ${leavesToday.map(leave => `
          <div class="col-12 col-md-6 col-lg-4">
            <div class="availability-card">
              <div class="d-flex align-items-center gap-2">
                <div class="availability-icon ${_getLeaveIconClass(leave.leaveType)}">
                  <i class="bi ${_getLeaveIcon(leave.leaveType)}"></i>
                </div>
                <div class="flex-grow-1">
                  <div class="fw-semibold">${escapeHtml(leave.memberName || "Unknown")}</div>
                  <div class="small text-muted">${leave.leaveType}</div>
                  ${leave.reason ? `<div class="small text-muted fst-italic">${escapeHtml(leave.reason)}</div>` : ''}
                </div>
              </div>
            </div>
          </div>`).join("")}
        </div>
      </div>
    </div>`;
    listWrap.innerHTML = availabilityHtml;
  }

  // Pending leads detail list
  if (pendingCount > 0) {
    const pendingLeads = [];
    pendingSnap.forEach(d => pendingLeads.push({ id: d.id, ...d.data() }));

    const pendingHtml = `
    <div class="crm-settings-card mb-4">
      <div class="crm-settings-card-header">
        <i class="bi bi-hourglass-split me-2"></i>Pending Assignment Leads
      </div>
      <div class="table-responsive">
        <table class="table align-middle table-hover mb-0" style="font-size:13.5px">
          <thead>
            <tr>
              <th>Sl.No</th><th>Name</th><th>Phone</th><th>Created</th><th>Reason</th>
            </tr>
          </thead>
          <tbody>
            ${pendingLeads.map(l => `
            <tr>
              <td>${l.slNo}</td>
              <td>${escapeHtml(l.fullName)}</td>
              <td>${escapeHtml(l.phoneNumber)}</td>
              <td>${l.createdAt ? formatDateTime(l.createdAt.toDate()) : "—"}</td>
              <td><span class="badge badge-pending-assignment">${escapeHtml(l.assignmentReason || "Pending")}</span></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
    
    if (onLeaveCount === 0 && halfDayCount === 0) {
      listWrap.innerHTML = pendingHtml;
    } else {
      listWrap.innerHTML += pendingHtml;
    }
  } else if (onLeaveCount === 0 && halfDayCount === 0) {
    listWrap.innerHTML = "";
  }

  // Module 2 — Campaign Analytics (appended, never replaces the cards above)
  if (typeof renderCampaignAnalyticsSection === "function") renderCampaignAnalyticsSection();
}

// Helper functions for leave display
function _getLeaveIcon(leaveType) {
  const icons = {
    "Full Day": "calendar-x",
    "Half Day Morning": "sunrise",
    "Half Day Afternoon": "sunset",
    "Multiple Days": "calendar-range",
    "Work From Home": "house",
    "Sick Leave": "thermometer",
    "Emergency Leave": "exclamation-triangle"
  };
  return icons[leaveType] || "calendar-x";
}

function _getLeaveIconClass(leaveType) {
  if (leaveType === "Work From Home") return "availability-icon-wfh";
  if (leaveType === "Half Day Morning" || leaveType === "Half Day Afternoon") return "availability-icon-half";
  return "availability-icon-leave";
}

// ── Audit Log ─────────────────────────────────────────────────
async function renderAuditLog() {
  const wrap = document.getElementById("auditLogBody");
  if (!wrap) return;

  wrap.innerHTML = `<div class="text-center text-muted py-4">
    <span class="spinner-border spinner-border-sm me-2"></span>Loading…</div>`;

  try {
    const snap = await auditLogRef.orderBy("timestamp", "desc").limit(200).get();
    if (snap.empty) {
      wrap.innerHTML = `<p class="text-muted">No audit entries yet.</p>`;
      return;
    }

    const rows = [];
    snap.forEach(d => rows.push({ id: d.id, ...d.data() }));

    wrap.innerHTML = `
    <div class="table-card">
      <div class="table-responsive">
        <table class="table align-middle table-hover mb-0" style="font-size:13px">
          <thead>
            <tr>
              <th>Date &amp; Time</th>
              <th>Lead #</th>
              <th>Action</th>
              <th>Reason</th>
              <th>Actor</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
            <tr>
              <td class="text-nowrap">${r.timestamp ? formatDateTime(r.timestamp.toDate()) : "—"}</td>
              <td>${r.slNo || "—"}</td>
              <td><span class="badge audit-badge-${_auditBadgeClass(r.action)}">${escapeHtml(r.action)}</span></td>
              <td>${escapeHtml(r.reason || "—")}</td>
              <td>${escapeHtml(r.actor || "System")}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  } catch (err) {
    console.error("Audit log load failed:", err);
    wrap.innerHTML = `<p class="text-danger">Failed to load audit log.</p>`;
  }
}

function _auditBadgeClass(action) {
  if (!action) return "info";
  const a = action.toLowerCase();
  if (a.includes("assigned immediately") || a.includes("office opening")) return "success";
  if (a.includes("pending"))   return "warning";
  if (a.includes("skipped"))   return "danger";
  if (a.includes("holiday"))   return "secondary";
  return "info";
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

function toast(message, type = "primary") {
  const container = document.getElementById("toastContainer");
  const id = "t" + Date.now();
  const html = `
    <div id="${id}" class="toast align-items-center text-bg-${type} border-0" role="alert">
      <div class="d-flex">
        <div class="toast-body">${message}</div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button>
      </div>
    </div>`;
  container.insertAdjacentHTML("beforeend", html);
  const toastEl = new bootstrap.Toast(document.getElementById(id), { delay: 8000 });
  toastEl.show();
}

function browserNotify(title, body) {
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, { body, icon: "" });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logoutBtn");
  if (logoutBtn) logoutBtn.addEventListener("click", logout);
  initApp();
});