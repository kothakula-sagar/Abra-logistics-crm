// ============================================================
// CAMPAIGN-REPORTS.JS — Loaded-data campaign reporting
// No Firebase reads. Uses MarketingChannels + loaded ALL_LEADS.
// ============================================================

let currentReportTab = 'overview';

function switchReportTab(tab) {
  currentReportTab = tab;
  document.querySelectorAll('.campaign-report-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`[data-report-tab="${tab}"]`)?.classList.add('active');
  renderCurrentReport();
}

function campaignReportData() {
  const marketing = window.MarketingChannels?.getReportData?.() || { customers: [], emailCampaigns: [], whatsappCampaigns: [] };
  const campaigns = [
    ...(marketing.emailCampaigns || []).map(c => ({...c, channel:'Email'})),
    ...(marketing.whatsappCampaigns || []).map(c => ({...c, channel:'WhatsApp'}))
  ];
  return { marketing, campaigns, leads: Array.isArray(window.ALL_LEADS) ? window.ALL_LEADS : [] };
}

function campaignReportRange() {
  const from = document.getElementById('reportFilterDateFrom')?.value;
  const to = document.getElementById('reportFilterDateTo')?.value;
  const today = typeof reportNowDateKey === 'function' ? reportNowDateKey() : new Date().toISOString().slice(0,10);
  return {from:from||today,to:to||today};
}

function inCampaignRange(value, range) {
  if (typeof reportDateKey === 'function') {
    const k=reportDateKey(value); return !!k && k>=range.from && k<=range.to;
  }
  const d=value?.toDate?value.toDate():new Date(value); if(Number.isNaN(d.getTime()))return false;
  const k=d.toISOString().slice(0,10); return k>=range.from&&k<=range.to;
}

function populateReportFilters() {
  const {campaigns}=campaignReportData();
  const campaignSelect=document.getElementById('reportFilterCampaign');
  if(campaignSelect)campaignSelect.innerHTML='<option value="">All Campaigns</option>'+campaigns.map(c=>`<option value="${escapeHtml(c.id)}">${escapeHtml(c.name||'Campaign')} (${c.channel})</option>`).join('');
  const members=Array.isArray(window.ACTIVE_MEMBERS)&&window.ACTIVE_MEMBERS.length?window.ACTIVE_MEMBERS:(typeof ALL_USERS!=='undefined'?ALL_USERS.filter(u=>u.role==='member'):[]);
  const memberSelect=document.getElementById('reportFilterMember');
  if(memberSelect)memberSelect.innerHTML='<option value="">All Members</option>'+members.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(m.name||m.email)}</option>`).join('');
  const today=typeof reportNowDateKey==='function'?reportNowDateKey():new Date().toISOString().slice(0,10);
  const d=new Date(`${today}T12:00:00`);d.setDate(d.getDate()-30);const from=d.toISOString().slice(0,10);
  const f=document.getElementById('reportFilterDateFrom'),t=document.getElementById('reportFilterDateTo');
  if(f&&!f.value)f.value=from;if(t&&!t.value)t.value=today;
}

function selectedCampaigns() {
  const {campaigns}=campaignReportData();
  const range=campaignReportRange();
  const campaignId=document.getElementById('reportFilterCampaign')?.value;
  return campaigns.filter(c=>(!campaignId||c.id===campaignId)&&inCampaignRange(c.createdAt,range));
}

function selectedLeadRows() {
  const {leads}=campaignReportData();
  const range=campaignReportRange();
  const campaignId=document.getElementById('reportFilterCampaign')?.value;
  const status=document.getElementById('reportFilterStatus')?.value;
  const member=document.getElementById('reportFilterMember')?.value;
  return leads.filter(l=>l.campaignId&&inCampaignRange(l.createdAt,range)&&(!campaignId||l.campaignId===campaignId)&&(!status||l.status===status)&&(!member||l.assignedTo===member));
}

function campaignEvents(campaign) {
  const isEmail = String(campaign?.channel || '').toLowerCase() === 'email' || Object.values(campaign.sentRecipients||{}).some(e=>String(e?.sentThrough||'').toLowerCase()==='gmail');
  return Object.values(campaign.sentRecipients||{}).filter(e=>isEmail ? (e?.sentAt || e?.timestamp) : e?.openedAt).map(e=>({...e,campaign}));
}

function renderCampaignReportsPanel() {
  const wrap=document.getElementById('campaignReportsPanel')||document.getElementById('view-campaignreports');
  if(!wrap)return;
  if(window.CURRENT_USER?.role!=='marketing' && typeof hasPermission==='function'&&!hasPermission('campaignReports.view')){
    wrap.innerHTML='<div class="alert alert-danger"><i class="bi bi-lock-fill me-2"></i>Access Denied.</div>';return;
  }
  wrap.innerHTML=`
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <div><h2 class="page-title"><i class="bi bi-bar-chart-line me-2"></i>Campaign Reports</h2><p class="page-subtitle">Campaign performance from the data already loaded by Email, WhatsApp and Leads.</p></div>
    </div>
    <div class="table-card p-3 mb-3"><div class="row g-2">
      <div class="col-md-3"><label class="form-label small">Campaign</label><select id="reportFilterCampaign" class="form-select form-select-sm" onchange="applyReportFilters()"></select></div>
      <div class="col-md-3"><label class="form-label small">Date Range From</label><input type="date" id="reportFilterDateFrom" class="form-control form-control-sm" onchange="applyReportFilters()"></div>
      <div class="col-md-3"><label class="form-label small">Date Range To</label><input type="date" id="reportFilterDateTo" class="form-control form-control-sm" onchange="applyReportFilters()"></div>
      <div class="col-md-3"><label class="form-label small">Lead Status</label><select id="reportFilterStatus" class="form-select form-select-sm" onchange="applyReportFilters()"><option value="">All Statuses</option><option>Interested</option><option>Not Interested</option><option>Busy</option><option>Not Picking Call</option><option>Not Open</option></select></div>
      <div class="col-md-3"><label class="form-label small">Assigned Member</label><select id="reportFilterMember" class="form-select form-select-sm" onchange="applyReportFilters()"></select></div>
      <div class="col-md-3 d-flex align-items-end"><button class="btn btn-sm btn-outline-secondary w-100" onclick="clearReportFilters()"><i class="bi bi-x-circle me-1"></i>Clear Filters</button></div>
    </div></div>
    <div class="mb-3"><ul class="nav nav-tabs"><li class="nav-item"><a href="#" class="nav-link campaign-report-tab active" data-report-tab="overview" onclick="event.preventDefault();switchReportTab('overview')">Overview</a></li><li class="nav-item"><a href="#" class="nav-link campaign-report-tab" data-report-tab="comparison" onclick="event.preventDefault();switchReportTab('comparison')">Campaign Comparison</a></li><li class="nav-item"><a href="#" class="nav-link campaign-report-tab" data-report-tab="member-performance" onclick="event.preventDefault();switchReportTab('member-performance')">Member Performance</a></li><li class="nav-item"><a href="#" class="nav-link campaign-report-tab" data-report-tab="trends" onclick="event.preventDefault();switchReportTab('trends')">Daily Trends</a></li></ul></div>
    <div id="reportContentArea"></div>`;
  populateReportFilters();renderCurrentReport();
}

function renderCurrentReport(){
  if(!document.getElementById('reportContentArea'))return;
  if(currentReportTab==='comparison')return renderComparisonReport();
  if(currentReportTab==='member-performance')return renderMemberPerformanceReport();
  if(currentReportTab==='trends')return renderTrendsReport();
  renderOverviewReport();
}

function renderOverviewReport(){
  const area=document.getElementById('reportContentArea');if(!area)return;
  const d=campaignReportData(), campaigns=selectedCampaigns(), leads=selectedLeadRows(), events=campaigns.flatMap(c=>campaignEvents(c));
  const interested=leads.filter(l=>l.status==='Interested').length;
  const conversion=leads.length?Math.round(interested/leads.length*100):0;
  const max=Math.max(1,...campaigns.map(c=>campaignEvents(c).length));
  area.innerHTML=`<div class="row g-3 mb-3">${[
    ['Campaigns',campaigns.length,'📣'],['Messages Initiated',events.length,'💬'],['Leads',leads.length,'📋'],['Conversion',`${conversion}%`,'📈']
  ].map(x=>`<div class="col-6 col-lg-3"><div class="marketing-stat"><span>${x[2]} ${x[0]}</span><strong>${x[1]}</strong></div></div>`).join('')}</div>
  <div class="table-card p-3"><h6 class="mb-3">Campaign processing</h6>${campaigns.length?campaigns.map(c=>{const count=campaignEvents(c).length,p=Math.round(count/max*100);return `<div class="report-campaign-row mb-3"><div class="d-flex justify-content-between mb-1"><strong>${escapeHtml(c.name||'Campaign')}</strong><span><span class="badge ${c.channel==='Email'?'bg-primary':'bg-success'} me-2">${c.channel}</span>${count} initiated</span></div><div class="progress report-progress"><div class="progress-bar ${c.channel==='Email'?'bg-primary':'bg-success'}" style="width:${p}%"></div></div></div>`}).join(''):'<div class="text-center text-muted py-4">No campaign activity for the selected filters.</div>'}</div>`;
}

function renderComparisonReport(){
  const area=document.getElementById('reportContentArea');if(!area)return;const campaigns=selectedCampaigns();const rows=campaigns.map(c=>{const leads=selectedLeadRows().filter(l=>l.campaignId===c.id),interested=leads.filter(l=>l.status==='Interested').length,rate=leads.length?Math.round(interested/leads.length*100):0,events=campaignEvents(c).length;return {c,leads:leads.length,interested,rate,events}});
  area.innerHTML=`<div class="table-card p-3"><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Campaign</th><th>Channel</th><th>Leads</th><th>Interested</th><th>Conversion</th><th>Messages Initiated</th><th>Processing</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><strong>${escapeHtml(r.c.name||'Campaign')}</strong></td><td>${r.c.channel}</td><td>${r.leads}</td><td>${r.interested}</td><td>${r.rate}%</td><td>${r.events}</td><td><div class="progress report-progress"><div class="progress-bar ${r.c.channel==='Email'?'bg-primary':'bg-success'}" style="width:${Math.min(100,r.events?100:0)}%"></div></div></td></tr>`).join(''):'<tr><td colspan="7" class="text-center text-muted py-4">No campaigns for the selected date range.</td></tr>'}</tbody></table></div></div>`;
}

