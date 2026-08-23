// ============================================================
// CAMPAIGN-ANALYTICS.JS — Module 2: Campaign Analytics Dashboard
//
// Visible to: Super Admin, Admin (never Member — dashboard tab
// itself is already hidden from Members in app.js buildNav()).
//
// Design notes:
//  - Zero extra Firestore reads: everything is derived from the
//    ALL_CAMPAIGNS / CAMPAIGN_FIELDS_CACHE (campaigns.js) and
//    ALL_LEADS (leads.js) arrays that are already kept live via
//    existing onSnapshot listeners elsewhere in the app.
//  - refreshCampaignAnalyticsIfVisible() is called from those
//    existing listeners' callbacks (see hooks added in campaigns.js
//    and leads.js) so the section reacts in real time without a
//    listener of its own ("reuse existing listeners").
//  - All calculation functions are now imported from campaign-utils.js
//    to prevent code duplication with campaign-reports.js
// ============================================================

// NOTE: All shared calculation functions (_campaignLeadsScope, computeCampaignStats,
// _todayCampaignLeadsCount, formatDuration, etc.) are now in campaign-utils.js
// and must be loaded BEFORE this file in dashboard.html

// ── Render: KPI cards + performance table + distribution chart ─
function renderCampaignAnalyticsSection() {
  const wrap = document.getElementById("campaignAnalyticsWrap");
  if (!wrap) return;
  if (!(CURRENT_USER.role === "superadmin" || CURRENT_USER.role === "admin")) { wrap.innerHTML = ""; return; }

  const campaigns = typeof ALL_CAMPAIGNS !== "undefined" ? ALL_CAMPAIGNS : [];
  const activeCount   = campaigns.filter(c => getCampaignStatus(c) === "active").length;
  const inactiveCount = campaigns.filter(c => getCampaignStatus(c) === "inactive").length;
  const archivedCount = campaigns.filter(c => getCampaignStatus(c) === "archived").length;

  const overall = computeCampaignStats(null);
  const todaysLeads = _todayCampaignLeadsCount();

  const kpis = [
    { icon: "bi-columns-gap",     label: "Total Campaigns",     value: campaigns.length, color: "var(--steel)" },
    { icon: "bi-play-circle",     label: "Active Campaigns",    value: activeCount,       color: "#1E7A34" },
    { icon: "bi-pause-circle",    label: "Inactive Campaigns",  value: inactiveCount,     color: "#C05621" },
    { icon: "bi-archive",         label: "Archived Campaigns",  value: archivedCount,     color: "#6B7280" },
    { icon: "bi-people-fill",     label: "Total Campaign Leads",value: overall.total,     color: "var(--navy)" },
    { icon: "bi-calendar-event",  label: "Today's Leads",       value: todaysLeads,       color: "#2A5A9C" },
    { icon: "bi-graph-up-arrow",  label: "Conversion Rate",     value: overall.convRate + "%", color: "#6339B5" }
  ];

  wrap.innerHTML = `
    <hr class="my-4">
    <div class="mb-3 d-flex justify-content-between align-items-center flex-wrap gap-2">
      <div>
        <h5 class="mb-0"><i class="bi bi-bar-chart-line me-2"></i>Campaign Analytics</h5>
        <p class="page-subtitle mb-0">Live performance across all lead-capture campaigns.</p>
      </div>
    </div>

    <div class="row g-3 mb-4">
      ${kpis.map(c => `
        <div class="col-6 col-md-4 col-lg-3">
          <div class="dash-stat-card">
            <div class="dash-stat-icon" style="color:${c.color}"><i class="bi ${c.icon}"></i></div>
            <div class="dash-stat-value" style="color:${c.color}">${c.value}</div>
            <div class="dash-stat-label">${c.label}</div>
          </div>
        </div>`).join("")}
    </div>

    <div class="row g-3 mb-4">
      <div class="col-lg-7">
        <div class="table-card">
          <div class="table-responsive">
            <table class="table align-middle table-hover mb-0" style="font-size:13.5px">
              <thead>
                <tr>
                  <th>Campaign</th><th>Total</th><th>Interested</th><th>Busy</th>
                  <th>Not Picking</th><th>Converted</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                ${campaigns.length === 0 ? `<tr><td colspan="7" class="text-center text-muted py-3">No campaigns yet.</td></tr>` :
                  campaigns.map(c => {
                    const s = computeCampaignStats(c.id);
                    const status = getCampaignStatus(c);
                    return `
                <tr role="button" onclick="openCampaignDetailsModal('${c.id}')">
                  <td class="fw-semibold">${escapeHtml(c.name)}</td>
                  <td>${s.total}</td>
                  <td>${s.counts["Interested"]}</td>
                  <td>${s.counts["Busy"]}</td>
                  <td>${s.counts["Not Picking Call"]}</td>
                  <td>${s.converted}</td>
                  <td>${CAMPAIGN_STATUS_BADGE[status]}</td>
                </tr>`;
                  }).join("")}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="col-lg-5">
        <div class="table-card p-3" style="height:100%">
          <h6 class="mb-3">Campaign Lead Distribution</h6>
          <canvas id="campaignLeadDistributionChart" height="220"></canvas>
        </div>
      </div>
    </div>`;

  _renderCampaignDistributionChart(campaigns);
}

