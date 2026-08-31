// ============================================================
// CAMPAIGN-REPORTS.JS — Unified campaign reporting
// Includes Email/WhatsApp marketing campaigns AND the lead-capture
// campaigns stored in the `campaigns` collection.
// No Firebase reads. Uses already-loaded caches from the CRM.
// ============================================================

let currentReportTab = 'overview';

function switchReportTab(tab) {
  currentReportTab = tab;
  document.querySelectorAll('.campaign-report-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-report-tab="${tab}"]`)?.classList.add('active');
  renderCurrentReport();
}

function campaignReportData() {
  const marketing = window.MarketingChannels?.getReportData?.() || {
    customers: [], emailCampaigns: [], whatsappCampaigns: []
  };

  const marketingCampaigns = [
    ...(marketing.emailCampaigns || []).map(c => ({
      ...c,
      reportKey: `email:${c.id}`,
      source: 'marketing',
      channel: 'Email'
    })),
    ...(marketing.whatsappCampaigns || []).map(c => ({
      ...c,
      reportKey: `whatsapp:${c.id}`,
      source: 'marketing',
      channel: 'WhatsApp'
    }))
  ];

  const leadCampaigns = (Array.isArray(window.ALL_CAMPAIGNS) ? window.ALL_CAMPAIGNS : [])
    .map(c => ({
      ...c,
      reportKey: `lead:${c.id}`,
      source: 'lead-capture',
      channel: 'Lead Capture'
    }));

  return {
    marketing,
    campaigns: [...marketingCampaigns, ...leadCampaigns],
    leads: Array.isArray(window.ALL_LEADS) ? window.ALL_LEADS : []
  };
}

function campaignReportRange() {
  const rawFrom = document.getElementById('reportFilterDateFrom')?.value;
  const rawTo = document.getElementById('reportFilterDateTo')?.value;
  const today = typeof reportNowDateKey === 'function'
    ? reportNowDateKey()
    : new Date().toISOString().slice(0, 10);
  const from = rawFrom || today;
  const to = rawTo || today;
  return from <= to ? { from, to } : { from: to, to: from };
}

function inCampaignRange(value, range) {
  if (typeof reportDateKey === 'function') {
    const k = reportDateKey(value);
    return !!k && k >= range.from && k <= range.to;
  }
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return false;
  const k = d.toISOString().slice(0, 10);
  return k >= range.from && k <= range.to;
}

function campaignLeadRows(campaign, range, leads) {
  if (campaign?.source !== 'lead-capture') return [];
  return leads.filter(l =>
    l.campaignId === campaign.id &&
    inCampaignRange(l.createdAt, range)
  );
}

function campaignEvents(campaign, range) {
  if (campaign?.source !== 'marketing') return [];
  return Object.values(campaign.sentRecipients || {})
    .filter(e => e?.openedAt && (!range || inCampaignRange(e.openedAt, range)))
    .map(e => ({ ...e, campaign }));
}

// A campaign should remain visible if it was created in the period OR
// had actual activity in the period. This fixes the old behaviour where
// older campaigns disappeared just because their createdAt was outside
// the selected reporting range.
function campaignHasActivityInRange(campaign, range, leads) {
  if (inCampaignRange(campaign.createdAt, range)) return true;
  if (campaign.source === 'marketing') return campaignEvents(campaign, range).length > 0;
  return campaignLeadRows(campaign, range, leads).length > 0;
}

function populateReportFilters() {
  const { campaigns } = campaignReportData();
  const campaignSelect = document.getElementById('reportFilterCampaign');
  if (campaignSelect) {
    const previous = campaignSelect.value;
    campaignSelect.innerHTML = '<option value="">All Campaigns</option>' + campaigns.map(c =>
      `<option value="${escapeHtml(c.reportKey)}">${escapeHtml(c.name || 'Campaign')} (${escapeHtml(c.channel)})</option>`
    ).join('');
    if (previous && campaigns.some(c => c.reportKey === previous)) campaignSelect.value = previous;
  }

  const members = Array.isArray(window.ACTIVE_MEMBERS) && window.ACTIVE_MEMBERS.length
    ? window.ACTIVE_MEMBERS
    : (typeof ALL_USERS !== 'undefined' ? ALL_USERS.filter(u => u.role === 'member') : []);
  const memberSelect = document.getElementById('reportFilterMember');
  if (memberSelect) {
    const previous = memberSelect.value;
    memberSelect.innerHTML = '<option value="">All Members</option>' + members.map(m =>
      `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name || m.email)}</option>`
    ).join('');
    if (previous && members.some(m => m.id === previous)) memberSelect.value = previous;
  }

  const today = typeof reportNowDateKey === 'function'
    ? reportNowDateKey()
    : new Date().toISOString().slice(0, 10);
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 30);
  const from = d.toISOString().slice(0, 10);
  const f = document.getElementById('reportFilterDateFrom');
  const t = document.getElementById('reportFilterDateTo');
  if (f && !f.value) f.value = from;
  if (t && !t.value) t.value = today;
}

