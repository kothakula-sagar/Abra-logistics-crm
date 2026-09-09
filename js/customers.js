/* CUSTOMERS — central Email Marketing customer directory. */
(function () {
  'use strict';
  const getCustomersPageScroller=()=>document.querySelector('.main-content')||document.scrollingElement||document.documentElement;
  const getCustomersPageScrollTop=()=>getCustomersPageScroller()?.scrollTop??0;
  const setCustomersPageScrollTop=top=>{const el=getCustomersPageScroller();if(el&&Number.isFinite(top))el.scrollTop=top};
  let search='',unsubscribeStore=null,customerCharts={};
  const isAdmin=()=>['admin','superadmin'].includes(window.CURRENT_USER?.role);
  const isActive=()=>!!window.CURRENT_USER?.active;
  const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const hasEmail=c=>!!String(c?.email||'').trim();
  function channelStatus(c){if(!hasEmail(c))return null;const value=c.emailStatus||c.marketingStatus;return value&&['Not Interested','Unsubscribed'].includes(value)?'Unsubscribed':'Subscribed'}
  function getCustomers(){return window.MarketingChannels?.getContacts?.()||[]}
  function toDate(value){if(!value)return null;if(value?.toDate)return value.toDate();if(value instanceof Date)return value;const d=new Date(value);return Number.isNaN(d.getTime())?null:d}
  function dayKey(value){const d=toDate(value);if(!d)return '';return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function lastSevenDays(){const today=new Date();today.setHours(0,0,0,0);return Array.from({length:7},(_,index)=>{const d=new Date(today);d.setDate(today.getDate()-(6-index));return{key:dayKey(d),label:d.toLocaleDateString('en-IN',{weekday:'short',day:'2-digit'})}})}
  function destroyCustomerCharts(){Object.values(customerCharts).forEach(chart=>{try{chart?.destroy()}catch(_){}});customerCharts={}}
  function renderCustomerCharts(customers){const ChartCtor=window.Chart;if(typeof ChartCtor!=='function')return;destroyCustomerCharts();const days=lastSevenDays(),labels=days.map(d=>d.label),newCustomers=days.map(day=>customers.filter(c=>dayKey(c.createdAt)===day.key).length),emailSubscribed=customers.filter(c=>channelStatus(c)==='Subscribed').length,unsubscribed=customers.filter(c=>channelStatus(c)==='Unsubscribed').length,newByDay=days.map(day=>customers.filter(c=>dayKey(c.createdAt)===day.key)),dailyEmail=newByDay.map(list=>list.filter(c=>channelStatus(c)==='Subscribed').length),dailyUnsubscribed=newByDay.map(list=>list.filter(c=>channelStatus(c)==='Unsubscribed').length),commonScale={x:{grid:{display:false},ticks:{color:'#64748b',font:{size:10}}},y:{beginAtZero:true,grid:{color:'rgba(148,163,184,.16)'},ticks:{precision:0,color:'#64748b',font:{size:10}}}},lineOptions={responsive:true,maintainAspectRatio:false,interaction:{intersect:false,mode:'index'},plugins:{legend:{display:false},tooltip:{displayColors:false}},scales:commonScale};const newCtx=document.getElementById('customerNew7DayChart');if(newCtx)customerCharts.newCustomers=new ChartCtor(newCtx,{type:'line',data:{labels,datasets:[{label:'New Customers',data:newCustomers,borderColor:'#1769e0',backgroundColor:'rgba(37,99,235,.13)',pointBackgroundColor:'#1769e0',pointBorderColor:'#1769e0',pointRadius:4,pointHoverRadius:5,borderWidth:2.5,tension:.35,fill:true}]},options:lineOptions});const subCtx=document.getElementById('customerSubscribedChart');if(subCtx)customerCharts.subscribed=new ChartCtor(subCtx,{type:'doughnut',data:{labels:['Email Subscribed','Unsubscribed'],datasets:[{data:[emailSubscribed,unsubscribed],backgroundColor:['#4f8fe8','#e53935'],borderWidth:0,hoverOffset:4}]},options:{responsive:true,maintainAspectRatio:false,cutout:'58%',plugins:{legend:{position:'right',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:7,padding:14,color:'#475569',font:{size:11}}},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${ctx.raw}`}}}}});const unsubCtx=document.getElementById('customerUnsubscribedChart');if(unsubCtx)customerCharts.unsubscribed=new ChartCtor(unsubCtx,{type:'line',data:{labels,datasets:[{label:'Unsubscribed',data:dailyUnsubscribed,borderColor:'#e53935',backgroundColor:'rgba(239,68,68,.12)',pointBackgroundColor:'#e53935',pointBorderColor:'#e53935',pointRadius:4,pointHoverRadius:5,borderWidth:2.5,tension:.35,fill:true}]},options:lineOptions});[['customerEmailTrendChart',dailyEmail],['customerUnsubTrendChart',dailyUnsubscribed]].forEach(([id,data])=>{const canvas=document.getElementById(id);if(!canvas)return;customerCharts[id]=new ChartCtor(canvas,{type:'bar',data:{labels,datasets:[{data,borderRadius:2,borderSkipped:false,barPercentage:.55,categoryPercentage:.72}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{displayColors:false}},scales:commonScale}})})}
  function render(){const body=document.getElementById('customersViewBody');if(!body)return;const savedTableScrollTop=document.querySelector('.customers-table-scroll')?.scrollTop??0,savedPageScrollTop=getCustomersPageScrollTop(),customers=getCustomers().filter(hasEmail),q=search.toLowerCase().trim(),filtered=customers.filter(c=>`${c.name||''} ${c.email||''} ${c.phone||''} ${c.company||''}`.toLowerCase().includes(q)),emailSubscribed=customers.filter(c=>channelStatus(c)==='Subscribed').length,unsubscribed=customers.filter(c=>channelStatus(c)==='Unsubscribed').length,days=lastSevenDays(),newCustomers=days.map(day=>customers.filter(c=>dayKey(c.createdAt)===day.key).length),newByDay=days.map(day=>customers.filter(c=>dayKey(c.createdAt)===day.key)),dailyUnsubscribed=newByDay.map(list=>list.filter(c=>channelStatus(c)==='Unsubscribed').length);body.innerHTML=`<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3"><div><h1 class="page-title"><i class="bi bi-people me-2"></i>Customers</h1><p class="page-subtitle">Central customer directory for Email Marketing. Customers must have an email address; mobile is optional.</p></div><div class="d-flex gap-2 align-items-center"><input id="customersSearch" class="form-control" style="min-width:260px" placeholder="Search customers..." value="${esc(search)}">${isAdmin()?`<button class="btn btn-outline-secondary" onclick="window.MarketingChannels.syncExistingLeads()"><i class="bi bi-arrow-repeat me-1"></i>Sync Existing Leads</button>`:''}${isActive()?`<button class="btn btn-outline-primary" onclick="window.Customers.downloadImportTemplate()"><i class="bi bi-download me-1"></i>Template</button><button class="btn btn-brand" onclick="window.Customers.openImport()"><i class="bi bi-file-earmark-arrow-up me-1"></i>Import</button><button class="btn btn-brand" onclick="window.MarketingChannels.openContactModal('email')"><i class="bi bi-person-plus me-1"></i>Add Customer</button>`:''}</div></div><div class="row g-2 mb-3 customer-kpi-grid"><div class="col-6 col-lg-3"><div class="marketing-stat customer-kpi"><div><span>Total Customers</span><strong>${customers.length}</strong><small>Email-eligible customers</small></div><div class="customer-kpi-icon blue"><i class="bi bi-people-fill"></i></div></div></div><div class="col-6 col-lg-3"><div class="marketing-stat customer-kpi"><div><span>Email Subscribed</span><strong>${emailSubscribed}</strong><small>${customers.length?((emailSubscribed/customers.length)*100).toFixed(1):'0.0'}% of customers</small></div><div class="customer-kpi-icon blue"><i class="bi bi-envelope-fill"></i></div></div></div><div class="col-6 col-lg-3"><div class="marketing-stat customer-kpi"><div><span>Unsubscribed</span><strong class="red">${unsubscribed}</strong><small>Excluded from email campaigns</small></div><div class="customer-kpi-icon red"><i class="bi bi-slash-circle"></i></div></div></div><div class="col-6 col-lg-3"><div class="marketing-stat customer-kpi"><div><span>Manual Customers</span><strong class="purple">${customers.filter(c=>c.source!=='lead').length}</strong><small>Added manually</small></div><div class="customer-kpi-icon purple"><i class="bi bi-person-plus-fill"></i></div></div></div></div><div class="row g-2 mb-3 customer-top-analytics"><div class="col-lg-4"><div class="marketing-card customer-analytics-card customer-top-chart"><div class="marketing-card-title">New Customers (Last 7 Days)</div><div class="small text-muted">Daily new customers added</div><div class="customer-chart-wrap customer-main-chart"><canvas id="customerNew7DayChart"></canvas></div><div class="customer-chart-total"><span>Total New Customers (7 Days)</span><strong>${newCustomers.reduce((a,b)=>a+b,0)}</strong></div></div></div><div class="col-lg-4"><div class="marketing-card customer-analytics-card customer-top-chart"><div class="marketing-card-title">Email Subscription Overview</div><div class="small text-muted">Email subscription status</div><div class="customer-chart-wrap customer-donut-chart"><canvas id="customerSubscribedChart"></canvas></div></div></div><div class="col-lg-4"><div class="marketing-card customer-analytics-card customer-top-chart"><div class="marketing-card-title">Unsubscribed Overview (7 Days)</div><div class="small text-muted">Daily unsubscribed customers</div><div class="customer-chart-wrap customer-main-chart"><canvas id="customerUnsubscribedChart"></canvas></div><div class="customer-chart-total"><span>Total Unsubscribed (7 Days)</span><strong>${dailyUnsubscribed.reduce((a,b)=>a+b,0)}</strong></div></div></div></div><div class="marketing-card customer-subscription-trend mb-3"><div class="marketing-card-title">Email Subscription Trend (Last 7 Days)</div><div class="small text-muted">Daily email subscription and unsubscription trend</div><div class="customer-trend-grid"><div><div class="customer-trend-title email">Email Subscribed</div><div class="customer-trend-wrap"><canvas id="customerEmailTrendChart"></canvas></div></div><div><div class="customer-trend-title unsub">Unsubscribed</div><div class="customer-trend-wrap"><canvas id="customerUnsubTrendChart"></canvas></div></div></div></div><div class="marketing-card"><div class="d-flex justify-content-between align-items-center mb-2"><div><div class="marketing-card-title">Customer Directory</div><div class="small text-muted">${filtered.length} of ${customers.length} customers</div></div></div><div class="crm-scroll-table customers-table-scroll"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Sl No</th><th>Name</th><th>Email</th><th>Mobile</th><th>Company</th><th>Email Status</th><th>Source</th><th>Actions</th><th>Added by</th></tr></thead><tbody>${filtered.length?filtered.map((c,i)=>customerRow(c,i+1)).join(''):`<tr><td colspan="9" class="text-center py-5 text-muted">${q?'No customers found.':'No customers yet.'}</td></tr>`}</tbody></table></div></div>`;requestAnimationFrame(()=>{renderCustomerCharts(customers);const table=document.querySelector('.customers-table-scroll');if(table)table.scrollTop=savedTableScrollTop;setCustomersPageScrollTop(savedPageScrollTop)});document.getElementById('customersSearch')?.addEventListener('input',e=>{search=e.target.value;render();const input=document.getElementById('customersSearch');if(input){input.focus();input.setSelectionRange(search.length,search.length)}})}
  function customerRow(c,index){const status=channelStatus(c),source=c.source==='lead'?'Lead':'Manual',addedBy=c.createdByName||c.updatedByName||c.addedByName||'—';return `<tr><td>${index}</td><td><strong>${esc(c.name||'—')}</strong></td><td>${esc(c.email||'—')}</td><td>${esc(c.phone||'—')}</td><td>${esc(c.company||'—')}</td><td><select class="form-select form-select-sm customer-status-select ${status==='Unsubscribed'?'border-danger':''}" onchange="window.Customers.setStatus('${esc(c.id)}',this.value)"><option value="Subscribed" ${status==='Subscribed'?'selected':''}>Subscribed</option><option value="Unsubscribed" ${status==='Unsubscribed'?'selected':''}>Unsubscribed</option></select></td><td><span class="badge bg-light text-dark">${esc(source)}</span></td><td><div class="d-flex gap-1">${isAdmin()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openContactModal('email','${esc(c.id)}')">Edit</button>`:''}${isAdmin()?`<button class="btn btn-sm btn-outline-danger" onclick="window.Customers.delete('${esc(c.id)}')">Delete</button>`:''}</div></td><td>${esc(addedBy)}</td></tr>`}
  async function init(){if(!isActive())return;if(!unsubscribeStore&&window.MarketingChannels?.onContactsChange)unsubscribeStore=window.MarketingChannels.onContactsChange(()=>render());await window.MarketingChannels?.ensureContactsLoaded?.();render()}
  async function setStatus(id,value){if(!isActive())return;await window.MarketingChannels?.setContactStatus?.(id,'email',value)}
  async function remove(id){if(!isAdmin()||!confirm('Delete this customer? This cannot be undone.'))return;await window.MarketingChannels?.deleteContact?.(id)}
  const IMPORT_CODE='Sagar Kothakula';
  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function showImportProgress(title,subtitle,progress,step){
    const modal=document.getElementById('customerImportModal'); if(!modal)return;
    document.getElementById('customerImportTitle').textContent=title||'Checking file';
    document.getElementById('customerImportSubtitle').textContent=subtitle||'';
    document.getElementById('customerImportProgressBar').style.width=`${Math.max(0,Math.min(100,progress||0))}%`;
    modal.querySelectorAll('[data-import-step]').forEach(el=>el.classList.toggle('active',el.dataset.importStep===step));
    bootstrap.Modal.getOrCreateInstance(modal).show();
  }
  function hideImportProgress(){bootstrap.Modal.getInstance(document.getElementById('customerImportModal'))?.hide()}
  function downloadImportTemplate(){
    if(!window.XLSX){toast?.('Excel template engine is not available.','danger');return}
    const rows=[
      ['Import Code','Name','Email','Mobile','Company'],
      [IMPORT_CODE,'Example Customer','customer@example.com','9876543210','Example Company']
    ];
    const ws=XLSX.utils.aoa_to_sheet(rows);
    ws['!cols']=[{wch:22},{wch:28},{wch:36},{wch:18},{wch:30}];
    const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,ws,'Customers');
    XLSX.writeFile(wb,'Abra_Global_Shipping_Customer_Import_Template.xlsx');
    toast?.('Default customer import template downloaded. Keep the Import Code unchanged.','success');
  }
  function openImport(){
    if(!isActive())return;
    let input=document.getElementById('customerImportFileInput');
    if(!input){
      input=document.createElement('input'); input.type='file'; input.id='customerImportFileInput'; input.accept='.xlsx,.xls,.csv';
      input.style.display='none'; document.body.appendChild(input);
      input.addEventListener('change',()=>{const file=input.files?.[0]; input.value=''; if(file) importFile(file)});
    }
    input.click();
  }
  function normalizeHeader(v){return String(v??'').trim().toLowerCase().replace(/[\s_-]+/g,'')}
  function normalizeEmail(v){return String(v??'').trim().toLowerCase()}
  function normalizeName(v){return String(v??'').trim()}
  async function importFile(file){
    if(!window.XLSX){toast?.('Excel import is unavailable.','danger');return}
    const ext=(file.name.split('.').pop()||'').toLowerCase();
    showImportProgress('Checking file','Reading the selected customer file...',8,'file');
    try{
      const buffer=await file.arrayBuffer();
      await sleep(700);
      showImportProgress('Checking customer data','Validating columns and customer details...',25,'data');
      const wb=XLSX.read(buffer,{type:'array',cellDates:true});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json(ws,{defval:'',raw:false});
      if(!raw.length)throw new Error('The Excel file has no customer rows.');
      const first=raw[0], headers=Object.keys(first).map(normalizeHeader);
      const required=['importcode','name','email'];
      if(!required.every(h=>headers.includes(h)))throw new Error('Invalid template. Required columns: Import Code, Name, Email.');
      const get=(row,names)=>{const key=Object.keys(row).find(k=>names.includes(normalizeHeader(k)));return key?row[key]:''};
      const valid=[], invalid=[];
      for(let i=0;i<raw.length;i++){
        const row=raw[i], code=String(get(row,['importcode'])).trim(), name=normalizeName(get(row,['name'])), email=normalizeEmail(get(row,['email'])), phone=String(get(row,['mobile','phone','phonenumber'])).trim(), company=String(get(row,['company','companyname'])).trim();
        if(code!==IMPORT_CODE){invalid.push(`Row ${i+2}: invalid Import Code`);continue}
        if(!name){invalid.push(`Row ${i+2}: customer name is missing`);continue}
        if(!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){invalid.push(`Row ${i+2}: invalid email`);continue}
        valid.push({name,email,phone,company});
      }
      if(invalid.length)throw new Error(`${invalid[0]}${invalid.length>1?` (+${invalid.length-1} more errors)`:''}`);
      showImportProgress('Checking duplicates','Comparing email addresses locally before any database write...',45,'duplicates');
      await sleep(900);
      const contacts=await window.MarketingChannels?.ensureContactsLoaded?.()||getCustomers();
      const existingEmails=new Set(contacts.map(c=>normalizeEmail(c.email)).filter(Boolean));
      const seen=new Set();
      const unique=valid.filter(row=>{
        if(existingEmails.has(row.email)||seen.has(row.email))return false;
        seen.add(row.email);return true;
      });
      const skipped=valid.length-unique.length;
      showImportProgress('Checking security rules','Validating the CRM import policy...',62,'security');
      await sleep(900);
      if(!unique.length){
        showImportProgress('Import complete',`No new customers to add. ${skipped} duplicate${skipped===1?'':'s'} skipped.`,100,'complete');
        await sleep(900); hideImportProgress(); toast?.(`Import finished: ${skipped} duplicate${skipped===1?'':'s'} skipped. No database writes were made.`,'info'); return;
      }
      showImportProgress('Preparing database',`Preparing ${unique.length} new customer${unique.length===1?'':'s'} in efficient batches...`,80,'database');
      await sleep(900);
      const now=Date.now(), imported=[];
      for(let start=0;start<unique.length;start+=450){
        const chunk=unique.slice(start,start+450), batch=db.batch();
        chunk.forEach((row,index)=>{
          const ref=window.marketingContactsRef?.doc();
          if(!ref)throw new Error('Customer database is not ready. Please refresh the CRM and try again.');
          const data={source:'import',name:row.name,email:row.email,phone:row.phone,company:row.company,emailStatus:'Subscribed',marketingStatus:'Subscribed',createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:CURRENT_USER.uid,createdByName:CURRENT_USER.name||CURRENT_USER.email,importCode:IMPORT_CODE};
          batch.set(ref,data); imported.push({...row,id:ref.id,source:'import',createdAt:new Date(now+start+index),updatedAt:new Date(now+start+index),emailStatus:'Subscribed',marketingStatus:'Subscribed',createdBy:CURRENT_USER.uid,createdByName:CURRENT_USER.name||CURRENT_USER.email,importCode:IMPORT_CODE});
        });
        await batch.commit();
      }
      await window.MarketingChannels?.refreshContacts?.();
      showImportProgress('Import complete',`${unique.length} imported successfully. ${skipped} duplicate${skipped===1?'':'s'} skipped.`,100,'complete');
      render();
      await sleep(1000); hideImportProgress();
      toast?.(`Import successful: ${unique.length} added, ${skipped} duplicate${skipped===1?'':'s'} skipped.`,'success');
    }catch(e){
      console.error('Customer import failed:',e);
      showImportProgress('Import not completed',e.message||'The file could not be imported.',100,'file');
      await sleep(1200); hideImportProgress(); toast?.(e.message||'Customer import failed.','danger');
    }
  }
  window.Customers={init,render,setStatus,delete:remove,getCustomers,isLoaded:()=>getCustomers().length>0,openImport,downloadImportTemplate};
})();
