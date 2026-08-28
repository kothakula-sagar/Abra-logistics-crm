/* MARKETING CHANNELS — Email + WhatsApp campaigns and shared customer cache. */
(function(){
'use strict';
const contactsRef=()=>db.collection('marketingContacts');
const emailCampaignsRef=()=>db.collection('emailMarketingCampaigns');
const whatsappCampaignsRef=()=>db.collection('whatsappMarketingCampaigns');
const state={email:{contacts:[],campaigns:[],activeCampaignId:null,search:''},whatsapp:{contacts:[],campaigns:[],activeCampaignId:null,search:''}};
let contactCacheLoaded=false,contactLoadPromise=null,contactUnsubscribe=null,emailCampaignUnsubscribe=null,whatsappCampaignUnsubscribe=null;
const contactListeners=new Set();
const isAdmin=()=>['admin','superadmin'].includes(window.CURRENT_USER?.role);
const isActiveUser=()=>!!window.CURRENT_USER?.active;
const canEdit=()=>isActiveUser(); const canDelete=()=>isAdmin();
const isMarketingAllowed=()=>['superadmin','admin','marketing'].includes(window.CURRENT_USER?.role);
const WHATSAPP_BATCH_SIZE=10;
const WHATSAPP_COOLDOWN_MS=5*60*1000;
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
const asDate=v=>v?.toDate?v.toDate():(v?new Date(v):null);
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

function campaignRows(ch,rows){return rows.map(c=>`<tr><td><strong>${esc(c.name)}</strong></td><td>${ch==='email'?esc(c.subject||'—'):esc((c.body||'').slice(0,90))}</td><td>${eligibleContacts(ch).length}</td><td>${Object.keys(c.sentRecipients||{}).length}</td><td>${ch==='email'?`<span class="badge bg-light text-dark">${c.emailProvider==='Outlook'?'Outlook App':'Gmail'}</span>`:'<span class="badge bg-success-subtle text-success">WhatsApp</span>'}</td><td>${fmtDate(c.createdAt)}</td><td><div class="d-flex gap-1"><button class="btn btn-sm btn-brand" onclick="window.MarketingChannels.openCampaign('${ch}','${c.id}')">Open</button>${canEdit()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openCampaignModal('${ch}','${c.id}')">Edit</button>`:''}${canDelete()?`<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteCampaign('${ch}','${c.id}')">Delete</button>`:''}</div></td></tr>`).join('')}

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
 const s=getState(ch);
 const active=s.campaigns.find(c=>c.id===s.activeCampaignId);
 if(active){renderCampaignDetail(ch,active,body,{tableScrollTop:savedTableScrollTop,pageScrollTop:savedPageScrollTop});return}
 const q=s.search.toLowerCase();
 const rows=s.campaigns.filter(c=>`${c.name} ${c.subject||''} ${c.body||''}`.toLowerCase().includes(q));
 body.innerHTML=`<div class="marketing-stats-row"><div class="marketing-stat"><span>Campaigns</span><strong>${s.campaigns.length}</strong></div><div class="marketing-stat"><span>Subscribed recipients</span><strong>${eligibleContacts(ch).length}</strong></div><div class="marketing-stat"><span>Opened from CRM</span><strong>${s.campaigns.reduce((n,c)=>n+Object.keys(c.sentRecipients||{}).length,0)}</strong></div></div><div class="marketing-card"><div class="d-flex justify-content-between align-items-center gap-2 flex-wrap mb-3"><div><div class="marketing-card-title">${ch==='email'?'Email':'WhatsApp'} Campaigns</div><div class="small text-muted">No pagination. Scroll inside the table.</div></div><input class="form-control marketing-search" placeholder="Search campaigns..." value="${esc(s.search)}" oninput="window.MarketingChannels.setSearch('${ch}',this.value)"></div><div class="crm-scroll-table marketing-campaigns-scroll"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Campaign</th><th>${ch==='email'?'Subject':'Message'}</th><th>Recipients</th><th>Opened</th><th>Sent Through</th><th>Added</th><th>Actions</th></tr></thead><tbody>${rows.length?campaignRows(ch,rows):`<tr><td colspan="7" class="text-center py-5 text-muted">${q?'No campaigns found.':'No campaigns yet.'}</td></tr>`}</tbody></table></div></div>`;
 restoreScrollPosition(ch,savedTableScrollTop,savedPageScrollTop);
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
 if(ch==='whatsapp'&&getWhatsAppCooldown(campaign).remaining>0&&!whatsappCountdownTimer)startWhatsAppCountdown();
 body.innerHTML=`<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3"><button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.closeCampaign('${ch}')"><i class="bi bi-arrow-left me-1"></i>Back to ${ch==='email'?'Email':'WhatsApp'} Marketing</button><div class="d-flex gap-2">${canEdit()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openCampaignModal('${ch}','${campaign.id}')">Edit</button>`:''}${canDelete()?`<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteCampaign('${ch}','${campaign.id}')">Delete</button>`:''}</div></div><div class="marketing-detail-heading"><h2>${esc(campaign.name)} ${ch==='whatsapp'&&getWhatsAppCooldown(campaign).remaining>0?`<span class="whatsapp-countdown">Wait ${formatCountdown(getWhatsAppCooldown(campaign).remaining)}</span>`:''}</h2><p>${ch==='email'?`Subject: ${esc(campaign.subject||'')} · Opens in ${esc(campaign.emailProvider==='Outlook'?'Outlook App':(campaign.emailProvider||'Gmail'))}`:'Personalized WhatsApp message'}</p></div><div class="marketing-message-preview">${ch==='email'?`<div><strong>Subject</strong><div>${esc(campaign.subject||'')}</div></div>`:''}<div><strong>Body</strong><pre>${esc(campaign.body||'')}</pre></div></div><div class="marketing-card"><div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3"><div><div class="marketing-card-title">Campaign Recipients</div><div class="small text-muted">${contacts.length} interested recipients · scroll table</div></div><input class="form-control marketing-search" placeholder="Search recipients..." value="${esc(q)}" oninput="window.MarketingChannels.setSearch('${ch}',this.value)"></div><div class="crm-scroll-table marketing-recipients-scroll"><table class="table align-middle marketing-table mb-0"><thead><tr><th>Sl No</th><th>Name</th><th>${ch==='email'?'Email':'Number'}</th><th>Status</th><th>Sent Through</th><th>Action</th><th>Sent By</th></tr></thead><tbody>${filtered.length?filtered.map((c,i)=>recipientRow(ch,campaign,c,i+1,sentMap[c.id])).join(''):`<tr><td colspan="7" class="text-center py-4 text-muted">No matching interested customers.</td></tr>`}</tbody></table></div></div>`;
 restoreScrollPosition(ch,savedTableScrollTop,savedPageScrollTop);
}
function recipientRow(ch,campaign,c,index,sent){const destination=ch==='email'?c.email:normalisePhone(c.phone),opened=!!sent,sentThrough=sent?.sentThrough||(ch==='email'?(campaign.emailProvider==='Outlook'?'Outlook App':'Gmail'):'WhatsApp'),sentBy=sent?.sentByName||'—';const cooldown=getWhatsAppCooldown(campaign);const action=destination?(ch==='whatsapp'?(opened?`<button class="btn btn-sm btn-primary" disabled><i class="bi bi-whatsapp me-1"></i>Sent</button>`:(cooldown.remaining>0?`<button class="btn btn-sm btn-danger" disabled><i class="bi bi-hourglass-split me-1"></i>Wait</button>`:`<button class="btn btn-sm btn-success" onclick="window.MarketingChannels.openMessage('${ch}','${campaign.id}','${c.id}')"><i class="bi bi-whatsapp me-1"></i>Open WhatsApp</button>`)):`<button class="btn btn-sm btn-brand" onclick="window.MarketingChannels.openMessage('${ch}','${campaign.id}','${c.id}')"><i class="bi bi-envelope-at me-1"></i>Send Email</button>`):'<span class="text-muted">Missing contact</span>';return `<tr><td>${index}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(ch==='email'?c.email:c.phone)}</td><td><span class="badge ${opened?'bg-success-subtle text-success':'bg-light text-dark'}">${opened?'Sent':'Not Sent'}</span></td><td><span class="badge bg-light text-dark">${esc(sentThrough)}</span></td><td>${action}</td><td>${esc(sentBy)}</td></tr>`}

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
 const payload={updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:CURRENT_USER.uid,updatedByName:CURRENT_USER.name||CURRENT_USER.email};
 if(channel==='whatsapp')payload.whatsappStatus=value;else payload.emailStatus=value;
 const other=channel==='whatsapp'?statusOf(c,'email'):statusOf(c,'whatsapp');
 const nextEmail=channel==='email'?value:other;
 const nextWa=channel==='whatsapp'?value:other;
 payload.marketingStatus=(nextEmail==='Unsubscribed'&&nextWa==='Unsubscribed')?'Unsubscribed':'Subscribed';
 try{await contactsRef().doc(id).update(payload);const updated={...c,...payload,updatedAt:new Date()};state.email.contacts=state.email.contacts.map(x=>x.id===id?updated:x);state.whatsapp.contacts=state.whatsapp.contacts.map(x=>x.id===id?updated:x);notifyContactListeners();renderChannel('email');renderChannel('whatsapp');if(window.CRMReport?.refresh)window.CRMReport.refresh();toast?.(`${channel==='whatsapp'?'WhatsApp':'Email'} status updated.`,'success')}catch(e){console.error(e);toast?.('Failed to update customer status.','danger')}}

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

function openCampaignModal(ch,id=''){if(!canEdit())return;const c=id?state[ch].campaigns.find(x=>x.id===id):null;document.getElementById('marketingCampaignModalTitle').textContent=c?'Edit Campaign':'Create Campaign';document.getElementById('marketingCampaignId').value=c?.id||'';document.getElementById('marketingCampaignChannel').value=ch;document.getElementById('marketingCampaignName').value=c?.name||'';document.getElementById('marketingCampaignSubject').value=c?.subject||'';document.getElementById('marketingCampaignEmailProvider').value=c?.emailProvider||'Gmail';document.getElementById('marketingCampaignBody').value=c?.body||'';document.getElementById('marketingCampaignSubjectWrap').classList.toggle('d-none',ch!=='email');document.getElementById('marketingCampaignEmailProviderWrap').classList.toggle('d-none',ch!=='email');document.getElementById('marketingCampaignPlaceholderHelp').textContent=ch==='email'?'Use {{Name}} in the subject or body. It will be replaced for each customer.':'Use {{Name}} in the message. It will be replaced for each customer.';new bootstrap.Modal(document.getElementById('marketingCampaignModal')).show()}
async function saveCampaign(){if(!canEdit())return;const id=document.getElementById('marketingCampaignId').value.trim(),ch=document.getElementById('marketingCampaignChannel').value,name=document.getElementById('marketingCampaignName').value.trim(),subject=document.getElementById('marketingCampaignSubject').value.trim(),body=document.getElementById('marketingCampaignBody').value.trim(),provider=document.getElementById('marketingCampaignEmailProvider').value==='Outlook'?'Outlook':'Gmail';if(!name||!body){toast?.('Campaign name and body are required.','warning');return}if(ch==='email'&&!subject){toast?.('Email subject is required.','warning');return}const payload={name,subject:ch==='email'?subject:'',body,emailProvider:ch==='email'?provider:'',updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:CURRENT_USER.uid,updatedByName:CURRENT_USER.name||CURRENT_USER.email};try{const btn=document.getElementById('marketingCampaignSaveBtn');btn.disabled=true;const r=getCampaignRef(ch);if(id)await r.doc(id).update(payload);else await r.add({...payload,createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:CURRENT_USER.uid,createdByName:CURRENT_USER.name||CURRENT_USER.email,sentRecipients:{}});bootstrap.Modal.getInstance(document.getElementById('marketingCampaignModal'))?.hide();toast?.(id?'Campaign updated.':'Campaign created.','success')}catch(e){console.error(e);toast?.('Failed to save campaign.','danger')}finally{document.getElementById('marketingCampaignSaveBtn').disabled=false}}
async function deleteCampaign(ch,id){if(!canDelete()||!confirm('Delete this campaign? This cannot be undone.'))return;try{await getCampaignRef(ch).doc(id).delete();state[ch].activeCampaignId=null;toast?.('Campaign deleted.','success');renderChannel(ch)}catch(e){console.error(e);toast?.('Failed to delete campaign.','danger')}}

function replacePlaceholders(text,c){const values={name:c.name||'',email:c.email||'',phone:c.phone||'',company:c.company||''};return String(text||'').replace(/\{\{\s*(name|email|phone|company)\s*\}\}/gi,(_,k)=>values[k.toLowerCase()]??'')}
function sentEntriesByUser(campaign){return Object.values(campaign?.sentRecipients||{}).filter(x=>x&&x.sentBy===CURRENT_USER?.uid).map(x=>({...x,time:asDate(x.openedAt)?.getTime()||0})).sort((a,b)=>a.time-b.time)}
function getWhatsAppCooldown(campaign){if(!campaign||!CURRENT_USER?.uid)return {remaining:0,count:0};const now=Date.now(),entries=sentEntriesByUser(campaign),completedBatches=Math.floor(entries.length/WHATSAPP_BATCH_SIZE);let remaining=0;if(completedBatches>0){const batchEnd=entries[(completedBatches*WHATSAPP_BATCH_SIZE)-1]?.time||0;remaining=Math.max(0,batchEnd+WHATSAPP_COOLDOWN_MS-now);}return {remaining,count:entries.length%WHATSAPP_BATCH_SIZE,total:entries.length};}
function formatCountdown(ms){const total=Math.max(0,Math.ceil(ms/1000)),m=Math.floor(total/60),s=total%60;return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;}
let whatsappCountdownTimer=null;
function startWhatsAppCountdown(){if(whatsappCountdownTimer)clearInterval(whatsappCountdownTimer);whatsappCountdownTimer=setInterval(()=>{const c=state.whatsapp.campaigns.find(x=>x.id===state.whatsapp.activeCampaignId);if(!c){clearInterval(whatsappCountdownTimer);whatsappCountdownTimer=null;return}renderChannel('whatsapp');if(getWhatsAppCooldown(c).remaining<=0){clearInterval(whatsappCountdownTimer);whatsappCountdownTimer=null;}},1000);}

async function openMessage(ch,campaignId,contactId,options={}){const campaign=state[ch].campaigns.find(c=>c.id===campaignId),c=state[ch].contacts.find(x=>x.id===contactId);if(!campaign||!c)return;if(statusOf(c,ch)==='Unsubscribed'){toast?.(`This customer is Unsubscribed for ${ch==='email'?'Email':'WhatsApp'}.`,'warning');return}if(ch==='whatsapp'&&campaign.sentRecipients?.[contactId]){toast?.('This customer has already been sent this WhatsApp campaign.','info');return}if(ch==='whatsapp'){const cooldown=getWhatsAppCooldown(campaign);if(cooldown.remaining>0){toast?.(`WhatsApp is paused. Please wait ${formatCountdown(cooldown.remaining)}.`,'warning');startWhatsAppCountdown();return}}const body=replacePlaceholders(campaign.body,c);let url='';if(ch==='email'){const subject=replacePlaceholders(campaign.subject,c);if(!c.email){toast?.('Email address is missing.','warning');return}if(campaign.emailProvider==='Outlook')url=`mailto:${encodeURIComponent(c.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;else url=`https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(c.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`}else{const phone=normalisePhone(c.phone);if(!phone){toast?.('Valid WhatsApp number is missing.','warning');return}url=`https://wa.me/${phone}?text=${encodeURIComponent(body)}`}
saveMarketingPosition(ch);if(ch==='email'&&campaign.emailProvider==='Outlook')window.location.href=url;else window.open(url,'_blank','noopener,noreferrer');
const sentRecord={openedAt:new Date(),sentThrough:ch==='email'?(campaign.emailProvider==='Outlook'?'Outlook App':'Gmail'):'WhatsApp',sentBy:CURRENT_USER.uid,sentByName:CURRENT_USER.name||CURRENT_USER.email};campaign.sentRecipients={...(campaign.sentRecipients||{}),[contactId]:sentRecord};renderChannel(ch);restoreMarketingPosition(ch);if(ch==='whatsapp'&&getWhatsAppCooldown(campaign).remaining>0)startWhatsAppCountdown();try{await getCampaignRef(ch).doc(campaignId).update({[`sentRecipients.${contactId}`]:{openedAt:firebase.firestore.FieldValue.serverTimestamp(),sentThrough:sentRecord.sentThrough,sentBy:sentRecord.sentBy,sentByName:sentRecord.sentByName}})}catch(e){console.error('Failed to record campaign open',e)}if(options.shortcutIndex)toast?.(`Customer ${c.slNo || options.shortcutIndex}, ${c.name} is opened`,'success');if(window.CRMReport?.refresh)window.CRMReport.refresh()}
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

bindShortcuts();
window.marketingContactsRef=contactsRef();
window.MarketingChannels={openView,preload,ensureContactsLoaded,onContactsChange,setContactStatus,setSearch,closeCampaign,openCampaign,openContactModal,saveContact,deleteContact,openCampaignModal,saveCampaign,deleteCampaign,openMessage,syncLoadedLeads,syncLeadUpdate,syncExistingLeads,refreshContacts,getContacts:()=>state.email.contacts,getCampaigns:(ch)=>state[ch]?.campaigns?.slice()||[],getReportData:()=>({customers:state.email.contacts.slice(),emailCampaigns:state.email.campaigns.slice(),whatsappCampaigns:state.whatsapp.campaigns.slice()}) ,normalisePhone};
})();