function selectedCampaigns() {
  const { campaigns } = campaignReportData();
  const campaignKey = document.getElementById('reportFilterCampaign')?.value;
  // Keep the complete campaign catalogue visible. The selected date range
  // controls the activity/leads shown for each campaign, rather than hiding
  // older campaigns altogether. This makes lead-capture/ad campaigns visible
  // even when they were created before the selected reporting period.
  return campaigns.filter(c => !campaignKey || c.reportKey === campaignKey);
}

function selectedLeadRows() {
  const { leads, campaigns } = campaignReportData();
  const range = campaignReportRange();
  const campaignKey = document.getElementById('reportFilterCampaign')?.value;
  const status = document.getElementById('reportFilterStatus')?.value;
  const member = document.getElementById('reportFilterMember')?.value;

  const selected = campaignKey
    ? campaigns.find(c => c.reportKey === campaignKey)
    : null;

  // Lead rows only belong to lead-capture campaigns. A selected Email/WhatsApp
  // campaign therefore correctly shows zero CRM leads rather than unrelated leads.
  return leads.filter(l =>
    l.campaignId &&
    inCampaignRange(l.createdAt, range) &&
    (!selected || (selected.source === 'lead-capture' && l.campaignId === selected.id)) &&
    (!status || l.status === status) &&
    (!member || l.assignedTo === member)
  );
}

function reportCampaignMetrics(campaign) {
  const range = campaignReportRange();
  const leads = campaignLeadRows(campaign, range, campaignReportData().leads);
  const events = campaignEvents(campaign, range);
  const interested = leads.filter(l => l.status === 'Interested').length;
  const conversion = leads.length ? Math.round(interested / leads.length * 100) : 0;
  return { leads, events, interested, conversion };
}

