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
    const dayLabels = days.map(d => d.label);
    const newCustomers = days.map(day => customers.filter(c => dayKey(c.createdAt) === day.key).length);

    const emailSubscribed = customers.filter(c => channelStatus(c, 'email') === 'Subscribed').length;
    const whatsappSubscribed = customers.filter(c => channelStatus(c, 'whatsapp') === 'Subscribed').length;
    const bothSubscribed = customers.filter(c =>
      channelStatus(c, 'email') === 'Subscribed' && channelStatus(c, 'whatsapp') === 'Subscribed'
    ).length;
    const emailOnly = customers.filter(c =>
      channelStatus(c, 'email') === 'Subscribed' && channelStatus(c, 'whatsapp') !== 'Subscribed'
    ).length;
    const whatsappOnly = customers.filter(c =>
      channelStatus(c, 'whatsapp') === 'Subscribed' && channelStatus(c, 'email') !== 'Subscribed'
    ).length;
    const unsubscribed = customers.filter(c =>
      channelStatus(c, 'email') === 'Unsubscribed' && channelStatus(c, 'whatsapp') === 'Unsubscribed'
    ).length;

    const newByDay = days.map(day => customers.filter(c => dayKey(c.createdAt) === day.key));
    const dailyWhatsApp = newByDay.map(list => list.filter(c => channelStatus(c, 'whatsapp') === 'Subscribed').length);
    const dailyEmail = newByDay.map(list => list.filter(c => channelStatus(c, 'email') === 'Subscribed').length);
    const dailyBoth = newByDay.map(list => list.filter(c =>
      channelStatus(c, 'email') === 'Subscribed' && channelStatus(c, 'whatsapp') === 'Subscribed'
    ).length);
    const dailyUnsubscribed = newByDay.map(list => list.filter(c =>
      channelStatus(c, 'email') === 'Unsubscribed' && channelStatus(c, 'whatsapp') === 'Unsubscribed'
    ).length);

    const commonScale = {
      x: { grid: { display: false }, ticks: { color: '#64748b', font: { size: 10 } } },
      y: { beginAtZero: true, grid: { color: 'rgba(148,163,184,.16)' }, ticks: { precision: 0, color: '#64748b', font: { size: 10 } } }
    };

    const lineOptions = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: { legend: { display: false }, tooltip: { displayColors: false } },
      scales: commonScale
    };

    const barOptions = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { displayColors: false } },
      scales: commonScale
    };

    const newCtx = document.getElementById('customerNew7DayChart');
    if (newCtx) {
      customerCharts.newCustomers = new Chart(newCtx, {
        type: 'line',
        data: {
          labels: dayLabels,
          datasets: [{
            label: 'New Customers',
            data: newCustomers,
            borderColor: '#1769e0',
            backgroundColor: 'rgba(37, 99, 235, .13)',
            pointBackgroundColor: '#1769e0',
            pointBorderColor: '#1769e0',
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            tension: .35,
            fill: true
          }]
        },
        options: lineOptions
      });
    }

    const subscribedCtx = document.getElementById('customerSubscribedChart');
    if (subscribedCtx) {
      customerCharts.subscribed = new Chart(subscribedCtx, {
        type: 'doughnut',
        data: {
          labels: ['WhatsApp Only', 'Email Only', 'Both Subscribed', 'Unsubscribed'],
          datasets: [{
            data: [whatsappOnly, emailOnly, bothSubscribed, unsubscribed],
            backgroundColor: ['#43bf72', '#4f8fe8', '#f39a22', '#e53935'],
            borderWidth: 0,
            hoverOffset: 4
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '58%',
          plugins: {
            legend: {
              position: 'right',
              labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 7, padding: 14, color: '#475569', font: { size: 11 } }
            },
            tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.raw}` } }
          }
        }
      });
    }

    const unsubscribedCtx = document.getElementById('customerUnsubscribedChart');
    if (unsubscribedCtx) {
      customerCharts.unsubscribed = new Chart(unsubscribedCtx, {
        type: 'line',
        data: {
          labels: dayLabels,
          datasets: [{
            label: 'Unsubscribed',
            data: dailyUnsubscribed,
            borderColor: '#e53935',
            backgroundColor: 'rgba(239, 68, 68, .12)',
            pointBackgroundColor: '#e53935',
            pointBorderColor: '#e53935',
            pointRadius: 4,
            pointHoverRadius: 5,
            borderWidth: 2.5,
            tension: .35,
            fill: true
          }]
        },
        options: lineOptions
      });
    }

    const trendCanvasIds = [
      ['customerWhatsappTrendChart', dailyWhatsApp, '#43bf72'],
      ['customerEmailTrendChart', dailyEmail, '#4f8fe8'],
      ['customerBothTrendChart', dailyBoth, '#f39a22'],
      ['customerUnsubTrendChart', dailyUnsubscribed, '#e53935']
    ];
    trendCanvasIds.forEach(([id, data, color]) => {
      const canvas = document.getElementById(id);
      if (!canvas) return;
      const key = id.replace('customer', '').replace('TrendChart', '');
      customerCharts[key] = new Chart(canvas, {
        type: 'bar',
        data: {
          labels: dayLabels,
          datasets: [{
            data,
            backgroundColor: color,
            borderRadius: 2,
            borderSkipped: false,
            barPercentage: .55,
            categoryPercentage: .72
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { displayColors: false } },
          scales: commonScale
        }
      });
    });
  }

  function customerMetricTrend(customers, selector) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentStart = new Date(today);
    currentStart.setDate(today.getDate() - 6);
    const previousStart = new Date(today);
    previousStart.setDate(today.getDate() - 13);

    const current = customers.filter(c => {
      const d = toDate(c.createdAt);
      return d && d >= currentStart && d <= new Date(today.getTime() + 86400000 - 1);
    }).filter(selector).length;

    const previous = customers.filter(c => {
      const d = toDate(c.createdAt);
      return d && d >= previousStart && d < currentStart;
    }).filter(selector).length;

    const pct = previous ? ((current - previous) / previous) * 100 : (current ? 100 : 0);
    return { current, previous, pct };
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
    const days = lastSevenDays();
    const newCustomers = days.map(day => customers.filter(c => dayKey(c.createdAt) === day.key).length);
    const newByDay = days.map(day => customers.filter(c => dayKey(c.createdAt) === day.key));
    const dailyUnsubscribed = newByDay.map(list => list.filter(c =>
      channelStatus(c, 'email') === 'Unsubscribed' && channelStatus(c, 'whatsapp') === 'Unsubscribed'
    ).length);

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
      <div class="row g-2 mb-3 customer-kpi-grid">
        <div class="col-6 col-lg-3">
          <div class="marketing-stat customer-kpi">
            <div><span>Total Customers</span><strong>${customers.length}</strong><small>All customers in database</small></div>
            <div class="customer-kpi-icon blue"><i class="bi bi-people-fill"></i></div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="marketing-stat customer-kpi">
            <div><span>WhatsApp Subscribed</span><strong class="green">${whatsappSubscribed}</strong><small>${customers.length ? ((whatsappSubscribed / customers.length) * 100).toFixed(1) : '0.0'}% of total customers</small></div>
            <div class="customer-kpi-icon green"><i class="bi bi-whatsapp"></i></div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="marketing-stat customer-kpi">
            <div><span>Email Subscribed</span><strong>${emailSubscribed}</strong><small>${customers.length ? ((emailSubscribed / customers.length) * 100).toFixed(1) : '0.0'}% of total customers</small></div>
            <div class="customer-kpi-icon blue"><i class="bi bi-envelope-fill"></i></div>
          </div>
        </div>
        <div class="col-6 col-lg-3">
          <div class="marketing-stat customer-kpi">
            <div><span>Manual Customers</span><strong class="purple">${customers.filter(c=>c.source!=='lead').length}</strong><small>Added manually</small></div>
            <div class="customer-kpi-icon purple"><i class="bi bi-person-plus-fill"></i></div>
          </div>
        </div>
      </div>

      <div class="row g-2 mb-3 customer-top-analytics">
        <div class="col-lg-4">
          <div class="marketing-card customer-analytics-card customer-top-chart">
            <div class="marketing-card-title">New Customers (Last 7 Days)</div>
            <div class="small text-muted">Daily new customers added</div>
            <div class="customer-chart-wrap customer-main-chart"><canvas id="customerNew7DayChart"></canvas></div>
            <div class="customer-chart-total"><span>Total New Customers (7 Days)</span><strong>${newCustomers.reduce((a,b)=>a+b,0)}</strong><span class="customer-trend-badge">↑</span></div>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="marketing-card customer-analytics-card customer-top-chart">
            <div class="marketing-card-title">Subscription Overview</div>
            <div class="small text-muted">Subscription status distribution</div>
            <div class="customer-chart-wrap customer-donut-chart"><canvas id="customerSubscribedChart"></canvas></div>
          </div>
        </div>
        <div class="col-lg-4">
          <div class="marketing-card customer-analytics-card customer-top-chart">
            <div class="marketing-card-title">Unsubscribed Overview (7 Days)</div>
            <div class="small text-muted">Daily unsubscribed customers</div>
            <div class="customer-chart-wrap customer-main-chart"><canvas id="customerUnsubscribedChart"></canvas></div>
            <div class="customer-chart-total"><span>Total Unsubscribed (7 Days)</span><strong>${dailyUnsubscribed.reduce((a,b)=>a+b,0)}</strong><span class="customer-trend-badge red">↑</span></div>
          </div>
        </div>
      </div>

      <div class="marketing-card customer-subscription-trend mb-3">
        <div class="marketing-card-title">Subscription Trend (Last 7 Days)</div>
        <div class="small text-muted">Daily subscription and unsubscription trends</div>
        <div class="customer-trend-grid">
          <div><div class="customer-trend-title whatsapp">WhatsApp Subscribed</div><div class="customer-trend-wrap"><canvas id="customerWhatsappTrendChart"></canvas></div></div>
          <div><div class="customer-trend-title email">Email Subscribed</div><div class="customer-trend-wrap"><canvas id="customerEmailTrendChart"></canvas></div></div>
          <div><div class="customer-trend-title both">Both Subscribed</div><div class="customer-trend-wrap"><canvas id="customerBothTrendChart"></canvas></div></div>
          <div><div class="customer-trend-title unsub">Unsubscribed</div><div class="customer-trend-wrap"><canvas id="customerUnsubTrendChart"></canvas></div></div>
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
