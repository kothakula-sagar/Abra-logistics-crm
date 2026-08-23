// ============================================================
// HR-TRANSFERS.JS — HR Transfer Dashboard and Workflow
// ============================================================
// Handles Driver → HR transfer requests
// Reuses existing assignment engine, leave management, and reports
// ============================================================

// Collection reference
const hrTransfersRef = db.collection("hrTransfers");

// Global state
let ALL_HR_TRANSFERS = [];
// ACTIVE_HR is defined in leads.js and exported to window

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

// Safe access to global variables from other modules
function getActiveMembers() {
  return window.ACTIVE_MEMBERS || [];
}

function getActiveCampaigns() {
  return window.ALL_CAMPAIGNS || [];
}

function getAllLeads() {
  return window.ALL_LEADS || [];
}

// Utility functions (if not available globally)
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

function formatDateTime(date) {
  if (!date) return '—';
  if (typeof date.toDate === 'function') {
    date = date.toDate();
  }
  return date.toLocaleString();
}

function toast(message, type = 'info') {
  if (typeof window.toast === 'function') {
    window.toast(message, type);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// ============================================================
// INITIALIZATION
// ============================================================

async function loadHRTransfersView() {
  const container = document.getElementById("hrTransfersContentArea");
  if (!container) return;
  
  container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2">Loading HR Transfers...</p></div>';
  
  try {
    // Ensure we have access to required global data
    if (typeof window.ACTIVE_MEMBERS === 'undefined') window.ACTIVE_MEMBERS = [];
    if (typeof window.ACTIVE_HR === 'undefined') window.ACTIVE_HR = [];
    if (typeof window.ALL_CAMPAIGNS === 'undefined') window.ALL_CAMPAIGNS = [];
    
    // Perform data audit and auto-migration if needed
    await performDataAuditAndMigration();
    
    await Promise.all([
      loadHRTransfers(),
      refreshActiveHR()
    ]);
    
    renderHRTransfersDashboard();
  } catch (error) {
    console.error("Error loading HR transfers:", error);
    container.innerHTML = '<div class="alert alert-danger">Failed to load HR Transfers. Please try again.</div>';
  }
}

// ============================================================
// DATA AUDIT AND AUTO-MIGRATION
// ============================================================

async function performDataAuditAndMigration() {
  console.log("╔════════════════════════════════════════════════════════════╗");
  console.log("║         HR TRANSFER DATA AUDIT - COMPREHENSIVE            ║");
  console.log("╚════════════════════════════════════════════════════════════╝");
  
  // STEP 1: Count ALL leads
  const allLeadsSnapshot = await leadsRef.get();
  const totalLeads = allLeadsSnapshot.size;
  console.log(`\n📊 STEP 1: Total Leads in Database = ${totalLeads}`);
  
  // STEP 2: Find Driver leads - inspect actual schema
  console.log(`\n🔍 STEP 2: Finding Driver Leads...`);
  console.log(`Querying: leadsRef.where("status", "==", "Driver")`);
  
  const driverLeadsSnapshot = await leadsRef.where("status", "==", "Driver").get();
  const driverLeadsCount = driverLeadsSnapshot.size;
  
  console.log(`\n✅ Driver Leads Found = ${driverLeadsCount}`);
  
  const driverLeads = [];
  if (driverLeadsCount > 0) {
    console.log("\n📋 Driver Leads Details:");
    driverLeadsSnapshot.forEach(doc => {
      const lead = doc.data();
      const leadInfo = {
        id: doc.id,
        slNo: lead.slNo || "N/A",
        customerName: lead.fullName || "Unknown",
        campaign: lead.campaignName || "General",
        currentStatus: lead.status,
        assignedSalesMember: lead.assignedToName || "Unassigned",
        hrTransferCreated: lead.hrTransferCreated || false,
        hrTransferId: lead.hrTransferId || null
      };
      driverLeads.push(leadInfo);
    });
    console.table(driverLeads);
  } else {
    console.log("ℹ️  No Driver leads found in database");
  }
  
  // STEP 3: Read hrTransfers collection
  console.log(`\n🔍 STEP 3: Reading hrTransfers Collection...`);
  const transfersSnapshotBefore = await hrTransfersRef.get();
  const transfersCountBefore = transfersSnapshotBefore.size;
  
  console.log(`\n📦 Transfer Records Found (BEFORE) = ${transfersCountBefore}`);
  
  if (transfersCountBefore > 0) {
    const existingTransfers = [];
    transfersSnapshotBefore.forEach(doc => {
      const transfer = doc.data();
      existingTransfers.push({
        id: doc.id,
        leadId: transfer.leadId,
        slNo: transfer.slNo,
        customer: transfer.customerName,
        approvalStatus: transfer.approvalStatus,
        hrAssigned: transfer.hrAssignedToName || "None"
      });
    });
    console.table(existingTransfers);
  } else {
    console.log("ℹ️  hrTransfers collection is EMPTY");
  }
  
  // STEP 4: Create missing transfer records
  console.log(`\n🔧 STEP 4: Checking for Missing Transfers...`);
  
  if (driverLeadsCount > 0) {
    // Get existing transfer lead IDs to avoid duplicates
    const existingTransferLeadIds = new Set();
    transfersSnapshotBefore.forEach(doc => {
      const transfer = doc.data();
      if (transfer.leadId) {
        existingTransferLeadIds.add(transfer.leadId);
      }
    });
    
    // Find leads without transfers
    const leadsNeedingTransfers = [];
    driverLeadsSnapshot.forEach(doc => {
      if (!existingTransferLeadIds.has(doc.id)) {
        leadsNeedingTransfers.push({
          id: doc.id,
          data: doc.data()
        });
      }
    });
    
    if (leadsNeedingTransfers.length > 0) {
      console.log(`\n⚠️  Missing Transfers Detected: ${leadsNeedingTransfers.length} Driver leads without transfer records`);
      console.log(`Creating transfer records...`);
      
      let createdCount = 0;
      const batch = db.batch();
      
      for (const { id: leadId, data: lead } of leadsNeedingTransfers) {
        const transferId = `auto_${leadId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const transferRef = hrTransfersRef.doc(transferId);
        const now = firebase.firestore.Timestamp.now();
        
        const transferData = {
          leadId: leadId,
          slNo: lead.slNo || 0,
          customerName: lead.fullName || "Unknown",
          company: lead.companyName || "",
          phone: lead.phoneNumber || "",
          campaign: lead.campaignName || "General",
          campaignId: lead.campaignId || null,
          salesMember: lead.assignedToName || "Unassigned",
          salesMemberId: lead.assignedTo || null,
          currentAssignedTo: lead.assignedTo || null,
          currentAssignedRole: "member",
          requestedBy: "system-audit",
          requestedByName: "System Auto-Audit",
          requestedAt: now,
          targetRole: "hr",
          approvalStatus: "pending",
          migrationType: "audit-recovery",
          createdAt: now,
          assignmentPending: false,
          timeline: [{
            action: "Transfer Created",
            description: "Auto-created by system audit for existing Driver lead",
            timestamp: now,
            actor: "system-audit",
            actorName: "System Auto-Audit"
          }]
        };
        
        batch.set(transferRef, transferData);
        
        // Mark lead as having transfer created
        batch.update(leadsRef.doc(leadId), {
          hrTransferCreated: true,
          hrTransferId: transferId
        });
        
        createdCount++;
        
        console.log(`  ✓ Creating transfer for Lead #${lead.slNo} (${lead.fullName})`);
      }
      
      // Commit batch
      await batch.commit();
      console.log(`\n✅ Successfully created ${createdCount} transfer records`);
      
    } else {
      console.log(`✅ All Driver leads already have transfer records (no action needed)`);
    }
  } else {
    console.log(`ℹ️  No Driver leads found - no transfers to create`);
  }
  
  // STEP 5: Verify results
  console.log(`\n🔍 STEP 5: Verifying Results...`);
  const transfersSnapshotAfter = await hrTransfersRef.get();
  const transfersCountAfter = transfersSnapshotAfter.size;
  
  const pendingCount = Array.from(transfersSnapshotAfter.docs)
    .filter(doc => doc.data().approvalStatus === "pending").length;
  
  // STEP 6: Print summary
  console.log(`\n╔════════════════════════════════════════════════════════════╗`);
  console.log(`║                    AUDIT SUMMARY                          ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║ Total Leads in Database:        ${String(totalLeads).padStart(4)} leads          ║`);
  console.log(`║ Driver Leads Found:             ${String(driverLeadsCount).padStart(4)} leads          ║`);
  console.log(`║ Transfer Records (BEFORE):      ${String(transfersCountBefore).padStart(4)} records        ║`);
  console.log(`║ Transfer Records Created:       ${String(transfersCountAfter - transfersCountBefore).padStart(4)} records        ║`);
  console.log(`║ Transfer Records (AFTER):       ${String(transfersCountAfter).padStart(4)} records        ║`);
  console.log(`║ Pending Approval:               ${String(pendingCount).padStart(4)} pending        ║`);
  console.log(`╠════════════════════════════════════════════════════════════╣`);
  console.log(`║ Status: ${driverLeadsCount === transfersCountAfter ? '✅ SYNCED' : '⚠️  OUT OF SYNC'}                                     ║`);
  console.log(`╚════════════════════════════════════════════════════════════╝`);
  
  if (pendingCount === 0 && driverLeadsCount > 0) {
    console.warn(`\n⚠️  WARNING: ${driverLeadsCount} Driver leads exist but Pending Approval = 0`);
    console.warn(`This may indicate a data inconsistency. Check approvalStatus values.`);
  }
}

async function loadHRTransfers() {
  try {
    console.log("Loading HR transfers from collection: hrTransfers");
    const snap = await hrTransfersRef.orderBy("requestedAt", "desc").get();
    ALL_HR_TRANSFERS = [];
    snap.forEach(doc => {
      ALL_HR_TRANSFERS.push({ id: doc.id, ...doc.data() });
    });
    console.log(`Loaded ${ALL_HR_TRANSFERS.length} HR transfer records`);
    
    // Log status breakdown
    if (ALL_HR_TRANSFERS.length > 0) {
      const pending = ALL_HR_TRANSFERS.filter(t => t.approvalStatus === "pending").length;
      const approved = ALL_HR_TRANSFERS.filter(t => t.approvalStatus === "approved").length;
      const rejected = ALL_HR_TRANSFERS.filter(t => t.approvalStatus === "rejected").length;
      const waitingAssignment = ALL_HR_TRANSFERS.filter(t => 
        t.approvalStatus === "approved" && !t.hrAssignedTo && t.assignmentPending
      ).length;
      
      console.log("Status Breakdown:");
      console.log(`  Pending Approval: ${pending}`);
      console.log(`  Approved: ${approved}`);
      console.log(`  Rejected: ${rejected}`);
      console.log(`  Waiting Assignment: ${waitingAssignment}`);
    }
  } catch (error) {
    console.error("Error loading HR transfers:", error);
    ALL_HR_TRANSFERS = [];
  }
}

async function refreshActiveHR() {
  try {
    const snap = await usersRef
      .where("role", "==", "hr")
      .where("active", "==", true)
      .get();
    let activeHR = [];
    snap.forEach(doc => {
      activeHR.push({ id: doc.id, ...doc.data() });
    });
    window.ACTIVE_HR = activeHR; // Update the global reference
  } catch (error) {
    console.error("Error loading HR users:", error);
    window.ACTIVE_HR = [];
  }
}

// ============================================================
// LEGACY DRIVER MIGRATION
// ============================================================

async function migrateLegacyDriverLeads() {
  console.log("Starting legacy Driver leads migration...");
  
  try {
    // Find all Driver leads without HR transfer
    const snapshot = await leadsRef
      .where("status", "==", "Driver")
      .where("hrTransferCreated", "!=", true)
      .get();
    
    if (snapshot.empty) {
      console.log("No legacy Driver leads found for migration");
      toast("No legacy Driver leads found", "info");
      return { migrated: 0, skipped: 0 };
    }
    
    const batch = db.batch();
    let migratedCount = 0;
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;
    
    for (const doc of snapshot.docs) {
      const lead = doc.data();
      
      // Create HR transfer request
      const transferId = `legacy_${doc.id}`;
      const transferRef = hrTransfersRef.doc(transferId);
      
      const transferData = {
        leadId: doc.id,
        slNo: lead.slNo,
        customerName: lead.fullName,
        company: lead.companyName || "",
        phone: lead.phoneNumber,
        campaign: lead.campaignName || "General",
        campaignId: lead.campaignId || null,
        salesMember: lead.assignedToName || "Unknown",
        salesMemberId: lead.assignedTo || null,
        currentAssignedTo: lead.assignedTo,
        currentAssignedRole: "member",
        requestedBy: "system-migration",
        requestedByName: "System Migration",
        requestedAt: firebase.firestore.Timestamp.now(),
        targetRole: "hr",
        approvalStatus: "pending",
        migrationType: "legacy",
        createdAt: firebase.firestore.Timestamp.now(),
        timeline: [{
          action: "Legacy Migration",
          description: "Migrated from existing Driver lead",
          timestamp: firebase.firestore.Timestamp.now(),
          actor: "system-migration",
          actorName: "System Migration"
        }]
      };
      
      batch.set(transferRef, transferData);
      
      // Mark lead as migrated
      batch.update(doc.ref, {
        hrTransferCreated: true,
        hrTransferId: transferId
      });
      
      migratedCount++;
      batchCount++;
      
      // Commit batch if reaching limit
      if (batchCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        console.log(`Committed batch of ${batchCount} migrations`);
        batchCount = 0;
      }
    }
    
    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
      console.log(`Committed final batch of ${batchCount} migrations`);
    }
    
    console.log(`Migration complete: ${migratedCount} Driver leads migrated`);
    toast(`Successfully migrated ${migratedCount} Driver leads to HR Transfer system`, "success");
    
    // Reload transfers
    await loadHRTransfers();
    renderHRTransfersDashboard();
    
    return { migrated: migratedCount, skipped: 0 };
  } catch (error) {
    console.error("Migration failed:", error);
    toast("Migration failed: " + error.message, "danger");
    throw error;
  }
}

// ============================================================
// DASHBOARD RENDERING
// ============================================================

function renderHRTransfersDashboard() {
  const container = document.getElementById("hrTransfersContentArea");
  if (!container) return;
  
  const stats = calculateHRTransferStats();
  const today = new Date().toISOString().slice(0, 10);
  
  // Log dashboard load stats
  console.log("=== DASHBOARD LOADED ===");
  console.log(`Total Transfers: ${stats.total}`);
  console.log(`Pending Approval: ${stats.pending}`);
  console.log(`Approved Today: ${stats.approvedToday}`);
  console.log(`Rejected: ${stats.rejected}`);
  console.log(`Waiting Assignment: ${stats.waitingAssignment}`);
  console.log(`Assigned to HR: ${stats.assigned}`);
  console.log("======================");
  
  container.innerHTML = `
    <div class="hr-transfers-dashboard">
      <!-- Header -->
      <div class="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 class="mb-1">
            <i class="bi bi-arrow-left-right me-2"></i>HR Transfer Dashboard
          </h1>
          <p class="text-muted mb-0">Manage Driver to HR transfer approvals and assignments</p>
        </div>
        <div class="btn-group">
          ${CURRENT_USER.role === "superadmin" ? `
          <button class="btn btn-outline-secondary" onclick="migrateLegacyDriverLeads()">
            <i class="bi bi-database-add me-1"></i>Migrate Legacy Drivers
          </button>
          ` : ''}
          <button class="btn btn-outline-primary" onclick="refreshHRTransfers()">
            <i class="bi bi-arrow-clockwise me-1"></i>Refresh
          </button>
        </div>
      </div>
      
      <!-- KPI Cards -->
      <div class="row g-3 mb-4">
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-hourglass-split text-warning fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.pending}</h3>
              <small class="text-muted">Pending Approval</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-check-circle-fill text-success fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.approvedToday}</h3>
              <small class="text-muted">Approved Today</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-x-circle-fill text-danger fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.rejected}</h3>
              <small class="text-muted">Rejected</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-clock-history text-info fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.waitingAssignment}</h3>
              <small class="text-muted">Waiting Assignment</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-person-check-fill text-primary fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.assigned}</h3>
              <small class="text-muted">Assigned to HR</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-arrow-repeat text-secondary fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.total}</h3>
              <small class="text-muted">Total Transfers</small>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Filters -->
      <div class="card mb-3">
        <div class="card-body">
          <div class="row g-2">
            <div class="col-md-2">
              <label class="form-label small">Status</label>
              <select class="form-select form-select-sm" id="hrTransferStatusFilter" onchange="filterHRTransfers()">
                <option value="">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
                <option value="waiting_assignment">Waiting Assignment</option>
                <option value="assigned">Assigned to HR</option>
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small">Sales Member</label>
              <select class="form-select form-select-sm" id="hrTransferSalesMemberFilter" onchange="filterHRTransfers()">
                <option value="">All Members</option>
                ${getActiveMembers().map(m => `<option value="${m.id}">${escapeHtml(m.name || m.email)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small">HR Member</label>
              <select class="form-select form-select-sm" id="hrTransferHRMemberFilter" onchange="filterHRTransfers()">
                <option value="">All HR</option>
                ${(window.ACTIVE_HR || []).map(h => `<option value="${h.id}">${escapeHtml(h.name || h.email)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small">Campaign</label>
              <select class="form-select form-select-sm" id="hrTransferCampaignFilter" onchange="filterHRTransfers()">
                <option value="">All Campaigns</option>
                ${getActiveCampaigns().map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-2">
              <label class="form-label small">From Date</label>
              <input type="date" class="form-control form-control-sm" id="hrTransferFromDate" onchange="filterHRTransfers()">
            </div>
            <div class="col-md-2">
              <label class="form-label small">To Date</label>
              <input type="date" class="form-control form-control-sm" id="hrTransferToDate" onchange="filterHRTransfers()">
            </div>
          </div>
          <div class="row g-2 mt-2">
            <div class="col-md-6">
              <input type="text" class="form-control form-control-sm" id="hrTransferSearch" placeholder="Search by lead #, name, phone..." onkeyup="filterHRTransfers()">
            </div>
            <div class="col-md-6 text-end">
              <button class="btn btn-sm btn-outline-secondary" onclick="clearHRTransferFilters()">
                <i class="bi bi-x-circle me-1"></i>Clear Filters
              </button>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Transfer Table -->
      <div class="card mb-4">
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead class="table-light sticky-top">
                <tr>
                  <th>Lead #</th>
                  <th>Customer</th>
                  <th>Company</th>
                  <th>Campaign</th>
                  <th>Sales Member</th>
                  <th>Requested On</th>
                  <th>Status</th>
                  <th>HR Assigned</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="hrTransfersTableBody">
                ${renderHRTransfersTable()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      
      <!-- Waiting Assignment Section -->
      ${stats.waitingAssignment > 0 ? `
      <div class="card">
        <div class="card-header bg-warning bg-opacity-10">
          <h5 class="mb-0">
            <i class="bi bi-clock-history me-2"></i>
            Waiting Assignment (${stats.waitingAssignment})
          </h5>
          <small class="text-muted">Approved transfers waiting for HR member assignment</small>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead class="table-light">
                <tr>
                  <th>Lead</th>
                  <th>Campaign</th>
                  <th>Sales Member</th>
                  <th>Approved By</th>
                  <th>Approved On</th>
                  <th>Waiting Since</th>
                  <th>Reason</th>
                  <th>Next Retry</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                ${renderWaitingAssignmentTable()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  `;
  
  // Initialize date filters to today
  const todayDate = new Date().toISOString().slice(0, 10);
  const fromDateInput = document.getElementById("hrTransferFromDate");
  const toDateInput = document.getElementById("hrTransferToDate");
  if (fromDateInput) fromDateInput.value = todayDate;
  if (toDateInput) toDateInput.value = todayDate;
  
  // ============================================================
  // EVENT DELEGATION FOR TRANSFER ACTION BUTTONS
  // ============================================================
  console.log("✓ Setting up event delegation for transfer buttons");
  
  // Remove old listeners if any
  const oldListener = container._transferButtonListener;
  if (oldListener) {
    container.removeEventListener('click', oldListener);
  }
  
  // Add new event delegation listener
  const transferButtonListener = function(e) {
    const target = e.target.closest('button');
    if (!target) return;
    
    console.log("🖱️ Button clicked via delegation:", target.className);
    
    // Approve button
    if (target.classList.contains('approve-transfer-btn')) {
      const transferId = target.getAttribute('data-transfer-id');
      console.log("✓ Approve button clicked, transferId:", transferId);
      e.preventDefault();
      e.stopPropagation();
      
      // INLINE IMPLEMENTATION - Call directly without relying on window.approveHRTransfer
      (async function() {
        console.log("✓✓✓ INLINE APPROVE STARTING");
        try {
          const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
          if (!transfer) {
            toast("Transfer not found", "danger");
            return;
          }
          
          const leadDoc = await leadsRef.doc(transfer.leadId).get();
          if (!leadDoc.exists) {
            toast("Lead not found", "danger");
            return;
          }
          
          const lead = { id: leadDoc.id, ...leadDoc.data() };
          
          // Load call audits WITHOUT orderBy to avoid index requirement
          let callAudits = [];
          try {
            const callAuditsSnap = await callAuditsRef
              .where("leadId", "==", transfer.leadId)
              .get();
            
            callAuditsSnap.forEach(doc => {
              callAudits.push({ id: doc.id, ...doc.data() });
            });
            
            // Sort in memory instead of in query
            callAudits.sort((a, b) => {
              const dateA = a.createdAt ? a.createdAt.toMillis() : 0;
              const dateB = b.createdAt ? b.createdAt.toMillis() : 0;
              return dateB - dateA; // Newest first
            });
            
            console.log("✓ Call audits loaded:", callAudits.length);
          } catch (callError) {
            console.warn("Could not load call audits:", callError);
            // Continue without call audits
            callAudits = [];
          }
          
          renderEnterpriseApprovalModal(transfer, lead, callAudits);
          console.log("✓✓✓ INLINE APPROVE COMPLETED - MODAL SHOULD BE OPEN");
        } catch (error) {
          console.error("❌ INLINE APPROVE ERROR:", error);
          toast("Failed to open approval dialog: " + error.message, "danger");
        }
      })();
      
      return;
    }
    
    // Reject button
    if (target.classList.contains('reject-transfer-btn')) {
      const transferId = target.getAttribute('data-transfer-id');
      console.log("✓ Reject button clicked, transferId:", transferId);
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.rejectHRTransfer === 'function') {
        window.rejectHRTransfer(transferId);
      }
      return;
    }
    
    // View details button
    if (target.classList.contains('view-transfer-btn')) {
      const transferId = target.getAttribute('data-transfer-id');
      console.log("✓ View button clicked, transferId:", transferId);
      e.preventDefault();
      e.stopPropagation();
      if (typeof window.viewHRTransferDetails === 'function') {
        window.viewHRTransferDetails(transferId);
      }
      return;
    }
  };
  
  container._transferButtonListener = transferButtonListener;
  container.addEventListener('click', transferButtonListener);
  
  console.log("✓ Event delegation setup complete");
}

function calculateHRTransferStats() {
  const today = new Date().toISOString().slice(0, 10);
  
  const pending = ALL_HR_TRANSFERS.filter(t => t.approvalStatus === "pending").length;
  const approvedToday = ALL_HR_TRANSFERS.filter(t => {
    if (t.approvalStatus !== "approved") return false;
    if (!t.approvedAt) return false;
    const approvedDate = t.approvedAt.toDate().toISOString().slice(0, 10);
    return approvedDate === today;
  }).length;
  const rejected = ALL_HR_TRANSFERS.filter(t => t.approvalStatus === "rejected").length;
  const waitingAssignment = ALL_HR_TRANSFERS.filter(t => 
    t.approvalStatus === "approved" && !t.hrAssignedTo && t.assignmentPending
  ).length;
  const assigned = ALL_HR_TRANSFERS.filter(t => t.hrAssignedTo).length;
  const total = ALL_HR_TRANSFERS.length;
  
  return { pending, approvedToday, rejected, waitingAssignment, assigned, total };
}

// ============================================================
// WAITING ASSIGNMENT TABLE
// ============================================================

function renderWaitingAssignmentTable() {
  const waiting = ALL_HR_TRANSFERS.filter(t => 
    t.approvalStatus === "approved" && !t.hrAssignedTo && t.assignmentPending
  );
  
  if (waiting.length === 0) {
    return `<tr><td colspan="9" class="text-center py-3 text-muted">No transfers waiting for assignment</td></tr>`;
  }
  
  return waiting.map(transfer => {
    const nextRetry = calculateNextRetry(transfer.assignmentReason);
    const waitingSince = transfer.approvedAt ? transfer.approvedAt.toDate() : null;
    const waitingDuration = waitingSince ? Math.floor((Date.now() - waitingSince.getTime()) / 1000 / 60) : 0;
    
    return `
      <tr>
        <td>
          <strong>#${transfer.slNo}</strong><br>
          <small class="text-muted">${escapeHtml(transfer.customerName)}</small>
        </td>
        <td>${escapeHtml(transfer.campaign)}</td>
        <td>${escapeHtml(transfer.salesMember)}</td>
        <td>${escapeHtml(transfer.approvedByName || '—')}</td>
        <td>${transfer.approvedAt ? formatDateTime(transfer.approvedAt.toDate()) : '—'}</td>
        <td>
          <span class="badge ${waitingDuration > 60 ? 'bg-danger' : waitingDuration > 30 ? 'bg-warning' : 'bg-info'}">
            ${waitingDuration < 60 ? waitingDuration + ' min' : Math.floor(waitingDuration / 60) + ' hrs'}
          </span>
        </td>
        <td>
          <span class="badge ${getReasonBadgeClass(transfer.assignmentReason)}">
            ${escapeHtml(transfer.assignmentReason || 'Unknown')}
          </span>
        </td>
        <td>
          <small class="text-muted">${nextRetry}</small>
        </td>
        <td>
          <button class="btn btn-sm btn-outline-primary" onclick="retryAssignment('${transfer.id}')" title="Retry Assignment">
            <i class="bi bi-arrow-repeat"></i>
          </button>
          <button class="btn btn-sm btn-outline-info" onclick="viewHRTransferDetails('${transfer.id}')" title="View Details">
            <i class="bi bi-eye"></i>
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

function calculateNextRetry(reason) {
  if (!reason) return 'Unknown';
  
  const lowReason = reason.toLowerCase();
  
  // Office Hours - Calculate next office opening
  if (lowReason.includes('office') || lowReason.includes('closed')) {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Get office start time from CRM config (reuse existing)
    const officeStart = (typeof window.CRM_CONFIG !== 'undefined' && window.CRM_CONFIG.officeStart) || "09:00";
    
    // Check if today is still a working day and office hasn't opened yet
    const isWorkingDay = (typeof isOfficeHoursNow === 'function');
    if (now.getHours() < 9) {
      return `Today ${officeStart}`;
    }
    return `Tomorrow ${officeStart}`;
  }
  
  // Holiday - Calculate next working day
  if (lowReason.includes('holiday')) {
    return 'Next Working Day';
  }
  
  // No HR Available - Immediate when HR added
  if (lowReason.includes('no hr') || lowReason.includes('hr member')) {
    return 'When HR Added';
  }
  
  // HR on Leave - Calculate when leave ends
  if (lowReason.includes('leave')) {
    return 'After Leave Ends';
  }
  
  // Break Time
  if (lowReason.includes('break')) {
    return 'After Break (15-30 min)';
  }
  
  return 'Pending';
}

function getReasonBadgeClass(reason) {
  if (!reason) return 'bg-secondary';
  
  const lowReason = reason.toLowerCase();
  if (lowReason.includes('office') || lowReason.includes('closed')) return 'bg-warning';
  if (lowReason.includes('holiday')) return 'bg-danger';
  if (lowReason.includes('no hr') || lowReason.includes('hr member')) return 'bg-primary';
  if (lowReason.includes('leave')) return 'bg-info';
  if (lowReason.includes('break')) return 'bg-secondary';
  return 'bg-secondary';
}

// Retry assignment manually
window.retryAssignment = async function(transferId) {
  try {
    const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
    if (!transfer) {
      toast("Transfer not found", "danger");
      return;
    }
    
    toast("Retrying assignment...", "info");
    
    // Use existing assignment engine
    await assignToHRUsingAssignmentEngine(transferId, transfer);
    
    // Reload dashboard
    await loadHRTransfers();
    renderHRTransfersDashboard();
    
  } catch (error) {
    console.error("Retry failed:", error);
    toast("Failed to retry assignment: " + error.message, "danger");
  }
};


function renderHRTransfersTable() {
  const filtered = getFilteredHRTransfers();
  
  if (filtered.length === 0) {
    return `<tr><td colspan="9" class="text-center py-5">
      <i class="bi bi-inbox display-4 text-muted d-block mb-3"></i>
      <h5 class="text-muted">No pending transfer requests</h5>
      <p class="text-muted">All driver transfer requests have been processed.</p>
      <button class="btn btn-primary mt-2" onclick="refreshHRTransfers()">
        <i class="bi bi-arrow-clockwise me-1"></i>Refresh
      </button>
    </td></tr>`;
  }
  
  return filtered.map(transfer => {
    // Determine display status based on approval and assignment state
    let displayStatus = transfer.approvalStatus;
    if (transfer.approvalStatus === "approved" && !transfer.hrAssignedTo && transfer.assignmentPending) {
      displayStatus = "waiting_assignment";
    } else if (transfer.approvalStatus === "approved" && transfer.hrAssignedTo) {
      displayStatus = "assigned";
    }
    
    const statusBadge = getStatusBadge(displayStatus);
    const hrName = transfer.hrAssignedToName || (transfer.assignmentPending ? `Waiting (${transfer.assignmentReason || 'No HR Available'})` : '—');
    
    return `
      <tr>
        <td><span class="badge bg-secondary">#${transfer.slNo}</span></td>
        <td>
          <div class="fw-semibold">${escapeHtml(transfer.customerName)}</div>
          <small class="text-muted">${escapeHtml(transfer.phone)}</small>
        </td>
        <td>${escapeHtml(transfer.company || '—')}</td>
        <td>${escapeHtml(transfer.campaign)}</td>
        <td>${escapeHtml(transfer.salesMember)}</td>
        <td>${transfer.requestedAt ? formatDateTime(transfer.requestedAt.toDate()) : '—'}</td>
        <td>${statusBadge}</td>
        <td>${escapeHtml(hrName)}</td>
        <td>
          ${renderTransferActions(transfer)}
        </td>
      </tr>
    `;
  }).join('');
}

function getStatusBadge(status) {
  const badges = {
    pending: '<span class="badge bg-warning">Pending Approval</span>',
    approved: '<span class="badge bg-success">Approved</span>',
    rejected: '<span class="badge bg-danger">Rejected</span>',
    waiting_assignment: '<span class="badge bg-info">Waiting Assignment</span>',
    assigned: '<span class="badge bg-primary">Assigned to HR</span>'
  };
  return badges[status] || '<span class="badge bg-secondary">Unknown</span>';
}

function renderTransferActions(transfer) {
  const isAdmin = CURRENT_USER.role === "admin" || CURRENT_USER.role === "superadmin";
  
  if (transfer.approvalStatus === "pending" && isAdmin) {
    return `
      <div class="btn-group btn-group-sm">
        <button class="btn btn-success approve-transfer-btn" data-transfer-id="${transfer.id}" title="Approve" style="pointer-events: auto;">
          <i class="bi bi-check-lg" style="pointer-events: none;"></i>
        </button>
        <button class="btn btn-danger reject-transfer-btn" data-transfer-id="${transfer.id}" title="Reject" style="pointer-events: auto;">
          <i class="bi bi-x-lg" style="pointer-events: none;"></i>
        </button>
        <button class="btn btn-outline-secondary view-transfer-btn" data-transfer-id="${transfer.id}" title="View Details" style="pointer-events: auto;">
          <i class="bi bi-eye" style="pointer-events: none;"></i>
        </button>
      </div>
    `;
  } else {
    return `
      <button class="btn btn-sm btn-outline-secondary view-transfer-btn" data-transfer-id="${transfer.id}" title="View Details" style="pointer-events: auto;">
        <i class="bi bi-eye" style="pointer-events: none;"></i> View
      </button>
    `;
  }
}

// ============================================================
// FILTERING
// ============================================================

function getFilteredHRTransfers() {
  let filtered = [...ALL_HR_TRANSFERS];
  
  // Status filter
  const statusFilter = document.getElementById("hrTransferStatusFilter")?.value;
  if (statusFilter) {
    filtered = filtered.filter(t => t.approvalStatus === statusFilter);
  }
  
  // Sales member filter
  const salesMemberFilter = document.getElementById("hrTransferSalesMemberFilter")?.value;
  if (salesMemberFilter) {
    filtered = filtered.filter(t => t.salesMemberId === salesMemberFilter);
  }
  
  // HR member filter
  const hrMemberFilter = document.getElementById("hrTransferHRMemberFilter")?.value;
  if (hrMemberFilter) {
    filtered = filtered.filter(t => t.hrAssignedTo === hrMemberFilter);
  }
  
  // Campaign filter
  const campaignFilter = document.getElementById("hrTransferCampaignFilter")?.value;
  if (campaignFilter) {
    filtered = filtered.filter(t => t.campaignId === campaignFilter);
  }
  
  // Date range filter
  const fromDate = document.getElementById("hrTransferFromDate")?.value;
  const toDate = document.getElementById("hrTransferToDate")?.value;
  if (fromDate) {
    filtered = filtered.filter(t => {
      if (!t.requestedAt) return false;
      const reqDate = t.requestedAt.toDate().toISOString().slice(0, 10);
      return reqDate >= fromDate;
    });
  }
  if (toDate) {
    filtered = filtered.filter(t => {
      if (!t.requestedAt) return false;
      const reqDate = t.requestedAt.toDate().toISOString().slice(0, 10);
      return reqDate <= toDate;
    });
  }
  
  // Search filter
  const search = document.getElementById("hrTransferSearch")?.value.toLowerCase();
  if (search) {
    filtered = filtered.filter(t => {
      return (
        (t.slNo && t.slNo.toString().includes(search)) ||
        (t.customerName && t.customerName.toLowerCase().includes(search)) ||
        (t.phone && t.phone.includes(search)) ||
        (t.company && t.company.toLowerCase().includes(search))
      );
    });
  }
  
  return filtered;
}

window.filterHRTransfers = function() {
  const tbody = document.getElementById("hrTransfersTableBody");
  if (!tbody) return;
  tbody.innerHTML = renderHRTransfersTable();
};

window.clearHRTransferFilters = function() {
  document.getElementById("hrTransferStatusFilter").value = "";
  document.getElementById("hrTransferSalesMemberFilter").value = "";
  document.getElementById("hrTransferHRMemberFilter").value = "";
  document.getElementById("hrTransferCampaignFilter").value = "";
  document.getElementById("hrTransferFromDate").value = "";
  document.getElementById("hrTransferToDate").value = "";
  document.getElementById("hrTransferSearch").value = "";
  filterHRTransfers();
};

window.refreshHRTransfers = async function() {
  await loadHRTransfers();
  renderHRTransfersDashboard();
  toast("HR Transfers refreshed", "success");
};

// ============================================================
// NOTIFICATIONS
// ============================================================

async function sendHRTransferNotifications(transferId, type, rejectionReason = null) {
  try {
    const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
    if (!transfer) return;

    if (type === "approved") {
      // Notify HR if assigned
      if (transfer.hrAssignedTo && transfer.hrAssignedToName) {
        // Notification logic would go here
        console.log(`Notification sent to HR: ${transfer.hrAssignedToName}`);
      }
      
      // Notify sales member
      if (transfer.salesMemberId) {
        console.log(`Approval notification sent to: ${transfer.salesMember}`);
      }
    } else if (type === "rejected") {
      // Notify sales member about rejection
      if (transfer.salesMemberId) {
        console.log(`Rejection notification sent to: ${transfer.salesMember} - Reason: ${rejectionReason}`);
      }
    }
    
  } catch (error) {
    console.error("Error sending HR transfer notifications:", error);
  }
}

window.approveHRTransfer = async function(transferId) {
  console.log("════════════════════════════════════════════════════════");
  console.log("✓ STEP 1: approveHRTransfer STARTED");
  console.log("Transfer ID:", transferId);
  console.log("typeof transferId:", typeof transferId);
  
  try {
    console.log("✓ STEP 2: About to call showEnterpriseApprovalModal");
    // Open Enterprise Approval Modal instead of immediate approval
    await showEnterpriseApprovalModal(transferId);
    console.log("✓ STEP 9: showEnterpriseApprovalModal COMPLETED");
  } catch (error) {
    console.error("❌ ERROR in approveHRTransfer:", error);
    console.error("Error stack:", error.stack);
    toast("Failed to open approval dialog: " + error.message, "danger");
  }
};

// ============================================================
// ENTERPRISE HR TRANSFER APPROVAL MODAL
// ============================================================

async function showEnterpriseApprovalModal(transferId) {
  console.log("✓ showEnterpriseApprovalModal called with ID:", transferId);
  
  const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
  if (!transfer) {
    console.error("❌ Transfer not found");
    toast("Transfer not found", "danger");
    return;
  }
  
  // Load complete lead data
  const leadDoc = await leadsRef.doc(transfer.leadId).get();
  if (!leadDoc.exists) {
    console.error("❌ Lead not found");
    toast("Lead not found", "danger");
    return;
  }
  
  const lead = { id: leadDoc.id, ...leadDoc.data() };
  console.log("✓ Lead loaded:", lead.slNo);
  
  // Load call audit history - WITHOUT orderBy to avoid index requirement
  let callAudits = [];
  try {
    const callAuditsSnap = await callAuditsRef
      .where("leadId", "==", transfer.leadId)
      .get();
    
    callAuditsSnap.forEach(doc => {
      callAudits.push({ id: doc.id, ...doc.data() });
    });
    
    // Sort in memory
    callAudits.sort((a, b) => {
      const dateA = a.createdAt ? a.createdAt.toMillis() : 0;
      const dateB = b.createdAt ? b.createdAt.toMillis() : 0;
      return dateB - dateA;
    });
  } catch (callError) {
    console.warn("Could not load call audits:", callError);
    callAudits = [];
  }
  
  console.log("✓ Call audits loaded:", callAudits.length);
  
  // Render modal
  renderEnterpriseApprovalModal(transfer, lead, callAudits);
  console.log("✓ Modal rendered successfully");
}

function renderEnterpriseApprovalModal(transfer, lead, callAudits) {
  console.log("✓ Rendering approval modal for Lead #" + lead.slNo);
  
  const history = lead.history || [];
  const sortedHistory = [...history].sort((a, b) => {
    const dateA = new Date(a.timestamp || 0);
    const dateB = new Date(b.timestamp || 0);
    return dateB - dateA; // Newest first
  });
  
  // Extract notes from history (entries with "Note:" or remarks)
  const notes = sortedHistory.filter(entry => 
    entry.text && (entry.text.includes("Note:") || entry.text.includes("Remarks:"))
  );
  
  const modalHtml = `
    <div class="modal fade" id="enterpriseApprovalModal" tabindex="-1" data-bs-backdrop="static">
      <div class="modal-dialog modal-xl modal-dialog-scrollable">
        <div class="modal-content">
          <div class="modal-header bg-primary text-white">
            <h5 class="modal-title">
              <i class="bi bi-clipboard-check me-2"></i>
              HR Transfer Approval Review - Lead #${lead.slNo}
            </h5>
            <button type="button" class="btn-close btn-close-white" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            
            <!-- Lead Information Card -->
            <div class="card mb-3">
              <div class="card-header bg-light">
                <h6 class="mb-0"><i class="bi bi-info-circle me-2"></i>Lead Information</h6>
              </div>
              <div class="card-body">
                <div class="row g-3">
                  <div class="col-md-6">
                    <dl class="row mb-0">
                      <dt class="col-sm-5">Lead ID:</dt>
                      <dd class="col-sm-7"><code>${escapeHtml(transfer.leadId)}</code></dd>
                      
                      <dt class="col-sm-5">Customer Name:</dt>
                      <dd class="col-sm-7"><strong>${escapeHtml(transfer.customerName)}</strong></dd>
                      
                      <dt class="col-sm-5">Phone:</dt>
                      <dd class="col-sm-7">${escapeHtml(transfer.phone)}</dd>
                      
                      <dt class="col-sm-5">Company:</dt>
                      <dd class="col-sm-7">${escapeHtml(transfer.company || '—')}</dd>
                    </dl>
                  </div>
                  <div class="col-md-6">
                    <dl class="row mb-0">
                      <dt class="col-sm-5">Campaign:</dt>
                      <dd class="col-sm-7"><span class="badge bg-info">${escapeHtml(transfer.campaign)}</span></dd>
                      
                      <dt class="col-sm-5">Current Status:</dt>
                      <dd class="col-sm-7"><span class="badge bg-warning">Driver</span></dd>
                      
                      <dt class="col-sm-5">Sales Member:</dt>
                      <dd class="col-sm-7">${escapeHtml(transfer.salesMember)}</dd>
                      
                      <dt class="col-sm-5">Requested On:</dt>
                      <dd class="col-sm-7">${transfer.requestedAt ? formatDateTime(transfer.requestedAt.toDate()) : '—'}</dd>
                    </dl>
                  </div>
                </div>
              </div>
            </div>
            
            <!-- Sales Activity Timeline -->
            <div class="card mb-3">
              <div class="card-header bg-light">
                <h6 class="mb-0"><i class="bi bi-clock-history me-2"></i>Sales Activity Timeline</h6>
              </div>
              <div class="card-body" style="max-height: 300px; overflow-y: auto;">
                ${sortedHistory.length > 0 ? `
                  <div class="timeline">
                    ${sortedHistory.map(entry => `
                      <div class="timeline-entry">
                        <div class="timeline-icon ${getTimelineIconClass(entry.text)}">
                          <i class="bi ${getTimelineIcon(entry.text)}"></i>
                        </div>
                        <div class="timeline-content">
                          <div class="d-flex justify-content-between align-items-start">
                            <div>
                              <strong>${escapeHtml(entry.text || 'Activity')}</strong>
                              ${entry.statusAtTime ? `<br><small class="text-muted">Status: ${escapeHtml(entry.statusAtTime)}</small>` : ''}
                            </div>
                            <small class="text-muted text-end">
                              ${entry.timestamp ? new Date(entry.timestamp).toLocaleString() : '—'}<br>
                              ${escapeHtml(entry.updatedByName || 'System')}
                            </small>
                          </div>
                        </div>
                      </div>
                    `).join('')}
                  </div>
                ` : '<p class="text-muted mb-0">No activity history available</p>'}
              </div>
            </div>
            
            <!-- Sales Notes -->
            ${notes.length > 0 ? `
            <div class="card mb-3">
              <div class="card-header bg-light">
                <h6 class="mb-0"><i class="bi bi-journal-text me-2"></i>Sales Notes</h6>
              </div>
              <div class="card-body" style="max-height: 200px; overflow-y: auto;">
                ${notes.map(note => `
                  <div class="border-bottom pb-2 mb-2">
                    <p class="mb-1">${escapeHtml(note.text)}</p>
                    <small class="text-muted">
                      ${note.timestamp ? new Date(note.timestamp).toLocaleString() : '—'} - 
                      ${escapeHtml(note.updatedByName || 'Unknown')}
                    </small>
                  </div>
                `).join('')}
              </div>
            </div>
            ` : ''}
            
            <!-- Call History -->
            ${callAudits.length > 0 ? `
            <div class="card mb-3">
              <div class="card-header bg-light">
                <h6 class="mb-0"><i class="bi bi-telephone me-2"></i>Call History</h6>
              </div>
              <div class="card-body">
                <div class="table-responsive">
                  <table class="table table-sm table-hover mb-0">
                    <thead>
                      <tr>
                        <th>Call #</th>
                        <th>Date</th>
                        <th>Duration</th>
                        <th>Status</th>
                        <th>Recording</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${callAudits.map((audit, idx) => `
                        <tr>
                          <td>#${callAudits.length - idx}</td>
                          <td>${audit.createdAt ? formatDateTime(audit.createdAt.toDate()) : '—'}</td>
                          <td>${formatDuration(audit.recordingDuration)}</td>
                          <td><span class="badge ${getCallStatusBadge(audit.status)}">${escapeHtml(audit.status || 'Unknown')}</span></td>
                          <td>
                            ${audit.recordingUrl ? `
                              <button class="btn btn-sm btn-outline-primary" onclick="playRecording('${audit.recordingUrl}', '${escapeHtml(audit.recordingFileName || 'Recording')}')">
                                <i class="bi bi-play-circle"></i> Play
                              </button>
                            ` : '<span class="text-muted">—</span>'}
                          </td>
                        </tr>
                      `).join('')}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            ` : ''}
            
            <!-- Approval Information Panel -->
            <div class="alert alert-info">
              <h6 class="alert-heading"><i class="bi bi-info-circle me-2"></i>After Approval</h6>
              <p class="mb-2">The system will use the existing Assignment Engine to assign this lead to an available HR member:</p>
              <ul class="mb-0">
                <li>✓ <strong>Office Hours</strong> will be checked (assignment only during office hours)</li>
                <li>✓ <strong>Holidays</strong> will be checked (no assignment on holidays)</li>
                <li>✓ <strong>HR Leave</strong> will be checked (skip HR members on leave)</li>
                <li>✓ <strong>HR Availability</strong> will be checked (round-robin assignment)</li>
                <li>✓ <strong>Campaign Assignment Rules</strong> will be applied</li>
              </ul>
              <hr>
              <p class="mb-0"><small class="text-muted">
                <i class="bi bi-lightbulb me-1"></i>
                If no HR member is available, the transfer will be marked as <strong>"Waiting Assignment"</strong> 
                and automatically assigned when conditions are met.
              </small></p>
            </div>
            
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">
              <i class="bi bi-x-circle me-1"></i>Cancel
            </button>
            <button type="button" class="btn btn-success" onclick="confirmEnterpriseApproval('${transfer.id}')">
              <i class="bi bi-check-circle me-1"></i>Approve Transfer
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Remove old modal if exists
  const oldModal = document.getElementById("enterpriseApprovalModal");
  if (oldModal) oldModal.remove();
  
  // Add new modal
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  console.log("✓ Modal HTML inserted into DOM");
  
  // Show modal
  const modal = new bootstrap.Modal(document.getElementById("enterpriseApprovalModal"));
  modal.show();
  console.log("✓ Modal opened successfully");
}

// Helper functions for timeline styling
function getTimelineIcon(text) {
  const lowText = (text || '').toLowerCase();
  if (lowText.includes('created')) return 'bi-plus-circle-fill';
  if (lowText.includes('assigned')) return 'bi-person-check-fill';
  if (lowText.includes('call') || lowText.includes('contact')) return 'bi-telephone-fill';
  if (lowText.includes('interested')) return 'bi-hand-thumbs-up-fill';
  if (lowText.includes('driver')) return 'bi-truck';
  if (lowText.includes('transfer')) return 'bi-arrow-left-right';
  if (lowText.includes('approved')) return 'bi-check-circle-fill';
  if (lowText.includes('rejected')) return 'bi-x-circle-fill';
  return 'bi-circle-fill';
}

function getTimelineIconClass(text) {
  const lowText = (text || '').toLowerCase();
  if (lowText.includes('created')) return 'bg-primary';
  if (lowText.includes('assigned')) return 'bg-success';
  if (lowText.includes('interested')) return 'bg-info';
  if (lowText.includes('driver') || lowText.includes('transfer')) return 'bg-warning';
  if (lowText.includes('approved')) return 'bg-success';
  if (lowText.includes('rejected')) return 'bg-danger';
  return 'bg-secondary';
}

function getCallStatusBadge(status) {
  const statusMap = {
    'Pending': 'bg-warning',
    'Approved': 'bg-success',
    'Rejected': 'bg-danger',
    'Re-Call Required': 'bg-info'
  };
  return statusMap[status] || 'bg-secondary';
}

function formatDuration(seconds) {
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Audio player for call recordings
window.playRecording = function(url, filename) {
  const playerHtml = `
    <div class="modal fade" id="audioPlayerModal" tabindex="-1">
      <div class="modal-dialog">
        <div class="modal-content">
          <div class="modal-header">
            <h6 class="modal-title"><i class="bi bi-music-note-beamed me-2"></i>${escapeHtml(filename)}</h6>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body text-center">
            <audio controls class="w-100" autoplay>
              <source src="${url}" type="audio/mpeg">
              Your browser does not support audio playback.
            </audio>
          </div>
          <div class="modal-footer">
            <a href="${url}" download="${escapeHtml(filename)}" class="btn btn-sm btn-outline-primary">
              <i class="bi bi-download"></i> Download
            </a>
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  const oldPlayer = document.getElementById("audioPlayerModal");
  if (oldPlayer) oldPlayer.remove();
  
  document.body.insertAdjacentHTML('beforeend', playerHtml);
  const modal = new bootstrap.Modal(document.getElementById("audioPlayerModal"));
  modal.show();
};

// Confirm approval - uses existing Assignment Engine
window.confirmEnterpriseApproval = async function(transferId) {
  try {
    const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
    if (!transfer) {
      toast("Transfer not found", "danger");
      return;
    }
    
    // Close approval modal
    const approvalModal = bootstrap.Modal.getInstance(document.getElementById("enterpriseApprovalModal"));
    if (approvalModal) approvalModal.hide();
    
    // Update transfer status to approved
    await hrTransfersRef.doc(transferId).update({
      approvalStatus: "approved",
      approvedBy: CURRENT_USER.uid,
      approvedByName: CURRENT_USER.name || CURRENT_USER.email,
      approvedAt: firebase.firestore.Timestamp.now(),
      timeline: firebase.firestore.FieldValue.arrayUnion({
        action: "Approved",
        description: `Transfer approved by ${CURRENT_USER.name || CURRENT_USER.email}`,
        timestamp: firebase.firestore.Timestamp.now(),
        actor: CURRENT_USER.uid,
        actorName: CURRENT_USER.name || CURRENT_USER.email
      })
    });
    
    // Write to existing audit log
    await writeAuditLog(transfer.leadId, transfer.slNo, "HR Transfer Approved", 
      `Approved by ${CURRENT_USER.name || CURRENT_USER.email}`, CURRENT_USER.name || CURRENT_USER.email);
    
    // Now use existing assignment engine to assign to HR
    await assignToHRUsingAssignmentEngine(transferId, transfer);
    
    // Send notifications using existing notification system
    await sendHRTransferNotifications(transferId, "approved");
    
    // Reload and re-render
    await loadHRTransfers();
    renderHRTransfersDashboard();
    
  } catch (error) {
    console.error("Approval failed:", error);
    toast("Failed to approve transfer: " + error.message, "danger");
  }
};

// ============================================================
// ASSIGNMENT TO HR - REUSES EXISTING ASSIGNMENT ENGINE LOGIC
// ============================================================

async function assignToHRUsingAssignmentEngine(transferId, transfer) {
  console.log("Assigning to HR using existing assignment engine...");
  
  // Check if valid assignment time (office hours, not holiday, not break time)
  const canAssign = isValidAssignmentTime();
  const todayLeaves = canAssign ? await getTodayLeaves() : [];
  
  if (canAssign) {
    // Try to assign immediately
    const hrMember = await getNextAvailableUserByRole("hr", todayLeaves);
    
    if (hrMember) {
      // Immediate assignment
      const now = firebase.firestore.Timestamp.now();
      
      await hrTransfersRef.doc(transferId).update({
        hrAssignedTo: hrMember.id,
        hrAssignedToName: hrMember.name || hrMember.email,
        hrAssignedAt: now,
        assignmentPending: false,
        assignmentReason: null,
        timeline: firebase.firestore.FieldValue.arrayUnion({
          action: "Assigned to HR",
          description: `Assigned to HR ${hrMember.name || hrMember.email}`,
          timestamp: now,
          actor: "system",
          actorName: "Auto Assignment"
        })
      });
      
      // Update lead
      await leadsRef.doc(transfer.leadId).update({
        assignedTo: hrMember.id,
        assignedToName: hrMember.name || hrMember.email,
        assignedAt: now,
        assignedBy: "HR Transfer Assignment",
        assignmentRole: "hr",
        previousAssignedTo: transfer.currentAssignedTo,
        previousAssignedRole: transfer.currentAssignedRole,
        history: firebase.firestore.FieldValue.arrayUnion({
          text: `Transferred to HR ${hrMember.name || hrMember.email} after Driver status approval`,
          statusAtTime: "Driver",
          updatedBy: "system",
          updatedByName: "HR Transfer System",
          timestamp: new Date().toISOString()
        })
      });
      
      console.log(`Assigned to HR: ${hrMember.name}`);
      toast(`Transfer assigned to HR: ${hrMember.name}`, "success");
      
    } else {
      // No HR available - mark as waiting assignment (DO NOT delete or hide)
      await addToPendingAssignment(transferId, transfer, "No HR Members Available");
      toast("Transfer approved. Waiting for HR member to be assigned.", "info");
    }
  } else {
    // Outside valid assignment time - add to pending assignment
    const reason = isHolidayToday()
      ? "Holiday — no assignment today"
      : !isOfficeHoursNow()
        ? "Outside Office Hours"
        : isBreakTimeNow()
          ? "Break Time"
          : "No HR available";
    
    await addToPendingAssignment(transferId, transfer, reason);
    toast(`Transfer approved. Assignment pending: ${reason}`, "info");
  }
}

async function addToPendingAssignment(transferId, transfer, reason) {
  console.log(`Adding to pending assignment: ${reason}`);
  
  const now = firebase.firestore.Timestamp.now();
  
  // Update transfer
  await hrTransfersRef.doc(transferId).update({
    assignmentPending: true,
    assignmentReason: reason,
    timeline: firebase.firestore.FieldValue.arrayUnion({
      action: "Pending Assignment",
      description: `Waiting for HR assignment (${reason})`,
      timestamp: now,
      actor: "system",
      actorName: "Auto Assignment"
    })
  });
  
  // Update lead
  await leadsRef.doc(transfer.leadId).update({
    assignmentPending: true,
    assignmentReason: reason,
    assignmentRole: "hr",
    history: firebase.firestore.FieldValue.arrayUnion({
      text: `Pending HR assignment (${reason})`,
      statusAtTime: "Driver",
      updatedBy: "system",
      updatedByName: "HR Transfer System",
      timestamp: new Date().toISOString()
    })
  });
  
  // Add to assignment queue (will be picked up by existing assignment watcher)
  await assignmentQueueRef.doc(transfer.leadId).set({
    leadId: transfer.leadId,
    slNo: transfer.slNo,
    createdAt: now,
    reason: reason,
    transferId: transferId,
    isHRTransfer: true
  });
  
  console.log("Added to assignment queue");
}

// ============================================================
// REJECTION WORKFLOW
// ============================================================

window.rejectHRTransfer = async function(transferId) {
  const reason = prompt("Enter rejection reason:");
  if (!reason) return;
  
  try {
    const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
    if (!transfer) {
      toast("Transfer not found", "danger");
      return;
    }
    
    await hrTransfersRef.doc(transferId).update({
      approvalStatus: "rejected",
      rejectedBy: CURRENT_USER.uid,
      rejectedByName: CURRENT_USER.name || CURRENT_USER.email,
      rejectedAt: firebase.firestore.Timestamp.now(),
      rejectionReason: reason,
      timeline: firebase.firestore.FieldValue.arrayUnion({
        action: "Rejected",
        description: `Rejected by ${CURRENT_USER.name || CURRENT_USER.email}: ${reason}`,
        timestamp: firebase.firestore.Timestamp.now(),
        actor: CURRENT_USER.uid,
        actorName: CURRENT_USER.name || CURRENT_USER.email
      })
    });
    
    // Send notifications
    await sendHRTransferNotifications(transferId, "rejected", reason);
    
    // Audit log
    await writeAuditLog(transfer.leadId, transfer.slNo, "HR Transfer Rejected", 
      `Rejected by ${CURRENT_USER.name || CURRENT_USER.email}: ${reason}`, CURRENT_USER.name || CURRENT_USER.email);
    
    // Reload and re-render
    await loadHRTransfers();
    renderHRTransfersDashboard();
    toast("Transfer rejected", "success");
    
  } catch (error) {
    console.error("Rejection failed:", error);
    toast("Failed to reject transfer: " + error.message, "danger");
  }
};

// ============================================================
// VIEW DETAILS
// ============================================================

window.viewHRTransferDetails = function(transferId) {
  const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
  if (!transfer) {
    toast("Transfer not found", "danger");
    return;
  }
  
  const timeline = transfer.timeline || [];
  
  const modalHtml = `
    <div class="modal fade" id="hrTransferDetailsModal" tabindex="-1">
      <div class="modal-dialog modal-lg">
        <div class="modal-content">
          <div class="modal-header">
            <h5 class="modal-title">HR Transfer Details - Lead #${transfer.slNo}</h5>
            <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
          </div>
          <div class="modal-body">
            <div class="row mb-3">
              <div class="col-md-6">
                <h6 class="text-muted">Customer Information</h6>
                <p class="mb-1"><strong>Name:</strong> ${escapeHtml(transfer.customerName)}</p>
                <p class="mb-1"><strong>Phone:</strong> ${escapeHtml(transfer.phone)}</p>
                <p class="mb-1"><strong>Company:</strong> ${escapeHtml(transfer.company || '—')}</p>
                <p class="mb-1"><strong>Campaign:</strong> ${escapeHtml(transfer.campaign)}</p>
              </div>
              <div class="col-md-6">
                <h6 class="text-muted">Transfer Information</h6>
                <p class="mb-1"><strong>Status:</strong> ${getStatusBadge(
                  transfer.approvalStatus === "approved" && !transfer.hrAssignedTo && transfer.assignmentPending 
                    ? "waiting_assignment" 
                    : transfer.approvalStatus === "approved" && transfer.hrAssignedTo 
                      ? "assigned"
                      : transfer.approvalStatus
                )}</p>
                <p class="mb-1"><strong>Sales Member:</strong> ${escapeHtml(transfer.salesMember)}</p>
                <p class="mb-1"><strong>Requested:</strong> ${transfer.requestedAt ? formatDateTime(transfer.requestedAt.toDate()) : '—'}</p>
                ${transfer.hrAssignedToName ? `<p class="mb-1"><strong>HR Assigned:</strong> ${escapeHtml(transfer.hrAssignedToName)}</p>` : ''}
                ${transfer.assignmentPending && transfer.assignmentReason ? `<p class="mb-1 text-warning"><strong>Assignment Status:</strong> ${escapeHtml(transfer.assignmentReason)}</p>` : ''}
              </div>
            </div>
            
            ${transfer.rejectionReason ? `
            <div class="alert alert-danger">
              <strong>Rejection Reason:</strong> ${escapeHtml(transfer.rejectionReason)}
            </div>
            ` : ''}
            
            <h6 class="text-muted mt-3">Timeline</h6>
            <div class="timeline">
              ${timeline.map(entry => `
                <div class="timeline-entry">
                  <div class="timeline-icon">
                    <i class="bi bi-circle-fill"></i>
                  </div>
                  <div class="timeline-content">
                    <strong>${escapeHtml(entry.action)}</strong>
                    <p class="mb-0 text-muted small">${escapeHtml(entry.description)}</p>
                    <p class="mb-0 text-muted small">${entry.timestamp ? formatDateTime(entry.timestamp.toDate()) : ''} - ${escapeHtml(entry.actorName || 'System')}</p>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
            <a href="#" class="btn btn-primary" onclick="viewLeadDetails('${transfer.leadId}'); return false;">View Full Lead</a>
          </div>
        </div>
      </div>
    </div>
  `;
  
  // Remove old modal if exists
  const oldModal = document.getElementById("hrTransferDetailsModal");
  if (oldModal) oldModal.remove();
  
  // Add new modal
  document.body.insertAdjacentHTML('beforeend', modalHtml);
  
  // Show modal
  const modal = new bootstrap.Modal(document.getElementById("hrTransferDetailsModal"));
  modal.show();
};

// ============================================================
// NOTIFICATIONS
// ============================================================

async function sendHRTransferNotifications(transferId, action, reason = null) {
  try {
    const transfer = ALL_HR_TRANSFERS.find(t => t.id === transferId);
    if (!transfer) return;
    
    if (action === "approved") {
      // Notify HR (if assigned)
      if (transfer.hrAssignedTo) {
        await notificationsRef.add({
          userId: transfer.hrAssignedTo,
          type: "hr_transfer_approved",
          title: "New Lead Assigned",
          message: `Lead #${transfer.slNo} (${transfer.customerName}) has been assigned to you from Driver transfer`,
          leadId: transfer.leadId,
          timestamp: firebase.firestore.Timestamp.now(),
          read: false
        });
      }
      
      // Notify Sales Member
      if (transfer.salesMemberId) {
        await notificationsRef.add({
          userId: transfer.salesMemberId,
          type: "hr_transfer_approved",
          title: "Transfer Approved",
          message: `Your HR transfer request for Lead #${transfer.slNo} (${transfer.customerName}) has been approved`,
          leadId: transfer.leadId,
          timestamp: firebase.firestore.Timestamp.now(),
          read: false
        });
      }
    } else if (action === "rejected") {
      // Notify Sales Member
      if (transfer.salesMemberId) {
        await notificationsRef.add({
          userId: transfer.salesMemberId,
          type: "hr_transfer_rejected",
          title: "Transfer Rejected",
          message: `Your HR transfer request for Lead #${transfer.slNo} (${transfer.customerName}) was rejected${reason ? `: ${reason}` : ''}`,
          leadId: transfer.leadId,
          timestamp: firebase.firestore.Timestamp.now(),
          read: false
        });
      }
    }
  } catch (error) {
    console.error("Failed to send notifications:", error);
  }
}

// ============================================================
// AUTOMATIC HR TRANSFER ON DRIVER STATUS
// ============================================================

async function createHRTransferOnDriverStatus(leadId, leadData) {
  console.log("Creating HR transfer for Driver status...");
  
  try {
    // Check if transfer already exists
    if (leadData.hrTransferCreated) {
      console.log("HR transfer already exists for this lead");
      return;
    }
    
    const transferId = `auto_${leadId}_${Date.now()}`;
    const now = firebase.firestore.Timestamp.now();
    
    const transferData = {
      leadId: leadId,
      slNo: leadData.slNo,
      customerName: leadData.fullName,
      company: leadData.companyName || "",
      phone: leadData.phoneNumber,
      campaign: leadData.campaignName || "General",
      campaignId: leadData.campaignId || null,
      salesMember: leadData.assignedToName || CURRENT_USER.name || CURRENT_USER.email,
      salesMemberId: leadData.assignedTo || CURRENT_USER.uid,
      currentAssignedTo: leadData.assignedTo || CURRENT_USER.uid,
      currentAssignedRole: "member",
      requestedBy: CURRENT_USER.uid,
      requestedByName: CURRENT_USER.name || CURRENT_USER.email,
      requestedAt: now,
      targetRole: "hr",
      approvalStatus: "pending",
      migrationType: "automatic",
      createdAt: now,
      timeline: [{
        action: "Transfer Requested",
        description: `Driver status selected by ${CURRENT_USER.name || CURRENT_USER.email}, transfer requested`,
        timestamp: now,
        actor: CURRENT_USER.uid,
        actorName: CURRENT_USER.name || CURRENT_USER.email
      }]
    };
    
    await hrTransfersRef.doc(transferId).set(transferData);
    
    // Mark lead as having transfer created
    await leadsRef.doc(leadId).update({
      hrTransferCreated: true,
      hrTransferId: transferId
    });
    
    // Notify admins
    const adminUsers = await usersRef.where("role", "in", ["admin", "superadmin"]).where("active", "==", true).get();
    const notificationBatch = db.batch();
    adminUsers.forEach(doc => {
      const notifRef = notificationsRef.doc();
      notificationBatch.set(notifRef, {
        userId: doc.id,
        type: "hr_transfer_requested",
        title: "New HR Transfer Request",
        message: `Lead #${leadData.slNo} (${leadData.fullName}) requires HR transfer approval`,
        leadId: leadId,
        transferId: transferId,
        timestamp: now,
        read: false
      });
    });
    await notificationBatch.commit();
    
    console.log("HR transfer created successfully");
    toast("HR Transfer request created. Pending admin approval.", "info");
    
  } catch (error) {
    console.error("Failed to create HR transfer:", error);
    toast("Failed to create HR transfer request", "danger");
  }
}

// Export for use in leads.js and global access
window.createHRTransferOnDriverStatus = createHRTransferOnDriverStatus;
window.loadHRTransfersView = loadHRTransfersView;
window.migrateLegacyDriverLeads = migrateLegacyDriverLeads;
window.showEnterpriseApprovalModal = showEnterpriseApprovalModal;