function renderCampaignReportsPanel() {
  const wrap = document.getElementById('campaignReportsPanel') || document.getElementById('view-campaignreports');
  if (!wrap) return;
  if (window.CURRENT_USER?.role !== 'marketing' && typeof hasPermission === 'function' && !hasPermission('campaignReports.view')) {
    wrap.innerHTML = '<div class="alert alert-danger"><i class="bi bi-lock-fill me-2"></i>Access Denied.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <div><h2 class="page-title"><i class="bi bi-bar-chart-line me-2"></i>Campaign Reports</h2><p class="page-subtitle">Unified performance for Email, WhatsApp and lead-capture campaigns.</p></div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-outline-secondary" onclick="exportReportPDF()"><i class="bi bi-file-earmark-pdf me-1"></i>PDF</button>
        <button class="btn btn-sm btn-outline-success" onclick="exportReportExcel()"><i class="bi bi-file-earmark-excel me-1"></i>Excel</button>
      </div>
    </div>
    <div class="table-card p-3 mb-3"><div class="row g-2">
      <div class="col-md-3"><label class="form-label small">Campaign</label><select id="reportFilterCampaign" class="form-select form-select-sm" onchange="applyReportFilters()"></select></div>
      <div class="col-md-3"><label class="form-label small">Date Range From</label><input type="date" id="reportFilterDateFrom" class="form-control form-control-sm" onchange="applyReportFilters()"></div>
      <div class="col-md-3"><label class="form-label small">Date Range To</label><input type="date" id="reportFilterDateTo" class="form-control form-control-sm" onchange="applyReportFilters()"></div>
      <div class="col-md-3"><label class="form-label small">Lead Status</label><select id="reportFilterStatus" class="form-select form-select-sm" onchange="applyReportFilters()"><option value="">All Statuses</option><option>Interested</option><option>Not Interested</option><option>Busy</option><option>Not Picking Call</option><option>Not Open</option><option>Driver</option><option>Transporter</option><option>Job Seeker</option></select></div>
      <div class="col-md-3"><label class="form-label small">Assigned Member</label><select id="reportFilterMember" class="form-select form-select-sm" onchange="applyReportFilters()"></select></div>
      <div class="col-md-3 d-flex align-items-end"><button class="btn btn-sm btn-outline-secondary w-100" onclick="clearReportFilters()"><i class="bi bi-x-circle me-1"></i>Clear Filters</button></div>
    </div></div>
    <div class="mb-3"><ul class="nav nav-tabs"><li class="nav-item"><a href="#" class="nav-link campaign-report-tab active" data-report-tab="overview" onclick="event.preventDefault();switchReportTab('overview')">Overview</a></li><li class="nav-item"><a href="#" class="nav-link campaign-report-tab" data-report-tab="comparison" onclick="event.preventDefault();switchReportTab('comparison')">Campaign Comparison</a></li><li class="nav-item"><a href="#" class="nav-link campaign-report-tab" data-report-tab="member-performance" onclick="event.preventDefault();switchReportTab('member-performance')">Member Performance</a></li><li class="nav-item"><a href="#" class="nav-link campaign-report-tab" data-report-tab="trends" onclick="event.preventDefault();switchReportTab('trends')">Daily Trends</a></li></ul></div>
    <div id="reportContentArea"></div>`;
  populateReportFilters();
  renderCurrentReport();
}

function renderCurrentReport() {
  if (!document.getElementById('reportContentArea')) return;
  if (currentReportTab === 'comparison') return renderComparisonReport();
  if (currentReportTab === 'member-performance') return renderMemberPerformanceReport();
  if (currentReportTab === 'trends') return renderTrendsReport();
  renderOverviewReport();
}

function renderOverviewReport() {
  const area = document.getElementById('reportContentArea');
  if (!area) return;
  const d = campaignReportData();
  const campaigns = selectedCampaigns();
  const leads = selectedLeadRows();
  const events = campaigns.flatMap(c => campaignEvents(c, campaignReportRange()));
  const interested = leads.filter(l => l.status === 'Interested').length;
  const conversion = leads.length ? Math.round(interested / leads.length * 100) : 0;
  const max = Math.max(1, ...campaigns.map(c => {
    const m = reportCampaignMetrics(c);
    return Math.max(m.events.length, m.leads.length);
  }));

  area.innerHTML = `<div class="row g-3 mb-3">${[
    ['Campaigns', campaigns.length, '📣'],
    ['Messages Initiated', events.length, '💬'],
    ['Leads', leads.length, '📋'],
    ['Conversion', `${conversion}%`, '📈']
  ].map(x => `<div class="col-6 col-lg-3"><div class="marketing-stat"><span>${x[2]} ${x[0]}</span><strong>${x[1]}</strong></div></div>`).join('')}</div>
  <div class="table-card p-3"><h6 class="mb-3">Campaign processing</h6>${campaigns.length ? campaigns.map(c => {
    const m = reportCampaignMetrics(c);
    const activityCount = c.source === 'lead-capture' ? m.leads.length : m.events.length;
    const p = Math.round(activityCount / max * 100);
    const cls = c.channel === 'Email' ? 'bg-primary' : c.channel === 'WhatsApp' ? 'bg-success' : 'bg-warning';
    const activityLabel = c.source === 'lead-capture' ? `${m.leads.length} lead(s)` : `${m.events.length} initiated`;
    return `<div class="report-campaign-row mb-3"><div class="d-flex justify-content-between mb-1"><strong>${escapeHtml(c.name || 'Campaign')}</strong><span><span class="badge ${cls} me-2">${escapeHtml(c.channel)}</span>${activityLabel}</span></div><div class="progress report-progress"><div class="progress-bar ${cls}" style="width:${Math.min(100, p)}%"></div></div></div>`;
  }).join('') : '<div class="text-center text-muted py-4">No campaign activity for the selected filters.</div>'}</div>`;
}

function renderComparisonReport() {
  const area = document.getElementById('reportContentArea');
  if (!area) return;
  const campaigns = selectedCampaigns();
  const rows = campaigns.map(c => {
    const m = reportCampaignMetrics(c);
    return {
      c,
      leads: m.leads.length,
      interested: m.interested,
      rate: m.conversion,
      events: m.events.length
    };
  });
  area.innerHTML = `<div class="table-card p-3"><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Campaign</th><th>Channel</th><th>Leads</th><th>Interested</th><th>Conversion</th><th>Messages Initiated</th><th>Processing</th></tr></thead><tbody>${rows.length ? rows.map(r => {
    const cls = r.c.channel === 'Email' ? 'bg-primary' : r.c.channel === 'WhatsApp' ? 'bg-success' : 'bg-warning';
    const activity = r.c.source === 'lead-capture' ? r.leads : r.events;
    return `<tr><td><strong>${escapeHtml(r.c.name || 'Campaign')}</strong></td><td><span class="badge ${cls}">${escapeHtml(r.c.channel)}</span></td><td>${r.leads}</td><td>${r.interested}</td><td>${r.rate}%</td><td>${r.events}</td><td><div class="progress report-progress"><div class="progress-bar ${cls}" style="width:${activity ? 100 : 0}%"></div></div></td></tr>`;
  }).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">No campaigns for the selected date range.</td></tr>'}</tbody></table></div></div>`;
}

function renderMemberPerformanceReport() {
  const area = document.getElementById('reportContentArea');
  if (!area) return;
  const members = Array.isArray(window.ACTIVE_MEMBERS) && window.ACTIVE_MEMBERS.length
    ? window.ACTIVE_MEMBERS
    : (typeof ALL_USERS !== 'undefined' ? ALL_USERS.filter(u => u.role === 'member') : []);
  const leads = selectedLeadRows();
  const rows = members.map(m => {
    const x = leads.filter(l => l.assignedTo === m.id);
    const i = x.filter(l => l.status === 'Interested').length;
    return { name: m.name || m.email, total: x.length, interested: i, rate: x.length ? Math.round(i / x.length * 100) : 0 };
  }).filter(x => x.total);
  area.innerHTML = `<div class="table-card p-3"><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Sales Member</th><th>Total Leads</th><th>Interested</th><th>Conversion</th><th>Performance</th></tr></thead><tbody>${rows.length ? rows.map(r => `<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.total}</td><td>${r.interested}</td><td>${r.rate}%</td><td><div class="progress report-progress"><div class="progress-bar" style="width:${r.rate}%"></div></div></td></tr>`).join('') : '<tr><td colspan="5" class="text-center text-muted py-4">No member data for this period.</td></tr>'}</tbody></table></div></div>`;
}

function renderTrendsReport() {
  const area = document.getElementById('reportContentArea');
  if (!area) return;
  const d = campaignReportData();
  const range = campaignReportRange();
  const keys = [];
  const x = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);
  while (x <= end) {
    keys.push(x.toISOString().slice(0, 10));
    x.setDate(x.getDate() + 1);
  }
  const email = Object.fromEntries(keys.map(k => [k, 0]));
  const wa = Object.fromEntries(keys.map(k => [k, 0]));
  const leadCounts = Object.fromEntries(keys.map(k => [k, 0]));
  d.campaigns.forEach(c => {
    if (c.source === 'marketing') {
      campaignEvents(c, range).forEach(e => {
        const k = reportDateKey(e.openedAt);
        if (k && email[k] !== undefined) (c.channel === 'Email' ? email : wa)[k]++;
      });
    } else {
      campaignLeadRows(c, range, d.leads).forEach(l => {
        const k = reportDateKey(l.createdAt);
        if (k && leadCounts[k] !== undefined) leadCounts[k]++;
      });
    }
  });
  area.innerHTML = `<div class="table-card p-3"><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Date</th><th>Email</th><th>WhatsApp</th><th>Lead Campaign Leads</th><th>Total</th></tr></thead><tbody>${keys.map(k => `<tr><td>${reportDateLabel(k, false)}</td><td>${email[k]}</td><td>${wa[k]}</td><td>${leadCounts[k]}</td><td><strong>${email[k] + wa[k] + leadCounts[k]}</strong></td></tr>`).join('')}</tbody></table></div></div>`;
}

