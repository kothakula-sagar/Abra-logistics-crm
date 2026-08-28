// ============================================================
// LEADS.JS — Lead CRUD, round-robin assignment, status workflow,
// history logging, filters, urgent actions, follow-up reminders
// ============================================================

// ============================================================
// STATUS LIST
// ============================================================
// NOTE: "Pending Approval", "Re-Call Required", and "No Response" are SYSTEM-ONLY statuses.
// They are automatically assigned by the workflow and should NEVER be 
// manually selectable in the dropdown.
// - Pending Approval & Re-Call Required: Managed via callAuditStatus field
// - No Response: Assigned after max consecutive Not Picking Call attempts
// ============================================================

const STATUS_LIST = [
  "Not Open",
  "Busy",
  "Contacted",
  "Interested",
  "Call Back Later",
  "Not Picking Call",
  "Not Interested",
  "Job Seeker",
  "Driver",
  "Transporter"
];

// System-only statuses (never shown in dropdown, set automatically by workflow)
const SYSTEM_STATUSES = [
  "Pending Approval",   // Call audit workflow
  "Re-Call Required",   // Call audit workflow
  "No Response"         // Auto-assigned after max consecutive Not Picking Call attempts
];

// Statuses that indicate meaningful contact (reset Not Picking Call counter)
const MEANINGFUL_CONTACT_STATUSES = [
  "Contacted",
  "Busy",
  "Interested",
  "Call Back Later"
];

// Statuses that require mandatory call audit (Sales Members cannot set directly)
const AUDIT_REQUIRED_STATUSES = ["Not Interested"];

// ============================================================
// ONE-TIME MIGRATION: Not Picking Call → No Response
// ============================================================
// This function reviews leads with consecutive Not Picking Call history
// and migrates them to "No Response" if they meet the criteria.
// Should be run ONCE after deploying this feature.
// ============================================================

