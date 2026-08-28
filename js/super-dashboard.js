/* SUPER DASHBOARD — loaded-data operational overview. */
(function(){
  'use strict';
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const dt=v=>{if(!v)return 0;if(v?.toDate)return v.toDate().getTime();const n=new Date(v).getTime();return Number.isNaN(n)?0:n};
  const fmt=v=>{if(!v)return '—';const d=v?.toDate?v.toDate():new Date(v);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})};
  const role=()=>window.CURRENT_USER?.role;
  const isStaff=()=>['admin','superadmin'].includes(role());
  const active=()=>!!window.CURRENT_USER?.active;
  const channelStatus=(c,ch)=>{const has=ch==='Email'?!!String(c?.email||'').trim():!!window.MarketingChannels?.normalisePhone?.(c?.phone);if(!has)return null;const v=ch==='Email'?c.emailStatus:c.whatsappStatus;if(v)return ['Not Interested','Unsubscribed'].includes(v)?'Unsubscribed':'Subscribed';if(c.marketingStatus)return ['Not Interested','Unsubscribed'].includes(c.marketingStatus)?'Unsubscribed':'Subscribed';return 'Subscribed'};

  function loadedData(){
    const m=window.MarketingChannels?.getReportData?.()||{customers:[],emailCampaigns:[],whatsappCampaigns:[]};
    const customers=m.customers||[];
    const emailCampaigns=m.emailCampaigns||[];
    const whatsappCampaigns=m.whatsappCampaigns||[];
    const leads=Array.isArray(window.ALL_LEADS)?window.ALL_LEADS:[];
    const campaigns=[
      ...emailCampaigns.map(c=>({channel:'Email',name:c.name||'Email Campaign',count:Object.keys(c.sentRecipients||{}).length,eligible:customers.filter(x=>channelStatus(x,'Email')==='Subscribed').length,createdAt:c.createdAt})),
      ...whatsappCampaigns.map(c=>({channel:'WhatsApp',name:c.name||'WhatsApp Campaign',count:Object.keys(c.sentRecipients||{}).length,eligible:customers.filter(x=>channelStatus(x,'WhatsApp')==='Subscribed').length,createdAt:c.createdAt}))
    ].sort((a,b)=>dt(b.createdAt)-dt(a.createdAt));
    const interestedCustomers=customers.filter(c=>channelStatus(c,'Email')==='Subscribed'||channelStatus(c,'WhatsApp')==='Subscribed');
    const emailOpened=emailCampaigns.reduce((n,c)=>n+Object.keys(c.sentRecipients||{}).length,0);
    const waOpened=whatsappCampaigns.reduce((n,c)=>n+Object.keys(c.sentRecipients||{}).length,0);
    const follows=leads.filter(l=>l.hasPendingFollowUp===true);
    return {customers,emailCampaigns,whatsappCampaigns,leads,campaigns,interestedCustomers,emailOpened,waOpened,follows};
  }

  function metric(label,value,sub,icon,view){
    return `<button class="super-kpi" ${view?`onclick="showView('${view}')"`:''}><div class="super-kpi-icon">${icon}</div><div><span>${esc(label)}</span><strong>${value}</strong><small>${esc(sub||'')}</small></div></button>`;
  }

  function render(){
    const root=document.getElementById('superDashboardBody');if(!root||!active())return;
    const d=loadedData();
    root.innerHTML=`
      <div class="super-dashboard-head"><div><h1 class="page-title"><i class="bi bi-speedometer2 me-2"></i>Dashboard</h1><p class="page-subtitle">A live overview built from the CRM data already loaded in memory.</p></div><button class="btn btn-outline-secondary" onclick="window.SuperDashboard.render()"><i class="bi bi-arrow-repeat me-1"></i>Refresh</button></div>
      <div class="super-kpi-grid">
        ${isStaff()?metric('Total Leads',d.leads.length,'Loaded CRM leads','📋','leads'):''}
        ${isStaff()?metric('Interested Leads',d.leads.filter(l=>String(l.status||'').toLowerCase()==='interested').length,'Current interested status','⭐','leads'):''}
        ${metric('Total Customers',d.customers.length,'Customer directory','👥','customers')}
        ${metric('Interested Customers',d.interestedCustomers.length,'Subscribed on at least one channel','💚','customers')}
        ${metric('Email Campaigns',d.emailCampaigns.length,`${d.emailOpened} opened from CRM`,'✉️','emailmarketing')}
        ${metric('WhatsApp Campaigns',d.whatsappCampaigns.length,`${d.waOpened} opened from CRM`,'💬','whatsappmarketing')}
        ${metric('Follow-ups Pending',d.follows.length,'From loaded lead data','⏰','myfollowups')}
        ${metric('Campaigns Created Today',d.campaigns.filter(c=>typeof reportDateKey==='function'&&reportDateKey(c.createdAt)===reportNowDateKey()).length,'Email + WhatsApp','📣','report')}
      </div>
      <div class="row g-3 mt-1">
        <div class="col-lg-7"><div class="marketing-card h-100"><div class="marketing-card-title mb-3">Campaign Performance</div><div class="small text-muted mb-3">Messages initiated from CRM versus eligible recipients.</div><div class="dashboard-campaign-list">${d.campaigns.length?d.campaigns.slice(0,20).map(c=>{const pct=c.eligible?Math.min(100,Math.round(c.count/c.eligible*100)):0;return `<div class="dashboard-campaign-item mb-3"><div class="d-flex justify-content-between gap-2 mb-1"><div><span class="badge ${c.channel==='Email'?'bg-primary-subtle text-primary':'bg-success-subtle text-success'} me-2">${c.channel}</span><strong>${esc(c.name)}</strong></div><span class="small fw-semibold">${c.count}/${c.eligible}</span></div><div class="progress report-progress"><div class="progress-bar ${c.channel==='Email'?'bg-primary':'bg-success'}" style="width:${pct}%"></div></div><div class="small text-muted mt-1">${pct}% of eligible recipients initiated</div></div>`}).join(''):'<div class="text-center text-muted py-4">No marketing campaigns loaded yet.</div>'}</div></div></div>
        <div class="col-lg-5"><div class="marketing-card h-100"><div class="marketing-card-title mb-3">Pending Follow-ups</div><div class="crm-scroll-table dashboard-follow-table"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Customer</th><th>Status</th><th>Follow-up</th></tr></thead><tbody>${d.follows.length?d.follows.slice(0,20).map(l=>`<tr><td><strong>${esc(l.fullName||'—')}</strong><div class="small text-muted">${esc(l.phoneNumber||'')}</div></td><td>${esc(l.status||'—')}</td><td>${fmt(l.nextFollowUpAt)}</td></tr>`).join(''):'<tr><td colspan="3" class="text-center py-4 text-muted">No pending follow-ups in loaded data.</td></tr>'}</tbody></table></div></div></div>
      </div>`;
  }
  window.SuperDashboard={render};
})();
