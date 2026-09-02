/* MARKETING CHANNELS — Email + WhatsApp campaigns and shared customer cache. */
(function(){
'use strict';
const contactsRef=()=>db.collection('marketingContacts');
const emailCampaignsRef=()=>db.collection('emailMarketingCampaigns');
const whatsappCampaignsRef=()=>db.collection('whatsappMarketingCampaigns');
const state={email:{contacts:[],campaigns:[],activeCampaignId:null,search:''},whatsapp:{contacts:[],campaigns:[],activeCampaignId:null,search:''}};
const marketingCharts={email:{},whatsapp:{}};
let contactCacheLoaded=false,contactLoadPromise=null,contactUnsubscribe=null,emailCampaignUnsubscribe=null,whatsappCampaignUnsubscribe=null;
const contactListeners=new Set();
const isAdmin=()=>['admin','superadmin'].includes(window.CURRENT_USER?.role);
const isActiveUser=()=>!!window.CURRENT_USER?.active;
const canEdit=()=>isActiveUser(); const canDelete=()=>isAdmin();
const isMarketingAllowed=()=>['superadmin','admin','marketing'].includes(window.CURRENT_USER?.role);
const DEFAULT_MARKETING_LIMITS={whatsappMessages:10,whatsappCooldownMinutes:5,emailMessages:10,emailCooldownMinutes:5};
const getMarketingLimits=()=>({
  whatsappMessages:Math.max(1,Number(getCRMSetting?.('whatsappMarketingMessagesPerBatch')||DEFAULT_MARKETING_LIMITS.whatsappMessages)),
  whatsappCooldownMinutes:Math.max(0,Number(getCRMSetting?.('whatsappMarketingCooldownMinutes')??DEFAULT_MARKETING_LIMITS.whatsappCooldownMinutes)),
  emailMessages:Math.max(1,Number(getCRMSetting?.('emailMarketingMessagesPerBatch')||DEFAULT_MARKETING_LIMITS.emailMessages)),
  emailCooldownMinutes:Math.max(0,Number(getCRMSetting?.('emailMarketingCooldownMinutes')??DEFAULT_MARKETING_LIMITS.emailCooldownMinutes))
});
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const asDate=v=>v?.toDate?v.toDate():(v?new Date(v):null);
const emailSentCount=campaign=>Object.keys(campaign?.sentRecipients||{}).length;
const fmtDate=v=>{const d=asDate(v);return d&&!Number.isNaN(d.getTime())?d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}):'—'};
const normalisePhone=raw=>{let p=String(raw||'').replace(/[\s\-().+]/g,'');if(p.startsWith('0'))p='91'+p.slice(1);return /^\d{10,15}$/.test(p)?p:''};
const statusOf=(c,ch)=>{const hasChannel=ch==='email'?!!String(c?.email||'').trim():!!normalisePhone(c?.phone);if(!hasChannel)return null;const x=ch==='whatsapp'?c.whatsappStatus:c.emailStatus;if(x)return ['Not Interested','Unsubscribed'].includes(x)?'Unsubscribed':'Subscribed';if(c.marketingStatus)return ['Not Interested','Unsubscribed'].includes(c.marketingStatus)?'Unsubscribed':'Subscribed';return 'Subscribed'};
const eligibleContacts=ch=>state[ch].contacts.filter(c=>statusOf(c,ch)!=='Unsubscribed'&&(ch==='email'?!!String(c.email||'').trim():!!normalisePhone(c.phone)));
const getCampaignRef=ch=>ch==='email'?emailCampaignsRef():whatsappCampaignsRef();
const getState=ch=>state[ch];
const MARKETING_SESSION_KEY='abraCRM.marketing.position.v3';
const getPageScroller=()=>document.querySelector('.main-content')||document.scrollingElement||document.documentElement;
const getPageScrollTop=()=>{const el=getPageScroller();return el?.scrollTop??0};
const setPageScrollTop=top=>{const el=getPageScroller();if(!el||!Number.isFinite(top))return;el.scrollTop=top};
function readMarketingSession(){try{return JSON.parse(sessionStorage.getItem(MARKETING_SESSION_KEY)||'{}')}catch(e){return {}}}
function writeMarketingSession(data){try{sessionStorage.setItem(MARKETING_SESSION_KEY,JSON.stringify(data))}catch(e){}}
function saveMarketingPosition(ch){const s=getState(ch),root=document.getElementById(`view-${ch}marketing`),table=root?.querySelector('.marketing-recipients-scroll')||root?.querySelector('.marketing-campaigns-scroll'),session=readMarketingSession();session[ch]={activeCampaignId:s.activeCampaignId||null,search:s.search||'',tableScrollTop:table?.scrollTop??0,pageScrollTop:getPageScrollTop(),savedAt:Date.now()};writeMarketingSession(session)}
function restoreMarketingPosition(ch){const saved=readMarketingSession()[ch];if(!saved)return;const s=getState(ch);if(saved.activeCampaignId&&s.campaigns.some(c=>c.id===saved.activeCampaignId))s.activeCampaignId=saved.activeCampaignId;if(typeof saved.search==='string')s.search=saved.search;const restore=()=>{const root=document.getElementById(`view-${ch}marketing`),table=root?.querySelector('.marketing-recipients-scroll')||root?.querySelector('.marketing-campaigns-scroll');if(table&&Number.isFinite(saved.tableScrollTop))table.scrollTop=saved.tableScrollTop;if(Number.isFinite(saved.pageScrollTop))setPageScrollTop(saved.pageScrollTop)};requestAnimationFrame(restore);requestAnimationFrame(()=>requestAnimationFrame(restore));setTimeout(restore,80);setTimeout(restore,220);}


function ensureView(ch){const root=document.getElementById(`view-${ch}marketing`);if(!root)return;if(!isMarketingAllowed()){root.innerHTML='<div class="alert alert-danger">You do not have access to this marketing module.</div>';return}root.innerHTML=`<div class="marketing-channel-page"><div class="marketing-channel-header"><div><h1 class="page-title"><i class="bi ${ch==='email'?'bi-envelope-at':'bi-whatsapp'} me-2"></i>${ch==='email'?'Email Marketing':'WhatsApp Marketing'}</h1><p class="page-subtitle">Create campaigns and open personalized messages for subscribed customers.</p></div><div class="marketing-toolbar-actions">${isAdmin()?'<button class="btn btn-outline-secondary" onclick="window.MarketingChannels.syncExistingLeads()"><i class="bi bi-arrow-repeat me-1"></i>Sync Existing Leads</button>':''}<button class="btn btn-brand" onclick="window.MarketingChannels.openCampaignModal('${ch}')"><i class="bi bi-plus-lg me-1"></i>New Campaign</button><div class="small text-muted w-100 text-end">Shortcuts: <kbd>Alt + O</kbd> Open Next</div></div></div><div id="${ch}MarketingBody"></div></div>`}