async function migrateNotPickingCallToNoResponse() {
  console.log("Starting one-time migration: Not Picking Call → No Response");
  
  const maxConsecutiveAttempts = getCRMSetting("maxConsecutiveNotPickingAttempts") || 3;
  console.log(`Using max consecutive attempts: ${maxConsecutiveAttempts}`);
  
  // Query all leads still in "Not Picking Call" status
  const snapshot = await leadsRef.where("status", "==", "Not Picking Call").get();
  
  if (snapshot.empty) {
    console.log("No leads found in 'Not Picking Call' status. Migration complete.");
    return { migrated: 0, skipped: 0 };
  }
  
  let migratedCount = 0;
  let skippedCount = 0;
  const batch = db.batch();
  let batchCount = 0;
  const MAX_BATCH_SIZE = 500;
  
  for (const doc of snapshot.docs) {
    const lead = doc.data();
    const history = lead.history || [];
    
    // Count consecutive "Not Picking Call" attempts at the END of history
    let consecutiveAttempts = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      const entry = history[i];
      if (entry.statusAtTime === "Not Picking Call") {
        consecutiveAttempts++;
      } else if (MEANINGFUL_CONTACT_STATUSES.includes(entry.statusAtTime)) {
        // Stop counting at meaningful contact
        break;
      }
    }
    
    // Migrate if meets criteria
    if (consecutiveAttempts >= maxConsecutiveAttempts) {
      const migrationEntry = {
        text: `Migration: Automatically moved to "No Response" after ${consecutiveAttempts} consecutive Not Picking Call attempts (max: ${maxConsecutiveAttempts} per CRM Settings). This status distinguishes no customer response from explicit "Not Interested".`,
        statusAtTime: "No Response",
        updatedBy: "system-migration",
        updatedByName: "System Migration",
        timestamp: new Date().toISOString(),
        isMigration: true
      };
      
      batch.update(doc.ref, {
        status: "No Response",
        consecutiveNotPickingAttempts: consecutiveAttempts,
        nextFollowUpAt: null, // Remove follow-up
        history: firebase.firestore.FieldValue.arrayUnion(migrationEntry)
      });
      
      migratedCount++;
      batchCount++;
      
      // Commit batch if reaching limit
      if (batchCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount} updates`);
        batchCount = 0;
      }
    } else {
      skippedCount++;
    }
  }
  
  // Commit remaining
  if (batchCount > 0) {
    await batch.commit();
    console.log(`Committed final batch of ${batchCount} updates`);
  }
  
  console.log(`Migration complete: ${migratedCount} migrated, ${skippedCount} skipped`);
  return { migrated: migratedCount, skipped: skippedCount };
}

// Call migration on page load (only if Super Admin and not run before)
async function checkAndRunMigration() {
  // Only Super Admin can trigger migration
  if (CURRENT_USER.role !== "superadmin") return;
  
  // Check if migration already run (using localStorage flag)
  const migrationKey = "noResponseMigrationCompleted_v1";
  if (localStorage.getItem(migrationKey)) {
    console.log("Migration already completed (flag found in localStorage)");
    return;
  }
  
  // Ask Super Admin for confirmation
  if (!confirm("One-time migration required: Review leads with consecutive 'Not Picking Call' attempts and move them to new 'No Response' status. This will improve your CRM analytics by distinguishing between 'no response' and 'not interested'. Run migration now?")) {
    console.log("Migration cancelled by user");
    return;
  }
  
  try {
    const result = await migrateNotPickingCallToNoResponse();
    toast(`Migration complete: ${result.migrated} leads moved to "No Response", ${result.skipped} leads skipped.`, "success");
    localStorage.setItem(migrationKey, new Date().toISOString());
  } catch (error) {
    console.error("Migration failed:", error);
    toast("Migration failed. Check console for details.", "danger");
  }
}

// Reminder delay in minutes per status — now read from CRM Settings at runtime.
// STATUS_REMINDER_MINUTES kept as a fallback for the very first render before
// Firestore settings load; actual values come from getCRMSetting().
const STATUS_REMINDER_MINUTES = {
  "Busy": 60,
  "Not Picking Call": 240
};

const STATUS_BADGE_CLASS = {
  "Not Open": "badge-not-open",
  "Busy": "badge-busy",
  "Not Picking Call": "badge-not-picking",
  "Interested": "badge-interested",
  "Not Interested": "badge-not-interested",
  "Job Seeker": "badge-job-seeker",
  "Driver": "badge-driver",
  "Transporter": "badge-transporter",
  "Pending Approval": "badge-pending-approval",
  "Re-Call Required": "badge-recall-required"
};

const UNCONTACTED_ALERT_MINUTES = 30; // fallback — overridden at runtime by getCRMSetting("leadRules.uncontactedAlertMinutes")

// ============================================================
// PAGINATION & DATA MANAGEMENT
// ============================================================

let ALL_LEADS = [];       // current page leads only (not full dataset)
let ACTIVE_MEMBERS = [];  // cached active sales member list for dropdowns
let ACTIVE_HR = [];       // cached active HR list for dropdowns
let toastedLeadIds = new Set(); // session-only, avoid repeat toast spam
let leadBadgeRefreshTimer = null;
let PENDING_MANUAL_SELECTIONS = new Set();

// Pagination state
const PAGINATION_STATE = {
  pageSize: parseInt(localStorage.getItem("leadsPageSize")) || 25,
  currentPage: 1,
  totalLeads: 0,
  totalPages: 0,
  firstVisible: null,
  lastVisible: null,
  hasNextPage: false,
  hasPrevPage: false,
  cursors: {}, // Store cursors for each page
  isLoading: false,
  currentFilters: {
    status: "",
    assignedTo: "",
    search: "",
    campaign: "",
    dateFrom: "",
    dateTo: ""
  }
};

// Cache for pagination
const PAGE_CACHE = new Map(); // Map<pageKey, {data, timestamp}>
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Detach function for current snapshot listener
let currentLeadsListener = null;

function isLeadNew(lead) {
  if (!lead?.createdAt) return false;

  const created = lead.createdAt.toDate
    ? lead.createdAt.toDate()
    : new Date(lead.createdAt);

  if (!(created instanceof Date) || Number.isNaN(created.getTime())) {
    return false;
  }

  const hours = (Date.now() - created.getTime()) / 3600000;
  return hours < 24;
}

function scheduleLeadBadgeRefresh() {
  if (leadBadgeRefreshTimer) {
    clearTimeout(leadBadgeRefreshTimer);
    leadBadgeRefreshTimer = null;
  }

  const upcomingExpiry = ALL_LEADS
    .filter((lead) => isLeadNew(lead))
    .map((lead) => {
      const created = lead.createdAt?.toDate
        ? lead.createdAt.toDate()
        : new Date(lead.createdAt);
      return created.getTime() + 24 * 60 * 60 * 1000;
    })
    .sort((a, b) => a - b)[0];

  if (!upcomingExpiry) return;

  const delay = Math.max(1000, upcomingExpiry - Date.now());
  leadBadgeRefreshTimer = setTimeout(() => {
    refreshLeadDependentViews();
  }, delay);
}

// ============================================================
// PAGINATION HELPERS
// ============================================================

/**
 * Generate cache key from current filters and page
 */
function getCacheKey(page, filters) {
  const filterStr = JSON.stringify(filters);
  return `page_${page}_${filterStr}_${PAGINATION_STATE.pageSize}`;
}

/**
 * Get cached page if available and fresh
 */
function getCachedPage(page, filters) {
  const key = getCacheKey(page, filters);
  const cached = PAGE_CACHE.get(key);
  
  if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION) {
    return cached.data;
  }
  
  // Clean expired cache
  if (cached) {
    PAGE_CACHE.delete(key);
  }
  
  return null;
}

/**
 * Cache page data
 */
function cachePage(page, filters, data) {
  const key = getCacheKey(page, filters);
  PAGE_CACHE.set(key, {
    data: data,
    timestamp: Date.now()
  });
  
  // Limit cache size (keep last 10 pages)
  if (PAGE_CACHE.size > 10) {
    const firstKey = PAGE_CACHE.keys().next().value;
    PAGE_CACHE.delete(firstKey);
  }
}

/**
 * Clear all cache (when filters change)
 */
function clearCache() {
  PAGE_CACHE.clear();
  PAGINATION_STATE.cursors = {};
}

/**
 * Debounce function for search
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// ---------------- LOAD / SUBSCRIBE ----------------
function refreshLeadDependentViews() {
  renderLeadsTable();
  updatePaginationUI();
  renderUrgentActions();
  renderMyFollowUps();
  checkReminders();
  scheduleLeadBadgeRefresh();

  if (typeof renderDashboardCards === "function") {
    renderDashboardCards();
  }

  if (typeof refreshCampaignAnalyticsIfVisible === "function") {
    refreshCampaignAnalyticsIfVisible();
  }

  if (typeof renderDailyReport === "function") {
    renderDailyReport();
  }

  if (typeof refreshNotifications === "function") {
    refreshNotifications();
  }
}

async function loadLeadsView() {
  // Team lists are only needed by staff. Members/HR already have their
  // lead scope enforced by Firestore and should not list every user profile.
  if (CURRENT_USER.role === 'admin' || CURRENT_USER.role === 'superadmin') {
    await refreshActiveMembers();
    await refreshActiveHR();
  }
  await loadUserTablePreferences(); // Load user preferences first
  buildLeadFilterUI();
  buildPaginationControls();
  
  // Load first page
  await loadLeadsPage(1);
}

/**
 * Load leads for specific page with a real-time Firestore listener.
 * The listener stays active until filters or pagination change.
 */
async function migratePendingAssignmentLeadState() {
  if (!leadsRef) return;

  const snapshot = await leadsRef.get();
  if (!snapshot || snapshot.empty) return;

  const batch = db.batch();
  let batchCount = 0;
  const MAX_BATCH_SIZE = 500;

  for (const doc of snapshot.docs) {
    const lead = doc.data();
    const isPendingAssignment = !!(
      lead.assignmentPending ||
      lead.assignedTo === "Pending" ||
      lead.assignedTo === null ||
      lead.assignedTo === "" ||
      lead.assignedMemberId === null ||
      lead.assignedMember === null
    );

    const state = typeof recalculateLeadState === "function" ? recalculateLeadState(lead) : lead;
    const corrected = {
      overdue: state.overdue || false,
      isOverdue: state.isOverdue || false,
      reminderSent: state.reminderSent || false,
      dueTime: state.dueTime || null,
      nextReminder: state.nextReminder || null
    };

    const needsUpdate = lead.overdue !== corrected.overdue || lead.isOverdue !== corrected.isOverdue || lead.reminderSent !== corrected.reminderSent || lead.dueTime !== corrected.dueTime || lead.nextReminder !== corrected.nextReminder;
    if (!needsUpdate) continue;

    batch.update(doc.ref, corrected);
    batchCount++;

    if (batchCount >= MAX_BATCH_SIZE) {
      await batch.commit();
      batchCount = 0;
    }
  }

  if (batchCount > 0) {
    await batch.commit();
  }
}

async function loadLeadsPage(page, direction = "next") {
  if (PAGINATION_STATE.isLoading && PAGINATION_STATE.currentPage === page) return;

  PAGINATION_STATE.isLoading = true;
  PAGINATION_STATE.currentPage = page;

  // Stop any existing listener before attaching a new one.
  if (currentLeadsListener) {
    currentLeadsListener();
    currentLeadsListener = null;
  }

  // Show loading state
  renderLoadingState();

  try {
    // Build Firestore query with filters
    let query = buildFirestoreQuery();

    // Apply pagination cursors
    if (page > 1 && direction === "next" && PAGINATION_STATE.lastVisible) {
      query = query.startAfter(PAGINATION_STATE.lastVisible);
    } else if (page > 1 && direction === "prev" && PAGINATION_STATE.firstVisible) {
      // For previous page, we need to query in reverse and flip results
      query = query.endBefore(PAGINATION_STATE.firstVisible).limitToLast(PAGINATION_STATE.pageSize);
    }

    // Add limit
    if (direction !== "prev") {
      query = query.limit(PAGINATION_STATE.pageSize);
    }

    currentLeadsListener = query.onSnapshot(async (snapshot) => {
      const docs = snapshot.docs || [];

      ALL_LEADS = docs.map((doc) => {
        const lead = { id: doc.id, ...doc.data() };
        return typeof recalculateLeadState === "function" ? recalculateLeadState(lead) : lead;
      });
      window.ALL_LEADS = ALL_LEADS;

      if (docs.length > 0) {
        PAGINATION_STATE.firstVisible = docs[0];
        PAGINATION_STATE.lastVisible = docs[docs.length - 1];

        PAGINATION_STATE.cursors[page] = {
          first: docs[0],
          last: docs[docs.length - 1]
        };
      } else {
        PAGINATION_STATE.firstVisible = null;
        PAGINATION_STATE.lastVisible = null;
      }

      PAGINATION_STATE.hasPrevPage = page > 1;

      const changedTypes = snapshot.docChanges().map((change) => change.type);
      if (PAGINATION_STATE.totalLeads === 0 || changedTypes.some((type) => type === "added" || type === "removed")) {
        await updateTotalCount();
      }

      PAGINATION_STATE.totalPages = Math.max(1, Math.ceil(PAGINATION_STATE.totalLeads / PAGINATION_STATE.pageSize));
      PAGINATION_STATE.hasNextPage = page < PAGINATION_STATE.totalPages;

      if (PAGINATION_STATE.currentPage === page) {
        refreshLeadDependentViews();
      }

      // Marketing consumes the lead page already loaded here. No second leads
      // query is made by the marketing module.
      if (window.MarketingChannels?.syncLoadedLeads) {
        window.MarketingChannels.syncLoadedLeads(ALL_LEADS).catch(err => console.error("Marketing loaded-lead sync failed:", err));
      }

      PAGINATION_STATE.isLoading = false;
    }, (error) => {
      console.error("Error listening to leads updates:", error);
      PAGINATION_STATE.isLoading = false;
      renderErrorState(error);
    });

  } catch (error) {
    console.error("Error loading leads page:", error);
    PAGINATION_STATE.isLoading = false;
    renderErrorState(error);
  }
}

/**
 * Build Firestore query with current filters
 */
function buildFirestoreQuery() {
  let query = leadsRef;
  
  // Role-based filtering
  if (CURRENT_USER.role === "member" || CURRENT_USER.role === "hr") {
    query = query.where("assignedTo", "==", CURRENT_USER.uid);
  }
  
  // Status filter
  if (PAGINATION_STATE.currentFilters.status) {
    query = query.where("status", "==", PAGINATION_STATE.currentFilters.status);
  }
  
  // Assigned To filter (Admin/Super Admin only)
  if (PAGINATION_STATE.currentFilters.assignedTo && CURRENT_USER.role !== "member") {
    query = query.where("assignedTo", "==", PAGINATION_STATE.currentFilters.assignedTo);
  }
  
  // Campaign filter
  if (PAGINATION_STATE.currentFilters.campaign) {
    query = query.where("campaignName", "==", PAGINATION_STATE.currentFilters.campaign);
  }
  
  // Date range filter
  if (PAGINATION_STATE.currentFilters.dateFrom) {
    const fromDate = firebase.firestore.Timestamp.fromDate(
      new Date(PAGINATION_STATE.currentFilters.dateFrom + "T00:00:00")
    );
    query = query.where("createdAt", ">=", fromDate);
  }
  
  if (PAGINATION_STATE.currentFilters.dateTo) {
    const toDate = firebase.firestore.Timestamp.fromDate(
      new Date(PAGINATION_STATE.currentFilters.dateTo + "T23:59:59")
    );
    query = query.where("createdAt", "<=", toDate);
  }
  
  // Always order by createdAt descending (newest first)
  // Note: Changed from slNo to createdAt for better index compatibility
  query = query.orderBy("createdAt", "desc");
  
  return query;
}

/**
 * Update total count (expensive operation, use sparingly)
 */
async function updateTotalCount() {
  try {
    let countQuery = leadsRef;
    
    // Apply same filters as main query
    if (CURRENT_USER.role === "member" || CURRENT_USER.role === "hr") {
      countQuery = countQuery.where("assignedTo", "==", CURRENT_USER.uid);
    }
    
    if (PAGINATION_STATE.currentFilters.status) {
      countQuery = countQuery.where("status", "==", PAGINATION_STATE.currentFilters.status);
    }
    
    if (PAGINATION_STATE.currentFilters.assignedTo && CURRENT_USER.role !== "member") {
      countQuery = countQuery.where("assignedTo", "==", PAGINATION_STATE.currentFilters.assignedTo);
    }
    
    if (PAGINATION_STATE.currentFilters.campaign) {
      countQuery = countQuery.where("campaignName", "==", PAGINATION_STATE.currentFilters.campaign);
    }
    
    if (PAGINATION_STATE.currentFilters.dateFrom) {
      const fromDate = firebase.firestore.Timestamp.fromDate(
        new Date(PAGINATION_STATE.currentFilters.dateFrom + "T00:00:00")
      );
      countQuery = countQuery.where("createdAt", ">=", fromDate);
    }
    
    if (PAGINATION_STATE.currentFilters.dateTo) {
      const toDate = firebase.firestore.Timestamp.fromDate(
        new Date(PAGINATION_STATE.currentFilters.dateTo + "T23:59:59")
      );
      countQuery = countQuery.where("createdAt", "<=", toDate);
    }
    
    // Get count
    const snapshot = await countQuery.get();
    PAGINATION_STATE.totalLeads = snapshot.size;
    
  } catch (error) {
    console.error("Error getting total count:", error);
    PAGINATION_STATE.totalLeads = 0;
  }
}

/**
 * Process cached page data
 */
function processCachedPage(cached) {
  ALL_LEADS = cached.leads;
  window.ALL_LEADS = ALL_LEADS; // Keep window reference updated
  PAGINATION_STATE.firstVisible = cached.firstVisible;
  PAGINATION_STATE.lastVisible = cached.lastVisible;
  PAGINATION_STATE.hasNextPage = cached.hasNextPage;
  PAGINATION_STATE.hasPrevPage = cached.hasPrevPage;
  
  renderLeadsTable();
  updatePaginationUI();
  checkReminders();
  
  PAGINATION_STATE.isLoading = false;
}

/**
 * Handle filter change
 */
async function onFilterChange() {
  // Clear cache when filters change
  clearCache();
  
  // Reset to page 1
  PAGINATION_STATE.currentPage = 1;
  PAGINATION_STATE.totalLeads = 0;
  
  // Load first page with new filters
  await loadLeadsPage(1);
}

/**
 * Debounced search handler
 */
const debouncedSearch = debounce(async (searchTerm) => {
  // For search, we need client-side filtering since Firestore doesn't support
  // full-text search. Load more results and filter client-side.
  PAGINATION_STATE.currentFilters.search = searchTerm.toLowerCase();
  renderLeadsTable(); // Filter current page immediately
  
  // If search is cleared, reload from server
  if (!searchTerm) {
    await onFilterChange();
  }
}, 300);

async function refreshActiveMembers() {
  const snap = await usersRef.where("role", "==", "member").where("active", "==", true).get();
  ACTIVE_MEMBERS = [];
  snap.forEach((doc) => ACTIVE_MEMBERS.push({ id: doc.id, ...doc.data() }));
  ACTIVE_MEMBERS.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  window.ACTIVE_MEMBERS = ACTIVE_MEMBERS; // Keep window reference updated
}

async function refreshActiveHR() {
  const snap = await usersRef.where("role", "==", "hr").where("active", "==", true).get();
  ACTIVE_HR = [];
  snap.forEach((doc) => ACTIVE_HR.push({ id: doc.id, ...doc.data() }));
  ACTIVE_HR.sort((a, b) => (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0));
  window.ACTIVE_HR = ACTIVE_HR; // Keep window reference updated
}

async function createHRTransferRequest(leadId, leadData, noteText) {
  const now = firebase.firestore.Timestamp.now();
  const previousStatus = leadData.status || "Not Open";
  if (leadData.transferRequestStatus === "Pending") {
    toast("A Driver transfer request is already pending for this lead.", "warning");
    return;
  }

  const transferRequest = {
    transferRequestStatus: "Pending",
    transferRequestedBy: CURRENT_USER.uid,
    transferRequestedByName: CURRENT_USER.name || CURRENT_USER.email,
    transferRequestedAt: now,
    transferRequestRequestedStatus: "Driver",
    transferRequestPreviousStatus: previousStatus,
    transferRequestNote: noteText?.trim() || null
  };

  const historyEntry = {
    text: `Driver transfer requested by ${CURRENT_USER.name || CURRENT_USER.email}. ${noteText?.trim() || ""}`.trim(),
    statusAtTime: "Driver",
    updatedBy: CURRENT_USER.uid,
    updatedByName: CURRENT_USER.name || CURRENT_USER.email,
    timestamp: new Date().toISOString()
  };

  await leadsRef.doc(leadId).update({
    status: "Driver",
    lastContactedAt: now,
    nextFollowUpAt: null,
    history: firebase.firestore.FieldValue.arrayUnion(historyEntry),
    ...transferRequest
  });

  await notifyAdminsForHRTransfer({ id: leadId, ...leadData, ...transferRequest });
  toast("Driver transfer request created and sent to Admin for approval.", "success");
  renderHRTransferRequests();
}

async function assignLeadToHRDirectly(leadId, leadData, noteText, approvalMetadata = {}) {
  const todayLeaves = isValidAssignmentTime() ? await getTodayLeaves() : [];
  const hrUser = await getNextAvailableUserByRole("hr", todayLeaves);
  if (!hrUser) {
    throw new Error("No active HR user is currently available.");
  }

  const now = firebase.firestore.Timestamp.now();
  const updateData = {
    status: "Driver",
    assignedTo: hrUser.id,
    assignedToName: hrUser.name || hrUser.email,
    assignedAt: now,
    assignedBy: CURRENT_USER.name || CURRENT_USER.email,
    assignmentPending: false,
    assignmentReason: null,
    transferRequestStatus: "Approved",
    transferRequestApprovedBy: CURRENT_USER.uid,
    transferRequestApprovedByName: CURRENT_USER.name || CURRENT_USER.email,
    transferRequestApprovedAt: now,
    transferRequestRequestedStatus: "Driver",
    transferRequestNote: noteText?.trim() || null,
    history: firebase.firestore.FieldValue.arrayUnion({
      text: `Driver transfer approved and assigned to ${hrUser.name || hrUser.email}. ${noteText?.trim() || ""}`.trim(),
      statusAtTime: "Driver",
      updatedBy: CURRENT_USER.uid,
      updatedByName: CURRENT_USER.name || CURRENT_USER.email,
      timestamp: new Date().toISOString()
    })
  };

  if (leadData.transferRequestStatus === "Pending") {
    updateData.transferRequestStatus = "Approved";
  }

  await leadsRef.doc(leadId).update(updateData);

  if (notificationsRef) {
    await notificationsRef.add({
      userId: hrUser.id,
      title: "New HR Lead Assigned",
      message: `Lead #${leadData.slNo} (${leadData.fullName}) has been assigned to you for driver handling.`,
      createdAt: now,
      read: false
    });
  }
  toast(`Assigned lead to HR ${hrUser.name || hrUser.email}.`, "success");
  renderHRTransferRequests();
}

async function approveHRTransfer(leadId) {
  if (!requirePermission("hrTransfers.approve")) return;

  try {
    const leadDoc = await leadsRef.doc(leadId).get();
    if (!leadDoc.exists) return;
    const leadData = leadDoc.data();
    await assignLeadToHRDirectly(leadId, leadData, "Approved by Admin", { approved: true });
    renderHRTransferRequests();
  } catch (err) {
    console.error(err);
    toast(err.message || "Failed to approve HR transfer.", "danger");
  }
}

async function rejectHRTransfer(leadId) {
  if (!requirePermission("hrTransfers.reject")) return;

  const reason = window.prompt("Enter rejection reason for this HR transfer request:");
  if (!reason) {
    toast("Rejection reason is required.", "warning");
    return;
  }

  const leadDoc = await leadsRef.doc(leadId).get();
  if (!leadDoc.exists) return;
  const leadData = leadDoc.data();
  const previousStatus = leadData.transferRequestPreviousStatus || "Not Open";
  const now = firebase.firestore.Timestamp.now();

  await leadsRef.doc(leadId).update({
    status: previousStatus,
    transferRequestStatus: "Rejected",
    transferRequestRejectedBy: CURRENT_USER.uid,
    transferRequestRejectedByName: CURRENT_USER.name || CURRENT_USER.email,
    transferRequestRejectedAt: now,
    transferRequestRejectedReason: reason,
    history: firebase.firestore.FieldValue.arrayUnion({
      text: `Driver transfer request rejected by ${CURRENT_USER.name || CURRENT_USER.email}. Reason: ${reason}`,
      statusAtTime: previousStatus,
      updatedBy: CURRENT_USER.uid,
      updatedByName: CURRENT_USER.name || CURRENT_USER.email,
      timestamp: new Date().toISOString()
    })
  });
  toast("HR transfer request rejected and lead status restored.", "info");
  renderHRTransferRequests();
}

