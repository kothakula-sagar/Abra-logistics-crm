// ============================================================
// LEAVE.JS — Employee Leave Management
// Super Admin: approve/reject leave requests
// Admin + Member: apply for leave, view own leaves
// ============================================================

const LEAVE_TYPES = [
  "Full Day",
  "Half Day Morning",
  "Half Day Afternoon",
  "Multiple Days",
  "Work From Home",
  "Emergency Leave",
  "Sick Leave"
];

const LEAVE_STATUS = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled"
};

let ALL_LEAVES = [];       // cached for the leave view
let ALL_USERS_LIST = [];   // for the member dropdown

// ── Subscribe to leaves (real-time) ──────────────────────────
function loadLeaveView() {
  const wrap = document.getElementById("view-leave");
  if (!wrap) return;

  let query = leavesRef.orderBy("date", "desc");
  if (CURRENT_USER.role === "member") {
    query = leavesRef
      .where("memberId", "==", CURRENT_USER.uid)
      .orderBy("date", "desc");
  }

  query.onSnapshot(snap => {
    ALL_LEAVES = [];
    snap.forEach(d => ALL_LEAVES.push({ id: d.id, ...d.data() }));
    renderLeaveView();
  }, err => console.error("Leave snapshot error:", err));
}

// ── Render Leave page ─────────────────────────────────────────
async function renderLeaveView() {
  const wrap = document.getElementById("view-leave");
  if (!wrap) return;

  const isSA = CURRENT_USER.role === "superadmin";
  const isAdmin = CURRENT_USER.role === "admin";
  const isMember = CURRENT_USER.role === "member";

  // Pre-fetch users for all roles (needed for member names)
  if (ALL_USERS_LIST.length === 0) {
    const snap = await usersRef.where("active", "==", true).get();
    ALL_USERS_LIST = [];
    snap.forEach(d => ALL_USERS_LIST.push({ id: d.id, ...d.data() }));
  }

  // Super Admin sees pending leave requests for approval
  // Admin + Member see their own leave application interface
  if (isSA) {
    renderSuperAdminLeaveView();
  } else {
    renderEmployeeLeaveView();
  }
}

// ── Super Admin View: Approval Interface ──────────────────────
async function renderSuperAdminLeaveView() {
  const wrap = document.getElementById("view-leave");
  if (!wrap) return;

  const pendingLeaves = ALL_LEAVES.filter(l => l.status === LEAVE_STATUS.PENDING);
  const approvedLeaves = ALL_LEAVES.filter(l => l.status === LEAVE_STATUS.APPROVED);
  const rejectedLeaves = ALL_LEAVES.filter(l => l.status === LEAVE_STATUS.REJECTED);

  wrap.innerHTML = `
  <div class="mb-4">
    <h1 class="page-title"><i class="bi bi-calendar2-check me-2"></i>Leave Management</h1>
    <p class="page-subtitle">Review and approve leave requests from your team.</p>
  </div>

  <ul class="nav nav-tabs mb-3" id="leaveTabs">
    <li class="nav-item">
      <button class="nav-link active" id="leaveTabPending" onclick="switchLeaveTab('pending')">
        <i class="bi bi-clock-history me-1"></i>Pending Requests 
        ${pendingLeaves.length > 0 ? `<span class="badge bg-warning text-dark ms-1">${pendingLeaves.length}</span>` : ''}
      </button>
    </li>
    <li class="nav-item">
      <button class="nav-link" id="leaveTabApproved" onclick="switchLeaveTab('approved')">
        <i class="bi bi-check-circle me-1"></i>Approved
      </button>
    </li>
    <li class="nav-item">
      <button class="nav-link" id="leaveTabRejected" onclick="switchLeaveTab('rejected')">
        <i class="bi bi-x-circle me-1"></i>Rejected
      </button>
    </li>
    <li class="nav-item">
      <button class="nav-link" id="leaveTabAll" onclick="switchLeaveTab('all')">
        <i class="bi bi-list-ul me-1"></i>All Leaves
      </button>
    </li>
  </ul>

  <!-- Pending Requests Panel -->
  <div id="leavePanelPending">
    ${pendingLeaves.length === 0 ? 
      `<div class="alert alert-success"><i class="bi bi-check-circle me-2"></i>No pending leave requests.</div>` :
      _renderLeaveTable(pendingLeaves, true)}
  </div>

  <!-- Approved Leaves Panel -->
  <div id="leavePanelApproved" class="d-none">
    ${approvedLeaves.length === 0 ?
      `<div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>No approved leaves.</div>` :
      _renderLeaveTable(approvedLeaves, false)}
  </div>

  <!-- Rejected Leaves Panel -->
  <div id="leavePanelRejected" class="d-none">
    ${rejectedLeaves.length === 0 ?
      `<div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>No rejected leaves.</div>` :
      _renderLeaveTable(rejectedLeaves, false)}
  </div>

  <!-- All Leaves Panel -->
  <div id="leavePanelAll" class="d-none">
    ${ALL_LEAVES.length === 0 ?
      `<div class="alert alert-info"><i class="bi bi-info-circle me-2"></i>No leave records.</div>` :
      _renderLeaveTable(ALL_LEAVES, false)}
  </div>`;
}