function applyReportFilters() {
  renderCurrentReport();
}

function clearReportFilters() {
  const today = typeof reportNowDateKey === 'function' ? reportNowDateKey() : new Date().toISOString().slice(0, 10);
  const d = new Date(`${today}T12:00:00`);
  d.setDate(d.getDate() - 30);
  const campaign = document.getElementById('reportFilterCampaign');
  const status = document.getElementById('reportFilterStatus');
  const member = document.getElementById('reportFilterMember');
  const from = document.getElementById('reportFilterDateFrom');
  const to = document.getElementById('reportFilterDateTo');
  if (campaign) campaign.value = '';
  if (status) status.value = '';
  if (member) member.value = '';
  if (from) from.value = d.toISOString().slice(0, 10);
  if (to) to.value = today;
  renderCurrentReport();
}

function exportReportPDF() {
  if (!window.jspdf?.jsPDF) { toast('PDF library is not available.', 'danger'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  doc.setFontSize(16);
  doc.text('Abra Logistics Campaign Report', 14, 18);
  doc.setFontSize(10);
  doc.text(`Period: ${campaignReportRange().from} to ${campaignReportRange().to}`, 14, 26);
  const rows = selectedCampaigns().map(c => {
    const m = reportCampaignMetrics(c);
    return [c.channel, c.name || 'Campaign', m.leads.length, m.events.length];
  });
  doc.autoTable?.({ head: [['Channel', 'Campaign', 'Leads', 'Messages Initiated']], body: rows, startY: 34 });
  doc.save('abra-logistics-campaign-report.pdf');
}

function exportReportExcel() {
  if (!window.XLSX) { toast('Excel library is not available.', 'danger'); return; }
  const rows = selectedCampaigns().map(c => {
    const m = reportCampaignMetrics(c);
    return { Channel: c.channel, Campaign: c.name || 'Campaign', Leads: m.leads.length, 'Messages Initiated': m.events.length, Created: typeof fmtDate === 'function' ? fmtDate(c.createdAt) : '' };
  });
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Campaign Report');
  XLSX.writeFile(wb, 'abra-logistics-campaign-report.xlsx');
}

function printReport() { window.print(); }