function renderMemberPerformanceReport(){
  const area=document.getElementById('reportContentArea');if(!area)return;const members=Array.isArray(window.ACTIVE_MEMBERS)&&window.ACTIVE_MEMBERS.length?window.ACTIVE_MEMBERS:(typeof ALL_USERS!=='undefined'?ALL_USERS.filter(u=>u.role==='member'):[]);const leads=selectedLeadRows();const rows=members.map(m=>{const x=leads.filter(l=>l.assignedTo===m.id),i=x.filter(l=>l.status==='Interested').length;return {name:m.name||m.email,total:x.length,interested:i,rate:x.length?Math.round(i/x.length*100):0}}).filter(x=>x.total);
  area.innerHTML=`<div class="table-card p-3"><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Sales Member</th><th>Total Leads</th><th>Interested</th><th>Conversion</th><th>Performance</th></tr></thead><tbody>${rows.length?rows.map(r=>`<tr><td><strong>${escapeHtml(r.name)}</strong></td><td>${r.total}</td><td>${r.interested}</td><td>${r.rate}%</td><td><div class="progress report-progress"><div class="progress-bar" style="width:${r.rate}%"></div></div></td></tr>`).join(''):'<tr><td colspan="5" class="text-center text-muted py-4">No member data for this period.</td></tr>'}</tbody></table></div></div>`;
}