async function notifyAdminsForHRTransfer(lead) {
  if (!notificationsRef) return;
  const usersSnap = await usersRef.where("role", "in", ["admin", "superadmin"]).where("active", "==", true).get();
  const now = firebase.firestore.Timestamp.now();
  usersSnap.forEach((doc) => {
    notificationsRef.add({
      userId: doc.id,
      title: "Driver Transfer Request",
      message: `Lead #${lead.slNo} (${lead.fullName}) requires HR transfer approval.`,
      createdAt: now,
      read: false
    });
  });
}

async function renderHRTransferRequests() {
  if (!hasPermission("hrTransfers.view")) return;
  const section = document.getElementById("view-hrtransfers");
  if (!section) return;

  const snapshot = await leadsRef.where("transferRequestStatus", "==", "Pending").get();
  const pending = [];
  snapshot.forEach((doc) => pending.push({ id: doc.id, ...doc.data() }));

  if (pending.length === 0) {
    section.innerHTML = `<div class="alert alert-info">No pending HR transfer requests at the moment.</div>`;
    return;
  }

  const rows = pending.map((lead) => `
    <tr>
      <td>${lead.slNo}</td>
      <td>${lead.fullName}</td>
      <td>${lead.phoneNumber || "-"}</td>
      <td>${lead.assignedToName || "Unassigned"}</td>
      <td>${lead.transferRequestedByName || "Unknown"}</td>
      <td>${lead.transferRequestedAt ? new Date(lead.transferRequestedAt.toDate()).toLocaleString() : "-"}</td>
      <td>${lead.transferRequestNote || "-"}</td>
      <td class="text-nowrap">
        ${hasPermission("hrTransfers.approve") ? `<button class="btn btn-sm btn-success me-1" onclick="approveHRTransfer('${lead.id}')">Approve</button>` : ""}
        ${hasPermission("hrTransfers.reject") ? `<button class="btn btn-sm btn-danger" onclick="rejectHRTransfer('${lead.id}')">Reject</button>` : ""}
      </td>
    </tr>
  `).join("");

  section.innerHTML = `
    <div class="card">
      <div class="card-header">
        <h5 class="card-title mb-0">Pending HR Transfer Requests</h5>
      </div>
      <div class="table-responsive">
        <table class="table table-sm table-hover mb-0">
          <thead>
            <tr>
              <th>Sl.No</th>
              <th>Customer</th>
              <th>Phone</th>
              <th>Sales Owner</th>
              <th>Requested By</th>
              <th>Requested At</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ---------------- CREATE LEAD (Admin / Super Admin) ----------------
async function createLead(formData) {
  if (!requirePermission("leads.create")) return;

  // Delegate to Smart Assignment engine in assignment.js
  await smartCreateLead(formData);
}

// ============================================================
// FOLLOW-UP SCHEDULING SYSTEM
// ============================================================

// Global variable to track follow-up modal state
let PENDING_STATUS_UPDATE = null;

/**
 * Validates follow-up date and time against CRM Settings
 * Returns { valid: boolean, error: string, suggestion: any }
 */
async function validateFollowUpDateTime(date, time) {
  const scheduledDateTime = new Date(`${date}T${time}`);
  const now = new Date();
  
  // 1. Not in the past
  if (scheduledDateTime <= now) {
    return { valid: false, error: "Cannot schedule follow-up in the past.", type: "error" };
  }
  
  // 2. Not on holiday
  const holidays = CRM_CONFIG.holidays || [];
  const isHoliday = holidays.some(h => {
    if (h.recurring) {
      return h.date.slice(5) === date.slice(5);
    }
    return h.date === date;
  });
  
  if (isHoliday) {
    const holiday = holidays.find(h => 
      h.recurring ? h.date.slice(5) === date.slice(5) : h.date === date
    );
    const nextDate = getNextWorkingDay(date);
    return { 
      valid: false, 
      error: `${date} is a holiday (${holiday.name}).`,
      suggestion: nextDate,
      type: "error"
    };
  }
  
  // 3. Working day
  const dayOfWeek = ["Sunday","Monday","Tuesday","Wednesday",
                     "Thursday","Friday","Saturday"][scheduledDateTime.getDay()];
  const workingDays = CRM_CONFIG.workingDays || [];
  
  if (!workingDays.includes(dayOfWeek)) {
    const nextDate = getNextWorkingDay(date);
    return { 
      valid: false, 
      error: `${dayOfWeek} is not a working day.`,
      suggestion: nextDate,
      type: "error"
    };
  }

  // 4. Office hours
  const [officeStartH, officeStartM] = (CRM_CONFIG.officeStart || "09:00").split(":").map(Number);
  const [officeEndH, officeEndM] = (CRM_CONFIG.officeEnd || "18:00").split(":").map(Number);
  const [schedH, schedM] = time.split(":").map(Number);
  
  const schedMinutes = schedH * 60 + schedM;
  const startMinutes = officeStartH * 60 + officeStartM;
  const endMinutes = officeEndH * 60 + officeEndM;
  
  if (schedMinutes < startMinutes || schedMinutes >= endMinutes) {
    return {
      valid: false,
      error: `Time must be between ${CRM_CONFIG.officeStart} and ${CRM_CONFIG.officeEnd}.`,
      suggestion: CRM_CONFIG.officeStart,
      type: "error"
    };
  }
  
  // 5. Not during break time
  const breaks = CRM_CONFIG.breakTimings || [];
  for (const brk of breaks) {
    const [brkStartH, brkStartM] = (brk.start || "00:00").split(":").map(Number);
    const [brkEndH, brkEndM] = (brk.end || "00:00").split(":").map(Number);
    const brkStartMin = brkStartH * 60 + brkStartM;
    const brkEndMin = brkEndH * 60 + brkEndM;
    
    if (schedMinutes >= brkStartMin && schedMinutes < brkEndMin) {
      return {
        valid: false,
        error: `Cannot schedule during break time: ${brk.name} (${brk.start} - ${brk.end}).`,
        type: "warning"
      };
    }
  }
  
  return { valid: true };
}

/**
 * Find next working day starting from given date
 */
function getNextWorkingDay(startDate) {
  const workingDays = CRM_CONFIG.workingDays || [];
  const holidays = CRM_CONFIG.holidays || [];
  const date = new Date(startDate);
  
  // Try up to 14 days ahead
  for (let i = 1; i <= 14; i++) {
    date.setDate(date.getDate() + 1);
    const dateStr = date.toISOString().slice(0, 10);
    const dayName = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][date.getDay()];
    
    // Check if working day
    if (!workingDays.includes(dayName)) continue;
    
    // Check if holiday
    const isHoliday = holidays.some(h => {
      if (h.recurring) return h.date.slice(5) === dateStr.slice(5);
      return h.date === dateStr;
    });
    
    if (!isHoliday) return dateStr;
  }
  
  return startDate; // fallback
}

/**
 * Open follow-up scheduling modal
 */
async function openFollowUpModal(leadId, leadData, statusNote) {
  // Store pending status update
  PENDING_STATUS_UPDATE = {
    leadId: leadId,
    newStatus: "Call Back Later",
    noteText: statusNote,
    leadData: leadData
  };
  
  // Populate modal
  document.getElementById("followUpLeadName").textContent = escapeHtml(leadData.fullName);
  document.getElementById("followUpLeadPhone").textContent = escapeHtml(leadData.phoneNumber || "—");
  
  // Set default date (tomorrow) and time (10:00 AM)
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  
  document.getElementById("followUpDate").value = tomorrowStr;
  document.getElementById("followUpTime").value = "10:00";
  document.getElementById("followUpRemark").value = "";
  document.getElementById("followUpValidationMessages").innerHTML = "";
  
  // Reset radio buttons
  document.getElementById("followUpCall").checked = true;
  document.getElementById("followUpMorning").checked = true;
  
  // Show modal
  const modal = new bootstrap.Modal(document.getElementById("scheduleFollowUpModal"));
  modal.show();
  
  // Add validation on change
  document.getElementById("followUpDate").addEventListener("input", validateFollowUpInputs);
  document.getElementById("followUpTime").addEventListener("input", validateFollowUpInputs);
}

/**
 * Validate follow-up inputs and show messages
 */
async function validateFollowUpInputs() {
  const date = document.getElementById("followUpDate").value;
  const time = document.getElementById("followUpTime").value;
  const msgContainer = document.getElementById("followUpValidationMessages");
  
  if (!date || !time) {
    msgContainer.innerHTML = "";
    return;
  }
  
  const validation = await validateFollowUpDateTime(date, time);
  
  if (!validation.valid) {
    const iconClass = validation.type === "error" ? "bi-x-circle-fill" : "bi-exclamation-triangle-fill";
    const cssClass = validation.type === "error" ? "followup-validation-error" : "followup-validation-warning";
    
    let html = `
      <div class="${cssClass}">
        <i class="bi ${iconClass}"></i>
        <div>
          <div>${escapeHtml(validation.error)}</div>
          ${validation.suggestion ? `
            <span class="followup-validation-suggestion" onclick="applySuggestedDate('${validation.suggestion}')">
              <i class="bi bi-arrow-right-circle me-1"></i>Use ${validation.suggestion}
            </span>
          ` : ""}
        </div>
      </div>
    `;
    msgContainer.innerHTML = html;
  } else {
    msgContainer.innerHTML = `
      <div style="background: #D8F3DD; border: 1px solid #a8dcb4; border-radius: 8px; padding: 10px 12px; font-size: 13px; color: #1E7A34;">
        <i class="bi bi-check-circle-fill me-2"></i>Follow-up time is valid.
      </div>
    `;
  }
}

/**
 * Apply suggested date from validation message
 */
function applySuggestedDate(dateStr) {
  document.getElementById("followUpDate").value = dateStr;
  validateFollowUpInputs();
}

/**
 * Cancel follow-up schedule - return to status modal
 */
function cancelFollowUpSchedule() {
  const modal = bootstrap.Modal.getInstance(document.getElementById("scheduleFollowUpModal"));
  modal.hide();
  PENDING_STATUS_UPDATE = null;
  
  // Re-open status modal
  // Note: The status modal should still be accessible in the DOM
}

/**
 * Handle follow-up form submission
 */
document.addEventListener("DOMContentLoaded", () => {
  const followUpForm = document.getElementById("scheduleFollowUpForm");
  if (followUpForm) {
    followUpForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      
      if (!PENDING_STATUS_UPDATE) {
        toast("No pending status update found.", "danger");
        return;
      }
      
      const date = document.getElementById("followUpDate").value;
      const time = document.getElementById("followUpTime").value;
      const contactMethod = document.querySelector('input[name="followUpContactMethod"]:checked').value;
      const preferredTime = document.querySelector('input[name="followUpPreferredTime"]:checked').value;
      const remark = document.getElementById("followUpRemark").value.trim();
      
      if (!remark) {
        toast("Please provide a remark for the follow-up.", "warning");
        return;
      }
      
      // Final validation
      const validation = await validateFollowUpDateTime(date, time);
      if (!validation.valid) {
        toast(validation.error, "danger");
        return;
      }
      
      // Disable submit button
      const submitBtn = followUpForm.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Scheduling...';
      
      try {
        // Create follow-up object
        const scheduledTimestamp = firebase.firestore.Timestamp.fromDate(new Date(`${date}T${time}`));
        
        const followUpData = {
          status: "Pending",
          scheduledDate: date,
          scheduledTime: time,
          scheduledTimestamp: scheduledTimestamp,
          contactMethod: contactMethod,
          preferredTime: preferredTime,
          remark: remark,
          assignedTo: CURRENT_USER.uid,
          assignedToName: CURRENT_USER.name || CURRENT_USER.email,
          createdBy: CURRENT_USER.uid,
          createdByName: CURRENT_USER.name || CURRENT_USER.email,
          createdAt: firebase.firestore.Timestamp.now(),
          completedAt: null,
          completedBy: null,
          completedByName: null
        };
        
        // Now execute the status update WITH follow-up
        await executeStatusUpdateWithFollowUp(
          PENDING_STATUS_UPDATE.leadId,
          PENDING_STATUS_UPDATE.newStatus,
          PENDING_STATUS_UPDATE.noteText,
          followUpData
        );
        
        // Close modal
        const modal = bootstrap.Modal.getInstance(document.getElementById("scheduleFollowUpModal"));
        modal.hide();
        
        // Close status modal too
        const statusModal = bootstrap.Modal.getInstance(document.getElementById("statusModal"));
        if (statusModal) statusModal.hide();
        
        // Clear pending update
        PENDING_STATUS_UPDATE = null;
        
        toast(`Follow-up scheduled for ${date} at ${time}.`, "success");
        
      } catch (error) {
        console.error("Follow-up scheduling error:", error);
        toast("Failed to schedule follow-up. Please try again.", "danger");
      } finally {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Schedule Follow-up';
      }
    });
  }
});

/**
 * Execute status update with follow-up data
 */
async function executeStatusUpdateWithFollowUp(leadId, newStatus, noteText, followUpData) {
  const leadRef = leadsRef.doc(leadId);
  const now = firebase.firestore.Timestamp.now();

  // Get current lead data
  const leadDoc = await leadRef.get();
  if (!leadDoc.exists) {
    toast("Lead not found.", "danger");
    return;
  }
  const leadData = leadDoc.data();

  // Read settings
  const maxConsecutiveAttempts = getCRMSetting("maxConsecutiveNotPickingAttempts") || 3;
  
  // Create history entry with follow-up details
  let historyText = noteText && noteText.trim() ? noteText.trim() : "(status updated, no note added)";
  historyText += `\n\n📅 Follow-up scheduled:\nDate: ${followUpData.scheduledDate} at ${followUpData.scheduledTime}\nMethod: ${followUpData.contactMethod}\nPreferred: ${followUpData.preferredTime}\nRemark: ${followUpData.remark}`;

  const historyEntry = {
    text: historyText,
    statusAtTime: newStatus,
    updatedBy: CURRENT_USER.uid,
    updatedByName: CURRENT_USER.name || CURRENT_USER.email,
    timestamp: new Date().toISOString(),
    followUp: followUpData // Embed follow-up in history
  };

  // Update lead with follow-up embedded
  const updateData = {
    status: newStatus,
    lastContactedAt: now,
    followUp: followUpData, // Store current follow-up in lead document
    hasPendingFollowUp: true,
    nextFollowUpAt: followUpData.scheduledTimestamp,
    consecutiveNotPickingAttempts: 0, // Reset on Call Back Later
    lastStatusNote: noteText && noteText.trim() ? noteText.trim() : followUpData.remark || "",
    lastCallSummary: noteText && noteText.trim() ? noteText.trim() : followUpData.remark || "",
    statusUpdatedAt: now,
    statusChangedByName: CURRENT_USER.name || CURRENT_USER.email || "",
    history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
  };

  await leadRef.update(updateData);
}

// ---------------- UPDATE STATUS / NOTE (with history) ----------------
async function updateLeadStatus(leadId, newStatus, noteText) {
  if (!requirePermission("leads.changeStatus")) return;

  const leadRef = leadsRef.doc(leadId);
  const now = firebase.firestore.Timestamp.now();

  // Get current lead data
  const leadDoc = await leadRef.get();
  if (!leadDoc.exists) {
    toast("Lead not found.", "danger");
    return;
  }
  const leadData = leadDoc.data();
  
  // ✅ INTERCEPT "Call Back Later" — require follow-up scheduling
  if (newStatus === "Call Back Later") {
    // Close the status modal first
    const statusModal = bootstrap.Modal.getInstance(document.getElementById("statusModal"));
    if (statusModal) statusModal.hide();
    
    // Open follow-up modal
    await openFollowUpModal(leadId, leadData, noteText);
    return; // Stop here — follow-up modal will complete the update
  }
  
  // ✅ AUTO-CANCEL pending follow-up if moving to final status
  const finalStatuses = ["Interested", "Not Interested", "No Response", "Job Seeker", "Driver", "Transporter"];
  if (finalStatuses.includes(newStatus) && leadData.hasPendingFollowUp) {
    await cancelPendingFollowUp(leadId, leadData, newStatus);
  }

  // If an admin/superadmin is moving a lead to Driver, assign to HR directly
  if (newStatus === "Driver" && CURRENT_USER.role !== "member") {
    await assignLeadToHRDirectly(leadId, leadData, noteText);
    return;
  }

  // Continue with normal status update logic
  // Read settings - all values from CRM_CONFIG
  const maxConsecutiveAttempts = getCRMSetting("maxConsecutiveNotPickingAttempts") || 3;
  const autoMoveToNoResponse = getCRMSetting("autoMoveToNoResponse") ?? true;
  const reminderAfterBusy = getCRMSetting("reminderAfterMinutes") || 60;
  
  // Not Picking Call reminder: 4 hours (240 minutes)
  const reminderMap = {
    "Busy": reminderAfterBusy,
    "Not Picking Call": 240
  };

  // Track consecutive "Not Picking Call" attempts
  let consecutiveAttempts = leadData.consecutiveNotPickingAttempts || 0;
  let finalStatus = newStatus;
  let nextFollowUpAt = null;
  let historyText = noteText && noteText.trim() ? noteText.trim() : "(status updated, no note added)";

  // Handle "Not Picking Call" attempt tracking
  if (newStatus === "Not Picking Call") {
    consecutiveAttempts++;
    
    // Check if max consecutive attempts reached
    if (consecutiveAttempts >= maxConsecutiveAttempts) {
      if (autoMoveToNoResponse) {
        // Auto-move to "No Response" (system-only status)
        finalStatus = "No Response";
        nextFollowUpAt = null; // No follow-up for No Response
        historyText = `Not Picking Call - Attempt ${consecutiveAttempts}/${maxConsecutiveAttempts}. Automatically moved to "No Response" per CRM Settings (${maxConsecutiveAttempts} consecutive attempts with no answer). ${noteText && noteText.trim() ? "Note: " + noteText.trim() : ""}`;
        
        toast(`Lead automatically moved to "No Response" after ${maxConsecutiveAttempts} consecutive attempts with no answer.`, "warning");
      } else {
        // Prevent additional "Not Picking Call" updates
        toast(`Maximum consecutive "Not Picking Call" attempts (${maxConsecutiveAttempts}) reached. Please select another status or contact admin.`, "danger");
        return; // Block the update
      }
    } else {
      // Still under max attempts - schedule follow-up
      const reminderMinutes = reminderMap[newStatus];
      if (reminderMinutes) {
        nextFollowUpAt = firebase.firestore.Timestamp.fromMillis(Date.now() + reminderMinutes * 60000);
      }
      historyText = `Not Picking Call - Consecutive attempt ${consecutiveAttempts}/${maxConsecutiveAttempts}. ${noteText && noteText.trim() ? "Note: " + noteText.trim() : ""}`;
    }
  } else if (MEANINGFUL_CONTACT_STATUSES.includes(newStatus)) {
    // Reset consecutive attempts on meaningful contact
    consecutiveAttempts = 0;
    
    // Schedule follow-up if applicable
    const reminderMinutes = reminderMap[newStatus];
    if (reminderMinutes) {
      nextFollowUpAt = firebase.firestore.Timestamp.fromMillis(Date.now() + reminderMinutes * 60000);
    }
  } else {
    // Other status changes also reset the counter
    consecutiveAttempts = 0;
  }

  // Create history entry
  const historyEntry = {
    text: historyText,
    statusAtTime: finalStatus,
    updatedBy: CURRENT_USER.uid,
    updatedByName: CURRENT_USER.name || CURRENT_USER.email,
    timestamp: new Date().toISOString(),
    ...(newStatus === "Not Picking Call" && { 
      attemptCount: consecutiveAttempts, 
      maxAttempts: maxConsecutiveAttempts,
      isConsecutive: true
    })
  };

  // Update lead
  const updateData = {
    status: finalStatus,
    lastContactedAt: now,
    nextFollowUpAt: nextFollowUpAt,
    consecutiveNotPickingAttempts: consecutiveAttempts,
    lastStatusNote: noteText && noteText.trim() ? noteText.trim() : "",
    lastCallSummary: noteText && noteText.trim() ? noteText.trim() : "",
    statusUpdatedAt: now,
    statusChangedByName: CURRENT_USER.name || CURRENT_USER.email || "",
    history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
  };

  await leadRef.update(updateData);

  // Explicitly unsubscribe a marketing contact when a lead is marked Not Interested.
  // This does not perform a second leads read.
  if (finalStatus === "Not Interested" && window.MarketingChannels?.syncLeadUpdate) {
    window.MarketingChannels.syncLeadUpdate({ ...leadData, id: leadId, status: finalStatus }).catch(err => console.error("Marketing unsubscribe sync failed:", err));
  }

  // ✅ HR TRANSFER: Automatically create transfer request for Driver status
  if (finalStatus === "Driver" && !leadData.hrTransferCreated) {
    // Only create transfer if function is available (hr-transfers.js loaded)
    if (typeof createHRTransferOnDriverStatus === "function") {
      try {
        await createHRTransferOnDriverStatus(leadId, { ...leadData, ...updateData });
      } catch (error) {
        console.error("Failed to create HR transfer:", error);
        // Don't block status update if transfer creation fails
      }
    }
  }

  // Log to console for debugging
  if (newStatus === "Not Picking Call") {
    console.log(`Not Picking Call: Consecutive attempt ${consecutiveAttempts}/${maxConsecutiveAttempts}, Auto-move to No Response enabled: ${autoMoveToNoResponse}, Final status: ${finalStatus}`);
  }
}

// ---------------- DELETE / EDIT (Super Admin only) ----------------
async function deleteLead(leadId) {
  if (!requirePermission("leads.delete")) return;

  const lead = ALL_LEADS.find((l) => l.id === leadId);
  const historyEntry = {
    text: "Lead deleted by Super Admin",
    statusAtTime: lead ? lead.status : "",
    updatedBy: CURRENT_USER.uid,
    updatedByName: CURRENT_USER.name || CURRENT_USER.email,
    timestamp: new Date().toISOString()
  };
  // Log to an audit trail collection before removing, so history isn't lost
  await db.collection("deletedLeadsAudit").add({
    ...lead,
    ...historyEntry,
    deletedAt: firebase.firestore.Timestamp.now()
  });
  await leadsRef.doc(leadId).delete();
  if (window.marketingContactsRef) {
    try { await window.marketingContactsRef.doc(`lead_${leadId}`).delete(); }
    catch (err) { console.error("Failed to remove deleted lead from marketing contacts:", err); }
  }
}

async function editLeadDetails(leadId, formData) {
  const historyEntry = {
    text: "Lead details edited by Super Admin",
    statusAtTime: formData.status || null,
    updatedBy: CURRENT_USER.uid,
    updatedByName: CURRENT_USER.name || CURRENT_USER.email,
    timestamp: new Date().toISOString()
  };
  await leadsRef.doc(leadId).update({
    ...formData,
    history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
  });
}

// ---------------- RENDER: FILTER UI ----------------
function buildLeadFilterUI() {
  const wrap = document.getElementById("leadFilters");
  if (!wrap) return;

  const showMemberFilter = CURRENT_USER.role !== "member";
  const memberOptions = ACTIVE_MEMBERS.map(
    (m) => `<option value="${m.id}">${m.name || m.email}</option>`
  ).join("");

  wrap.innerHTML = `
    <div class="leads-filter-sticky">
      <div class="row g-2 align-items-end mb-2">
        <div class="col-6 col-md-2">
          <label class="form-label small mb-1">Status</label>
          <select id="filterStatus" class="form-select form-select-sm">
            <option value="">All Statuses</option>
            ${STATUS_LIST.map((s) => `<option value="${s}">${s}</option>`).join("")}
            ${SYSTEM_STATUSES.map((s) => `<option value="${s}">${s}</option>`).join("")}
          </select>
        </div>
        ${showMemberFilter ? `
        <div class="col-6 col-md-2">
          <label class="form-label small mb-1">Assigned To</label>
          <select id="filterMember" class="form-select form-select-sm">
            <option value="">All Members</option>
            ${memberOptions}
          </select>
        </div>` : ""}
        <div class="col-6 col-md-2">
          <label class="form-label small mb-1">Campaign</label>
          <select id="filterCampaign" class="form-select form-select-sm">
            <option value="">All Campaigns</option>
          </select>
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label small mb-1">From Date</label>
          <input id="filterDateFrom" type="date" class="form-control form-control-sm">
        </div>
        <div class="col-6 col-md-2">
          <label class="form-label small mb-1">To Date</label>
          <input id="filterDateTo" type="date" class="form-control form-control-sm">
        </div>
        <div class="col-6 col-md-${showMemberFilter ? '2' : '4'}">
          <label class="form-label small mb-1">Search</label>
          <input id="filterSearch" type="text" class="form-control form-control-sm" placeholder="Name, phone, company...">
        </div>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-auto">
          <button class="btn btn-sm btn-outline-secondary" onclick="clearLeadFilters()">
            <i class="bi bi-x-circle me-1"></i>Clear Filters
          </button>
        </div>
        <div class="col-auto ms-auto">
          <div class="d-flex align-items-center gap-2">
            <span class="small text-muted">Show:</span>
            <select id="pageSizeSelector" class="form-select form-select-sm" style="width: auto;">
              <option value="25" ${PAGINATION_STATE.pageSize === 25 ? 'selected' : ''}>25</option>
              <option value="50" ${PAGINATION_STATE.pageSize === 50 ? 'selected' : ''}>50</option>
              <option value="100" ${PAGINATION_STATE.pageSize === 100 ? 'selected' : ''}>100</option>
            </select>
            <span class="small text-muted">per page</span>
          </div>
        </div>
      </div>
    </div>`;

  // Populate campaign filter
  if (typeof ALL_CAMPAIGNS !== 'undefined' && ALL_CAMPAIGNS) {
    const campaignSelect = document.getElementById("filterCampaign");
    if (campaignSelect) {
      ALL_CAMPAIGNS.forEach(c => {
        if (c.active) {
          const option = document.createElement("option");
          option.value = c.name;
          option.textContent = c.name;
          campaignSelect.appendChild(option);
        }
      });
    }
  }

  // Attach event listeners
  document.getElementById("filterStatus")?.addEventListener("change", async (e) => {
    PAGINATION_STATE.currentFilters.status = e.target.value;
    await onFilterChange();
  });

  document.getElementById("filterMember")?.addEventListener("change", async (e) => {
    PAGINATION_STATE.currentFilters.assignedTo = e.target.value;
    await onFilterChange();
  });

  document.getElementById("filterCampaign")?.addEventListener("change", async (e) => {
    PAGINATION_STATE.currentFilters.campaign = e.target.value;
    await onFilterChange();
  });

  document.getElementById("filterDateFrom")?.addEventListener("change", async (e) => {
    PAGINATION_STATE.currentFilters.dateFrom = e.target.value;
    await onFilterChange();
  });

  document.getElementById("filterDateTo")?.addEventListener("change", async (e) => {
    PAGINATION_STATE.currentFilters.dateTo = e.target.value;
    await onFilterChange();
  });

  document.getElementById("filterSearch")?.addEventListener("input", (e) => {
    debouncedSearch(e.target.value);
  });

  document.getElementById("pageSizeSelector")?.addEventListener("change", async (e) => {
    PAGINATION_STATE.pageSize = parseInt(e.target.value);
    localStorage.setItem("leadsPageSize", PAGINATION_STATE.pageSize);
    await onFilterChange();
  });
}

function clearLeadFilters() {
  document.getElementById("filterStatus").value = "";
  document.getElementById("filterMember")?.value && (document.getElementById("filterMember").value = "");
  document.getElementById("filterCampaign").value = "";
  document.getElementById("filterDateFrom").value = "";
  document.getElementById("filterDateTo").value = "";
  document.getElementById("filterSearch").value = "";
  
  PAGINATION_STATE.currentFilters = {
    status: "",
    assignedTo: "",
    search: "",
    campaign: "",
    dateFrom: "",
    dateTo: ""
  };
  
  onFilterChange();
}

// ---------------- PAGINATION CONTROLS ----------------
function buildPaginationControls() {
  const container = document.getElementById("leadFilters");
  if (!container) return;
  
  // Add pagination UI container after filters
  const paginationHTML = `
    <div id="paginationControls" class="d-flex justify-content-between align-items-center mb-3">
      <div id="paginationInfo" class="small text-muted"></div>
      <div id="paginationButtons"></div>
    </div>
  `;
  
  // Check if pagination controls already exist
  if (!document.getElementById("paginationControls")) {
    container.insertAdjacentHTML("afterend", paginationHTML);
  }
}

function updatePaginationUI() {
  const info = document.getElementById("paginationInfo");
  const buttons = document.getElementById("paginationButtons");
  
  if (!info || !buttons) return;
  
  // Calculate range
  const start = (PAGINATION_STATE.currentPage - 1) * PAGINATION_STATE.pageSize + 1;
  const end = Math.min(start + ALL_LEADS.length - 1, PAGINATION_STATE.totalLeads);
  
  // Update info
  if (ALL_LEADS.length > 0) {
    info.innerHTML = `Showing <strong>${start}</strong> – <strong>${end}</strong> of <strong>${PAGINATION_STATE.totalLeads}</strong> leads`;
  } else {
    info.innerHTML = `No leads found`;
  }
  
  // Build pagination buttons
  const totalPages = PAGINATION_STATE.totalPages;
  const currentPage = PAGINATION_STATE.currentPage;
  
  let buttonsHTML = '<nav><ul class="pagination pagination-sm mb-0">';
  
  // Previous button
  buttonsHTML += `
    <li class="page-item ${!PAGINATION_STATE.hasPrevPage || PAGINATION_STATE.isLoading ? 'disabled' : ''}">
      <a class="page-link" href="#" onclick="navigateToPage(${currentPage - 1}, 'prev'); return false;">
        <i class="bi bi-chevron-left"></i> Previous
      </a>
    </li>
  `;
  
  // Page numbers
  const maxButtons = 7;
  let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxButtons - 1);
  
  // Adjust if we're near the end
  if (endPage - startPage < maxButtons - 1) {
    startPage = Math.max(1, endPage - maxButtons + 1);
  }
  
  // First page
  if (startPage > 1) {
    buttonsHTML += `
      <li class="page-item">
        <a class="page-link" href="#" onclick="navigateToPage(1); return false;">1</a>
      </li>
    `;
    if (startPage > 2) {
      buttonsHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
    }
  }
  
  // Page range
  for (let i = startPage; i <= endPage; i++) {
    buttonsHTML += `
      <li class="page-item ${i === currentPage ? 'active' : ''}">
        <a class="page-link" href="#" onclick="navigateToPage(${i}); return false;">${i}</a>
      </li>
    `;
  }
  
  // Last page
  if (endPage < totalPages) {
    if (endPage < totalPages - 1) {
      buttonsHTML += `<li class="page-item disabled"><span class="page-link">...</span></li>`;
    }
    buttonsHTML += `
      <li class="page-item">
        <a class="page-link" href="#" onclick="navigateToPage(${totalPages}); return false;">${totalPages}</a>
      </li>
    `;
  }
  
  // Next button
  buttonsHTML += `
    <li class="page-item ${!PAGINATION_STATE.hasNextPage || PAGINATION_STATE.isLoading ? 'disabled' : ''}">
      <a class="page-link" href="#" onclick="navigateToPage(${currentPage + 1}, 'next'); return false;">
        Next <i class="bi bi-chevron-right"></i>
      </a>
    </li>
  `;
  
  buttonsHTML += '</ul></nav>';
  buttons.innerHTML = buttonsHTML;
}

/**
 * Navigate to specific page
 */
async function navigateToPage(page, direction = "next") {
  if (PAGINATION_STATE.isLoading) return;
  if (page < 1 || page > PAGINATION_STATE.totalPages) return;
  
  await loadLeadsPage(page, direction);
  
  // Scroll to top of table
  document.querySelector(".table-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function canManualAssignLead() {
  return !!CURRENT_USER && (CURRENT_USER.role === "superadmin" || hasPermission("leads.assign") || hasPermission("leads.reassign"));
}

// ---------------- RENDER: LEADS TABLE ----------------
function renderLeadsTable() {
  const tbody = document.getElementById("leadsTableBody");
  if (!tbody) return;

  let rows = ALL_LEADS;
  const searchFilter = PAGINATION_STATE.currentFilters.search;

  if (searchFilter) {
    rows = rows.filter((l) => {
      const hay = `${l.fullName} ${l.phoneNumber} ${l.companyName} ${l.email}`.toLowerCase();
      return hay.includes(searchFilter);
    });
  }

  if (rows.length === 0) {
    renderEmptyState();
    return;
  }

  const prefs = getUserTablePreferences();
  const showCampaign = prefs.showCampaign !== false;
  const showAssigned = prefs.showAssigned !== false;
  const canEditDelete = CURRENT_USER.role === "superadmin" || hasPermission("leads.delete");
  const canManualAssign = canManualAssignLead();
  const pendingRows = rows.filter((lead) => !!lead.assignmentPending);

  tbody.innerHTML = rows.map((l) => {
    const created = l.createdAt ? l.createdAt.toDate() : new Date();
    const uncontactedOverdue = isUncontactedOverdue(l);
    const isPending = !!l.assignmentPending;
    const phone = normalisePhone(l.phoneNumber);
    const selected = PENDING_MANUAL_SELECTIONS.has(l.id) ? "checked" : "";

    const fullName = escapeHtml(l.fullName);
    const displayName = fullName.length > 25 ? fullName.substring(0, 22) + '...' : fullName;
    const nameTitle = fullName.length > 25 ? fullName : '';
    const isNewBadge = isLeadNew(l)
      ? '<span class="lead-new-badge">NEW</span>'
      : '';

    const campaignName = escapeHtml(l.campaignName || l.serviceNeeded || "General");
    const displayCampaign = campaignName.length > 20 ? campaignName.substring(0, 17) + '...' : campaignName;
    const campaignTitle = campaignName.length > 20 ? campaignName : '';

    let statusBadgeHTML = `<span class="status-badge ${STATUS_BADGE_CLASS[l.status] || ""}">${l.status}</span>`;

    if (l.status === "Not Picking Call" && l.consecutiveNotPickingAttempts) {
      const maxAttempts = getCRMSetting("maxConsecutiveNotPickingAttempts") || 3;
      statusBadgeHTML += `<div class="small text-muted mt-1">
        <span class="badge badge-attempt">Attempt ${l.consecutiveNotPickingAttempts}/${maxAttempts}</span>
      </div>`;
    } else if (l.status === "No Response") {
      statusBadgeHTML += `<div class="small text-muted mt-1">
        <span class="badge badge-system">System Generated</span>
      </div>`;
    }

    if (uncontactedOverdue) {
      statusBadgeHTML += '<div class="small text-danger mt-1"><i class="bi bi-alarm"></i> Overdue</div>';
    }

    return `
    <tr class="${uncontactedOverdue ? "row-urgent" : ""}">
      <td class="text-center">
        ${canManualAssign && isPending ? `<input type="checkbox" class="form-check-input lead-manual-check" data-lead-id="${l.id}" ${selected}>` : '<span class="text-muted">—</span>'}
      </td>
      <td class="text-center"><span class="badge bg-light text-dark">${l.slNo || '—'}</span></td>
      <td class="text-nowrap small">${formatDateTime(created)}</td>
      <td>
        <div class="customer-cell" ${nameTitle ? `title="${nameTitle}"` : ''}>
          <div class="fw-semibold">${displayName}${isNewBadge}</div>
          ${l.companyName ? `<div class="small text-muted text-truncate">${escapeHtml(l.companyName).substring(0, 30)}</div>` : ''}
        </div>
      </td>
      <td class="text-nowrap">
        <a href="tel:${l.phoneNumber}" class="text-decoration-none">
          <i class="bi bi-telephone me-1"></i>${escapeHtml(l.phoneNumber)}
        </a>
      </td>
      ${showCampaign ? `<td class="col-campaign" ${campaignTitle ? `title="${campaignTitle}"` : ''}>${displayCampaign}</td>` : ''}
      ${showAssigned ? `<td class="col-assigned">
        ${isPending
          ? `<span class="badge badge-pending-assignment"><i class="bi bi-hourglass-split me-1"></i>Pending</span>`
          : `<span class="text-truncate d-inline-block" style="max-width: 150px;" title="${escapeHtml(l.assignedToName || 'Unassigned')}">${escapeHtml(l.assignedToName || "—")}</span>`}
      </td>` : ''}
      <td>${statusBadgeHTML}</td>
      <td class="text-center">
        <div class="action-buttons">
          <button class="btn btn-icon btn-sm btn-outline-secondary" onclick="openLeadDetailsModal('${l.id}')" 
                  title="View Details" data-bs-toggle="tooltip">
            <i class="bi bi-eye"></i>
          </button>
          ${isPending ? `<button class="btn btn-icon btn-sm btn-brand" onclick="openManualLeadAssignmentModal('${l.id}')" title="Manual Assignment" data-bs-toggle="tooltip"><i class="bi bi-person-check-fill"></i></button>` : `
          <button class="btn btn-icon btn-sm btn-primary" onclick="openStatusModal('${l.id}')" 
                  title="Update Status" data-bs-toggle="tooltip">
            <i class="bi bi-pencil-square"></i>
          </button>
          `}
          ${phone ? `
          <a href="tel:${phone}" class="btn btn-icon btn-sm btn-success" 
             title="Call" data-bs-toggle="tooltip">
            <i class="bi bi-telephone-fill"></i>
          </a>
          <a href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" 
             class="btn btn-icon btn-sm btn-whatsapp" title="WhatsApp" data-bs-toggle="tooltip">
            <i class="bi bi-whatsapp"></i>
          </a>
          ` : ''}
          <button class="btn btn-icon btn-sm btn-outline-secondary" onclick="openHistoryModal('${l.id}')" 
                  title="History" data-bs-toggle="tooltip">
            <i class="bi bi-clock-history"></i>
          </button>
          ${isPending ? '' : `
          <button class="btn btn-icon btn-sm btn-ai-pitch" onclick="openSalesPitchModal('${l.id}')" 
                  title="AI Sales Pitch" data-bs-toggle="tooltip">
            <i class="bi bi-robot"></i>
          </button>
          `}
          ${canEditDelete ? `
          <button class="btn btn-icon btn-sm btn-outline-danger" onclick="confirmDeleteLead('${l.id}')" 
                  title="Delete" data-bs-toggle="tooltip">
            <i class="bi bi-trash"></i>
          </button>
          ` : ''}
        </div>
      </td>
    </tr>`;
  }).join("");

  refreshManualAssignmentToolbar({ pendingRows });
  bindManualAssignmentCheckboxes();
  initializeTooltips();
}

/**
 * Initialize Bootstrap tooltips for action buttons
 */
function refreshManualAssignmentToolbar({ pendingRows = [] } = {}) {
  const toolbar = document.getElementById("manualAssignmentToolbar");
  const counter = document.getElementById("manualSelectionCounter");
  const selectAllPendingLeads = document.getElementById("selectAllPendingLeads");
  const canManualAssign = canManualAssignLead();

  if (!toolbar || !counter || !selectAllPendingLeads) return;

  const pendingCount = pendingRows.length || ALL_LEADS.filter((lead) => !!lead.assignmentPending).length;
  const isVisible = canManualAssign && pendingCount > 0;
  toolbar.classList.toggle("d-none", !isVisible);
  counter.textContent = String(PENDING_MANUAL_SELECTIONS.size);
  selectAllPendingLeads.checked = pendingCount > 0 && PENDING_MANUAL_SELECTIONS.size === pendingCount;
}

function bindManualAssignmentCheckboxes() {
  const checkboxes = document.querySelectorAll(".lead-manual-check");
  checkboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", (event) => {
      const { leadId } = event.target.dataset;
      if (!leadId) return;
      if (event.target.checked) {
        PENDING_MANUAL_SELECTIONS.add(leadId);
      } else {
        PENDING_MANUAL_SELECTIONS.delete(leadId);
      }
      refreshManualAssignmentToolbar();
    });
  });

  const selectAllPendingLeads = document.getElementById("selectAllPendingLeads");
  if (selectAllPendingLeads) {
    selectAllPendingLeads.onclick = () => {
      const pendingIds = ALL_LEADS.filter((lead) => !!lead.assignmentPending).map((lead) => lead.id);
      if (selectAllPendingLeads.checked) {
        pendingIds.forEach((id) => PENDING_MANUAL_SELECTIONS.add(id));
      } else {
        pendingIds.forEach((id) => PENDING_MANUAL_SELECTIONS.delete(id));
      }
      refreshManualAssignmentToolbar();
      renderLeadsTable();
    };
  }
}

async function openManualLeadAssignmentModal(leadId) {
  const lead = ALL_LEADS.find((item) => item.id === leadId);
  if (!lead || !lead.assignmentPending) {
    toast("Only pending leads can be manually assigned.", "warning");
    return;
  }

  if (!canManualAssignLead()) {
    toast("You don't have permission to manually assign leads.", "warning");
    return;
  }

  window.manualBulkAssignmentLeadIds = [leadId];
  document.getElementById("manualAssignmentLeadId").textContent = lead.slNo || lead.id;
  document.getElementById("manualAssignmentLeadId").dataset.leadId = lead.id;
  document.getElementById("manualAssignmentLeadName").textContent = lead.fullName || "—";
  document.getElementById("manualAssignmentLeadPhone").textContent = lead.phoneNumber || "—";
  document.getElementById("manualAssignmentLeadCampaign").textContent = lead.campaignName || lead.serviceNeeded || "General";
  document.getElementById("manualAssignmentLeadCreated").textContent = formatDateTime(lead.createdAt ? lead.createdAt.toDate() : new Date());
  document.getElementById("manualAssignmentLeadStatus").textContent = lead.status || "—";
  document.getElementById("manualAssignmentModalLabel").innerHTML = '<i class="bi bi-person-check-fill me-2"></i>Manual Lead Assignment';
  document.getElementById("manualAssignmentConfirmBtn").innerHTML = '<i class="bi bi-person-check-fill me-1"></i>Assign Lead';
  document.getElementById("manualOverrideWrap").style.display = CURRENT_USER.role === "superadmin" ? "" : "none";

  await populateManualAssignmentEmployees();
  const modal = new bootstrap.Modal(document.getElementById("manualAssignmentModal"));
  modal.show();
}

function openBulkManualAssignmentModal() {
  if (!canManualAssignLead()) {
    toast("You don't have permission to manually assign leads.", "warning");
    return;
  }

  const selected = Array.from(PENDING_MANUAL_SELECTIONS);
  if (selected.length === 0) {
    toast("Select one or more pending leads first.", "warning");
    return;
  }

  const lead = ALL_LEADS.find((item) => item.id === selected[0]);
  if (!lead) {
    toast("Selected lead could not be found.", "warning");
    return;
  }

  window.manualBulkAssignmentLeadIds = selected;
  document.getElementById("manualAssignmentLeadId").textContent = `${selected.length} selected`;
  document.getElementById("manualAssignmentLeadId").dataset.leadId = selected[0];
  document.getElementById("manualAssignmentLeadName").textContent = lead.fullName || "—";
  document.getElementById("manualAssignmentLeadPhone").textContent = lead.phoneNumber || "—";
  document.getElementById("manualAssignmentLeadCampaign").textContent = lead.campaignName || lead.serviceNeeded || "General";
  document.getElementById("manualAssignmentLeadCreated").textContent = `${selected.length} pending leads`;
  document.getElementById("manualAssignmentLeadStatus").textContent = "Pending Assignment";
  document.getElementById("manualAssignmentModalLabel").innerHTML = '<i class="bi bi-person-check-fill me-2"></i>Bulk Manual Lead Assignment';
  document.getElementById("manualAssignmentConfirmBtn").innerHTML = '<i class="bi bi-person-check-fill me-1"></i>Assign Selected';
  document.getElementById("manualOverrideWrap").style.display = CURRENT_USER.role === "superadmin" ? "" : "none";

  populateManualAssignmentEmployees();
  const modal = new bootstrap.Modal(document.getElementById("manualAssignmentModal"));
  modal.show();
}

async function populateManualAssignmentEmployees() {
  const employeeSelect = document.getElementById("manualAssignmentEmployeeSelect");
  const employeesList = document.getElementById("manualAssignmentEmployeesList");
  if (!employeeSelect || !employeesList) return;

  const employees = await getManualAssignableMembers();
  employeeSelect.innerHTML = "";
  employeesList.textContent = employees.length
    ? `${employees.length} available employee${employees.length === 1 ? "" : "s"} loaded.`
    : "No available employees are currently eligible for manual assignment.";

  if (employees.length === 0) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = "No available employees";
    employeeSelect.appendChild(option);
    return;
  }

  employees.forEach((employee) => {
    const option = document.createElement("option");
    option.value = employee.id;
    option.textContent = `${employee.name || employee.email} (${employee.role || "member"})`;
    employeeSelect.appendChild(option);
  });
}

async function confirmManualLeadAssignment() {
  const employeeSelect = document.getElementById("manualAssignmentEmployeeSelect");
  const targetLeadIds = Array.isArray(window.manualBulkAssignmentLeadIds) && window.manualBulkAssignmentLeadIds.length
    ? window.manualBulkAssignmentLeadIds
    : [document.getElementById("manualAssignmentLeadId").dataset.leadId].filter(Boolean);

  if (!employeeSelect || !employeeSelect.value) {
    toast("Choose an employee before assigning the lead.", "warning");
    return;
  }

  if (!targetLeadIds.length) {
    toast("No pending lead is selected for manual assignment.", "warning");
    return;
  }

  const overrideOfficeHours = document.getElementById("manualOverrideOfficeHours")?.checked || false;
  const modal = bootstrap.Modal.getInstance(document.getElementById("manualAssignmentModal"));

  try {
    for (const leadId of targetLeadIds) {
      await assignLeadToEmployee(leadId, employeeSelect.value, overrideOfficeHours);
    }

    if (modal) modal.hide();
    PENDING_MANUAL_SELECTIONS.clear();
    window.manualBulkAssignmentLeadIds = [];
    renderLeadsTable();
    toast(targetLeadIds.length > 1 ? `Assigned ${targetLeadIds.length} pending leads successfully.` : "Lead assigned successfully.", "success");
  } catch (error) {
    console.error("Manual assignment failed:", error);
    toast(error.message || "Manual assignment failed.", "danger");
  }
}

function initializeTooltips() {
  // Destroy existing tooltips first
  const existingTooltips = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  existingTooltips.forEach(el => {
    const tooltip = bootstrap.Tooltip.getInstance(el);
    if (tooltip) tooltip.dispose();
  });
  
  // Initialize new tooltips
  const tooltipTriggerList = [].slice.call(document.querySelectorAll('[data-bs-toggle="tooltip"]'));
  tooltipTriggerList.map(function (tooltipTriggerEl) {
    return new bootstrap.Tooltip(tooltipTriggerEl, {
      delay: { show: 500, hide: 100 }
    });
  });
}

/**
 * Render loading state with skeleton rows
 */
function renderLoadingState() {
  const tbody = document.getElementById("leadsTableBody");
  if (!tbody) return;
  
  // Get user preferences for column count
  const prefs = getUserTablePreferences();
  const showCampaign = prefs.showCampaign !== false;
  const showAssigned = prefs.showAssigned !== false;
  const colCount = 6 + (showCampaign ? 1 : 0) + (showAssigned ? 1 : 0);
  
  const skeletonRows = Array(5).fill(0).map(() => {
    let cols = `
      <td><div class="skeleton-text" style="width: 50px;"></div></td>
      <td><div class="skeleton-text" style="width: 120px;"></div></td>
      <td><div class="skeleton-text" style="width: 150px;"></div></td>
      <td><div class="skeleton-text" style="width: 120px;"></div></td>`;
    
    if (showCampaign) {
      cols += `<td><div class="skeleton-text" style="width: 140px;"></div></td>`;
    }
    
    if (showAssigned) {
      cols += `<td><div class="skeleton-text" style="width: 140px;"></div></td>`;
    }
    
    cols += `
      <td><div class="skeleton-text" style="width: 100px;"></div></td>
      <td><div class="skeleton-text" style="width: 200px;"></div></td>`;
    
    return `<tr>${cols}</tr>`;
  }).join("");
  
  tbody.innerHTML = skeletonRows;
}

/**
 * Render empty state
 */
function renderEmptyState() {
  const tbody = document.getElementById("leadsTableBody");
  if (!tbody) return;
  
  // Get column count based on preferences
  const prefs = getUserTablePreferences();
  const showCampaign = prefs.showCampaign !== false;
  const showAssigned = prefs.showAssigned !== false;
  const colCount = 6 + (showCampaign ? 1 : 0) + (showAssigned ? 1 : 0);
  
  const hasFilters = PAGINATION_STATE.currentFilters.status ||
                     PAGINATION_STATE.currentFilters.assignedTo ||
                     PAGINATION_STATE.currentFilters.search ||
                     PAGINATION_STATE.currentFilters.campaign ||
                     PAGINATION_STATE.currentFilters.dateFrom ||
                     PAGINATION_STATE.currentFilters.dateTo;
  
  tbody.innerHTML = `
    <tr>
      <td colspan="${colCount}" class="text-center py-5">
        <div class="empty-state">
          <i class="bi bi-inbox" style="font-size: 64px; color: var(--text-muted); opacity: 0.5;"></i>
          <h5 class="mt-3 mb-2 fw-bold">No Leads Found</h5>
          <p class="text-muted mb-3">
            ${hasFilters 
              ? 'No leads match your current filters. Try adjusting your search criteria.' 
              : 'No leads have been created yet. Click "Add Lead" to get started.'}
          </p>
          ${hasFilters ? `
          <button class="btn btn-sm btn-primary" onclick="clearLeadFilters()">
            <i class="bi bi-x-circle me-1"></i>Clear All Filters
          </button>` : ''}
        </div>
      </td>
    </tr>
  `;
}

/**
 * Render error state
 */
function renderErrorState(error) {
  const tbody = document.getElementById("leadsTableBody");
  if (!tbody) return;
  
  // Get column count based on preferences
  const prefs = getUserTablePreferences();
  const showCampaign = prefs.showCampaign !== false;
  const showAssigned = prefs.showAssigned !== false;
  const colCount = 6 + (showCampaign ? 1 : 0) + (showAssigned ? 1 : 0);
  
  tbody.innerHTML = `
    <tr>
      <td colspan="${colCount}" class="text-center py-5">
        <div class="error-state">
          <i class="bi bi-exclamation-triangle" style="font-size: 48px; color: #B23434;"></i>
          <h5 class="mt-3 mb-2">Unable to Load Leads</h5>
          <p class="text-muted small mb-3">${escapeHtml(error.message || 'An error occurred while loading leads.')}</p>
          <button class="btn btn-sm btn-primary" onclick="loadLeadsPage(${PAGINATION_STATE.currentPage})">
            <i class="bi bi-arrow-clockwise me-1"></i>Retry
          </button>
        </div>
      </td>
    </tr>
  `;
}

// ============================================================
// TABLE PREFERENCES
// ============================================================

/**
 * Get user table preferences (from cache or defaults)
 */
function getUserTablePreferences() {
  // Return cached preferences if available
  if (window.USER_TABLE_PREFS) {
    return window.USER_TABLE_PREFS;
  }
  
  // Return defaults
  return {
    showCampaign: true,
    showAssigned: true,
    tableDensity: "comfortable",
    defaultPageSize: 25
  };
}

/**
 * Open table preferences modal
 */
function openTablePreferences() {
  const prefs = getUserTablePreferences();
  
  // Populate modal with current preferences
  document.getElementById("prefShowCampaign").checked = prefs.showCampaign !== false;
  document.getElementById("prefShowAssigned").checked = prefs.showAssigned !== false;
  document.getElementById("prefTableDensity").value = prefs.tableDensity || "comfortable";
  document.getElementById("prefDefaultPageSize").value = prefs.defaultPageSize || PAGINATION_STATE.pageSize;
  
  // Show modal
  const modal = new bootstrap.Modal(document.getElementById("tablePreferencesModal"));
  modal.show();
}

/**
 * Save table preferences to Firestore
 */
async function saveTablePreferences() {
  const showCampaign = document.getElementById("prefShowCampaign").checked;
  const showAssigned = document.getElementById("prefShowAssigned").checked;
  const tableDensity = document.getElementById("prefTableDensity").value;
  const defaultPageSize = parseInt(document.getElementById("prefDefaultPageSize").value);
  
  const preferences = {
    showCampaign: showCampaign,
    showAssigned: showAssigned,
    tableDensity: tableDensity,
    defaultPageSize: defaultPageSize
  };
  
  try {
    // Save to Firestore user document
    await usersRef.doc(CURRENT_USER.uid).update({
      tablePreferences: preferences
    });
    
    // Update cache
    window.USER_TABLE_PREFS = preferences;
    
    // Apply changes
    applyTableDensity(tableDensity);
    updateTableColumns();
    
    // Update page size if changed
    if (defaultPageSize !== PAGINATION_STATE.pageSize) {
      PAGINATION_STATE.pageSize = defaultPageSize;
      localStorage.setItem("leadsPageSize", defaultPageSize);
      
      // Reload current page with new page size
      clearCache();
      await loadLeadsPage(1);
    } else {
      // Just re-render table
      renderLeadsTable();
    }
    
    // Close modal
    const modal = bootstrap.Modal.getInstance(document.getElementById("tablePreferencesModal"));
    modal.hide();
    
    toast("Table preferences saved successfully.", "success");
    
  } catch (error) {
    console.error("Error saving table preferences:", error);
    toast("Failed to save table preferences.", "danger");
  }
}

/**
 * Reset table preferences to defaults
 */
async function resetTablePreferences() {
  if (!confirm("Reset table preferences to defaults?")) return;
  
  const defaults = {
    showCampaign: true,
    showAssigned: true,
    tableDensity: "comfortable",
    defaultPageSize: 25
  };
  
  try {
    // Save defaults to Firestore
    await usersRef.doc(CURRENT_USER.uid).update({
      tablePreferences: defaults
    });
    
    // Update cache
    window.USER_TABLE_PREFS = defaults;
    
    // Update modal
    document.getElementById("prefShowCampaign").checked = true;
    document.getElementById("prefShowAssigned").checked = true;
    document.getElementById("prefTableDensity").value = "comfortable";
    document.getElementById("prefDefaultPageSize").value = 25;
    
    // Apply changes
    applyTableDensity("comfortable");
    updateTableColumns();
    
    // Update page size
    if (PAGINATION_STATE.pageSize !== 25) {
      PAGINATION_STATE.pageSize = 25;
      localStorage.setItem("leadsPageSize", 25);
      clearCache();
      await loadLeadsPage(1);
    } else {
      renderLeadsTable();
    }
    
    toast("Table preferences reset to defaults.", "success");
    
  } catch (error) {
    console.error("Error resetting table preferences:", error);
    toast("Failed to reset table preferences.", "danger");
  }
}

/**
 * Apply table density class
 */
function applyTableDensity(density) {
  const table = document.querySelector(".leads-table");
  if (!table) return;
  
  // Remove all density classes
  table.classList.remove("table-comfortable", "table-compact", "table-spacious");
  
  // Add selected density class
  if (density === "compact") {
    table.classList.add("table-compact");
  } else if (density === "spacious") {
    table.classList.add("table-spacious");
  } else {
    table.classList.add("table-comfortable");
  }
}

/**
 * Update table column visibility
 */
function updateTableColumns() {
  const prefs = getUserTablePreferences();
  const table = document.querySelector(".leads-table");
  if (!table) return;
  
  // Show/hide Campaign column
  const campaignHeaders = table.querySelectorAll(".col-campaign");
  campaignHeaders.forEach(el => {
    el.style.display = prefs.showCampaign !== false ? "" : "none";
  });
  
  // Show/hide Assigned To column
  const assignedHeaders = table.querySelectorAll(".col-assigned");
  assignedHeaders.forEach(el => {
    el.style.display = prefs.showAssigned !== false ? "" : "none";
  });
}

/**
 * Load user table preferences from Firestore on app initialization
 */
async function loadUserTablePreferences() {
  try {
    const userDoc = await usersRef.doc(CURRENT_USER.uid).get();
    if (userDoc.exists) {
      const userData = userDoc.data();
      if (userData.tablePreferences) {
        window.USER_TABLE_PREFS = userData.tablePreferences;
        
        // Apply preferences
        applyTableDensity(userData.tablePreferences.tableDensity || "comfortable");
        updateTableColumns();
        
        // Update page size if different
        if (userData.tablePreferences.defaultPageSize && 
            userData.tablePreferences.defaultPageSize !== PAGINATION_STATE.pageSize) {
          PAGINATION_STATE.pageSize = userData.tablePreferences.defaultPageSize;
          localStorage.setItem("leadsPageSize", userData.tablePreferences.defaultPageSize);
        }
      }
    }
  } catch (error) {
    console.error("Error loading table preferences:", error);
  }
}

function isUncontactedOverdue(lead) {
  const state = typeof recalculateLeadState === "function" ? recalculateLeadState(lead) : lead;
  return !!state.isOverdue;
}

function isFollowUpDue(lead) {
  if (!lead.nextFollowUpAt) return false;
  return lead.nextFollowUpAt.toDate().getTime() <= Date.now();
}

// ── Overdue helpers ───────────────────────────────────────────────────────────

/**
 * Cancel pending follow-up when lead moves to final status
 */
async function cancelPendingFollowUp(leadId, leadData, newStatus) {
  const leadRef = leadsRef.doc(leadId);
  
  // Update follow-up status to cancelled
  const cancelledFollowUp = {
    ...leadData.followUp,
    status: "Cancelled",
    cancelledAt: firebase.firestore.Timestamp.now(),
    cancelledBy: CURRENT_USER.uid,
    cancelledByName: CURRENT_USER.name || CURRENT_USER.email,
    cancelReason: `Lead moved to final status: ${newStatus}`
  };
  
  // Add timeline entry
  const timelineEntry = {
    text: `Follow-up Cancelled: Lead moved to "${newStatus}" status. Original follow-up was scheduled for ${leadData.followUp.scheduledDate} at ${leadData.followUp.scheduledTime}.`,
    statusAtTime: newStatus,
    updatedBy: CURRENT_USER.uid,
    updatedByName: CURRENT_USER.name || CURRENT_USER.email,
    timestamp: new Date().toISOString(),
    followUpCancelled: true
  };
  
  await leadRef.update({
    followUp: cancelledFollowUp,
    hasPendingFollowUp: false,
    nextFollowUpAt: null,
    history: firebase.firestore.FieldValue.arrayUnion(timelineEntry)
  });
}

/**
 * Returns total minutes a lead has been overdue (0 if not overdue).
 * A lead is urgent when:
 *   (a) status === "Not Open" AND createdAt > UNCONTACTED_ALERT_MINUTES ago, OR
 *   (b) nextFollowUpAt has passed (legacy reminders), OR
 *   (c) hasPendingFollowUp and scheduledTimestamp has passed (new follow-up system)
 */
function overdueMinutes(lead) {
  const state = typeof recalculateLeadState === "function" ? recalculateLeadState(lead) : lead;
  if (!state.isOverdue || !state.dueTime) return 0;

  const dueTimeMs = state.dueTime.toMillis ? state.dueTime.toMillis() : new Date(state.dueTime).getTime();
  const overdueMin = Math.max(0, Math.floor((Date.now() - dueTimeMs) / 60000));
  return overdueMin;
}

/** True when the lead has any urgency (used for row highlighting etc.) */
function isUrgentLead(lead) {
  return overdueMinutes(lead) > 0;
}

/**
 * Returns priority level string and CSS class based on overdue duration.
 *   > 120 min  → Critical  (dark red)
 *   60–120 min → High      (orange)
 *   0–60 min   → Medium    (yellow)
 */
function urgentPriority(overdueMin) {
  if (overdueMin > 120) return { label: "Critical",  cls: "urgent-critical" };
  if (overdueMin >= 60)  return { label: "High",      cls: "urgent-high"     };
  return                        { label: "Medium",    cls: "urgent-medium"   };
}

/** Human-readable overdue label, e.g. "2 hr 15 min" */
function formatOverdue(overdueMin) {
  if (overdueMin < 60) return `${overdueMin} min`;
  const h = Math.floor(overdueMin / 60);
  const m = overdueMin % 60;
  return m > 0 ? `${h} hr ${m} min` : `${h} hr`;
}

// ── WhatsApp phone normaliser (shared) ────────────────────────────────────────
function normalisePhone(raw) {
  let phone = (raw || "").replace(/[\s\-().+]/g, "");
  if (phone.startsWith("0")) phone = "91" + phone.slice(1);
  return /^\d{10,15}$/.test(phone) ? phone : null;
}

// ── Urgent Actions — role-branching entry point ───────────────────────────────
function renderUrgentActions() {
  const container = document.getElementById("urgentActionsBody");
  if (!container) return;

  if (CURRENT_USER.role === "member") {
    _renderUrgentMember(container);
  } else {
    _renderUrgentStaff(container);
  }
}

// ── STAFF view (Admin / Super Admin) — full team ──────────────────────────────
function _renderUrgentStaff(container) {
  // Collect all urgent leads with their overdue minutes, sorted most overdue first
  const urgent = ALL_LEADS
    .map(l => ({ lead: l, min: overdueMinutes(l) }))
    .filter(x => x.min > 0)
    .sort((a, b) => b.min - a.min);

  if (urgent.length === 0) {
    container.innerHTML = `
      <div class="urgent-empty">
        <div class="urgent-empty-icon">🎉</div>
        <div class="urgent-empty-title">Great Job!</div>
        <div class="urgent-empty-sub">No urgent leads right now. All leads are being attended to.</div>
      </div>`;
    return;
  }

  container.innerHTML = urgent.map(({ lead: l, min }) => {
    const { label, cls } = urgentPriority(min);
    const phone = normalisePhone(l.phoneNumber);
    return `
    <div class="urgent-card-v2 ${cls}">
      <div class="urgent-card-priority-bar"></div>
      <div class="urgent-card-body">

        <div class="urgent-card-top">
          <div class="urgent-card-meta">
            <span class="urgent-sl">Sl.No ${l.slNo}</span>
            <span class="urgent-priority-badge ${cls}-badge">${label}</span>
          </div>
          <div class="urgent-overdue-pill ${cls}-pill">
            <i class="bi bi-alarm-fill me-1"></i>Overdue ${formatOverdue(min)}
          </div>
        </div>

        <div class="urgent-card-info">
          <div class="urgent-name">${escapeHtml(l.fullName)}${isLeadNew(l) ? ' <span class="lead-new-badge">NEW</span>' : ''}</div>
          <div class="urgent-company">${escapeHtml(l.companyName || "—")}</div>
          ${l.hasPendingFollowUp && l.followUp ? `
          <div class="followup-timeline-details mt-2">
            <div class="followup-timeline-details-row">
              <span class="followup-timeline-details-label"><i class="bi bi-calendar-check me-1"></i>Follow-up:</span>
              <span class="followup-timeline-details-value">${l.followUp.scheduledDate} at ${l.followUp.scheduledTime}</span>
            </div>
            ${l.followUp.remark ? `
            <div class="followup-timeline-details-row">
              <span class="followup-timeline-details-label"><i class="bi bi-chat-text me-1"></i>Remark:</span>
              <span class="followup-timeline-details-value">${escapeHtml(l.followUp.remark).substring(0, 60)}${l.followUp.remark.length > 60 ? '...' : ''}</span>
            </div>
            ` : ''}
          </div>
          ` : ''}
        </div>

        <div class="urgent-card-details">
          <span class="urgent-detail-item">
            <i class="bi bi-person-fill"></i>${escapeHtml(l.assignedToName || "Unassigned")}
          </span>
          <span class="urgent-detail-item">
            <i class="bi bi-telephone-fill"></i>${escapeHtml(l.phoneNumber || "—")}
          </span>
          <span class="urgent-detail-item">
            <span class="status-badge ${STATUS_BADGE_CLASS[l.status] || ""}">${l.status}</span>
          </span>
        </div>

        <div class="urgent-card-actions">
          ${phone ? `
          <a href="tel:${phone}" class="btn btn-sm btn-success">
            <i class="bi bi-telephone-fill"></i> Call
          </a>` : ""}
          <button class="btn btn-sm btn-primary" onclick="openStatusModal('${l.id}')">
            <i class="bi bi-pencil-square"></i> Update
          </button>
          <button class="btn btn-sm btn-ai-pitch" onclick="openSalesPitchModal('${l.id}')">
            <i class="bi bi-robot"></i> AI Pitch
          </button>
          ${phone ? `
          <a href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-whatsapp">
            <i class="bi bi-whatsapp"></i> WhatsApp
          </a>` : ""}
          <button class="btn btn-sm btn-outline-secondary" onclick="openHistoryModal('${l.id}')">
            <i class="bi bi-clock-history"></i> History
          </button>
        </div>

      </div>
    </div>`;
  }).join("");
}

// ── MEMBER view — only their own urgent leads ─────────────────────────────────
function _renderUrgentMember(container) {
  const urgent = ALL_LEADS
    .filter(l => l.assignedTo === CURRENT_USER.uid)   // safety: members only see their own
    .map(l => ({ lead: l, min: overdueMinutes(l) }))
    .filter(x => x.min > 0)
    .sort((a, b) => b.min - a.min);

  if (urgent.length === 0) {
    container.innerHTML = `
      <div class="urgent-empty">
        <div class="urgent-empty-icon">🎉</div>
        <div class="urgent-empty-title">Great Job!</div>
        <div class="urgent-empty-sub">No urgent leads assigned to you. Keep it up!</div>
      </div>`;
    return;
  }

  container.innerHTML = urgent.map(({ lead: l, min }) => {
    const { label, cls } = urgentPriority(min);
    const phone = normalisePhone(l.phoneNumber);
    return `
    <div class="urgent-card-v2 ${cls}">
      <div class="urgent-card-priority-bar"></div>
      <div class="urgent-card-body">

        <div class="urgent-card-top">
          <div class="urgent-card-meta">
            <span class="urgent-sl">Sl.No ${l.slNo}</span>
            <span class="urgent-priority-badge ${cls}-badge">${label}</span>
          </div>
          <div class="urgent-overdue-pill ${cls}-pill">
            <i class="bi bi-alarm-fill me-1"></i>Overdue ${formatOverdue(min)}
          </div>
        </div>

        <div class="urgent-card-info">
          <div class="urgent-name">${escapeHtml(l.fullName)}${isLeadNew(l) ? ' <span class="lead-new-badge">NEW</span>' : ''}</div>
          <div class="urgent-company">${escapeHtml(l.companyName || "—")}</div>
          ${l.hasPendingFollowUp && l.followUp ? `
          <div class="followup-timeline-details mt-2">
            <div class="followup-timeline-details-row">
              <span class="followup-timeline-details-label"><i class="bi bi-calendar-check me-1"></i>Follow-up:</span>
              <span class="followup-timeline-details-value">${l.followUp.scheduledDate} at ${l.followUp.scheduledTime}</span>
            </div>
            ${l.followUp.remark ? `
            <div class="followup-timeline-details-row">
              <span class="followup-timeline-details-label"><i class="bi bi-chat-text me-1"></i>Remark:</span>
              <span class="followup-timeline-details-value">${escapeHtml(l.followUp.remark).substring(0, 60)}${l.followUp.remark.length > 60 ? '...' : ''}</span>
            </div>
            ` : ''}
          </div>
          ` : ''}
        </div>

        <div class="urgent-card-details">
          ${phone ? `<span class="urgent-detail-item"><i class="bi bi-telephone-fill"></i>${escapeHtml(l.phoneNumber)}</span>` : ""}
          <span class="urgent-detail-item">
            <span class="status-badge ${STATUS_BADGE_CLASS[l.status] || ""}">${l.status}</span>
          </span>
        </div>

        <div class="urgent-card-actions">
          ${phone ? `
          <a href="tel:${phone}" class="btn btn-sm btn-success">
            <i class="bi bi-telephone-fill"></i> Call
          </a>` : ""}
          <button class="btn btn-sm btn-primary" onclick="openStatusModal('${l.id}')">
            <i class="bi bi-pencil-square"></i> Update
          </button>
          <button class="btn btn-sm btn-ai-pitch" onclick="openSalesPitchModal('${l.id}')">
            <i class="bi bi-robot"></i> AI Pitch
          </button>
          ${phone ? `
          <a href="https://wa.me/${phone}" target="_blank" rel="noopener noreferrer" class="btn btn-sm btn-whatsapp">
            <i class="bi bi-whatsapp"></i> WhatsApp
          </a>` : ""}
        </div>

      </div>
    </div>`;
  }).join("");
}

// ---------------- MEMBER FOLLOW-UP LIST ----------------
function renderMyFollowUps() {
  const container = document.getElementById("myFollowUpsBody");
  if (!container) return;

  const dueList = ALL_LEADS
    .filter((l) => l.nextFollowUpAt)
    .sort((a, b) => a.nextFollowUpAt.toMillis() - b.nextFollowUpAt.toMillis());

  if (dueList.length === 0) {
    container.innerHTML = `<p class="text-muted">No pending follow-ups scheduled.</p>`;
    return;
  }

  container.innerHTML = dueList.map((l) => {
    const dt = l.nextFollowUpAt.toDate();
    const due = dt.getTime() <= Date.now();
    return `
    <div class="followup-card ${due ? "followup-due" : ""}">
      <div>
        <strong>${escapeHtml(l.fullName)}${isLeadNew(l) ? ' <span class="lead-new-badge">NEW</span>' : ''}</strong> · ${escapeHtml(l.phoneNumber)}
        <div class="small text-muted">Status: ${l.status} · Sl.No ${l.slNo}</div>
      </div>
      <div class="text-end">
        <div class="fw-semibold ${due ? "text-danger" : ""}">${due ? "Call now" : "Call at " + formatDateTime(dt)}</div>
        <button class="btn btn-sm btn-primary mt-1" onclick="openStatusModal('${l.id}')">Update</button>
      </div>
    </div>`;
  }).join("");
}

// ---------------- REMINDER WATCHER (toasts) ----------------
function startReminderWatcher() {
  checkReminders();
  setInterval(checkReminders, 60000); // check every minute
}

function checkReminders() {
  // Suppress all reminders during breaks, holidays, and outside office hours
  if (typeof shouldSuppressReminders === "function" && shouldSuppressReminders()) return;

  const toastEnabled = (typeof getCRMSetting === "function"
    ? getCRMSetting("notificationRules.toastNotifications") : true) !== false;
  const browserEnabled = (typeof getCRMSetting === "function"
    ? getCRMSetting("notificationRules.browserNotifications") : true) !== false;

  ALL_LEADS.forEach((l) => {
    const key = l.id + "_" + l.status;

    if (isUncontactedOverdue(l) && !toastedLeadIds.has(key)) {
      toastedLeadIds.add(key);
      if (CURRENT_USER.role === "member") {
        if (l.assignedTo === CURRENT_USER.uid) {
          if (toastEnabled)   toast(`Lead #${l.slNo} needs immediate attention — ${l.fullName}.`, "warning");
          if (browserEnabled) browserNotify("Urgent Lead", `Lead #${l.slNo} — ${l.fullName} (${l.phoneNumber})`);
        }
      } else {
        if (toastEnabled) toast(
          `Overdue: <strong>${escapeHtml(l.fullName)}</strong> (Sl.No ${l.slNo}) — assigned to ${escapeHtml(l.assignedToName)} — ${formatOverdue(overdueMinutes(l))} overdue.`,
          "danger"
        );
      }
    }

    if (CURRENT_USER.role === "member" && isFollowUpDue(l) && !toastedLeadIds.has(key + "_followup")) {
      if (l.assignedTo === CURRENT_USER.uid) {
        toastedLeadIds.add(key + "_followup");
        if (toastEnabled)   toast(`Follow-up due now: ${escapeHtml(l.fullName)} (${l.status}).`, "info");
        if (browserEnabled) browserNotify("Follow-up due", `${l.fullName} — ${l.status}`);
      }
    }
  });

  // ── Update sidebar badge ──────────────────────────────────────────────────
  const badge = document.getElementById("urgentBadge");
  if (!badge) return;

  let urgentCount = 0;
  if (CURRENT_USER.role === "member") {
    urgentCount = ALL_LEADS.filter(
      l => l.assignedTo === CURRENT_USER.uid && overdueMinutes(l) > 0
    ).length;
  } else {
    urgentCount = ALL_LEADS.filter(l => overdueMinutes(l) > 0).length;
  }

  if (urgentCount > 0) {
    badge.textContent = urgentCount;
    badge.classList.remove("d-none");
  } else {
    badge.classList.add("d-none");
  }

  // Also refresh the urgent view if it is currently visible
  const urgentSection = document.getElementById("view-urgent");
  if (urgentSection && !urgentSection.classList.contains("d-none")) {
    renderUrgentActions();
  }
}

