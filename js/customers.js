/*
 * CUSTOMERS — single CRM customer directory.
 * Uses marketingContacts as the customer cache so marketing pages do not
 * need to query the full leads collection again.
 */
(function () {
  'use strict';

  const ref = () => db.collection('marketingContacts');
  let unsubscribe = null;
  let customers = [];
  let search = '';

  const isAdmin = () => ['admin', 'superadmin'].includes(window.CURRENT_USER?.role);
  const canEdit = () => !!window.CURRENT_USER?.active;

  const esc = (v) => String(v ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  const dateText = (v) => {
    if (!v) return '—';
    const d = v?.toDate ? v.toDate() : new Date(v);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-IN', {day:'2-digit', month:'short', year:'numeric'});
  };
  const statusOf = (c, channel) => {
    const value = channel === 'whatsapp' ? c.whatsappStatus : c.emailStatus;
    if (value) return value === 'Not Interested' ? 'Not Interested' : 'Interested';
    if (c.marketingStatus) return c.marketingStatus === 'Not Interested' ? 'Not Interested' : 'Interested';
    return 'Interested';
  };

  function render() {
    const body = document.getElementById('customersViewBody');
    if (!body) return;
    const q = search.trim().toLowerCase();
    const filtered = customers.filter(c => `${c.name||''} ${c.email||''} ${c.phone||''} ${c.company||''} ${c.source||''}`.toLowerCase().includes(q));

    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h1 class="page-title"><i class="bi bi-people me-2"></i>Customers</h1>
          <p class="page-subtitle">One customer directory for Email Marketing and WhatsApp Marketing.</p>
        </div>
        <div class="d-flex gap-2 align-items-center">
          <input id="customersSearch" class="form-control" style="min-width:260px" placeholder="Search customers..." value="${esc(search)}">
          ${isAdmin() ? `<button class="btn btn-outline-secondary" onclick="window.MarketingChannels.syncExistingLeads()"><i class="bi bi-arrow-repeat me-1"></i>Sync Existing Leads</button>` : ''}${canEdit() ? `<button class="btn btn-brand" onclick="window.MarketingChannels.openContactModal('email')"><i class="bi bi-person-plus me-1"></i>Add Customer</button>` : ''}
        </div>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>Total Customers</span><strong>${customers.length}</strong></div></div>
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>WhatsApp Interested</span><strong>${customers.filter(c=>statusOf(c,'whatsapp')==='Interested').length}</strong></div></div>
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>Email Interested</span><strong>${customers.filter(c=>statusOf(c,'email')==='Interested').length}</strong></div></div>
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>Manual Customers</span><strong>${customers.filter(c=>c.source!=='lead').length}</strong></div></div>
      </div>
      <div class="marketing-card">
        <div class="d-flex justify-content-between align-items-center mb-2">
          <div><div class="marketing-card-title">Customer Directory</div><div class="small text-muted">${filtered.length} of ${customers.length} customers</div></div>
        </div>
        <div class="crm-scroll-table customers-table-scroll">
          <table class="table align-middle marketing-table mb-0">
            <thead><tr><th>Sl No</th><th>Name</th><th>Email</th><th>Mobile</th><th>Company</th><th>Sub / Unsub (WhatsApp)</th><th>Sub / Unsub (Email)</th><th>Source</th><th>Actions</th><th>Added by</th></tr></thead>
            <tbody>${filtered.length ? filtered.map((c,i)=>customerRow(c,i+1)).join('') : `<tr><td colspan="10" class="text-center py-5 text-muted">${q?'No customers found.':'No customers yet.'}</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;

    document.getElementById('customersSearch')?.addEventListener('input', e => { search=e.target.value; render(); });
  }

  function customerRow(c, index) {
    const wa = statusOf(c,'whatsapp');
    const em = statusOf(c,'email');
    const source = c.source === 'lead' ? 'Lead' : 'Manual';
    const addedBy = c.createdByName || c.updatedByName || c.addedByName || '—';
    return `<tr>
      <td>${index}</td>
      <td><strong>${esc(c.name || '—')}</strong></td>
      <td>${esc(c.email || '—')}</td>
      <td>${esc(c.phone || '—')}</td>
      <td>${esc(c.company || '—')}</td>
      <td><select class="form-select form-select-sm customer-status-select ${wa==='Not Interested'?'border-danger':''}" onchange="window.Customers.setStatus('${c.id}','whatsapp',this.value)"><option ${wa==='Interested'?'selected':''}>Interested</option><option ${wa==='Not Interested'?'selected':''}>Not Interested</option></select></td>
      <td><select class="form-select form-select-sm customer-status-select ${em==='Not Interested'?'border-danger':''}" onchange="window.Customers.setStatus('${c.id}','email',this.value)"><option ${em==='Interested'?'selected':''}>Interested</option><option ${em==='Not Interested'?'selected':''}>Not Interested</option></select></td>
      <td><span class="badge bg-light text-dark">${esc(source)}</span></td>
      <td><div class="d-flex gap-1">${canEdit()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openContactModal('email','${c.id}')">Edit</button>`:''}${isAdmin()?`<button class="btn btn-sm btn-outline-danger" onclick="window.Customers.delete('${c.id}')">Delete</button>`:''}</div></td>
      <td>${esc(addedBy)}</td>
    </tr>`;
  }

  async function init() {
    if (!window.CURRENT_USER?.active) return;
    if (unsubscribe) unsubscribe();
    unsubscribe = ref().orderBy('createdAt','asc').onSnapshot(snapshot => {
      customers = snapshot.docs.map(d => ({id:d.id,...d.data()}));
      render();
    }, err => {
      console.error('Customers listener failed:', err);
      toast?.('Failed to load customers.', 'danger');
    });
    render();
  }

  async function setStatus(id, channel, value) {
    if (!canEdit()) return;
    const payload = { updatedAt: firebase.firestore.FieldValue.serverTimestamp(), updatedBy: CURRENT_USER.uid, updatedByName: CURRENT_USER.name || CURRENT_USER.email };
    if (channel === 'whatsapp') payload.whatsappStatus = value; else payload.emailStatus = value;
    // Keep the legacy field for older screens/data, but channel-specific status is authoritative.
    if (value === 'Not Interested') payload.marketingStatus = 'Not Interested';
    else {
      const c = customers.find(x=>x.id===id);
      const other = channel === 'whatsapp' ? statusOf(c||{},'email') : statusOf(c||{},'whatsapp');
      payload.marketingStatus = other === 'Not Interested' ? 'Not Interested' : 'Interested';
    }
    try {
      await ref().doc(id).update(payload);
      toast?.(`${channel === 'whatsapp' ? 'WhatsApp' : 'Email'} status updated.`, 'success');
    } catch (err) {
      console.error(err);
      toast?.('Failed to update customer status.', 'danger');
    }
  }

  async function remove(id) {
    if (!isAdmin() || !confirm('Delete this customer? This cannot be undone.')) return;
    try { await ref().doc(id).delete(); toast?.('Customer deleted.', 'success'); }
    catch (err) { console.error(err); toast?.('Failed to delete customer.', 'danger'); }
  }

  window.Customers = { init, render, setStatus, delete: remove };
})();
