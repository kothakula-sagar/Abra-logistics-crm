// ============================================================
// REPORT.JS — Daily Marketing + CRM report
// Uses ONLY data already loaded by the marketing/CRM modules.
// No Firebase reads are performed by this module.
// ============================================================

const REPORT_PERIOD = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  CUSTOM_DATE: 'custom_date',
  DATE_RANGE: 'date_range'
};

const REPORT_TZ = 'Asia/Kolkata';
let reportCharts = [];
let reportReady = false;

function reportNowDateKey(offsetDays = 0) {
  const now = new Date();
  if (offsetDays) now.setDate(now.getDate() + offsetDays);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function reportDateKey(value) {
  if (!value) return '';
  const d = value?.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: REPORT_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

function reportDateLabel(key, long = true) {
  if (!key) return '—';
  const d = new Date(`${key}T12:00:00`);
  return d.toLocaleDateString('en-IN', long
    ? { day: '2-digit', month: 'long', year: 'numeric' }
    : { day: '2-digit', month: 'short', year: 'numeric' });
}

function reportDateRange() {
  const period = document.getElementById('reportPeriod')?.value || REPORT_PERIOD.TODAY;
  const today = reportNowDateKey();
  if (period === REPORT_PERIOD.YESTERDAY) {
    const y = new Date(`${today}T12:00:00`); y.setDate(y.getDate() - 1);
    const key = y.toISOString().slice(0,10);
    return { from: key, to: key };
  }
  if (period === REPORT_PERIOD.CUSTOM_DATE) {
    const key = document.getElementById('reportDate')?.value || today;
    return { from: key, to: key };
  }
  if (period === REPORT_PERIOD.DATE_RANGE) {
    const from = document.getElementById('reportDateRangeFrom')?.value || today;
    const to = document.getElementById('reportDateRangeTo')?.value || today;
    return { from: from <= to ? from : to, to: from <= to ? to : from };
  }
  return { from: today, to: today };
}

function inReportRange(value, range) {
  const key = reportDateKey(value);
  return !!key && key >= range.from && key <= range.to;
}

function getLoadedMarketingData() {
  const data = window.MarketingChannels?.getReportData?.();
  if (data) return data;
  return { customers: [], emailCampaigns: [], whatsappCampaigns: [] };
}

function getLoadedLeads() {
  return Array.isArray(window.ALL_LEADS) ? window.ALL_LEADS : [];
}

function campaignMessageEvents(campaign) {
  return Object.entries(campaign?.sentRecipients || {}).map(([contactId, entry]) => ({
    contactId,
    openedAt: entry?.openedAt || entry?.sentAt || entry?.timestamp,
    sentBy: entry?.sentBy,
    sentByName: entry?.sentByName || 'CRM User'
  })).filter(x => x.openedAt);
}

function getReportDataset() {
  const range = reportDateRange();
  const data = getLoadedMarketingData();
  const customers = data.customers || [];
  const emailCampaigns = data.emailCampaigns || [];
  const whatsappCampaigns = data.whatsappCampaigns || [];
  const allCampaigns = [
    ...emailCampaigns.map(c => ({ ...c, channel: 'Email' })),
    ...whatsappCampaigns.map(c => ({ ...c, channel: 'WhatsApp' }))
  ];

  const customersAdded = customers.filter(c => inReportRange(c.createdAt, range));
  const customerUpdates = customers.filter(c => {
    if (!c.updatedAt || !inReportRange(c.updatedAt, range)) return false;
    const createdMs = c.createdAt?.toDate ? c.createdAt.toDate().getTime() : new Date(c.createdAt || 0).getTime();
    const updatedMs = c.updatedAt?.toDate ? c.updatedAt.toDate().getTime() : new Date(c.updatedAt || 0).getTime();
    return !createdMs || !updatedMs || Math.abs(updatedMs - createdMs) > 1000;
  });
  const campaignsCreated = allCampaigns.filter(c => inReportRange(c.createdAt, range));

  const emailEvents = emailCampaigns.flatMap(c => campaignMessageEvents(c).map(e => ({ ...e, campaign: c, channel: 'Email' })))
    .filter(e => inReportRange(e.openedAt, range));
  const whatsappEvents = whatsappCampaigns.flatMap(c => campaignMessageEvents(c).map(e => ({ ...e, campaign: c, channel: 'WhatsApp' })))
    .filter(e => inReportRange(e.openedAt, range));

  const leadRows = getLoadedLeads().filter(l => inReportRange(l.createdAt, range));
  const leadStatusCounts = {};
  leadRows.forEach(l => { leadStatusCounts[l.status] = (leadStatusCounts[l.status] || 0) + 1; });

  return {
    range, customers, customersAdded, customerUpdates,
    allCampaigns, campaignsCreated,
    emailCampaigns, whatsappCampaigns,
    emailEvents, whatsappEvents, leadRows, leadStatusCounts
  };
}

function formatCount(n) { return Number(n || 0).toLocaleString('en-IN'); }

function initReportControls() {
  const period = document.getElementById('reportPeriod');
  if (!period || reportReady) return;
  reportReady = true;
  const today = reportNowDateKey();
  const yesterday = new Date(`${today}T12:00:00`); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = yesterday.toISOString().slice(0,10);

  period.value = REPORT_PERIOD.TODAY;
  const dateInput = document.getElementById('reportDate');
  const from = document.getElementById('reportDateRangeFrom');
  const to = document.getElementById('reportDateRangeTo');
  if (dateInput) { dateInput.value = today; dateInput.disabled = true; }
  if (from) from.value = today;
  if (to) to.value = today;

  period.addEventListener('change', handlePeriodChange);
  dateInput?.addEventListener('change', renderDailyReport);
  from?.addEventListener('change', renderDailyReport);
  to?.addEventListener('change', renderDailyReport);
  renderDailyReport();
}

function handlePeriodChange() {
  const period = document.getElementById('reportPeriod')?.value;
  const dateInput = document.getElementById('reportDate');
  const rangeWrap = document.getElementById('reportDateRangeWrap');
  const today = reportNowDateKey();
  const y = new Date(`${today}T12:00:00`); y.setDate(y.getDate() - 1);
  const yesterday = y.toISOString().slice(0,10);

  if (period === REPORT_PERIOD.TODAY) {
    if (dateInput) { dateInput.value = today; dateInput.disabled = true; }
    rangeWrap?.classList.add('d-none');
  } else if (period === REPORT_PERIOD.YESTERDAY) {
    if (dateInput) { dateInput.value = yesterday; dateInput.disabled = true; }
    rangeWrap?.classList.add('d-none');
  } else if (period === REPORT_PERIOD.CUSTOM_DATE) {
    if (dateInput) dateInput.disabled = false;
    rangeWrap?.classList.add('d-none');
  } else {
    if (dateInput) dateInput.disabled = true;
    rangeWrap?.classList.remove('d-none');
  }
  renderDailyReport();
}

function statCard(label, value, sub, icon) {
  return `<div class="col-6 col-md-3"><div class="report-stat-card report-stat-marketing">
    <div class="d-flex justify-content-between align-items-start"><div><div class="report-stat-value">${formatCount(value)}</div><div class="report-stat-label">${label}</div></div><div class="report-kpi-icon">${icon}</div></div>
    <div class="small text-muted mt-2">${sub}</div>
  </div></div>`;
}

function campaignActivityRows(events, channel) {
  const byCampaign = {};
  events.forEach(e => {
    const id = e.campaign?.id || e.campaign?.name || 'unknown';
    if (!byCampaign[id]) byCampaign[id] = { name: e.campaign?.name || 'Campaign', count: 0 };
    byCampaign[id].count++;
  });
  return Object.values(byCampaign).sort((a,b) => b.count - a.count).map(x => ({ ...x, channel }));
}

function renderDailyReport() {
  const grid = document.getElementById('reportStatsGrid');
  const box = document.getElementById('reportMessageBox');
  if (!grid || !box) return;

  const d = getReportDataset();
  const totalMessages = d.emailEvents.length + d.whatsappEvents.length;
  const emailCampaignsCreated = d.campaignsCreated.filter(c => c.channel === 'Email').length;
  const whatsappCampaignsCreated = d.campaignsCreated.filter(c => c.channel === 'WhatsApp').length;
  const leadTotal = d.leadRows.length;

  grid.innerHTML = [
    statCard('New Customers', d.customersAdded.length, 'Added in selected period', '👥'),
    statCard('Customer Updates', d.customerUpdates.length, 'Subscription/profile changes', '✏️'),
    statCard('Campaigns Created', d.campaignsCreated.length, `${emailCampaignsCreated} Email · ${whatsappCampaignsCreated} WhatsApp`, '📣'),
    statCard('Email Initiated', d.emailEvents.length, 'Opened from CRM', '✉️'),
    statCard('WhatsApp Initiated', d.whatsappEvents.length, 'Opened from CRM', '💬'),
    statCard('Total CRM Activity', totalMessages, 'Email + WhatsApp initiated', '📊'),
    statCard('Leads Received', leadTotal, 'From the loaded Leads dataset', '📋'),
    statCard('Subscribed Customers', d.customers.filter(c => c.emailStatus === 'Subscribed' || c.whatsappStatus === 'Subscribed').length, 'At least one active channel', '✅')
  ].join('');

  box.textContent = buildProfessionalReportMessage(d);
  renderReportCharts(d);
  renderCampaignBreakdown(d);
}

function buildProfessionalReportMessage(d) {
  const period = document.getElementById('reportPeriod')?.value || REPORT_PERIOD.TODAY;
  const rangeLabel = d.range.from === d.range.to
    ? reportDateLabel(d.range.from)
    : `${reportDateLabel(d.range.from, false)} – ${reportDateLabel(d.range.to, false)}`;
  const name = (document.getElementById('reportManagerName')?.value || CURRENT_USER?.name || 'Team').trim();
  const emailByCampaign = campaignActivityRows(d.emailEvents, 'Email');
  const waByCampaign = campaignActivityRows(d.whatsappEvents, 'WhatsApp');

  const lines = [
    `Dear ${name},`,
    '',
    `Please find below the Abra Logistics CRM Marketing Activity Report for ${rangeLabel}.`,
    '',
    'CUSTOMER ACTIVITY',
    `• New customers added: ${formatCount(d.customersAdded.length)}`,
    `• Customer updates recorded: ${formatCount(d.customerUpdates.length)}`,
    '',
    'CAMPAIGN ACTIVITY',
    `• Campaigns created: ${formatCount(d.campaignsCreated.length)}`,
    `  - Email campaigns: ${formatCount(d.campaignsCreated.filter(c => c.channel === 'Email').length)}`,
    `  - WhatsApp campaigns: ${formatCount(d.campaignsCreated.filter(c => c.channel === 'WhatsApp').length)}`,
    '',
    'MESSAGE ACTIVITY',
    `• Email messages initiated from CRM: ${formatCount(d.emailEvents.length)}`,
    `• WhatsApp messages initiated from CRM: ${formatCount(d.whatsappEvents.length)}`,
    `• Total marketing messages initiated: ${formatCount(d.emailEvents.length + d.whatsappEvents.length)}`,
    ''
  ];

  if (emailByCampaign.length) {
    lines.push('EMAIL CAMPAIGN BREAKDOWN');
    emailByCampaign.forEach(c => lines.push(`• ${c.name}: ${formatCount(c.count)} message(s) initiated`));
    lines.push('');
  }
  if (waByCampaign.length) {
    lines.push('WHATSAPP CAMPAIGN BREAKDOWN');
    waByCampaign.forEach(c => lines.push(`• ${c.name}: ${formatCount(c.count)} message(s) initiated`));
    lines.push('');
  }

  if (d.leadRows.length) {
    lines.push('CRM LEAD ACTIVITY');
    lines.push(`• Leads received: ${formatCount(d.leadRows.length)}`);
    lines.push(`• Interested: ${formatCount(d.leadStatusCounts.Interested || 0)}`);
    lines.push(`• Not Interested: ${formatCount(d.leadStatusCounts['Not Interested'] || 0)}`);
    lines.push(`• Pending / Not Open: ${formatCount(d.leadStatusCounts['Not Open'] || 0)}`);
    lines.push('');
  }

  lines.push('Note: Email and WhatsApp activity is counted when the CRM opens the personalized message/compose action. The CRM cannot confirm that the final Send button was pressed in Gmail, Outlook or WhatsApp.');
  lines.push('');
  lines.push('Regards,');
  lines.push(CURRENT_USER?.name || 'Abra Logistics Team');
  return lines.join('\n');
}

function destroyReportCharts() {
  reportCharts.forEach(c => { try { c.destroy(); } catch (_) {} });
  reportCharts = [];
}

function dailyKeys(range) {
  const keys = [];
  const d = new Date(`${range.from}T12:00:00`);
  const end = new Date(`${range.to}T12:00:00`);
  while (d <= end) {
    keys.push(d.toISOString().slice(0,10));
    d.setDate(d.getDate() + 1);
  }
  return keys;
}

function countByDate(items, dateGetter, keys) {
  const counts = Object.fromEntries(keys.map(k => [k, 0]));
  items.forEach(item => { const k = reportDateKey(dateGetter(item)); if (k && counts[k] !== undefined) counts[k]++; });
  return counts;
}

function renderReportCharts(d) {
  const canvases = ['reportCustomerChart','reportCampaignChart','reportMessageChart'];
  if (!canvases.some(id => document.getElementById(id))) return;
  destroyReportCharts();
  if (typeof Chart === 'undefined') return;

  const keys = dailyKeys(d.range);
  const labels = keys.map(k => reportDateLabel(k, false));
  const customerCounts = countByDate(d.customersAdded, x => x.createdAt, keys);
  const campaignCounts = countByDate(d.campaignsCreated, x => x.createdAt, keys);
  const emailCounts = countByDate(d.emailEvents, x => x.openedAt, keys);
  const waCounts = countByDate(d.whatsappEvents, x => x.openedAt, keys);

  const make = (id, datasets) => {
    const el = document.getElementById(id); if (!el) return;
    reportCharts.push(new Chart(el, {
      type: 'line',
      data: { labels, datasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
    }));
  };
  make('reportCustomerChart', [{ label: 'New Customers', data: keys.map(k => customerCounts[k]), tension: .3, fill: true }]);
  make('reportCampaignChart', [{ label: 'Campaigns Created', data: keys.map(k => campaignCounts[k]), tension: .3, fill: true }]);
  make('reportMessageChart', [
    { label: 'Email', data: keys.map(k => emailCounts[k]), tension: .3, fill: false },
    { label: 'WhatsApp', data: keys.map(k => waCounts[k]), tension: .3, fill: false }
  ]);
}

function renderCampaignBreakdown(d) {
  const wrap = document.getElementById('reportCampaignBreakdown');
  if (!wrap) return;
  const rows = [...campaignActivityRows(d.emailEvents, 'Email'), ...campaignActivityRows(d.whatsappEvents, 'WhatsApp')];
  const max = Math.max(1, ...rows.map(r => r.count));
  wrap.innerHTML = rows.length ? rows.map(r => {
    const pct = Math.round((r.count / max) * 100);
    const cls = r.channel === 'Email' ? 'bg-primary' : 'bg-success';
    return `<div class="report-campaign-row"><div class="d-flex justify-content-between gap-2 mb-1"><span><span class="badge ${cls} me-2">${r.channel}</span><strong>${escapeHtml(r.name)}</strong></span><span class="fw-semibold">${formatCount(r.count)}</span></div><div class="progress report-progress"><div class="progress-bar ${cls}" style="width:${pct}%"></div></div></div>`;
  }).join('') : '<div class="text-muted py-4 text-center">No campaign message activity for this period.</div>';
}

function copyReportMessage() {
  const box = document.getElementById('reportMessageBox'); if (!box) return;
  navigator.clipboard.writeText(box.textContent).then(() => toast('Report copied to clipboard.', 'success'), () => toast('Could not copy the report.', 'danger'));
}

async function shareReportOnTelegram() {
  const box = document.getElementById('reportMessageBox');
  if (!box) return;
  const message = String(box.textContent || '').trim();
  if (!message) {
    toast('There is no report message to send.', 'warning');
    return;
  }

  const button = document.getElementById('shareReportTelegramBtn');
  const original = button?.innerHTML || '';
  if (button) {
    button.disabled = true;
    button.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Sending…';
  }

  try {
    if (!window.TelegramCRM?.sendReportMessage) {
      throw new Error('Telegram report service is not available.');
    }
    const recipientName = String(document.getElementById('reportManagerName')?.value || '').trim();
    const data = await window.TelegramCRM.sendReportMessage({ message, recipientName });
    const recipients = Array.isArray(data.recipients) ? data.recipients : [];
    toast(
      recipients.length
        ? `Report sent to ${recipients.map(r => r.name || r.email || 'Admin').join(', ')} on Telegram.`
        : 'Report sent on Telegram.',
      'success'
    );
  } catch (error) {
    toast(error.message || 'Failed to send the report on Telegram.', 'danger');
  } finally {
    if (button) {
      button.disabled = false;
      button.innerHTML = original || '<i class="bi bi-telegram"></i> Send to Admin on Telegram';
    }
  }
}

// Backward compatibility for any older markup that still calls the old name.
function shareReportOnWhatsApp() { return shareReportOnTelegram(); }

// Backwards-compatible helpers used by older screens.
function getLeadsForToday() { const k = reportNowDateKey(); return getLoadedLeads().filter(l => reportDateKey(l.createdAt) === k); }
function getLeadsForYesterday() { const k = reportDateRangeForYesterday(); return getLoadedLeads().filter(l => reportDateKey(l.createdAt) === k); }
function reportDateRangeForYesterday() { const t = reportNowDateKey(); const d = new Date(`${t}T12:00:00`); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); }
function getLeadsForCustomDate() { const k = document.getElementById('reportDate')?.value || reportNowDateKey(); return getLoadedLeads().filter(l => reportDateKey(l.createdAt) === k); }
function getLeadsForDateRange() { const r=reportDateRange(); return getLoadedLeads().filter(l => inReportRange(l.createdAt,r)); }
function getLeadsForSelectedPeriod() { return getLeadsForDateRange(); }

function switchMainReportTab(tab) {
  const daily = document.getElementById('dailyReportPanel');
  const campaign = document.getElementById('campaignReportsPanel');
  const dailyBtn = document.getElementById('reportTabDaily');
  const campaignBtn = document.getElementById('reportTabCampaign');
  const isCampaign = tab === 'campaign';
  daily?.classList.toggle('d-none', isCampaign);
  campaign?.classList.toggle('d-none', !isCampaign);
  dailyBtn?.classList.toggle('active', !isCampaign);
  campaignBtn?.classList.toggle('active', isCampaign);
  if (isCampaign && typeof renderCampaignReportsPanel === 'function') renderCampaignReportsPanel();
  if (!isCampaign) renderDailyReport();
}
window.CRMReport = { refresh: renderDailyReport };