// ── Employee View: Application Interface ──────────────────────
async function renderEmployeeLeaveView() {
  const wrap = document.getElementById("view-leave");
  if (!wrap) return;

  const myLeaves = ALL_LEAVES.filter(l => l.memberId === CURRENT_USER.uid);
  const pendingLeaves = myLeaves.filter(l => l.status === LEAVE_STATUS.PENDING);
  const approvedLeaves = myLeaves.filter(l => l.status === LEAVE_STATUS.APPROVED);

  const memberOpts = ALL_USERS_LIST
    .filter(u => u.role === "member" || u.id === CURRENT_USER.uid)
    .map(u => `<option value="${u.id}">${escapeHtml(u.name || u.email)}</option>`)
    .join("");

  wrap.innerHTML = `
  <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
    <div>
      <h1 class="page-title"><i class="bi bi-calendar2-check me-2"></i>Leave Management</h1>
      <p class="page-subtitle">Apply for leave and track your requests.</p>
    </div>
    <button class="btn btn-brand" data-bs-toggle="modal" data-bs-target="#applyLeaveModal">
      <i class="bi bi-plus-lg me-1"></i>Apply for Leave
    </button>
  </div>

  <!-- Stats Cards -->
  <div class="row g-3 mb-4">
    <div class="col-6 col-md-3">
      <div class="crm-settings-card">
        <div class="crm-settings-card-body text-center">
          <div style="font-size:2rem;color:var(--amber)"><i class="bi bi-clock-history"></i></div>
          <div style="font-size:1.5rem;font-weight:600;color:var(--amber)">${pendingLeaves.length}</div>
          <div class="small text-muted">Pending</div>
        </div>
      </div>
    </div>
    <div class="col-6 col-md-3">
      <div class="crm-settings-card">
        <div class="crm-settings-card-body text-center">
          <div style="font-size:2rem;color:#1E7A34"><i class="bi bi-check-circle"></i></div>
          <div style="font-size:1.5rem;font-weight:600;color:#1E7A34">${approvedLeaves.length}</div>
          <div class="small text-muted">Approved</div>
        </div>
      </div>
    </div>
    <div class="col-6 col-md-3">
      <div class="crm-settings-card">
        <div class="crm-settings-card-body text-center">
          <div style="font-size:2rem;color:#B23434"><i class="bi bi-x-circle"></i></div>
          <div style="font-size:1.5rem;font-weight:600;color:#B23434">${myLeaves.filter(l => l.status === LEAVE_STATUS.REJECTED).length}</div>
          <div class="small text-muted">Rejected</div>
        </div>
      </div>
    </div>
    <div class="col-6 col-md-3">
      <div class="crm-settings-card">
        <div class="crm-settings-card-body text-center">
          <div style="font-size:2rem;color:var(--steel)"><i class="bi bi-list-ul"></i></div>
          <div style="font-size:1.5rem;font-weight:600;color:var(--steel)">${myLeaves.length}</div>
          <div class="small text-muted">Total</div>
        </div>
      </div>
    </div>
  </div>

  <!-- My Leave Requests -->
  <div class="table-card">
    <div class="table-card-header">
      <i class="bi bi-calendar2-week me-2"></i>My Leave Requests
    </div>
    <div class="table-responsive">
      <table class="table align-middle table-hover mb-0">
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Reviewed By</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          ${myLeaves.length === 0
            ? `<tr><td colspan="6" class="text-center py-4 text-muted">No leave requests yet.</td></tr>`
            : myLeaves.map(l => `
          <tr>
            <td>${_formatLeaveDate(l)}</td>
            <td><span class="badge bg-secondary">${escapeHtml(l.leaveType || "—")}</span></td>
            <td>${escapeHtml(l.reason || "—")}</td>
            <td>
              <span class="leave-status-badge leave-${(l.status||"pending").toLowerCase()}">
                ${l.status || "Pending"}
              </span>
            </td>
            <td>${escapeHtml(l.approvedByName || "—")}</td>
            <td class="text-nowrap">
              ${l.status === LEAVE_STATUS.PENDING ? `
              <button class="btn btn-sm btn-outline-danger" onclick="cancelLeave('${l.id}')">
                <i class="bi bi-x-lg"></i> Cancel
              </button>` : "—"}
            </td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <!-- Apply Leave Modal -->
  <div class="modal fade" id="applyLeaveModal" tabindex="-1">
    <div class="modal-dialog">
      <div class="modal-content">
        <form id="applyLeaveForm" onsubmit="submitLeave(event)">
          <div class="modal-header">
            <h5 class="modal-title">Apply for Leave</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label">Leave Type <span class="text-danger">*</span></label>
              <select id="leaveType" class="form-select" required onchange="onLeaveTypeChange()">
                <option value="">Select leave type…</option>
                ${LEAVE_TYPES.map(t => `<option value="${t}">${t}</option>`).join("")}
              </select>
            </div>
            <div class="mb-3" id="singleDateWrap">
              <label class="form-label">Leave Date <span class="text-danger">*</span></label>
              <input type="date" id="leaveDate" class="form-control" required
                     value="${new Date().toISOString().slice(0,10)}">
            </div>
            <div class="mb-3 d-none" id="multipleDatesWrap">
              <div class="row g-2">
                <div class="col-6">
                  <label class="form-label">From Date <span class="text-danger">*</span></label>
                  <input type="date" id="leaveDateFrom" class="form-control"
                         value="${new Date().toISOString().slice(0,10)}">
                </div>
                <div class="col-6">
                  <label class="form-label">To Date <span class="text-danger">*</span></label>
                  <input type="date" id="leaveDateTo" class="form-control"
                         value="${new Date().toISOString().slice(0,10)}">
                </div>
              </div>
              <div class="form-text">Both dates inclusive.</div>
            </div>
            <div class="mb-3">
              <label class="form-label">Reason</label>
              <textarea id="leaveReason" class="form-control" rows="3"
                        placeholder="Brief reason for leave request…"></textarea>
            </div>
            <div class="alert alert-info mb-0">
              <i class="bi bi-info-circle me-2"></i>
              Your leave request will be sent to Super Admin for approval.
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Cancel</button>
            <button type="submit" class="btn btn-brand">Submit Request</button>
          </div>
        </form>
      </div>
    </div>
  </div>`;
}

async function submitLeave(e) {
  if (!requirePermission("leave.apply")) return;

  e.preventDefault();

  const leaveType = document.getElementById("leaveType")?.value;
  const reason    = document.getElementById("leaveReason")?.value?.trim() || "";

  if (!leaveType) {
    toast("Please select a leave type.", "warning");
    return;
  }

  let leaveData = {
    memberId:   CURRENT_USER.uid,
    memberName: CURRENT_USER.name || CURRENT_USER.email,
    leaveType,
    reason,
    status:     LEAVE_STATUS.PENDING, // Always pending for approval
    approvedBy: null,
    approvedByName: null,
    createdAt:  firebase.firestore.Timestamp.now(),
    createdBy:  CURRENT_USER.uid
  };

  // Handle date(s) based on leave type
  if (leaveType === "Multiple Days") {
    const fromDate = document.getElementById("leaveDateFrom")?.value;
    const toDate   = document.getElementById("leaveDateTo")?.value;
    
    if (!fromDate || !toDate) {
      toast("Please select both From and To dates.", "warning");
      return;
    }
    
    if (fromDate > toDate) {
      toast("From Date cannot be after To Date.", "warning");
      return;
    }

    leaveData.dateFrom = fromDate;
    leaveData.dateTo   = toDate;
    leaveData.date     = fromDate; // For querying
  } else {
    const date = document.getElementById("leaveDate")?.value;
    if (!date) {
      toast("Please select a date.", "warning");
      return;
    }
    leaveData.date = date;
  }

  try {
    await leavesRef.add(leaveData);

    const modal = bootstrap.Modal.getInstance(document.getElementById("applyLeaveModal"));
    modal?.hide();
    
    toast("Leave request submitted for approval.", "success");
    
    // Notify Super Admin
    await notifySuperAdmin("New Leave Request", 
      `${CURRENT_USER.name || CURRENT_USER.email} has applied for ${leaveType}`);
  } catch (err) {
    console.error(err);
    toast("Failed to submit leave request.", "danger");
  }
}

async function approveLeave(id) {
  if (!requirePermission("leave.approve")) return;
  if (!confirm("Approve this leave request?")) return;

  try {
    await leavesRef.doc(id).update({
      status:         LEAVE_STATUS.APPROVED,
      approvedBy:     CURRENT_USER.uid,
      approvedByName: CURRENT_USER.name || CURRENT_USER.email,
      approvedAt:     firebase.firestore.Timestamp.now()
    });
    
    // Get leave details for notification
    const leaveDoc = await leavesRef.doc(id).get();
    const leave = leaveDoc.data();
    
    toast("Leave approved.", "success");
    
    // Notify employee
    if (leave && leave.memberId) {
      await notifyEmployee(leave.memberId, "Leave Approved", 
        `Your ${leave.leaveType} request has been approved`);
    }
  } catch (err) {
    console.error(err);
    toast("Failed to approve leave.", "danger");
  }
}

async function rejectLeave(id) {
  if (!requirePermission("leave.reject")) return;

  const rejectionReason = prompt("Enter reason for rejection (optional):");
  if (rejectionReason === null) return; // Cancelled

  try {
    await leavesRef.doc(id).update({ 
      status: LEAVE_STATUS.REJECTED,
      rejectionReason: rejectionReason || "",
      rejectedBy: CURRENT_USER.uid,
      rejectedByName: CURRENT_USER.name || CURRENT_USER.email,
      rejectedAt: firebase.firestore.Timestamp.now()
    });
    
    // Get leave details for notification
    const leaveDoc = await leavesRef.doc(id).get();
    const leave = leaveDoc.data();
    
    toast("Leave rejected.", "success");
    
    // Notify employee
    if (leave && leave.memberId) {
      await notifyEmployee(leave.memberId, "Leave Rejected", 
        `Your ${leave.leaveType} request has been rejected${rejectionReason ? ': ' + rejectionReason : ''}`);
    }
  } catch (err) {
    console.error(err);
    toast("Failed to reject leave.", "danger");
  }
}

async function cancelLeave(id) {
  if (!confirm("Cancel this leave request?")) return;

  try {
    await leavesRef.doc(id).update({
      status: LEAVE_STATUS.CANCELLED,
      cancelledAt: firebase.firestore.Timestamp.now()
    });
    toast("Leave request cancelled.", "success");
  } catch (err) {
    console.error(err);
    toast("Failed to cancel leave.", "danger");
  }
}

async function deleteLeave(id) {
  if (!confirm("Delete this leave record?")) return;
  await leavesRef.doc(id).delete();
  toast("Leave deleted.", "success");
}

// ── Holiday welcome popup ─────────────────────────────────────
async function checkHolidayWelcome() {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().slice(0, 10);

  const wasHoliday = (CRM_CONFIG.holidays || []).some(h => {
    if (!h.date) return false;
    return h.recurring ? h.date.slice(5) === yStr.slice(5) : h.date === yStr;
  });

  if (!wasHoliday) return;

  const seenKey = `holidayWelcome_${yStr}_${CURRENT_USER.uid}`;
  if (sessionStorage.getItem(seenKey)) return;
  sessionStorage.setItem(seenKey, "1");

  const holName = (CRM_CONFIG.holidays || []).find(h =>
    h.recurring ? h.date?.slice(5) === yStr.slice(5) : h.date === yStr
  )?.name || "holiday";

  const modal = bootstrap.Modal.getOrCreateInstance(
    document.getElementById("holidayWelcomeModal")
  );
  document.getElementById("holidayWelcomeBody").innerHTML = `
    <div class="text-center py-2">
      <div style="font-size:3rem">🎉</div>
      <p class="mt-3 mb-0" style="font-size:15px;line-height:1.7">
        Hey <strong>${escapeHtml(CURRENT_USER.name || CURRENT_USER.email)}</strong>,<br>
        I hope you enjoyed your holiday yesterday (<em>${escapeHtml(holName)}</em>).<br>
        Let's focus on today's leads and give our customers the best experience.<br>
        Some customers have been waiting for your call.<br><br>
        <strong>Have a productive day! 🚀</strong>
      </p>
    </div>`;
  modal.show();
}

// ── Helper Functions ──────────────────────────────────────────

function switchLeaveTab(tab) {
  // Update tab buttons
  document.querySelectorAll('#leaveTabs .nav-link').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`leaveTab${tab.charAt(0).toUpperCase() + tab.slice(1)}`)?.classList.add('active');
  
  // Update panels
  ['pending', 'approved', 'rejected', 'all'].forEach(t => {
    const panel = document.getElementById(`leavePanel${t.charAt(0).toUpperCase() + t.slice(1)}`);
    if (panel) {
      if (t === tab) {
        panel.classList.remove('d-none');
      } else {
        panel.classList.add('d-none');
      }
    }
  });
}

function onLeaveTypeChange() {
  const leaveType = document.getElementById("leaveType")?.value;
  const singleWrap = document.getElementById("singleDateWrap");
  const multiWrap = document.getElementById("multipleDatesWrap");
  
  if (leaveType === "Multiple Days") {
    singleWrap?.classList.add("d-none");
    multiWrap?.classList.remove("d-none");
    document.getElementById("leaveDate")?.removeAttribute("required");
    document.getElementById("leaveDateFrom")?.setAttribute("required", "required");
    document.getElementById("leaveDateTo")?.setAttribute("required", "required");
  } else {
    singleWrap?.classList.remove("d-none");
    multiWrap?.classList.add("d-none");
    document.getElementById("leaveDate")?.setAttribute("required", "required");
    document.getElementById("leaveDateFrom")?.removeAttribute("required");
    document.getElementById("leaveDateTo")?.removeAttribute("required");
  }
}

function _formatLeaveDate(leave) {
  if (leave.leaveType === "Multiple Days" && leave.dateFrom && leave.dateTo) {
    return `${leave.dateFrom} to ${leave.dateTo}`;
  }
  return leave.date || "—";
}

function _renderLeaveTable(leaves, showActions) {
  return `
  <div class="table-card">
    <div class="table-responsive">
      <table class="table align-middle table-hover mb-0">
        <thead>
          <tr>
            <th>Employee</th>
            <th>Date</th>
            <th>Type</th>
            <th>Reason</th>
            <th>Status</th>
            <th>Reviewed By</th>
            ${showActions ? "<th>Actions</th>" : ""}
          </tr>
        </thead>
        <tbody>
          ${leaves.map(l => `
          <tr>
            <td>${escapeHtml(l.memberName || "—")}</td>
            <td>${_formatLeaveDate(l)}</td>
            <td><span class="badge bg-secondary">${escapeHtml(l.leaveType || "—")}</span></td>
            <td>${escapeHtml(l.reason || "—")}</td>
            <td>
              <span class="leave-status-badge leave-${(l.status||"pending").toLowerCase()}">
                ${l.status || "Pending"}
              </span>
            </td>
            <td>${escapeHtml(l.approvedByName || l.rejectedByName || "—")}</td>
            ${showActions && l.status === LEAVE_STATUS.PENDING ? `
            <td class="text-nowrap">
              <button class="btn btn-sm btn-success" onclick="approveLeave('${l.id}')">
                <i class="bi bi-check-lg"></i> Approve
              </button>
              <button class="btn btn-sm btn-outline-danger" onclick="rejectLeave('${l.id}')">
                <i class="bi bi-x-lg"></i> Reject
              </button>
            </td>` : showActions ? '<td>—</td>' : ''}
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>`;
}

// ── Notification helpers ──────────────────────────────────────
async function notifySuperAdmin(title, message) {
  // Find Super Admin users
  const superAdmins = ALL_USERS_LIST.filter(u => u.role === "superadmin");
  
  // In a real implementation, you would send notifications via:
  // - Browser notifications (if implemented)
  // - Email (if configured)
  // - In-app notification system (if implemented)
  
  console.log(`Notify Super Admin: ${title} - ${message}`);
  
  // Optional: Use toast for current user if they are super admin
  if (CURRENT_USER.role === "superadmin") {
    toast(`${title}: ${message}`, "info");
  }
}

async function notifyEmployee(memberId, title, message) {
  // In a real implementation, you would send notifications via:
  // - Browser notifications (if implemented)
  // - Email (if configured)
  // - In-app notification system (if implemented)
  
  console.log(`Notify Employee ${memberId}: ${title} - ${message}`);
  
  // Optional: Show toast if the employee is the current user
  if (memberId === CURRENT_USER.uid) {
    toast(`${title}: ${message}`, "info");
  }
}
