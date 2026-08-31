/*
 * CUSTOMERS — single CRM customer directory.
 * The customer data is owned by MarketingChannels so Customers, Email,
 * WhatsApp and Reports all use the same in-memory dataset.
 */
(function () {
  'use strict';
  const getCustomersPageScroller = () => document.querySelector('.main-content') || document.scrollingElement || document.documentElement;
  const getCustomersPageScrollTop = () => getCustomersPageScroller()?.scrollTop ?? 0;
  const setCustomersPageScrollTop = (top) => { const el=getCustomersPageScroller(); if(el && Number.isFinite(top)) el.scrollTop=top; };

  let search = '';
  let unsubscribeStore = null;
  let customerCharts = {};

  const isAdmin = () => ['admin', 'superadmin'].includes(window.CURRENT_USER?.role);
  const isActive = () => !!window.CURRENT_USER?.active;
  const esc = (v) => String(v ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#039;');

  const hasEmail = c => !!String(c?.email || '').trim();
  const hasWhatsApp = c => !!window.MarketingChannels?.normalisePhone?.(c?.phone) || /^\+?\d[\d\s().-]{8,}$/.test(String(c?.phone || '').trim());

  function channelStatus(c, channel) {
    const hasChannel = channel === 'email' ? hasEmail(c) : hasWhatsApp(c);
    if (!hasChannel) return null;
    const value = channel === 'email' ? c.emailStatus : c.whatsappStatus;
    if (value) return ['Not Interested', 'Unsubscribed'].includes(value) ? 'Unsubscribed' : 'Subscribed';
    if (c.marketingStatus) return ['Not Interested', 'Unsubscribed'].includes(c.marketingStatus) ? 'Unsubscribed' : 'Subscribed';
    return 'Subscribed';
  }

  function getCustomers() {
    return window.MarketingChannels?.getContacts?.() || [];
  }

  function toDate(value) {
    if (!value) return null;
    if (value?.toDate) return value.toDate();
    if (value instanceof Date) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function dayKey(value) {
    const d = toDate(value);
    if (!d) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  function lastSevenDays() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, index) => {
      const d = new Date(today);
      d.setDate(today.getDate() - (6 - index));
      return {
        key: dayKey(d),
        label: d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit' })
      };
    });
  }

  function destroyCustomerCharts() {
    Object.values(customerCharts).forEach(chart => {
      try { chart?.destroy(); } catch (_) {}
    });
    customerCharts = {};
  }

  function renderCustomerCharts(customers) {
    const root = document.getElementById('customerAnalyticsCharts');
    if (!root || typeof Chart === 'undefined') return;
    destroyCustomerCharts();

    const days = lastSevenDays();
    const newCustomers = days.map(day => customers.filter(c => dayKey(c.createdAt) === day.key).length);
    const emailSubscribed = customers.filter(c => channelStatus(c, 'email') === 'Subscribed').length;
    const whatsappSubscribed = customers.filter(c => channelStatus(c, 'whatsapp') === 'Subscribed').length;
    const emailUnsubscribed = customers.filter(c => channelStatus(c, 'email') === 'Unsubscribed').length;
    const whatsappUnsubscribed = customers.filter(c => channelStatus(c, 'whatsapp') === 'Unsubscribed').length;

    const common = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom' } },
      scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
    };

    const newCtx = document.getElementById('customerNew7DayChart');
    if (newCtx) {
      customerCharts.newCustomers = new Chart(newCtx, {
        type: 'line',
        data: {
          labels: days.map(d => d.label),
          datasets: [{ label: 'New Customers', data: newCustomers, tension: 0.3, fill: true }]
        },
        options: common
      });
    }

    const subscribedCtx = document.getElementById('customerSubscribedChart');
    if (subscribedCtx) {
      customerCharts.subscribed = new Chart(subscribedCtx, {
        type: 'bar',
        data: {
          labels: ['Email', 'WhatsApp'],
          datasets: [{ label: 'Subscribed', data: [emailSubscribed, whatsappSubscribed] }]
        },
        options: common
      });
    }

    const unsubscribedCtx = document.getElementById('customerUnsubscribedChart');
    if (unsubscribedCtx) {
      customerCharts.unsubscribed = new Chart(unsubscribedCtx, {
        type: 'bar',
        data: {
          labels: ['Email', 'WhatsApp'],
          datasets: [{ label: 'Unsubscribed', data: [emailUnsubscribed, whatsappUnsubscribed] }]
        },
        options: common
      });
    }
  }

  function render() {
    const body = document.getElementById('customersViewBody');
    if (!body) return;

    // Preserve the user's position while the shared customer snapshot updates.
    // A realtime listener should add/update rows without throwing the user back to row 1.
    const existingTable = body.querySelector('.customers-table-scroll');
    const savedTableScrollTop = existingTable ? (existingTable.scrollTop ?? 0) : 0;
    const savedPageScrollTop = getCustomersPageScrollTop();

    const customers = getCustomers();
    const q = search.trim().toLowerCase();
    const filtered = customers.filter(c =>
      `${c.name||''} ${c.email||''} ${c.phone||''} ${c.company||''} ${c.source||''}`.toLowerCase().includes(q)
    );

    const whatsappSubscribed = customers.filter(c => channelStatus(c, 'whatsapp') === 'Subscribed').length;
    const emailSubscribed = customers.filter(c => channelStatus(c, 'email') === 'Subscribed').length;

    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <div>
          <h1 class="page-title"><i class="bi bi-people me-2"></i>Customers</h1>
          <p class="page-subtitle">One customer directory for Email Marketing and WhatsApp Marketing.</p>
        </div>
        <div class="d-flex gap-2 align-items-center">
          <input id="customersSearch" class="form-control" style="min-width:260px" placeholder="Search customers..." value="${esc(search)}">
          ${isAdmin() ? `<button class="btn btn-outline-secondary" onclick="window.MarketingChannels.syncExistingLeads()"><i class="bi bi-arrow-repeat me-1"></i>Sync Existing Leads</button>` : ''}
          ${isActive() ? `<button class="btn btn-brand" onclick="window.MarketingChannels.openContactModal('email')"><i class="bi bi-person-plus me-1"></i>Add Customer</button>` : ''}
        </div>
      </div>
      <div class="row g-2 mb-3">
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>Total Customers</span><strong>${customers.length}</strong></div></div>
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>WhatsApp Subscribed</span><strong>${whatsappSubscribed}</strong></div></div>
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>Email Subscribed</span><strong>${emailSubscribed}</strong></div></div>
        <div class="col-6 col-lg-3"><div class="marketing-stat"><span>Manual Customers</span><strong>${customers.filter(c=>c.source!=='lead').length}</strong></div></div>
      </div>
      <div class="marketing-card customer-analytics-card mb-3">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div>
            <div class="marketing-card-title">Customer Analytics</div>
            <div class="small text-muted">Last 7 days · Based only on the customers already loaded in the CRM · No date selection</div>
          </div>
        </div>
        <div id="customerAnalyticsCharts" class="customer-analytics-grid">
          <div class="customer-chart-panel"><div class="customer-chart-title">New Customers · Last 7 Days</div><div class="customer-chart-wrap"><canvas id="customerNew7DayChart"></canvas></div></div>
          <div class="customer-chart-panel"><div class="customer-chart-title">Subscribed Customers</div><div class="customer-chart-wrap"><canvas id="customerSubscribedChart"></canvas></div></div>
          <div class="customer-chart-panel"><div class="customer-chart-title">Unsubscribed Customers</div><div class="customer-chart-wrap"><canvas id="customerUnsubscribedChart"></canvas></div></div>
        </div>
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

    requestAnimationFrame(() => {
      renderCustomerCharts(customers);
      const table = document.querySelector('.customers-table-scroll');
      if (table) table.scrollTop = savedTableScrollTop;
      setCustomersPageScrollTop(savedPageScrollTop);
    });

    document.getElementById('customersSearch')?.addEventListener('input', e => {
      search = e.target.value;
      render();
      const input = document.getElementById('customersSearch');
      if (input) { input.focus(); input.setSelectionRange(search.length, search.length); }
    });
  }

  function statusCell(c, channel) {
    const status = channelStatus(c, channel);
    const label = channel === 'email' ? 'Email' : 'WhatsApp';
    if (!status) return `<span class="badge bg-light text-secondary">No ${label === 'Email' ? 'email' : 'WhatsApp number'}</span>`;
    return `<select class="form-select form-select-sm customer-status-select ${status==='Unsubscribed'?'border-danger':''}" onchange="window.Customers.setStatus('${esc(c.id)}','${channel}',this.value)">
      <option value="Subscribed" ${status==='Subscribed'?'selected':''}>Subscribed</option>
      <option value="Unsubscribed" ${status==='Unsubscribed'?'selected':''}>Unsubscribed</option>
    </select>`;
  }

  function customerRow(c, index) {
    const source = c.source === 'lead' ? 'Lead' : 'Manual';
    const addedBy = c.createdByName || c.updatedByName || c.addedByName || '—';
    return `<tr>
      <td>${index}</td>
      <td><strong>${esc(c.name || '—')}</strong></td>
      <td>${esc(c.email || '—')}</td>
      <td>${esc(c.phone || '—')}</td>
      <td>${esc(c.company || '—')}</td>
      <td>${statusCell(c, 'whatsapp')}</td>
      <td>${statusCell(c, 'email')}</td>
      <td><span class="badge bg-light text-dark">${esc(source)}</span></td>
      <td><div class="d-flex gap-1">${isAdmin()?`<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openContactModal('email','${esc(c.id)}')">Edit</button>`:''}${isAdmin()?`<button class="btn btn-sm btn-outline-danger" onclick="window.Customers.delete('${esc(c.id)}')">Delete</button>`:''}</div></td>
      <td>${esc(addedBy)}</td>
    </tr>`;
  }

  async function init() {
    if (!isActive()) return;
    if (!unsubscribeStore && window.MarketingChannels?.onContactsChange) {
      unsubscribeStore = window.MarketingChannels.onContactsChange(() => render());
    }
    await window.MarketingChannels?.ensureContactsLoaded?.();
    render();
  }

  async function setStatus(id, channel, value) {
    if (!isActive()) return;
    const customers = getCustomers();
    const c = customers.find(x => x.id === id);
    if (!c) return;
    if ((channel === 'email' && !hasEmail(c)) || (channel === 'whatsapp' && !hasWhatsApp(c))) return;
    await window.MarketingChannels?.setContactStatus?.(id, channel, value);
  }

  async function remove(id) {
    if (!isAdmin() || !confirm('Delete this customer? This cannot be undone.')) return;
    await window.MarketingChannels?.deleteContact?.(id);
  }

  window.Customers = { init, render, setStatus, delete: remove, getCustomers, isLoaded: () => getCustomers().length > 0 };
})();