// ---------------- MODALS: Add Lead ----------------
const addLeadForm = document.getElementById("addLeadForm");
if (addLeadForm) {
  addLeadForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("addLeadSubmitBtn");

    const campaignSel = document.getElementById("leadCampaign");
    if (campaignSel && !campaignSel.value) {
      toast("Please select a Campaign Type.", "warning");
      return;
    }

    let campaignInfo = null;
    try {
      campaignInfo = collectCampaignDataFromAddLeadForm(); // null on legacy / no-campaign path
    } catch (err) {
      toast(err.message, "warning");
      return;
    }

    btn.disabled = true;
    try {
      await createLead({
        serviceNeeded: document.getElementById("leadService").value.trim(),
        email: document.getElementById("leadEmail").value.trim(),
        fullName: document.getElementById("leadFullName").value.trim(),
        phoneNumber: document.getElementById("leadPhone").value.trim(),
        companyName: document.getElementById("leadCompany").value.trim(),
        campaignId:          campaignInfo ? campaignInfo.campaignId : null,
        campaignName:        campaignInfo ? campaignInfo.campaignName : null,
        campaignData:        campaignInfo ? campaignInfo.campaignData : null,
        campaignFieldsMeta:  campaignInfo ? campaignInfo.campaignFieldsMeta : null,
        assignmentRole:      campaignInfo ? campaignInfo.assignmentRole : "member"
      });
      addLeadForm.reset();
      resetAddLeadCampaignUI();
      bootstrap.Modal.getInstance(document.getElementById("addLeadModal")).hide();
      toast("Lead added and auto-assigned.", "success");
    } catch (err) {
      console.error(err);
      toast(err.message || "Failed to add lead.", "danger");
    } finally {
      btn.disabled = false;
    }
  });
}