function _renderCampaignDistributionChart(campaigns) {
  const canvas = document.getElementById("campaignLeadDistributionChart");
  if (!canvas || typeof Chart === "undefined") return;

  const labels = campaigns.map(c => c.name);
  const data = campaigns.map(c => _campaignLeadsScope(c.id).length);
  const colors = ["#1E7A34", "#2A5A9C", "#6339B5", "#C05621", "#B23434", "#157A72", "#92600A", "#4338CA"];

  if (window._campaignDistChart) window._campaignDistChart.destroy();
  window._campaignDistChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{ data, backgroundColor: labels.map((_, i) => colors[i % colors.length]) }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: "bottom", labels: { boxWidth: 12, font: { size: 11 } } } }
    }
  });
}

// Called from campaigns.js / leads.js snapshot callbacks — cheap no-op unless
// the Dashboard view is actually on screen.
function refreshCampaignAnalyticsIfVisible() {
  const view = document.getElementById("view-dashboard");
  if (view && !view.classList.contains("d-none")) {
    renderCampaignAnalyticsSection();
  }
}

// ============================================================
// CAMPAIGN DETAILS MODAL — shared by Module 1 (View action),
// Module 2 (click a performance row), and Module 3 (report drill-down)
// ============================================================
function openCampaignDetailsModal(campaignId) {
  const c = ALL_CAMPAIGNS.find(x => x.id === campaignId);
  if (!c) { toast("Campaign not found.", "warning"); return; }

  const status = getCampaignStatus(c);
  const fields = (CAMPAIGN_FIELDS_CACHE[campaignId] || []).slice().sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  const stats = computeCampaignStats(campaignId);
  const leads = _campaignLeadsScope(campaignId)
    .slice()
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, 10);

  const createdByName = c.createdBy ? (ALL_USERS?.find(u => u.id === c.createdBy)?.name || "—") : "—";

  const overviewRows = [
    ["Status", CAMPAIGN_STATUS_BADGE[status]],
    ["Created Date", c.createdAt ? formatDateTime(c.createdAt.toDate()) : "—"],
    ["Created By", escapeHtml(createdByName)],
    ["Last Updated", c.updatedAt ? formatDateTime(c.updatedAt.toDate()) : "—"],
    ["Total Leads", stats.total],
    ["Conversion Rate", stats.convRate + "%"],
    ["Average Response Time", formatDuration(stats.avgResponseMin)]
  ];

  const statusBreakdown = [
    ["Interested", stats.counts["Interested"]],
    ["Busy", stats.counts["Busy"]],
    ["Not Picking", stats.counts["Not Picking Call"]],
    ["Not Interested", stats.counts["Not Interested"]],
    ["Drivers", stats.counts["Driver"]],
    ["Transporters", stats.counts["Transporter"]],
    ["Job Seekers", stats.counts["Job Seeker"]],
    ["Converted", stats.converted]
  ];

  document.getElementById("campaignDetailsModalTitle").textContent = c.name;
  document.getElementById("campaignDetailsModalBody").innerHTML = `
    <h6 class="text-muted small fw-semibold mb-2">CAMPAIGN OVERVIEW</h6>
    <div class="row g-2 mb-3">
      ${overviewRows.map(([label, value]) => `
        <div class="col-6 col-md-4">
          <div class="lead-detail-row">
            <div class="lead-detail-label">${label}</div>
            <div class="lead-detail-value">${value}</div>
          </div>
        </div>`).join("")}
    </div>

    ${fields.length > 0 ? `
    <h6 class="text-muted small fw-semibold mb-2 mt-3">CONFIGURED FIELDS</h6>
    <div class="mb-3">
      ${fields.map(f => `<span class="badge bg-light text-dark border me-1 mb-1">${escapeHtml(f.fieldLabel)}</span>`).join("")}
    </div>` : ""}

    <h6 class="text-muted small fw-semibold mb-2 mt-3">LEAD STATUS BREAKDOWN</h6>
    <div class="row g-2 mb-3">
      ${statusBreakdown.map(([label, value]) => `
        <div class="col-6 col-md-3">
          <div class="dash-stat-card py-2">
            <div class="dash-stat-value" style="font-size:20px">${value}</div>
            <div class="dash-stat-label">${label}</div>
          </div>
        </div>`).join("")}
    </div>

    <h6 class="text-muted small fw-semibold mb-2 mt-3">RECENT LEADS (latest ${leads.length})</h6>
    <div class="table-responsive">
      <table class="table table-sm align-middle mb-0" style="font-size:13px">
        <thead><tr><th>Sl.No</th><th>Name</th><th>Phone</th><th>Status</th><th>Created</th></tr></thead>
        <tbody>
          ${leads.length === 0 ? `<tr><td colspan="5" class="text-center text-muted py-3">No leads yet for this campaign.</td></tr>` :
            leads.map(l => `
          <tr>
            <td>${l.slNo}</td>
            <td>${escapeHtml(l.fullName || "—")}</td>
            <td>${escapeHtml(l.phoneNumber || "—")}</td>
            <td><span class="badge ${STATUS_BADGE_CLASS[l.status] || "badge-not-open"}">${escapeHtml(l.status || "—")}</span></td>
            <td class="text-nowrap">${l.createdAt ? formatDateTime(l.createdAt.toDate()) : "—"}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>`;

  bootstrap.Modal.getOrCreateInstance(document.getElementById("campaignDetailsModal")).show();
}