function campaignRows(ch,rows){return rows.map(c=>{const sent=ch==='email'?emailSentCount(c):Object.keys(c.sentRecipients||{}).length;return `<tr><td><strong>${esc(c.name)}</strong></td><td>${ch==='email'?esc(c.subject||'—'):esc((c.body||'').slice(0,90))}</td><td>${eligibleContacts(ch).length}</td><td>${sent}</td>${ch==='email'?'':'<td>'+sent+'</td>'}<td><span class="badge bg-light text-dark">${ch==='email'?'Gmail':'WhatsApp'}</span></td><td>${fmtDate(c.createdAt)}</td><td><div class="d-flex gap-1"><button class="btn btn-sm btn-brand" onclick="window.MarketingChannels.openCampaign('${ch}','${c.id}')">Open</button>${canEdit()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openCampaignModal('${ch}','${c.id}')">Edit</button>`:''}${canDelete()?`<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteCampaign('${ch}','${c.id}')">Delete</button>`:''}</div></td></tr>`}).join('')}

function renderChannel(ch){
 const pageScrollBeforeRender=getPageScrollTop();
 const bodyBefore=document.getElementById(`${ch}MarketingBody`);
 const oldTableBefore=bodyBefore?.querySelector('.marketing-recipients-scroll')||bodyBefore?.querySelector('.marketing-campaigns-scroll');
 const tableScrollBefore=oldTableBefore?.scrollTop??0;
 const saved=readMarketingSession()[ch]||{};
 const savedTableScrollTop=oldTableBefore?tableScrollBefore:(Number.isFinite(saved.tableScrollTop)?saved.tableScrollTop:0);
 const savedPageScrollTop=pageScrollBeforeRender;
 ensureView(ch);
 const body=document.getElementById(`${ch}MarketingBody`);
 if(!body)return;
 renderMarketingStatus(ch);
 const s=getState(ch);
 const active=s.campaigns.find(c=>c.id===s.activeCampaignId);
 if(active){renderCampaignDetail(ch,active,body,{tableScrollTop:savedTableScrollTop,pageScrollTop:savedPageScrollTop});return}
 const q=s.search.toLowerCase();
 const rows=s.campaigns.filter(c=>`${c.name} ${c.subject||''} ${c.body||''}`.toLowerCase().includes(q));
 body.innerHTML=`<div class="marketing-stats-row"><div class="marketing-stat"><span>Campaigns</span><strong>${s.campaigns.length}</strong></div><div class="marketing-stat"><span>Subscribed recipients</span><strong>${eligibleContacts(ch).length}</strong></div><div class="marketing-stat"><span>${ch==='email'?'Emails sent':'Messages opened'}</span><strong>${ch==='email'?s.campaigns.reduce((n,c)=>n+emailSentCount(c),0):s.campaigns.reduce((n,c)=>n+Object.keys(c.sentRecipients||{}).length,0)}</strong></div><div class="marketing-stat"><span>${ch==='email'?'Sending provider':'WhatsApp'}</span><strong>${ch==='email'?'Gmail':'WhatsApp'}</strong></div></div>${marketingAnalyticsMarkup(ch)}<div class="marketing-card"><div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3"><div><div class="marketing-card-title">${ch==='email'?'Email':'WhatsApp'} Campaigns</div><div class="small text-muted">No pagination. Scroll inside the table.</div></div><input class="form-control marketing-search" placeholder="Search campaigns..." value="${esc(s.search)}" oninput="window.MarketingChannels.setSearch('${ch}',this.value)"></div><div class="crm-scroll-table marketing-campaigns-scroll"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Campaign</th><th>${ch==='email'?'Subject':'Message'}</th><th>Recipients</th><th>Sent</th>${ch==='email'?'':'<th>Opened</th>'}<th>Sent Through</th><th>Added</th><th>Actions</th></tr></thead><tbody>${rows.length?campaignRows(ch,rows):`<tr><td colspan="${ch==='email'?'7':'8'}" class="text-center py-5 text-muted">${q?'No campaigns found.':'No campaigns yet.'}</td></tr>`}</tbody></table></div></div>`;
 renderMarketingAnalytics(ch);
 restoreScrollPosition(ch,savedTableScrollTop,savedPageScrollTop);
}

function marketingDateKey(value){
 const d=asDate(value);
 if(!d||Number.isNaN(d.getTime()))return '';
 return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
}
function marketingLast7Days(){
 const todayKey=marketingDateKey(new Date());
 const today=new Date(`${todayKey}T12:00:00`);
 const out=[];
 for(let i=6;i>=0;i--){const d=new Date(today);d.setDate(today.getDate()-i);const key=d.toISOString().slice(0,10);out.push({key,label:d.toLocaleDateString('en-IN',{day:'2-digit',month:'short'})});}
 return out;
}
function marketingSendEntries(ch){
 return (state[ch]?.campaigns||[]).flatMap(c=>Object.entries(c.sentRecipients||{}).map(([contactId,entry])=>({
   campaign:c,contactId,time:entry?.sentAt||entry?.openedAt||entry?.timestamp
 }))).filter(x=>asDate(x.time));
}
function marketingAnalyticsMarkup(ch){
 const label=ch==='email'?'Email':'WhatsApp';
 return `<div class="marketing-analytics-section">
   <div class="d-flex justify-content-between align-items-end gap-2 flex-wrap mb-3">
     <div><div class="marketing-analytics-title"><i class="bi bi-bar-chart-line-fill me-2"></i>Last 7 Days ${label} Marketing Charts</div><div class="small text-muted">Based only on campaigns and message sends already loaded in this CRM session.</div></div>
     <span class="badge bg-light text-dark">7-day rolling view</span>
   </div>
   <div class="marketing-analytics-grid">
     <div class="marketing-chart-panel"><div class="marketing-chart-title">Created Campaigns</div><div class="marketing-chart-subtitle">Campaigns created each day</div><div class="marketing-chart-wrap"><canvas id="${ch}CreatedCampaignsChart"></canvas></div></div>
     <div class="marketing-chart-panel"><div class="marketing-chart-title">Individual Campaigns</div><div class="marketing-chart-subtitle">Emails sent / opened by campaign</div><div class="marketing-chart-wrap"><canvas id="${ch}CampaignSendsChart"></canvas></div></div>
     <div class="marketing-chart-panel"><div class="marketing-chart-title">Daily Sending Trend</div><div class="marketing-chart-subtitle">Total emails sent / opened per day</div><div class="marketing-chart-wrap"><canvas id="${ch}DailySendsChart"></canvas></div></div>
   </div>
 </div>`;
}
function destroyMarketingCharts(ch){
 Object.values(marketingCharts[ch]||{}).forEach(chart=>{try{chart?.destroy()}catch(_){}});
 marketingCharts[ch]={};
}
function renderMarketingAnalytics(ch){
 if(typeof Chart==='undefined')return;
 const root=document.getElementById(`view-${ch}marketing`);
 if(!root)return;
 destroyMarketingCharts(ch);
 const days=marketingLast7Days(), keys=days.map(d=>d.key), entries=marketingSendEntries(ch);
 const createdCounts=keys.map(key=>(state[ch].campaigns||[]).filter(c=>marketingDateKey(c.createdAt)===key).length);
 const dailySendCounts=keys.map(key=>entries.filter(e=>marketingDateKey(e.time)===key).length);
 const campaignCounts=(state[ch].campaigns||[]).map(c=>({name:c.name||'Unnamed Campaign',count:Object.values(c.sentRecipients||{}).filter(e=>keys.includes(marketingDateKey(e?.openedAt||e?.sentAt||e?.timestamp))).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
 const campaignNames=campaignCounts.length?campaignCounts.map(x=>x.name):['No sends in last 7 days'];
 const campaignValues=campaignCounts.length?campaignCounts.map(x=>x.count):[0];
 const base={responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{y:{beginAtZero:true,ticks:{precision:0}}}};
 const createdCanvas=document.getElementById(`${ch}CreatedCampaignsChart`);
 const campaignCanvas=document.getElementById(`${ch}CampaignSendsChart`);
 const dailyCanvas=document.getElementById(`${ch}DailySendsChart`);
 if(createdCanvas)marketingCharts[ch].created=new Chart(createdCanvas,{type:'bar',data:{labels:days.map(d=>d.label),datasets:[{label:'Campaigns',data:createdCounts,borderWidth:1,borderRadius:6}]},options:{...base}});
 if(campaignCanvas)marketingCharts[ch].campaigns=new Chart(campaignCanvas,{type:'bar',data:{labels:campaignNames,datasets:[{label:'Messages',data:campaignValues,borderWidth:1,borderRadius:6}]},options:{...base,indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{beginAtZero:true,ticks:{precision:0}},y:{ticks:{autoSkip:false}}}}});
 if(dailyCanvas)marketingCharts[ch].daily=new Chart(dailyCanvas,{type:'line',data:{labels:days.map(d=>d.label),datasets:[{label:'Messages',data:dailySendCounts,tension:.3,fill:true,pointRadius:4,borderWidth:2}]},options:{...base,elements:{point:{hoverRadius:6}}}});
}

function restoreScrollPosition(ch,tableScrollTop,pageScrollTop){
 const restore=()=>{
  const root=document.getElementById(`view-${ch}marketing`);
  const table=root?.querySelector('.marketing-recipients-scroll')||root?.querySelector('.marketing-campaigns-scroll');
  if(table&&Number.isFinite(tableScrollTop))table.scrollTop=tableScrollTop;
  if(Number.isFinite(pageScrollTop))setPageScrollTop(pageScrollTop);
 };
 requestAnimationFrame(restore);
 requestAnimationFrame(()=>requestAnimationFrame(restore));
 setTimeout(restore,80);
 setTimeout(restore,220);
}

function renderCampaignDetail(ch,campaign,body,preserve={}){
 const saved=readMarketingSession()[ch]||{};
 const savedTableScrollTop=Number.isFinite(preserve.tableScrollTop)?preserve.tableScrollTop:(Number.isFinite(saved.tableScrollTop)?saved.tableScrollTop:0);
 const savedPageScrollTop=Number.isFinite(preserve.pageScrollTop)?preserve.pageScrollTop:(Number.isFinite(saved.pageScrollTop)?saved.pageScrollTop:getPageScrollTop());
 const contacts=eligibleContacts(ch),sentMap=campaign.sentRecipients||{},q=getState(ch).search.toLowerCase(),filtered=contacts.filter(c=>`${c.name} ${c.email} ${c.phone} ${c.company}`.toLowerCase().includes(q));
 renderMarketingStatus(ch);if(getMarketingCooldown(ch).remaining>0&&!marketingCountdownTimer)startMarketingCountdown(ch);
 body.innerHTML=`<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3"><button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.closeCampaign('${ch}')"><i class="bi bi-arrow-left me-1"></i>Back to ${ch==='email'?'Email':'WhatsApp'} Marketing</button><div class="d-flex gap-2">${canEdit()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openCampaignModal('${ch}','${campaign.id}')">Edit</button>`:''}${canDelete()?`<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteCampaign('${ch}','${campaign.id}')">Delete</button>`:''}</div></div><div class="marketing-detail-heading"><h2>${esc(campaign.name)}</h2><p>${ch==='email'?`Subject: ${esc(campaign.subject||'')} · Sent through Gmail`:'Personalized WhatsApp message'}</p></div>${ch==='email'?`<div class="marketing-stats-row mb-3"><div class="marketing-stat"><span>Sent</span><strong>${emailSentCount(campaign)}</strong></div><div class="marketing-stat"><span>Provider</span><strong>Gmail</strong></div></div>`:''}<div class="marketing-message-preview">${ch==='email'?`<div class="mb-3"><strong>Subject</strong><div>${esc(campaign.subject||'')}</div></div><div><strong>Body</strong><div class="marketing-email-detail-preview">${sanitizeEmailHtml(campaign.bodyHtml||campaign.body||'')}</div></div>`:`<div><strong>Body</strong><pre>${esc(campaign.body||'')}</pre></div>`}</div><div class="marketing-card"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3"><div><div class="marketing-card-title">Campaign Recipients</div><div class="small text-muted">${contacts.length} interested recipients · scroll table</div></div><input class="form-control marketing-search" placeholder="Search recipients..." value="${esc(q)}" oninput="window.MarketingChannels.setSearch('${ch}',this.value)"></div><div class="crm-scroll-table marketing-recipients-scroll"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Sl No</th><th>Name</th><th>${ch==='email'?'Email':'Number'}</th><th>Status</th>${ch==='email'?'':'<th>Opened</th>'}<th>Sent Through</th><th>Action</th><th>Sent By</th></tr></thead><tbody>${filtered.length?filtered.map((c,i)=>recipientRow(ch,campaign,c,i+1,sentMap[c.id])).join(''):`<tr><td colspan="${ch==='email'?'7':'8'}" class="text-center py-4 text-muted">No matching interested customers.</td></tr>`}</tbody></table></div></div>`;
 restoreScrollPosition(ch,savedTableScrollTop,savedPageScrollTop);
}
function recipientRow(ch,campaign,c,index,sent){const destination=ch==='email'?c.email:normalisePhone(c.phone);const isSent=!!sent;const sentThrough=ch==='email'?'Gmail':(sent?.sentThrough||'WhatsApp');const sentBy=sent?.sentByName||'—';const cooldown=getMarketingCooldown(ch);const action=destination?(ch==='whatsapp'?(isSent?`<button class="btn btn-sm btn-primary" disabled><i class="bi bi-whatsapp me-1"></i>Sent</button>`:(cooldown.remaining>0?`<button class="btn btn-sm btn-danger" disabled><i class="bi bi-hourglass-split me-1"></i>Wait</button>`:`<button class="btn btn-sm btn-success" onclick="window.MarketingChannels.openMessage('${ch}','${campaign.id}','${c.id}')"><i class="bi bi-whatsapp me-1"></i>Open WhatsApp</button>`)):`<button class="btn btn-sm ${isSent?'btn-danger':'btn-brand'}" ${isSent?'disabled':''} onclick="window.MarketingChannels.openMessage('${ch}','${campaign.id}','${c.id}')"><i class="bi bi-envelope-at me-1"></i>${isSent?'Sent':'Send Email'}</button>`):'<span class="text-muted">Missing contact</span>';return `<tr><td>${index}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(ch==='email'?c.email:c.phone)}</td><td><span class="badge ${isSent?(ch==='email'?'bg-danger text-white':'bg-success-subtle text-success'):'bg-light text-dark'}">${isSent?'Sent':'Not Sent'}</span></td>${ch==='email'?'':`<td>—</td>`}<td><span class="badge bg-light text-dark">${esc(sentThrough)}</span></td><td>${action}</td><td>${esc(sentBy)}</td></tr>`}
function notifyContactListeners(){contactListeners.forEach(fn=>{try{fn(state.email.contacts.slice())}catch(e){console.error('Customer listener failed',e)}})}
function onContactsChange(fn){if(typeof fn!=='function')return()=>{};contactListeners.add(fn);return()=>contactListeners.delete(fn)}
function primeContactsFromCustomerView(){
 const local=window.Customers?.getCustomers?.();
 if(Array.isArray(local)&&local.length){
   state.email.contacts=local.slice();
   state.whatsapp.contacts=local.slice();
   contactCacheLoaded=true;
   notifyContactListeners();
   return true;
 }
 return false;
}
async function loadContacts(){
 if(contactCacheLoaded)return;
 if(primeContactsFromCustomerView())return;
 if(contactLoadPromise)return contactLoadPromise;
 contactLoadPromise=new Promise((resolve,reject)=>{
   if(contactUnsubscribe)contactUnsubscribe();
   contactUnsubscribe=contactsRef().orderBy('createdAt','asc').onSnapshot(s=>{
     const all=s.docs.map(d=>({id:d.id,...d.data()}));
     state.email.contacts=all;state.whatsapp.contacts=all;contactCacheLoaded=true;contactLoadPromise=null;
     notifyContactListeners();renderChannel('email');renderChannel('whatsapp');if(window.CRMReport?.refresh)window.CRMReport.refresh();resolve(all);
   },e=>{contactLoadPromise=null;console.error(e);toast?.('Failed to load marketing contacts.','danger');reject(e)})
 });
 return contactLoadPromise;
}
async function ensureContactsLoaded(){await loadContacts();return state.email.contacts.slice()}
async function refreshContacts(){await ensureContactsLoaded();renderChannel('email');renderChannel('whatsapp');notifyContactListeners()}
function subscribeChannel(ch){const ref=getCampaignRef(ch),cb=s=>{state[ch].campaigns=s.docs.map(d=>({id:d.id,...d.data()}));const saved=readMarketingSession()[ch];if(saved?.activeCampaignId&&state[ch].campaigns.some(c=>c.id===saved.activeCampaignId))state[ch].activeCampaignId=saved.activeCampaignId;if(typeof saved?.search==='string')state[ch].search=saved.search;renderChannel(ch);restoreMarketingPosition(ch);if(window.CRMReport?.refresh)window.CRMReport.refresh()};const old=ch==='email'?emailCampaignUnsubscribe:whatsappCampaignUnsubscribe;if(old)old();const unsub=ref.orderBy('createdAt','desc').onSnapshot(cb,e=>{console.error(e);toast?.(`Failed to load ${ch} campaigns.`,'danger')});if(ch==='email')emailCampaignUnsubscribe=unsub;else whatsappCampaignUnsubscribe=unsub}
async function initChannel(ch){if(!isActiveUser())return;await loadContacts();subscribeChannel(ch);renderChannel(ch)}
async function preload(){if(!isActiveUser())return;await loadContacts();subscribeChannel('email');subscribeChannel('whatsapp');}
function openView(ch){initChannel(ch).catch(console.error)}
function setSearch(ch,v){saveMarketingPosition(ch);state[ch].search=v||'';renderChannel(ch)}
function closeCampaign(ch){state[ch].activeCampaignId=null;state[ch].search='';saveMarketingPosition(ch);renderChannel(ch)}
function openCampaign(ch,id){state[ch].activeCampaignId=id;state[ch].search='';saveMarketingPosition(ch);renderChannel(ch)}

async function openContactModal(ch,id=''){if(!canEdit())return;primeContactsFromCustomerView();if(!contactCacheLoaded){await loadContacts();}let existing=id?state.email.contacts.find(c=>c.id===id):null;if(id&&!existing){try{const snap=await contactsRef().doc(id).get();if(snap.exists)existing={id:snap.id,...snap.data()}}catch(e){console.error(e);toast?.('Unable to load customer.','danger');return}}document.getElementById('marketingContactModalTitle').textContent=existing?'Edit Customer':'Add Customer';document.getElementById('marketingContactId').value=existing?.id||'';document.getElementById('marketingContactName').value=existing?.name||'';document.getElementById('marketingContactEmail').value=existing?.email||'';document.getElementById('marketingContactPhone').value=existing?.phone||'';document.getElementById('marketingContactCompany').value=existing?.company||'';document.getElementById('marketingContactChannel').value=ch;const modalEl=document.getElementById('marketingContactModal');modalEl.addEventListener('shown.bs.modal',()=>{const nameEl=document.getElementById('marketingContactName');if(nameEl){nameEl.focus();nameEl.setSelectionRange?.(nameEl.value.length,nameEl.value.length)}},{once:true});new bootstrap.Modal(modalEl).show()}
async function setContactStatus(id,channel,value){
 if(!isActiveUser())return;
 const c=state.email.contacts.find(x=>x.id===id);
 if(!c)return;
 if((channel==='email'&&!String(c.email||'').trim())||(channel==='whatsapp'&&!normalisePhone(c.phone)))return;
 const previousStatus=channel==='whatsapp'?statusOf(c,'whatsapp'):statusOf(c,'email');
 if(previousStatus===value)return;
 const payload={updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:CURRENT_USER.uid,updatedByName:CURRENT_USER.name||CURRENT_USER.email};
 if(channel==='whatsapp')payload.whatsappStatus=value;else payload.emailStatus=value;
 const other=channel==='whatsapp'?statusOf(c,'email'):statusOf(c,'whatsapp');
 const nextEmail=channel==='email'?value:other;
 const nextWa=channel==='whatsapp'?value:other;
 payload.marketingStatus=(nextEmail==='Unsubscribed'&&nextWa==='Unsubscribed')?'Unsubscribed':'Subscribed';
 try{
  await contactsRef().doc(id).update(payload);
  const updated={...c,...payload,updatedAt:new Date()};
  state.email.contacts=state.email.contacts.map(x=>x.id===id?updated:x);
  state.whatsapp.contacts=state.whatsapp.contacts.map(x=>x.id===id?updated:x);
  notifyContactListeners();renderChannel('email');renderChannel('whatsapp');if(window.CRMReport?.refresh)window.CRMReport.refresh();
  if(CURRENT_USER?.role!=='admin'&&CURRENT_USER?.role!=='superadmin'&&window.notifyManagement){
    window.notifyManagement({
      title:'Marketing Subscription Status Changed',
      message:`Hi ${'{{ADMIN_NAME}}'} Sir, your team member ${CURRENT_USER.name||CURRENT_USER.email} has changed ${c.name||'the customer'} to ${value} for ${channel==='whatsapp'?'WhatsApp':'Email'}.`,
      type:'marketing-status-change',
      metadata:{customerName:c.name||'—',marketingType:channel==='whatsapp'?'WhatsApp':'Email',newStatus:value,changedBy:CURRENT_USER.name||CURRENT_USER.email}
    });
  }
  toast?.(`${channel==='whatsapp'?'WhatsApp':'Email'} status updated.`,'success');
 }catch(e){console.error(e);toast?.('Failed to update customer status.','danger')}}

async function saveContact(){
 if(!canEdit())return;
 const id=document.getElementById('marketingContactId').value.trim();
 const existing=id?state.email.contacts.find(c=>c.id===id):null;
 const nextEmail=existing&&statusOf(existing,'email')?statusOf(existing,'email'):(document.getElementById('marketingContactEmail').value.trim()?'Subscribed':null);const nextWa=existing&&statusOf(existing,'whatsapp')?statusOf(existing,'whatsapp'):(normalisePhone(document.getElementById('marketingContactPhone').value.trim())?'Subscribed':null);const payload={name:document.getElementById('marketingContactName').value.trim(),email:document.getElementById('marketingContactEmail').value.trim(),phone:document.getElementById('marketingContactPhone').value.trim(),company:document.getElementById('marketingContactCompany').value.trim(),emailStatus:nextEmail,whatsappStatus:nextWa,marketingStatus:(nextEmail==='Unsubscribed'&&nextWa==='Unsubscribed')?'Unsubscribed':'Subscribed',updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:CURRENT_USER.uid,updatedByName:CURRENT_USER.name||CURRENT_USER.email};
 if(!payload.name){toast?.('Customer name is required.','warning');return}
 if(!payload.email&&!payload.phone){toast?.('Add an email or phone number.','warning');return}
 // Duplicate validation is intentionally local-only. We check the customer list
 // already loaded in memory and never query Firebase for an email/phone lookup.
 if(!contactCacheLoaded){await loadContacts();}
 if(!contactCacheLoaded){toast?.('Customers are still loading. Please wait and try again.','warning');return}
 const emailKey=String(payload.email||'').trim().toLowerCase();
 const phoneKey=normalisePhone(payload.phone);
 const duplicateEmail=emailKey&&state.email.contacts.find(c=>c.id!==id&&String(c.email||'').trim().toLowerCase()===emailKey);
 const duplicatePhone=phoneKey&&state.email.contacts.find(c=>c.id!==id&&normalisePhone(c.phone)===phoneKey);
 if(duplicateEmail||duplicatePhone){
   const parts=[];
   if(duplicateEmail)parts.push('email');
   if(duplicatePhone)parts.push('mobile number');
   toast?.(`Customer with this ${parts.join(' and ')} already exists in Customers.`,'danger');
   return;
 }
 try{
   const btn=document.getElementById('marketingContactSaveBtn');btn.disabled=true;
   if(id){
     await contactsRef().doc(id).update(payload);
     const index=state.email.contacts.findIndex(c=>c.id===id);
     if(index>=0){const updated={...state.email.contacts[index],...payload,updatedAt:new Date()};state.email.contacts[index]=updated;state.whatsapp.contacts[index]={...updated};}
   }else{
     const created={...payload,source:'manual',createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:CURRENT_USER.uid,createdByName:CURRENT_USER.name||CURRENT_USER.email};
     const ref=await contactsRef().add(created);
     // Keep the local cache current without rereading the collection after the write.
     const localCreated={...created,id:ref.id,createdAt:new Date(),updatedAt:new Date()};
     state.email.contacts.push(localCreated);state.whatsapp.contacts.push(localCreated);
   }
   bootstrap.Modal.getInstance(document.getElementById('marketingContactModal'))?.hide();
   renderChannel('email');renderChannel('whatsapp');
   notifyContactListeners();
   if(window.Customers)window.Customers.render();
   if(window.CRMReport?.refresh)window.CRMReport.refresh();
   toast?.(id?'Customer updated.':'Customer added.','success')
 }catch(e){console.error(e);toast?.(e.message||'Failed to save customer.','danger')}
 finally{document.getElementById('marketingContactSaveBtn').disabled=false}
}
async function deleteContact(id){if(!canDelete()||!confirm('Delete this customer?'))return;try{await contactsRef().doc(id).delete();state.email.contacts=state.email.contacts.filter(c=>c.id!==id);state.whatsapp.contacts=state.whatsapp.contacts.filter(c=>c.id!==id);notifyContactListeners();renderChannel('email');renderChannel('whatsapp');if(window.Customers)window.Customers.render();if(window.CRMReport?.refresh)window.CRMReport.refresh();toast?.('Customer deleted.','success')}catch(e){console.error(e);toast?.('Failed to delete customer.','danger')}}

function sanitizeEmailHtml(html){
 const parser=new DOMParser();
 const doc=parser.parseFromString(String(html||''),'text/html');
 const allowed=new Set(['A','B','BR','CENTER','DIV','EM','FONT','H1','H2','H3','H4','H5','H6','HR','I','IMG','LI','OL','P','SPAN','STRONG','TABLE','TBODY','TD','TH','THEAD','TR','U','UL']);
 const blocked=new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','BUTTON','VIDEO','AUDIO','LINK','META','BASE']);
 const safeAttrs={A:new Set(['href','target','title','rel']),IMG:new Set(['src','alt','title','width','height']),FONT:new Set(['color','face','size']),TABLE:new Set(['width','cellpadding','cellspacing','border','align']),TD:new Set(['width','colspan','rowspan','align','valign']),TH:new Set(['width','colspan','rowspan','align','valign'])};
 [...doc.body.querySelectorAll('*')].forEach(el=>{
   if(blocked.has(el.tagName)||!allowed.has(el.tagName)){el.replaceWith(...[...el.childNodes]);return;}
   [...el.attributes].forEach(attr=>{
     const name=attr.name.toLowerCase(), value=attr.value||'';
     if(name.startsWith('on')||name==='srcdoc'){el.removeAttribute(attr.name);return;}
     if(name==='style' && /expression\s*\(|javascript:|behavior\s*:|url\s*\(\s*javascript:/i.test(value)){el.removeAttribute(attr.name);return;}
     const ok=safeAttrs[el.tagName]?.has(name)||name==='style';
     if(!ok)el.removeAttribute(attr.name);
     if(name==='href'&&!/^(https?:|mailto:|tel:)/i.test(value.trim()))el.removeAttribute(attr.name);
     if(name==='src'&&!/^https:/i.test(value.trim()))el.removeAttribute(attr.name);
   });
   if(el.hasAttribute('style')){
     const safeStyle=el.getAttribute('style').split(';').map(x=>x.trim()).filter(Boolean).filter(rule=>{
       const prop=rule.split(':')[0]?.trim().toLowerCase();const val=rule.split(':').slice(1).join(':').trim();
       return ['color','background-color','font-family','font-size','font-weight','font-style','text-decoration','text-align','line-height','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','border','border-radius','width','max-width'].includes(prop)&&!/javascript:|expression\s*\(|url\s*\(/i.test(val);
     });
     if(safeStyle.length)el.setAttribute('style',safeStyle.join('; '));else el.removeAttribute('style');
   }
 });
 return doc.body.innerHTML.trim();
}
function emailHtmlToPlainText(html){const doc=new DOMParser().parseFromString(String(html||''),'text/html');return (doc.body?.innerText||doc.body?.textContent||'').replace(/\n{3,}/g,'\n\n').trim()}
function getEmailEditorHtml(){
 const source=document.getElementById('marketingCampaignBodyHtml'),visual=document.getElementById('marketingCampaignBodyEditor');
 const mode=document.getElementById('marketingEmailEditor')?.classList.contains('is-html')?'html':'visual';
 const raw=mode==='html'?source?.value||'':visual?.innerHTML||'';const clean=sanitizeEmailHtml(raw);
 if(source)source.value=clean;if(visual&&mode==='visual')visual.innerHTML=clean;const hidden=document.getElementById('marketingCampaignBody');if(hidden)hidden.value=clean;return clean;
}
function setEmailEditorContent(html){const clean=sanitizeEmailHtml(html||'');const visual=document.getElementById('marketingCampaignBodyEditor'),source=document.getElementById('marketingCampaignBodyHtml'),hidden=document.getElementById('marketingCampaignBody');if(visual)visual.innerHTML=clean;if(source)source.value=clean;if(hidden)hidden.value=clean}
function setEmailEditorMode(mode='visual'){
 const editor=document.getElementById('marketingEmailEditor'),visual=document.getElementById('marketingCampaignBodyEditor'),source=document.getElementById('marketingCampaignBodyHtml');if(!editor||!visual||!source)return;
 if(mode==='html'){source.value=sanitizeEmailHtml(visual.innerHTML);editor.classList.add('is-html');document.getElementById('marketingEmailEditorHtmlBtn')?.classList.add('active');document.getElementById('marketingEmailEditorVisualBtn')?.classList.remove('active')}
 else{visual.innerHTML=sanitizeEmailHtml(source.value);source.value=sanitizeEmailHtml(source.value);editor.classList.remove('is-html');document.getElementById('marketingEmailEditorVisualBtn')?.classList.add('active');document.getElementById('marketingEmailEditorHtmlBtn')?.classList.remove('active')}
 document.getElementById('marketingCampaignBody').value=sanitizeEmailHtml(mode==='html'?source.value:visual.innerHTML);
}
function execEmailCommand(command,value=null){const visual=document.getElementById('marketingCampaignBodyEditor');if(!visual)return;visual.focus();try{document.execCommand(command,false,value||null)}catch(e){console.warn('Email formatting command failed',e)}getEmailEditorHtml()}
function insertEmailLink(){const url=prompt('Enter the link URL:','https://');if(!url)return;if(!/^(https?:|mailto:|tel:)/i.test(url.trim())){toast?.('Please enter a valid web, email or phone link.','warning');return}execEmailCommand('createLink',url.trim())}
function insertEmailImage(){const url=prompt('Enter an image URL (HTTPS):','https://');if(!url)return;if(!/^https:/i.test(url.trim())){toast?.('Email images must use an HTTPS URL.','warning');return}execEmailCommand('insertImage',url.trim());getEmailEditorHtml()}
function previewEmail(){
 const html=getEmailEditorHtml(),subject=replacePlaceholders(document.getElementById('marketingCampaignSubject')?.value||'',{name:'Customer',email:'customer@example.com',phone:'',company:'Company'});let modal=document.getElementById('marketingEmailPreviewModal');
 if(!modal){modal=document.createElement('div');modal.id='marketingEmailPreviewModal';modal.className='modal fade';modal.tabIndex=-1;modal.innerHTML=`<div class="modal-dialog modal-xl modal-dialog-centered"><div class="modal-content"><div class="modal-header"><div><h5 class="modal-title">Email Preview</h5><div id="marketingEmailPreviewSubject" class="small text-muted"></div></div><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body bg-light"><div id="marketingEmailPreviewFrame" style="background:#fff;max-width:760px;margin:auto;min-height:360px;padding:28px;overflow:auto"></div></div><div class="modal-footer"><button type="button" class="btn btn-outline-secondary" data-bs-dismiss="modal">Close</button></div></div></div>`;document.body.appendChild(modal)}
 document.getElementById('marketingEmailPreviewSubject').textContent=subject;document.getElementById('marketingEmailPreviewFrame').innerHTML=sanitizeEmailHtml(html);new bootstrap.Modal(modal).show();
}
function openCampaignModal(ch,id=''){
 if(!canEdit())return;const c=id?state[ch].campaigns.find(x=>x.id===id):null;document.getElementById('marketingCampaignModalTitle').textContent=c?'Edit Campaign':'Create Campaign';document.getElementById('marketingCampaignId').value=c?.id||'';document.getElementById('marketingCampaignChannel').value=ch;document.getElementById('marketingCampaignName').value=c?.name||'';document.getElementById('marketingCampaignSubject').value=c?.subject||'';if(document.getElementById('marketingCampaignEmailProvider'))document.getElementById('marketingCampaignEmailProvider').value='Gmail';setEmailEditorContent(c?.bodyHtml||c?.body||'');document.getElementById('marketingCampaignSubjectWrap').classList.toggle('d-none',ch!=='email');document.getElementById('marketingCampaignEmailProviderWrap').classList.toggle('d-none',ch!=='email');document.getElementById('marketingEmailEditor')?.classList.toggle('d-none',ch!=='email');document.getElementById('marketingCampaignBody')?.classList.toggle('d-none',ch==='email');document.getElementById('marketingCampaignBody').value=c?.body||'';document.getElementById('marketingEmailEditorVisualBtn')?.classList.add('active');document.getElementById('marketingEmailEditorHtmlBtn')?.classList.remove('active');document.getElementById('marketingEmailEditor')?.classList.remove('is-html');document.getElementById('marketingCampaignPlaceholderHelp').textContent=ch==='email'?'Use {{Name}} in the subject or body. It will be replaced for each customer. Images should use HTTPS URLs.':'Use {{Name}} in the message. It will be replaced for each customer.';new bootstrap.Modal(document.getElementById('marketingCampaignModal')).show();if(ch==='email')setTimeout(refreshGmailStatus,50);
}
async function saveCampaign(){
 if(!canEdit())return;const id=document.getElementById('marketingCampaignId').value.trim(),ch=document.getElementById('marketingCampaignChannel').value,name=document.getElementById('marketingCampaignName').value.trim(),subject=document.getElementById('marketingCampaignSubject').value.trim(),provider='Gmail';const body=ch==='email'?getEmailEditorHtml():document.getElementById('marketingCampaignBody').value.trim();if(!name||!body){toast?.('Campaign name and body are required.','warning');return}if(ch==='email'&&!subject){toast?.('Email subject is required.','warning');return}
 const payload={name,subject:ch==='email'?subject:'',body,bodyHtml:ch==='email'?body:'',emailProvider:ch==='email'?provider:'',updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:CURRENT_USER.uid,updatedByName:CURRENT_USER.name||CURRENT_USER.email};
 try{const btn=document.getElementById('marketingCampaignSaveBtn');btn.disabled=true;const r=getCampaignRef(ch);if(id)await r.doc(id).update(payload);else{const created={...payload,createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:CURRENT_USER.uid,createdByName:CURRENT_USER.name||CURRENT_USER.email,sentRecipients:{}};await r.add(created);if(CURRENT_USER?.role==='marketing'&&window.notifyManagement){const marketingName=CURRENT_USER.name||CURRENT_USER.email,plain=emailHtmlToPlainText(body),detail=ch==='email'?`Marketing Name: ${marketingName}\nCampaign Name: ${name}\nSubject: ${subject}\nOpen Email With: ${provider}\nBody: ${plain}`:`Marketing Name: ${marketingName}\nCampaign Name: ${name}\nBody: ${plain}`;window.notifyManagement({title:`New ${ch==='email'?'Email':'WhatsApp'} Marketing Campaign Created`,message:detail,type:'marketing-campaign-created',metadata:{marketingName:CURRENT_USER.name||CURRENT_USER.email,campaignName:name,marketingType:ch,subject:ch==='email'?subject:'',openEmailWith:ch==='email'?provider:'',body:plain,bodyHtml:ch==='email'?body:''}})}}bootstrap.Modal.getInstance(document.getElementById('marketingCampaignModal'))?.hide();toast?.(id?'Campaign updated.':'Campaign created.','success')}catch(e){console.error(e);toast?.('Failed to save campaign.','danger')}finally{document.getElementById('marketingCampaignSaveBtn').disabled=false}
}
async function deleteCampaign(ch,id){if(!canDelete()||!confirm('Delete this campaign? This cannot be undone.'))return;try{await getCampaignRef(ch).doc(id).delete();state[ch].activeCampaignId=null;toast?.('Campaign deleted.','success');renderChannel(ch)}catch(e){console.error(e);toast?.('Failed to delete campaign.','danger')}}

function replacePlaceholders(text,c){const values={name:c.name||'',email:c.email||'',phone:c.phone||'',company:c.company||''};return String(text||'').replace(/\{\{\s*(name|email|phone|company)\s*\}\}/gi,(_,k)=>values[k.toLowerCase()]??'')}
function allSentEntriesByUser(ch){
 const campaigns=state[ch]?.campaigns||[];
 // The marketing limit is shared across every user who has access to this
 // channel. Each campaign is still tracked separately for its own Sent state,
 // but the cooldown is calculated from all recorded sends in the channel.
 return campaigns.flatMap(c=>Object.values(c.sentRecipients||{}).map(x=>({...x,campaignId:c.id,time:asDate(x.openedAt)?.getTime()||0}))).filter(x=>x.time>0).sort((a,b)=>a.time-b.time);
}
function getMarketingCooldown(ch){
 if(!CURRENT_USER?.uid)return {remaining:0,available:0,limit:1,total:0};
 const limits=getMarketingLimits();
 const limit=ch==='whatsapp'?limits.whatsappMessages:limits.emailMessages;
 const cooldownMs=(ch==='whatsapp'?limits.whatsappCooldownMinutes:limits.emailCooldownMinutes)*60*1000;
 const entries=allSentEntriesByUser(ch);
 const now=Date.now();
 if(!entries.length)return {remaining:0,available:limit,limit,total:0};
 if(cooldownMs<=0)return {remaining:0,available:limit,limit,total:entries.length};

 // A batch starts after the last gap longer than the configured cooldown.
 // This avoids the old modulo/history bug and makes the countdown use the
 // timestamp of the actual message that completed the current batch.
 const latest=entries[entries.length-1];
 let batchCount=1;
 for(let i=entries.length-2;i>=0;i--){
   const gap=latest.time-entries[i].time;
   if(gap>cooldownMs)break;
   batchCount+=1;
   if(batchCount>=limit)break;
 }
 if(batchCount>=limit){
   const until=latest.time+cooldownMs;
   if(until>now)return {remaining:until-now,available:0,limit,total:entries.length};
   return {remaining:0,available:limit,limit,total:entries.length};
 }
 return {remaining:0,available:Math.max(0,limit-batchCount),limit,total:entries.length};
}
function formatCountdown(ms){const total=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(total/60),s=total%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
let marketingCountdownTimer=null;
let marketingCountdownChannel=null;
let marketingLastAnnouncedKey='';
function getMarketingAnnouncementKey(ch){
 const x=getMarketingCooldown(ch);
 if(x.remaining>0)return '';
 const campaign=state[ch]?.campaigns?.find(c=>c.id===state[ch]?.activeCampaignId);
 return `${CURRENT_USER?.uid||'user'}|${ch}|${campaign?.id||'no-campaign'}|${x.total}|${x.limit}`;
}
function speakMarketingCooldownComplete(ch){
 const key=getMarketingAnnouncementKey(ch);
 if(!key||key===marketingLastAnnouncedKey)return;
 const campaign=state[ch]?.campaigns?.find(c=>c.id===state[ch]?.activeCampaignId);
 const voiceEnabled=getCRMSetting?.('marketingCooldownVoiceAnnouncements')!==false;
 if(!campaign||!voiceEnabled||!window.speechSynthesis||typeof window.SpeechSynthesisUtterance!=='function')return;
 marketingLastAnnouncedKey=key;
 const userName=CURRENT_USER?.name||CURRENT_USER?.email||'there';
 const marketingName=ch==='whatsapp'?'WhatsApp Marketing':'Email Marketing';
 const message=`Hey ${userName}, your ${marketingName} timer is completed. You can now start the ${campaign.name} campaign.`;
 try{window.speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(message);utterance.rate=0.95;utterance.pitch=1;window.speechSynthesis.speak(utterance);}catch(e){console.warn('Marketing timer audio could not be played',e)}
}
function renderMarketingStatus(ch){
 const root=document.getElementById(`view-${ch}marketing`);if(!root)return;
 let el=root.querySelector('.marketing-send-status');
 if(!el){el=document.createElement('div');el.className='marketing-send-status';root.appendChild(el);}
 const x=getMarketingCooldown(ch),label=ch==='whatsapp'?'WhatsApp':'Email';
 const campaign=state[ch]?.campaigns?.find(c=>c.id===state[ch]?.activeCampaignId);
 const sent=campaign?.sentRecipients||{};
 const pending=campaign?eligibleContacts(ch).filter(c=>!(sent[c.id]?.sentAt||sent[c.id]?.messageId)).length:eligibleContacts(ch).length;
 const timing=x.remaining>0?`Can send ${x.available} of ${x.limit} in ${formatCountdown(x.remaining)}`:`Can send ${x.available} of ${x.limit} now`;
 el.classList.toggle('is-countdown',x.remaining>0);
 el.classList.toggle('is-available',x.remaining<=0);
 el.innerHTML=`<strong>${label} Marketing</strong><span>${pending} messages pending / ${x.available} of ${x.limit} can be sent</span><span class="marketing-send-status-timing">${timing}</span>`;
 if(x.remaining<=0)speakMarketingCooldownComplete(ch);
}
function startMarketingCountdown(ch){
 if(marketingCountdownTimer)clearInterval(marketingCountdownTimer);
 marketingCountdownChannel=ch;
 const tick=()=>{
   renderMarketingStatus(ch);
   const current=getMarketingCooldown(ch);
   if(current.remaining<=0){
     clearInterval(marketingCountdownTimer);
     marketingCountdownTimer=null;
     speakMarketingCooldownComplete(ch);
   }
 };
 tick();
 marketingCountdownTimer=setInterval(tick,1000);
}
async function authorizeGmail(){
 try{
   const token=await (window.auth?.currentUser?.getIdToken?.()||Promise.reject(new Error('Your CRM session has expired. Please log in again.')));
   const response=await fetch('/api/email/gmail/oauth-url',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}});
   const result=await response.json().catch(()=>({}));
   if(!response.ok||!result.ok)throw new Error(result.error||'Unable to start Gmail authorization.');
   window.open(result.url,'_blank','noopener,noreferrer');
   toast?.('Gmail authorization opened in a new tab. Complete Google authorization, then add the refresh token to the server environment.','info');
 }catch(e){console.error('Gmail authorization error',e);toast?.(e.message||'Unable to authorize Gmail.','danger')}
}
async function refreshGmailStatus(){
 const status=document.getElementById('marketingGmailStatus');
 if(!status)return;
 try{
   const token=await window.auth?.currentUser?.getIdToken?.();
   if(!token)return;
   const r=await fetch('/api/email/gmail/status',{headers:{Authorization:`Bearer ${token}`}});const d=await r.json().catch(()=>({}));
   status.textContent=d.authorized?`Authorized: ${d.account}`:(d.configured?'Not authorized yet':'Gmail OAuth not configured');
   status.className=`small ${d.authorized?'text-success':'text-muted'}`;
 }catch(e){status.textContent='Gmail status unavailable';status.className='small text-danger'}
}

async function openMessage(ch,campaignId,contactId,options={}){const campaign=state[ch].campaigns.find(c=>c.id===campaignId),c=state[ch].contacts.find(x=>x.id===contactId);if(!campaign||!c)return;if(statusOf(c,ch)==='Unsubscribed'){toast?.(`This customer is Unsubscribed for ${ch==='email'?'Email':'WhatsApp'}.`,'warning');return}if(campaign.sentRecipients?.[contactId]){toast?.(`This customer has already been sent this ${ch==='email'?'email':'WhatsApp'} campaign.`,'info');return}{const cooldown=getMarketingCooldown(ch);if(cooldown.remaining>0){toast?.(`${ch==='whatsapp'?'WhatsApp':'Email'} marketing is paused. Please wait ${formatCountdown(cooldown.remaining)}.`,'warning');startMarketingCountdown(ch);return}}const rawBody=campaign.bodyHtml||campaign.body||'';const bodyHtml=replacePlaceholders(rawBody,c);const body=ch==='email'?emailHtmlToPlainText(bodyHtml):replacePlaceholders(campaign.body,c);saveMarketingPosition(ch);if(ch==='email'){const subject=replacePlaceholders(campaign.subject,c);if(!c.email){toast?.('Email address is missing.','warning');return}try{const token=await (window.auth?.currentUser?.getIdToken?.()||Promise.reject(new Error('Your CRM session has expired. Please log in again.')));const response=await fetch('/api/email/send',{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`},body:JSON.stringify({to:c.email,subject,html:bodyHtml,text:body,campaignId,contactId,provider:'Gmail',sentByName:CURRENT_USER.name||CURRENT_USER.email})});let result={};try{result=await response.json()}catch(_){}if(!response.ok||!result.ok)throw new Error(result.error||'The email could not be sent.');const sentRecord={sentAt:result.sentAt||new Date(),sentThrough:'Gmail',sentBy:CURRENT_USER.uid,sentByName:CURRENT_USER.name||CURRENT_USER.email,messageId:result.messageId||''};campaign.sentRecipients={...(campaign.sentRecipients||{}),[contactId]:sentRecord};renderChannel(ch);restoreMarketingPosition(ch);renderMarketingStatus(ch);if(getMarketingCooldown(ch).remaining>0)startMarketingCountdown(ch);toast?.(`Email sent to ${c.name}.`,'success');if(options.shortcutIndex)toast?.(`Customer ${c.slNo || options.shortcutIndex}, ${c.name} is sent`,'success');if(window.CRMReport?.refresh)window.CRMReport.refresh()}catch(e){console.error('Email send failed',e);if(String(e.message||'').toLowerCase().includes('not authorized')||String(e.message||'').toLowerCase().includes('gmail is not authorized')){try{await authorizeGmail()}catch(_){} }else{toast?.(e.message||'Failed to send email.','danger')}}return}const phone=normalisePhone(c.phone);if(!phone){toast?.('Valid WhatsApp number is missing.','warning');return}const url=`https://wa.me/${phone}?text=${encodeURIComponent(body)}`;window.open(url,'_blank','noopener,noreferrer');const sentRecord={openedAt:new Date(),sentThrough:'WhatsApp',sentBy:CURRENT_USER.uid,sentByName:CURRENT_USER.name||CURRENT_USER.email};campaign.sentRecipients={...(campaign.sentRecipients||{}),[contactId]:sentRecord};renderChannel(ch);restoreMarketingPosition(ch);renderMarketingStatus(ch);if(getMarketingCooldown(ch).remaining>0)startMarketingCountdown(ch);try{await getCampaignRef(ch).doc(campaignId).update({[`sentRecipients.${contactId}`]:{openedAt:firebase.firestore.FieldValue.serverTimestamp(),sentThrough:sentRecord.sentThrough,sentBy:sentRecord.sentBy,sentByName:sentRecord.sentByName}})}catch(e){console.error('Failed to record WhatsApp open',e)}if(options.shortcutIndex)toast?.(`Customer ${c.slNo || options.shortcutIndex}, ${c.name} is opened`,'success');if(window.CRMReport?.refresh)window.CRMReport.refresh()}
document.addEventListener('visibilitychange',()=>{
 if(document.visibilityState!=='visible')return;
 ['whatsapp','email'].forEach(ch=>{
   const x=getMarketingCooldown(ch);
   if(x.remaining<=0){
     renderMarketingStatus(ch);
     if(marketingCountdownChannel===ch&&marketingCountdownTimer){clearInterval(marketingCountdownTimer);marketingCountdownTimer=null;}
   }else if(marketingCountdownChannel===ch&&!marketingCountdownTimer){
     startMarketingCountdown(ch);
   }
 });
});

function visibleChannel(){const e=document.getElementById('view-emailmarketing'),w=document.getElementById('view-whatsappmarketing');if(e&&!e.classList.contains('d-none'))return'email';if(w&&!w.classList.contains('d-none'))return'whatsapp';return null}
async function openNextRecipient(ch){const s=state[ch],campaign=s.campaigns.find(c=>c.id===s.activeCampaignId);if(!campaign){toast?.(`Open a ${ch==='email'?'email':'WhatsApp'} campaign first.`,'warning');return}const recipients=eligibleContacts(ch),sent=campaign.sentRecipients||{},i=recipients.findIndex(c=>!sent[c.id]);if(i===-1){toast?.(`All ${recipients.length} ${ch==='email'?'email':'WhatsApp'} leads in this campaign are opened.`,'success');return}await openMessage(ch,campaign.id,recipients[i].id,{shortcutIndex:i+1})}
function bindShortcuts(){if(window.__marketingShortcutsBound)return;window.__marketingShortcutsBound=true;document.addEventListener('keydown',e=>{const modal=document.getElementById('marketingContactModal');const isContactModal=modal?.classList.contains('show');const isCustomers=window.CURRENT_VIEW==='customers'||!document.getElementById('view-customers')?.classList.contains('d-none');const ch=visibleChannel();if(e.altKey&&(e.key==='/'||e.code==='Slash')){if(isCustomers){e.preventDefault();if(!isContactModal)openContactModal('email');}return}if(isContactModal&&!e.altKey&&e.key==='Enter'&&String(e.target?.tagName||'').toLowerCase()!=='textarea'){e.preventDefault();document.getElementById('marketingContactSaveBtn')?.click();return}if(e.altKey&&(e.key==='o'||e.key==='O'||e.code==='KeyO')){if(ch){e.preventDefault();openNextRecipient(ch);}}})}

async function syncLoadedLeads(leads){
 if(!contactCacheLoaded||!Array.isArray(leads)||!leads.length||!isActiveUser())return;
 const batch=db.batch();let writes=0;
 leads.forEach(l=>{
   const id=`lead_${l.id}`,existing=state.email.contacts.find(c=>c.id===id),ref=contactsRef().doc(id);
   const nextEmail=existing?statusOf(existing,'email'):(l.status==='Not Interested'?'Unsubscribed':'Subscribed');
   const nextWa=existing?statusOf(existing,'whatsapp'):(l.status==='Not Interested'?'Unsubscribed':'Subscribed');
   const nextLegacy=(nextEmail==='Unsubscribed'&&nextWa==='Unsubscribed')?'Unsubscribed':'Subscribed';
   const changed=!existing||existing.name!==(l.fullName||'')||existing.email!==(l.email||'')||existing.phone!==(l.phoneNumber||'')||existing.company!==(l.companyName||'')||statusOf(existing,'email')!==nextEmail||statusOf(existing,'whatsapp')!==nextWa;
   if(!changed)return;
   const payload={source:'lead',sourceLeadId:l.id,name:l.fullName||'',email:l.email||'',phone:l.phoneNumber||'',company:l.companyName||'',createdByName:existing?.createdByName||l.createdByName||l.addedByName||'—',emailStatus:nextEmail,whatsappStatus:nextWa,marketingStatus:nextLegacy,updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
   if(!existing)payload.createdAt=firebase.firestore.FieldValue.serverTimestamp();
   batch.set(ref,payload,{merge:true});writes++;
 });
 if(writes)try{await batch.commit();await refreshContacts()}catch(e){console.error('Loaded lead sync failed',e)}
}

async function syncExistingLeads(){
 if(!isAdmin()||!confirm('Sync all existing leads into the customer directory? This performs one full leads read.'))return;
 try{
  const snap=await leadsRef.get();let batch=db.batch(),count=0,n=0;
  for(const d of snap.docs){
   const l={id:d.id,...d.data()},existing=state.email.contacts.find(c=>c.id===`lead_${l.id}`),r=contactsRef().doc(`lead_${l.id}`);
   const emailStatus=l.status==='Not Interested'?'Unsubscribed':(existing?statusOf(existing,'email'):'Subscribed');
   const whatsappStatus=l.status==='Not Interested'?'Unsubscribed':(existing?statusOf(existing,'whatsapp'):'Subscribed');
   const marketingStatus=(emailStatus==='Unsubscribed'&&whatsappStatus==='Unsubscribed')?'Unsubscribed':'Subscribed';
   batch.set(r,{source:'lead',sourceLeadId:l.id,name:l.fullName||'',email:l.email||'',phone:l.phoneNumber||'',company:l.companyName||'',createdByName:existing?.createdByName||l.createdByName||l.addedByName||'—',emailStatus,whatsappStatus,marketingStatus,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),...(existing?{}:{createdAt:firebase.firestore.FieldValue.serverTimestamp()})},{merge:true});
   count++;n++;if(n===450){await batch.commit();batch=db.batch();n=0}
  }
  if(n)await batch.commit();await refreshContacts();toast?.(`Synced ${count} existing leads into Customers.`,'success')
 }catch(e){console.error(e);toast?.('Failed to sync existing leads.','danger')}
}

async function syncLeadUpdate(l){if(!l?.id||!isActiveUser())return;const id=`lead_${l.id}`,existing=state.email.contacts.find(c=>c.id===id);const emailStatus=l.status==='Not Interested'?'Unsubscribed':(existing?statusOf(existing,'email'):'Subscribed');const whatsappStatus=l.status==='Not Interested'?'Unsubscribed':(existing?statusOf(existing,'whatsapp'):'Subscribed');await contactsRef().doc(id).set({source:'lead',sourceLeadId:l.id,name:l.fullName||'',email:l.email||'',phone:l.phoneNumber||'',company:l.companyName||'',createdByName:l.createdByName||l.addedByName||'—',emailStatus,whatsappStatus,marketingStatus:(emailStatus==='Unsubscribed'&&whatsappStatus==='Unsubscribed')?'Unsubscribed':'Subscribed',updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});if(contactCacheLoaded)await refreshContacts()}

window.addEventListener('crmsettingsupdated',()=>{renderChannel('email');renderChannel('whatsapp');});
bindShortcuts();
window.marketingContactsRef=contactsRef();
window.MarketingChannels={openView,preload,ensureContactsLoaded,onContactsChange,setContactStatus,setSearch,closeCampaign,openCampaign,openContactModal,saveContact,deleteContact,openCampaignModal,saveCampaign,deleteCampaign,openMessage,syncLoadedLeads,syncLeadUpdate,syncExistingLeads,refreshContacts,getContacts:()=>state.email.contacts,getCampaigns:(ch)=>state[ch]?.campaigns?.slice()||[],getReportData:()=>({customers:state.email.contacts.slice(),emailCampaigns:state.email.campaigns.slice(),whatsappCampaigns:state.whatsapp.campaigns.slice()}),normalisePhone,setEmailEditorMode,execEmailCommand,insertEmailLink,insertEmailImage,previewEmail,authorizeGmail,refreshGmailStatus};
})();