// ---------------- MODALS: Update Status ----------------
let currentStatusLeadId = null;

function openStatusModal(leadId) {
  const lead = ALL_LEADS.find((l) => l.id === leadId);
  if (!lead) return;
  currentStatusLeadId = leadId;

  document.getElementById("statusModalLeadName").textContent = `${lead.fullName} — ${lead.phoneNumber}`;
  const select = document.getElementById("statusSelect");
  
  // Build dropdown with all regular statuses (SYSTEM_STATUSES are never selectable)
  // "Not Interested" IS visible for everyone - it's intercepted for members
  select.innerHTML = STATUS_LIST.map((s) => `<option value="${s}" ${s === lead.status ? "selected" : ""}>${s}</option>`).join("");
  document.getElementById("statusNote").value = "";

  new bootstrap.Modal(document.getElementById("statusModal")).show();
}

const statusUpdateForm = document.getElementById("statusUpdateForm");
if (statusUpdateForm) {
  statusUpdateForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const newStatus = document.getElementById("statusSelect").value;
    const note = document.getElementById("statusNote").value;
    const lead = ALL_LEADS.find(l => l.id === currentStatusLeadId);
    
    // Check if this is a "Not Interested" status for non-admin users
    if (newStatus === "Not Interested" && CURRENT_USER.role !== "admin" && CURRENT_USER.role !== "superadmin") {
      // Intercept and open call audit modal - do NOT change status directly
      handleNotInterestedStatus(currentStatusLeadId, lead);
      return;
    }

    // Sales Members trigger HR transfer requests for Driver status
    if (newStatus === "Driver" && CURRENT_USER.role === "member") {
      await createHRTransferRequest(currentStatusLeadId, lead, note);
      bootstrap.Modal.getInstance(document.getElementById("statusModal")).hide();
      return;
    }

    try {
      await updateLeadStatus(currentStatusLeadId, newStatus, note);
      bootstrap.Modal.getInstance(document.getElementById("statusModal")).hide();
      toast("Status updated.", "success");
    } catch (err) {
      console.error(err);
      toast("Failed to update status.", "danger");
    }
  });
}

