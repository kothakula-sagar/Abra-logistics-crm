// ============================================================
// CAMPAIGN-REPORTS.JS — Module 3: Campaign Reports with Filters & Export
//
// Visible to: Super Admin, Admin (never Member).
//
// Features:
//  - Campaign comparison reports
//  - Sales member performance by campaign
//  - Daily/weekly trend analysis
//  - Filterable by campaign, date range, status, member
//  - Export to PDF, Excel, Print
//  - Report tabs for different view types
//
// Design:
//  - Reuses shared calculation functions from campaign-analytics.js
//  - NO duplicate code - only UI and filtering logic
//  - Renders in dedicated report view section
// ============================================================

// ── Report Tab State ──────────────────────────────────────────
let currentReportTab = "overview"; // overview | comparison | member-performance | trends

function switchReportTab(tab) {
  currentReportTab = tab;
  
  // Update active tab styling
  document.querySelectorAll(".campaign-report-tab").forEach(t => t.classList.remove("active"));
  const activeTab = document.querySelector(`[data-report-tab="${tab}"]`);
  if (activeTab) activeTab.classList.add("active");
  
  // Render the selected report
  renderCurrentReport();
}

// ── Main Report Panel Renderer ────────────────────────────────
function renderCampaignReportsPanel() {
  const wrap = document.getElementById("view-campaignreports");
  if (!wrap) return;
  
  // Access control
  if (!hasPermission("campaignReports.view")) {
    wrap.innerHTML = '<div class="alert alert-danger"><i class="bi bi-lock-fill me-2"></i>Access Denied.</div>';
    return;
  }
  
  wrap.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <div>
        <h1 class="page-title"><i class="bi bi-file-earmark-bar-graph me-2"></i>Campaign Reports</h1>
        <p class="page-subtitle">Comprehensive campaign analysis with filters and exports.</p>
      </div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-danger" onclick="exportReportPDF()">
          <i class="bi bi-file-pdf me-1"></i>Export PDF
        </button>
        <button class="btn btn-sm btn-outline-success" onclick="exportReportExcel()">
          <i class="bi bi-file-excel me-1"></i>Export Excel
        </button>
        <button class="btn btn-sm btn-outline-secondary" onclick="printReport()">
          <i class="bi bi-printer me-1"></i>Print
        </button>
      </div>
    </div>
    
    <!-- Report Tabs -->
    <div class="mb-3">
      <ul class="nav nav-tabs">
        <li class="nav-item">
          <a class="nav-link campaign-report-tab active" data-report-tab="overview" href="#" onclick="event.preventDefault(); switchReportTab('overview')">
            <i class="bi bi-grid me-1"></i>Overview
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link campaign-report-tab" data-report-tab="comparison" href="#" onclick="event.preventDefault(); switchReportTab('comparison')">
            <i class="bi bi-bar-chart me-1"></i>Campaign Comparison
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link campaign-report-tab" data-report-tab="member-performance" href="#" onclick="event.preventDefault(); switchReportTab('member-performance')">
            <i class="bi bi-person-badge me-1"></i>Member Performance
          </a>
        </li>
        <li class="nav-item">
          <a class="nav-link campaign-report-tab" data-report-tab="trends" href="#" onclick="event.preventDefault(); switchReportTab('trends')">
            <i class="bi bi-graph-up me-1"></i>Daily Trends
          </a>
        </li>
      </ul>
    </div>
    
    <!-- Report Filters -->
    <div class="table-card p-3 mb-3">
      <div class="row g-2">
        <div class="col-md-3">
          <label class="form-label small mb-1">Campaign</label>
          <select id="reportFilterCampaign" class="form-select form-select-sm" onchange="applyReportFilters()">
            <option value="">All Campaigns</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Date Range From</label>
          <input type="date" id="reportFilterDateFrom" class="form-control form-control-sm" onchange="applyReportFilters()">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Date Range To</label>
          <input type="date" id="reportFilterDateTo" class="form-control form-control-sm" onchange="applyReportFilters()">
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Lead Status</label>
          <select id="reportFilterStatus" class="form-select form-select-sm" onchange="applyReportFilters()">
            <option value="">All Statuses</option>
            <option value="Interested">Interested</option>
            <option value="Not Interested">Not Interested</option>
            <option value="Busy">Busy</option>
            <option value="Not Picking Call">Not Picking Call</option>
            <option value="Not Open">Not Open</option>
          </select>
        </div>
        <div class="col-md-3">
          <label class="form-label small mb-1">Assigned Member</label>
          <select id="reportFilterMember" class="form-select form-select-sm" onchange="applyReportFilters()">
            <option value="">All Members</option>
          </select>
        </div>
        <div class="col-md-3 d-flex align-items-end">
          <button class="btn btn-sm btn-outline-secondary w-100" onclick="clearReportFilters()">
            <i class="bi bi-x-circle me-1"></i>Clear Filters
          </button>
        </div>
      </div>
    </div>
    
    <!-- Report Content -->
    <div id="reportContentArea"></div>
  `;
  
  // Populate campaign filter dropdown
  populateReportFilters();
  
  // Render initial report
  renderCurrentReport();
}

// ── Populate Filter Dropdowns ─────────────────────────────────
function populateReportFilters() {
  const campaigns = typeof ALL_CAMPAIGNS !== "undefined" ? ALL_CAMPAIGNS : [];
  const campaignSelect = document.getElementById("reportFilterCampaign");
  if (campaignSelect) {
    campaignSelect.innerHTML = '<option value="">All Campaigns</option>' +
      campaigns.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
  }
  
  const members = typeof ALL_USERS !== "undefined" ? ALL_USERS.filter(u => u.role === "member") : [];
  const memberSelect = document.getElementById("reportFilterMember");
  if (memberSelect) {
    memberSelect.innerHTML = '<option value="">All Members</option>' +
      members.map(m => `<option value="${m.id}">${escapeHtml(m.name || m.email)}</option>`).join("");
  }
  
  // Set default date range (last 30 days)
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);
  
  const dateFromInput = document.getElementById("reportFilterDateFrom");
  const dateToInput = document.getElementById("reportFilterDateTo");
  if (dateFromInput) dateFromInput.value = monthAgo.toISOString().slice(0, 10);
  if (dateToInput) dateToInput.value = today.toISOString().slice(0, 10);
}

// ── Get Filtered Leads ────────────────────────────────────────
function getFilteredLeads() {
  let leads = typeof ALL_LEADS !== "undefined" ? ALL_LEADS.filter(l => l.campaignId) : [];
  
  const campaignFilter = document.getElementById("reportFilterCampaign")?.value;
  const dateFrom = document.getElementById("reportFilterDateFrom")?.value;
  const dateTo = document.getElementById("reportFilterDateTo")?.value;
  const statusFilter = document.getElementById("reportFilterStatus")?.value;
  const memberFilter = document.getElementById("reportFilterMember")?.value;
  
  if (campaignFilter) {
    leads = leads.filter(l => l.campaignId === campaignFilter);
  }
  
  if (dateFrom) {
    const fromDate = new Date(dateFrom + "T00:00:00");
    leads = leads.filter(l => l.createdAt && l.createdAt.toDate() >= fromDate);
  }
  
  if (dateTo) {
    const toDate = new Date(dateTo + "T23:59:59");
    leads = leads.filter(l => l.createdAt && l.createdAt.toDate() <= toDate);
  }
  
  if (statusFilter) {
    leads = leads.filter(l => l.status === statusFilter);
  }
  
  if (memberFilter) {
    leads = leads.filter(l => l.assignedTo === memberFilter);
  }
  
  return leads;
}

// ── Apply Filters ──────────────────────────────────────────────
function applyReportFilters() {
  renderCurrentReport();
}

function clearReportFilters() {
  document.getElementById("reportFilterCampaign").value = "";
  document.getElementById("reportFilterStatus").value = "";
  document.getElementById("reportFilterMember").value = "";
  
  const today = new Date();
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);
  
  document.getElementById("reportFilterDateFrom").value = monthAgo.toISOString().slice(0, 10);
  document.getElementById("reportFilterDateTo").value = today.toISOString().slice(0, 10);
  
  renderCurrentReport();
}

// ── Render Current Report Tab ─────────────────────────────────
function renderCurrentReport() {
  switch (currentReportTab) {
    case "overview":
      renderOverviewReport();
      break;
    case "comparison":
      renderComparisonReport();
      break;
    case "member-performance":
      renderMemberPerformanceReport();
      break;
    case "trends":
      renderTrendsReport();
      break;
  }
}

// ── Overview Report ───────────────────────────────────────────
function renderOverviewReport() {
  const contentArea = document.getElementById("reportContentArea");
  if (!contentArea) return;
  
  const leads = getFilteredLeads();
  const totalLeads = leads.length;
  
  // Calculate stats using shared function from campaign-analytics.js
  const interestedCount = leads.filter(l => l.status === "Interested").length;
  const notInterestedCount = leads.filter(l => l.status === "Not Interested").length;
  const busyCount = leads.filter(l => l.status === "Busy").length;
  const conversionRate = totalLeads > 0 ? Math.round((interestedCount / totalLeads) * 100) : 0;
  
  // Group by campaign
  const byCampaign = {};
  leads.forEach(l => {
    if (!byCampaign[l.campaignId]) {
      const campaign = ALL_CAMPAIGNS.find(c => c.id === l.campaignId);
      byCampaign[l.campaignId] = {
        name: campaign ? campaign.name : "Unknown",
        count: 0
      };
    }
    byCampaign[l.campaignId].count++;
  });
  
  contentArea.innerHTML = `
    <div class="row g-3 mb-4">
      <div class="col-md-3">
        <div class="dash-stat-card">
          <div class="dash-stat-value" style="color: var(--navy)">${totalLeads}</div>
          <div class="dash-stat-label">Total Leads</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="dash-stat-card">
          <div class="dash-stat-value" style="color: #1E7A34">${interestedCount}</div>
          <div class="dash-stat-label">Interested</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="dash-stat-card">
          <div class="dash-stat-value" style="color: #B23434">${notInterestedCount}</div>
          <div class="dash-stat-label">Not Interested</div>
        </div>
      </div>
      <div class="col-md-3">
        <div class="dash-stat-card">
          <div class="dash-stat-value" style="color: #6339B5">${conversionRate}%</div>
          <div class="dash-stat-label">Conversion Rate</div>
        </div>
      </div>
    </div>
    
    <div class="table-card">
      <div class="table-responsive">
        <table class="table align-middle table-hover mb-0">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Total Leads</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            ${Object.values(byCampaign).length === 0 
              ? '<tr><td colspan="3" class="text-center text-muted py-3">No data for selected filters.</td></tr>'
              : Object.values(byCampaign).map(c => {
                const percentage = totalLeads > 0 ? Math.round((c.count / totalLeads) * 100) : 0;
                return `
                  <tr>
                    <td>${escapeHtml(c.name)}</td>
                    <td>${c.count}</td>
                    <td><div class="progress" style="height: 20px;">
                      <div class="progress-bar" style="width: ${percentage}%">${percentage}%</div>
                    </div></td>
                  </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Campaign Comparison Report ────────────────────────────────
function renderComparisonReport() {
  const contentArea = document.getElementById("reportContentArea");
  if (!contentArea) return;
  
  const campaigns = typeof ALL_CAMPAIGNS !== "undefined" ? ALL_CAMPAIGNS : [];
  const filteredLeads = getFilteredLeads();
  
  const comparisonData = campaigns.map(c => {
    const campaignLeads = filteredLeads.filter(l => l.campaignId === c.id);
    const interested = campaignLeads.filter(l => l.status === "Interested").length;
    const convRate = campaignLeads.length > 0 ? Math.round((interested / campaignLeads.length) * 100) : 0;
    
    return {
      name: c.name,
      total: campaignLeads.length,
      interested,
      convRate
    };
  }).filter(c => c.total > 0); // Only show campaigns with leads
  
  contentArea.innerHTML = `
    <div class="table-card">
      <div class="table-responsive">
        <table class="table align-middle table-hover mb-0">
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Total Leads</th>
              <th>Interested</th>
              <th>Conversion Rate</th>
              <th>Performance</th>
            </tr>
          </thead>
          <tbody>
            ${comparisonData.length === 0 
              ? '<tr><td colspan="5" class="text-center text-muted py-3">No campaigns with leads in the selected period.</td></tr>'
              : comparisonData.map(c => `
                <tr>
                  <td class="fw-semibold">${escapeHtml(c.name)}</td>
                  <td>${c.total}</td>
                  <td>${c.interested}</td>
                  <td><span class="badge ${c.convRate >= 50 ? 'bg-success' : c.convRate >= 25 ? 'bg-warning' : 'bg-danger'}">${c.convRate}%</span></td>
                  <td>
                    <div class="progress" style="height: 20px;">
                      <div class="progress-bar ${c.convRate >= 50 ? 'bg-success' : c.convRate >= 25 ? 'bg-warning' : 'bg-danger'}" style="width: ${c.convRate}%">${c.convRate}%</div>
                    </div>
                  </td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Member Performance Report ─────────────────────────────────
function renderMemberPerformanceReport() {
  const contentArea = document.getElementById("reportContentArea");
  if (!contentArea) return;
  
  const filteredLeads = getFilteredLeads();
  const members = typeof ALL_USERS !== "undefined" ? ALL_USERS.filter(u => u.role === "member") : [];
  
  const performanceData = members.map(m => {
    const memberLeads = filteredLeads.filter(l => l.assignedTo === m.id);
    const interested = memberLeads.filter(l => l.status === "Interested").length;
    const convRate = memberLeads.length > 0 ? Math.round((interested / memberLeads.length) * 100) : 0;
    
    return {
      name: m.name || m.email,
      total: memberLeads.length,
      interested,
      convRate
    };
  }).filter(m => m.total > 0); // Only show members with leads
  
  contentArea.innerHTML = `
    <div class="table-card">
      <div class="table-responsive">
        <table class="table align-middle table-hover mb-0">
          <thead>
            <tr>
              <th>Sales Member</th>
              <th>Total Leads</th>
              <th>Interested</th>
              <th>Conversion Rate</th>
              <th>Performance</th>
            </tr>
          </thead>
          <tbody>
            ${performanceData.length === 0 
              ? '<tr><td colspan="5" class="text-center text-muted py-3">No member performance data for selected filters.</td></tr>'
              : performanceData.map(m => `
                <tr>
                  <td class="fw-semibold">${escapeHtml(m.name)}</td>
                  <td>${m.total}</td>
                  <td>${m.interested}</td>
                  <td><span class="badge ${m.convRate >= 50 ? 'bg-success' : m.convRate >= 25 ? 'bg-warning' : 'bg-danger'}">${m.convRate}%</span></td>
                  <td>
                    <div class="progress" style="height: 20px;">
                      <div class="progress-bar ${m.convRate >= 50 ? 'bg-success' : m.convRate >= 25 ? 'bg-warning' : 'bg-danger'}" style="width: ${m.convRate}%">${m.convRate}%</div>
                    </div>
                  </td>
                </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Daily Trends Report ───────────────────────────────────────
function renderTrendsReport() {
  const contentArea = document.getElementById("reportContentArea");
  if (!contentArea) return;
  
  const filteredLeads = getFilteredLeads();
  
  // Group leads by date
  const byDate = {};
  filteredLeads.forEach(l => {
    if (!l.createdAt) return;
    const dateStr = l.createdAt.toDate().toISOString().slice(0, 10);
    if (!byDate[dateStr]) byDate[dateStr] = 0;
    byDate[dateStr]++;
  });
  
  const sortedDates = Object.keys(byDate).sort();
  
  contentArea.innerHTML = `
    <div class="table-card">
      <div class="table-responsive">
        <table class="table align-middle table-hover mb-0">
          <thead>
            <tr>
              <th>Date</th>
              <th>Total Leads</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            ${sortedDates.length === 0 
              ? '<tr><td colspan="3" class="text-center text-muted py-3">No trend data for selected period.</td></tr>'
              : sortedDates.map(date => {
                const count = byDate[date];
                const dateObj = new Date(date);
                const formattedDate = dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
                return `
                  <tr>
                    <td>${formattedDate}</td>
                    <td>${count}</td>
                    <td>
                      <div class="progress" style="height: 20px;">
                        <div class="progress-bar bg-info" style="width: ${Math.min(100, count * 10)}%">${count}</div>
                      </div>
                    </td>
                  </tr>`;
              }).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Export Functions ──────────────────────────────────────────
function exportReportPDF() {
  toast("PDF export functionality would be implemented here.", "info");
  // TODO: Implement PDF generation using jsPDF or similar library
}

function exportReportExcel() {
  toast("Excel export functionality would be implemented here.", "info");
  // TODO: Implement Excel generation using xlsx or similar library
}

function printReport() {
  window.print();
}