function renderTrendsReport(){
  const area=document.getElementById('reportContentArea');if(!area)return;const d=campaignReportData(),range=campaignReportRange(),keys=[];const x=new Date(`${range.from}T12:00:00`),end=new Date(`${range.to}T12:00:00`);while(x<=end){keys.push(x.toISOString().slice(0,10));x.setDate(x.getDate()+1)}
  const email=Object.fromEntries(keys.map(k=>[k,0])),wa=Object.fromEntries(keys.map(k=>[k,0]));d.campaigns.forEach(c=>campaignEvents(c).forEach(e=>{const k=reportDateKey(e.openedAt);if(k&&email[k]!==undefined)(c.channel==='Email'?email:wa)[k]++}));
  area.innerHTML=`<div class="table-card p-3"><div class="table-responsive"><table class="table align-middle"><thead><tr><th>Date</th><th>Email</th><th>WhatsApp</th><th>Total</th></tr></thead><tbody>${keys.map(k=>`<tr><td>${reportDateLabel(k,false)}</td><td>${email[k]}</td><td>${wa[k]}</td><td><strong>${email[k]+wa[k]}</strong></td></tr>`).join('')}</tbody></table></div></div>`;
}

function applyReportFilters(){renderCurrentReport()}
function clearReportFilters(){const today=typeof reportNowDateKey==='function'?reportNowDateKey():new Date().toISOString().slice(0,10);const d=new Date(`${today}T12:00:00`);d.setDate(d.getDate()-30);document.getElementById('reportFilterCampaign').value='';document.getElementById('reportFilterStatus').value='';document.getElementById('reportFilterMember').value='';document.getElementById('reportFilterDateFrom').value=d.toISOString().slice(0,10);document.getElementById('reportFilterDateTo').value=today;renderCurrentReport()}

function exportReportPDF(){if(!window.jspdf?.jsPDF){toast('PDF library is not available.','danger');return}const {jsPDF}=window.jspdf;const doc=new jsPDF();doc.setFontSize(16);doc.text('Abra Logistics Campaign Report',14,18);doc.setFontSize(10);doc.text(`Period: ${campaignReportRange().from} to ${campaignReportRange().to}`,14,26);const rows=selectedCampaigns().map(c=>[c.channel,c.name||'Campaign',campaignEvents(c).length]);doc.autoTable?.({head:[['Channel','Campaign','Messages Initiated']],body:rows,startY:34});doc.save('abra-logistics-campaign-report.pdf')}
function exportReportExcel(){if(!window.XLSX){toast('Excel library is not available.','danger');return}const rows=selectedCampaigns().map(c=>({Channel:c.channel,Campaign:c.name||'Campaign','Messages Initiated':campaignEvents(c).length,Created:typeof fmtDate==='function'?fmtDate(c.createdAt):''}));const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Campaign Report');XLSX.writeFile(wb,'abra-logistics-campaign-report.xlsx')}
function printReport(){window.print()}