// ---------------- MODAL: History ----------------
function openHistoryModal(leadId) {
  const lead = ALL_LEADS.find((l) => l.id === leadId);
  if (!lead) return;

  document.getElementById("historyModalLeadName").textContent = `${lead.fullName} — Sl.No ${lead.slNo}`;
  const body = document.getElementById("historyModalBody");

  const history = [...(lead.history || [])].reverse();
  if (history.length === 0) {
    body.innerHTML = `<p class="text-muted">No history yet.</p>`;
  } else {
    body.innerHTML = history.map((h) => {
      // Build attempt badge if this is a Not Picking Call entry
      let attemptBadge = "";
      if (h.attemptCount && h.maxAttempts) {
        const isMaxReached = h.attemptCount >= h.maxAttempts;
        const badgeClass = isMaxReached ? "bg-danger" : "bg-warning text-dark";
        attemptBadge = `<span class="badge ${badgeClass} ms-2">Attempt ${h.attemptCount}/${h.maxAttempts}</span>`;
      }
      
      return `
      <div class="history-entry">
        <div class="d-flex justify-content-between align-items-start">
          <span class="fw-semibold">${escapeHtml(h.updatedByName || "Unknown")}</span>
          <span class="small text-muted">${formatDateTime(new Date(h.timestamp))}</span>
        </div>
        <div class="small text-muted mb-1">
          Status: ${h.statusAtTime || "-"}${attemptBadge}
        </div>
        <div>${escapeHtml(h.text)}</div>
      </div>`;
    }).join("");
  }

  new bootstrap.Modal(document.getElementById("historyModal")).show();
}

// ---------------- DELETE CONFIRM (Super Admin) ----------------
function confirmDeleteLead(leadId) {
  const lead = ALL_LEADS.find((l) => l.id === leadId);
  if (!lead) return;
  if (confirm(`Delete lead "${lead.fullName}" (Sl.No ${lead.slNo})? This cannot be undone.`)) {
    deleteLead(leadId)
      .then(() => toast("Lead deleted.", "success"))
      .catch((err) => {
        console.error(err);
        toast("Failed to delete lead.", "danger");
      });
  }
}

// ---------------- UTILS ----------------
function formatDateTime(date) {
  return date.toLocaleString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit"
  });
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Export functions to window for use by other modules
window.loadLeadsView = loadLeadsView;
window.renderHRTransferRequests = renderHRTransferRequests;

// Export global variables for use by other modules
window.ALL_LEADS = ALL_LEADS;
window.ACTIVE_MEMBERS = ACTIVE_MEMBERS;
window.ACTIVE_HR = ACTIVE_HR;