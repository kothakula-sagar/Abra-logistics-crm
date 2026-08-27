/* SUPER DASHBOARD — CRM-wide operational overview. */
(function(){
  'use strict';
  const role = () => window.CURRENT_USER?.role;
  const isStaff = () => ['superadmin','admin'].includes(role());
  const active = () => !!window.CURRENT_USER?.active;
  const esc = v => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const dt = v => { if(!v) return 0; if(v?.toDate) return v.toDate().getTime(); const n=new Date(v).getTime(); return Number.isNaN(n)?0:n; };
  const fmt = v => { if(!v) return '—'; const d=v?.toDate?v.toDate():new Date(v); return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); };

  async function read(name, queryBuilder){
    try { let q=db.collection(name); if(queryBuilder) q=queryBuilder(q); const s=await q.get(); return s.docs.map(d=>({id:d.id,...d.data()})); }
    catch(err){ console.error('Dashboard read failed',name,err); return []; }
  }

  async function loadData(){
    const leadRows = await read('leads', q => (isStaff()?q:q.where('assignedTo','==',CURRENT_USER.uid)));
    const customerRows = await read('marketingContacts');
    const emailRows = await read('emailMarketingCampaigns', q=>q.orderBy('createdAt','desc'));
    const waRows = await read('whatsappMarketingCampaigns', q=>q.orderBy('createdAt','desc'));
    const saleRows = await read('campaigns', q=>q.orderBy('createdAt','desc'));
    const followRows = leadRows.filter(l=>l.hasPendingFollowUp === true);
    const leaveRows = await read('leaves', q => {
      let x=q.where('status','==','Pending');
      if(!isStaff()) x=x.where('memberId','==',CURRENT_USER.uid);
      return x;
    });
    const interestedLeads = leadRows.filter(l=>String(l.status||'').toLowerCase()==='interested');
    const interestedCustomers = customerRows.filter(c=>String(c.emailStatus||c.marketingStatus||'Interested')!=='Not Interested' || String(c.whatsappStatus||c.marketingStatus||'Interested')!=='Not Interested');
    const emailOpened = emailRows.reduce((n,c)=>n+Object.keys(c.sentRecipients||{}).length,0);
    const waOpened = waRows.reduce((n,c)=>n+Object.keys(c.sentRecipients||{}).length,0);
    const campaignPerformance = [...saleRows.map(c=>({channel:'Sales',name:c.name||c.campaignName||'Sales Campaign',recipients:c.totalLeads||c.leadCount||0,createdAt:c.createdAt})),...emailRows.map(c=>({channel:'Email',name:c.name||'Campaign',recipients:Object.keys(c.sentRecipients||{}).length,createdAt:c.createdAt})),...waRows.map(c=>({channel:'WhatsApp',name:c.name||'Campaign',recipients:Object.keys(c.sentRecipients||{}).length,createdAt:c.createdAt}))].sort((a,b)=>dt(b.createdAt)-dt(a.createdAt));
    return {leadRows,customerRows,emailRows,waRows,saleRows,followRows,leaveRows,interestedLeads,interestedCustomers,emailOpened,waOpened,campaignPerformance};
  }

  function metric(label,value,sub,icon,view){ return `<button class="super-kpi" onclick="${view?`showView('${view}')`:'void(0)'}"><div class="super-kpi-icon">${icon}</div><div><span>${esc(label)}</span><strong>${value}</strong><small>${esc(sub||'')}</small></div></button>`; }

  async function render(){
    const root=document.getElementById('superDashboardBody'); if(!root||!active()) return;
    root.innerHTML=`<div class="text-center py-5 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Loading CRM dashboard...</div>`;
    const d=await loadData();
    root.innerHTML=`
      <div class="super-dashboard-head"><div><h1 class="page-title"><i class="bi bi-speedometer2 me-2"></i>Super Dashboard</h1><p class="page-subtitle">One operational view of leads, customers, campaigns, follow-ups and team requests.</p></div><button class="btn btn-outline-secondary" onclick="window.SuperDashboard.render()"><i class="bi bi-arrow-repeat me-1"></i>Refresh</button></div>
      <div class="super-kpi-grid">
        ${metric('Total Leads',d.leadRows.length,'Leads in your CRM','📋','leads')}
        ${metric('Interested Leads',d.interestedLeads.length,'Current interested status','⭐','leads')}
        ${metric('Campaigns',d.saleRows.length+d.emailRows.length+d.waRows.length,`${d.saleRows.length} sales · ${d.emailRows.length} email · ${d.waRows.length} WhatsApp`,'📣','campaigns')}
        ${metric('Follow-ups Pending',d.followRows.length,'Needs follow-up','⏰','myfollowups')}
        ${metric('Leave Requests',d.leaveRows.length,'Pending requests','🗓️','leave')}
        ${metric('Total Customers',d.customerRows.length,'Customer directory','👥','customers')}
        ${metric('Interested Customers',d.interestedCustomers.length,'Interested in at least one channel','💚','customers')}
        ${metric('Email Campaigns',d.emailRows.length,`${d.emailOpened} opened from CRM`,'✉️','emailmarketing')}
        ${metric('WhatsApp Campaigns',d.waRows.length,`${d.waOpened} opened from CRM`,'💬','whatsappmarketing')}
      </div>
      <div class="row g-3 mt-1">
        <div class="col-lg-7"><div class="marketing-card h-100"><div class="marketing-card-title mb-3">Campaign Performance</div><div class="crm-scroll-table dashboard-campaign-table"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Channel</th><th>Campaign</th><th>Performance / Prepared</th><th>Created</th></tr></thead><tbody>${d.campaignPerformance.length?d.campaignPerformance.map(c=>`<tr><td><span class="badge ${c.channel==='Email'?'bg-primary-subtle text-primary':(c.channel==='Sales'?'bg-warning-subtle text-dark':'bg-success-subtle text-success')}">${c.channel}</span></td><td><strong>${esc(c.name)}</strong></td><td>${c.recipients}</td><td>${fmt(c.createdAt)}</td></tr>`).join(''):`<tr><td colspan="4" class="text-center py-4 text-muted">No marketing campaign performance yet.</td></tr>`}</tbody></table></div></div></div>
        <div class="col-lg-5"><div class="marketing-card h-100"><div class="marketing-card-title mb-3">Pending Follow-ups</div><div class="crm-scroll-table dashboard-follow-table"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Customer</th><th>Status</th><th>Follow-up</th></tr></thead><tbody>${d.followRows.length?d.followRows.slice(0,20).map(l=>`<tr><td><strong>${esc(l.fullName||'—')}</strong><div class="small text-muted">${esc(l.phoneNumber||'')}</div></td><td>${esc(l.status||'—')}</td><td>${fmt(l.nextFollowUpAt)}</td></tr>`).join(''):`<tr><td colspan="3" class="text-center py-4 text-muted">No pending follow-ups.</td></tr>`}</tbody></table></div></div></div>
      </div>`;
  }
  window.SuperDashboard={render};
})();
