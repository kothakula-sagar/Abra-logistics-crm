/**
 * dashboard.js - Dashboard stats and recent activity
 */

import { FB } from './firebase.js';
import { getUser } from './auth.js';
import { safeStr, escapeHtml, formatDate } from './utils.js';
import { loadProductsCatalog, loadMetaCatalogData } from './marketing.js';
import { normalizeProductName, normalizeModelNumber } from './product-model.js';

export async function loadStats() {
  const user = getUser();
  if (!user) return;

  const totalStart = performance.now();
  _renderLoadingState();

  try {
    const [products, metaData, seoHistory] = await Promise.all([
      _loadProducts(),
      _loadMetaData(),
      _fetchSeoHistory()
    ]);

    const calcStart = performance.now();
    const dashboardData = _calculateDashboardData(products, metaData, seoHistory);
    console.log(`[PERF] Dashboard Calculations: ${(performance.now() - calcStart).toFixed(2)}ms`);
    _renderDashboard(dashboardData);
    _updateHistoryBadge(products.length);
    console.log(`[PERF] Dashboard Total: ${(performance.now() - totalStart).toFixed(2)}ms`);
  } catch (e) {
    console.warn('[Dashboard] loadStats error:', e.message);
    _renderDashboardError();
  }
}

async function _loadProducts() {
  const start = performance.now();
  const products = await loadProductsCatalog();
  console.log(`[PERF] Dashboard Products Data: ${(performance.now() - start).toFixed(2)}ms`);
  return products || [];
}

async function _loadMetaData() {
  const start = performance.now();
  try {
    const data = await loadMetaCatalogData();
    console.log(`[PERF] Dashboard Campaign Data: ${(performance.now() - start).toFixed(2)}ms`);
    console.log(`[PERF] Dashboard Meta Data: ${(performance.now() - start).toFixed(2)}ms`);
    return data;
  } catch (error) {
    console.warn('[Dashboard] Meta data unavailable:', error.message);
    return { campaigns: [], campaignItems: [], metaItems: [] };
  }
}

async function _fetchSeoHistory() {
  try {
    const snap = await FB.getDocs(FB.col('SEO_History'));
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    console.warn('[Dashboard] SEO history unavailable:', error.message);
    return [];
  }
}

function _calculateDashboardData(products, metaData, seoHistory) {
  const campaigns = metaData?.campaigns || [];
  const campaignItems = metaData?.campaignItems || [];
  const metaItems = metaData?.metaItems || [];
  const productsById = new Map(products.map(product => [product.id, product]));
  const historyByProduct = new Map();

  seoHistory.forEach(history => {
    if (!history.productId) return;
    const current = historyByProduct.get(history.productId);
    if (!current || _timestamp(history.generatedAt) > _timestamp(current.generatedAt)) {
      historyByProduct.set(history.productId, history);
    }
  });

  const seoGeneratedIds = new Set(
    products.filter(product => String(product.generationStatus || '').toLowerCase() === 'completed').map(product => product.id)
  );
  seoHistory.forEach(history => {
    if (history.productId && history.seoChecklist) seoGeneratedIds.add(history.productId);
  });
  const seoGeneratedCount = products.filter(product => seoGeneratedIds.has(product.id)).length;

  const duplicateNameCounts = new Map();
  products.forEach(product => {
    const name = normalizeProductName(product.productName);
    if (name) duplicateNameCounts.set(name, (duplicateNameCounts.get(name) || 0) + 1);
  });
  const duplicateNames = new Set([...duplicateNameCounts].filter(([, count]) => count > 1).map(([name]) => name));

  const missingDescription = products.filter(product => {
    const productDescription = product.productDescription || product.product_description || product.description;
    const historyDescription = historyByProduct.get(product.id)?.seoChecklist?.productDescription;
    return !safeStr(productDescription || historyDescription).trim();
  }).length;
  const missingUrl = products.filter(product => {
    const urlSource = product.productUrl || product.product_url || product.url || product.seoUrl || product.seo_url || product.seo_slug || product.seoSlug || product.slug || product.productName;
    return !safeStr(urlSource).trim();
  }).length;

  const metaByItemId = new Map(metaItems.map(entry => [entry.campaignItemId || entry.id, entry]));
  const completedItems = campaignItems.filter(item => String(item.status || '').toLowerCase() === 'completed');
  const metaPendingItems = completedItems.filter(item => String(metaByItemId.get(item.id)?.metaStatus || 'pending').toLowerCase() !== 'added');
  const metaAddedItems = completedItems.filter(item => String(metaByItemId.get(item.id)?.metaStatus || 'pending').toLowerCase() === 'added');

  const campaignProgress = campaigns.slice(0, 5).map(campaign => {
    const items = campaignItems.filter(item => item.campaignId === campaign.id);
    const completed = items.filter(item => String(item.status || '').toLowerCase() === 'completed');
    const added = completed.filter(item => String(metaByItemId.get(item.id)?.metaStatus || 'pending').toLowerCase() === 'added').length;
    return {
      ...campaign,
      total: items.length,
      pending: items.filter(item => item.status === 'pending').length,
      generating: items.filter(item => item.status === 'generating').length,
      completed: completed.length,
      metaPending: completed.length - added,
      metaAdded: added,
      creativePercent: items.length ? Math.round((completed.length / items.length) * 100) : 0,
      metaPercent: completed.length ? Math.round((added / completed.length) * 100) : 0
    };
  });

  const activities = [
    ...products.flatMap(product => [
      product.createdAt ? { icon: '📦', title: `${product.productName || 'Product'} — Product created`, date: product.createdAt, by: product.createdByName || product.createdByEmail } : null,
      product.updatedAt && product.updatedAt !== product.createdAt ? { icon: '✏️', title: `${product.productName || 'Product'} — Product updated`, date: product.updatedAt, by: product.updatedByName } : null
    ]),
    ...campaigns.map(campaign => campaign.createdAt ? { icon: '🛍️', title: `${campaign.saleName || 'Campaign'} — Campaign created`, date: campaign.createdAt, by: campaign.createdByName } : null),
    ...completedItems.map(item => item.completedAt ? { icon: '🖼️', title: `${item.productName || 'Product'} — Creative completed`, date: item.completedAt } : null),
    ...metaAddedItems.map(item => metaByItemId.get(item.id)?.updatedAt ? { icon: '📘', title: `${item.productName || 'Product'} — Added to Meta Catalog`, date: metaByItemId.get(item.id).updatedAt } : null),
    ...seoHistory.filter(history => productsById.has(history.productId)).map(history => history.generatedAt ? { icon: '✨', title: `${productsById.get(history.productId).productName || 'Product'} — SEO generated`, date: history.generatedAt } : null)
  ].filter(Boolean).sort((a, b) => _timestamp(b.date) - _timestamp(a.date)).slice(0, 8);

  return {
    kpis: [
      { icon: '📦', label: 'Total Products', value: products.length, sub: 'Master products' },
      { icon: '✨', label: 'SEO Generated', value: seoGeneratedCount, sub: `${Math.max(products.length - seoGeneratedCount, 0)} remaining` },
      { icon: '🛍️', label: 'Sale Campaigns', value: campaigns.length, sub: 'Active campaigns' },
      { icon: '🖼️', label: 'Campaign Creatives', value: completedItems.length, sub: 'Completed' },
      { icon: '🟠', label: 'Meta Pending', value: metaPendingItems.length, sub: 'Waiting to be added' },
      { icon: '✅', label: 'Meta Added', value: metaAddedItems.length, sub: 'Added to catalog' }
    ],
    attention: [
      { icon: '🔢', label: 'Missing Model Number', value: products.filter(product => !normalizeModelNumber(product.modelNumber)).length, action: "window.App.go('products')" },
      { icon: '📝', label: 'Missing Description', value: missingDescription, action: "window.App.go('products')" },
      { icon: '🔗', label: 'Missing Product URL', value: missingUrl, action: "window.App.go('products')" },
      { icon: '♻️', label: 'Duplicate Product Names', value: products.filter(product => duplicateNames.has(normalizeProductName(product.productName))).length, action: "window.App.go('products')" },
      { icon: '✨', label: 'SEO Not Generated', value: Math.max(products.length - seoGeneratedCount, 0), action: "window.App.go('products')" },
      { icon: '📘', label: 'Meta Catalog Pending', value: metaPendingItems.length, action: "window.App.go('meta-catalog')" }
    ],
    readiness: { added: metaAddedItems.length, total: completedItems.length, pending: metaPendingItems.length },
    campaignProgress,
    activities
  };
}

function _renderLoadingState() {
  const grid = document.getElementById('dash-stats');
  if (!grid) return;
  grid.innerHTML = Array.from({ length: 6 }, () => `
    <div class="stat-card dashboard-skeleton"><div></div><div></div><div></div></div>`).join('');
}

function _renderDashboard(data) {
  const renderStart = performance.now();
  const grid = document.getElementById('dash-stats');
  if (grid) grid.innerHTML = data.kpis.map(s => `
    <div class="stat-card fade-in">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-label">${s.label}</div>
      <div class="stat-val">${s.value}</div>
      <div class="stat-sub">${escapeHtml(s.sub)}</div>
    </div>`).join('');

  const attention = document.getElementById('dashboard-attention-list');
  if (attention) attention.innerHTML = data.attention.map(item => `<button class="attention-item" type="button" onclick="${item.action}"><span><b>${item.icon}</b>${escapeHtml(item.label)}</span><strong>${item.value}</strong></button>`).join('');

  const readiness = document.getElementById('meta-readiness-content');
  if (readiness) {
    const percent = data.readiness.total ? Math.round((data.readiness.added / data.readiness.total) * 100) : 0;
    readiness.innerHTML = data.readiness.total ? `<div class="readiness-count">${data.readiness.added} <span>/ ${data.readiness.total} Added</span></div><div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div><div class="readiness-percent">${percent}% Complete</div><div class="readiness-meta"><span>${data.readiness.pending} Pending</span><span>${data.readiness.added} Added</span></div>` : '<p class="empty-msg">No catalog products yet.</p>';
  }

  const campaigns = document.getElementById('dashboard-campaign-progress');
  if (campaigns) campaigns.innerHTML = data.campaignProgress.length ? data.campaignProgress.map(campaign => `<article class="campaign-progress-item"><div class="campaign-progress-head"><div><h3>${escapeHtml(campaign.saleName || 'Campaign')}</h3><span>${campaign.total} Products · ${campaign.completed} Completed</span></div><button class="btn btn-outline btn-sm" onclick="window.App.go('campaigns')">Open Campaign</button></div><div class="campaign-progress-stats"><span>${campaign.pending} Pending</span><span>${campaign.generating} Generating</span><span>${campaign.metaPending} Meta Pending</span><span>${campaign.metaAdded} Meta Added</span></div><div class="campaign-progress-line"><span>Creative Generation</span><b>${campaign.creativePercent}%</b><div class="progress-track"><div class="progress-fill" style="width:${campaign.creativePercent}%"></div></div></div><div class="campaign-progress-line"><span>Meta Catalog</span><b>${campaign.metaPercent}%</b><div class="progress-track"><div class="progress-fill meta-progress-fill" style="width:${campaign.metaPercent}%"></div></div></div></article>`).join('') : '<p class="empty-msg">No sale campaigns yet.</p>';

  const recent = document.getElementById('recent-list');
  if (recent) recent.innerHTML = data.activities.length ? data.activities.map(activity => `<div class="recent-item"><div class="recent-thumb">${activity.icon}</div><div class="recent-info"><div class="recent-name">${escapeHtml(activity.title)}</div><div class="recent-date">${escapeHtml(activity.by || '')}${activity.by ? ' · ' : ''}${escapeHtml(formatDate(activity.date))}</div></div></div>`).join('') : '<p class="empty-msg">No recent activity yet.</p>';
  console.log(`[PERF] Dashboard Render: ${(performance.now() - renderStart).toFixed(2)}ms`);
}

function _updateHistoryBadge(count) {
  const badge = document.getElementById('history-badge');
  if (badge) badge.textContent = count;
}

function _renderDashboardError() {
  const grid = document.getElementById('dash-stats');
  if (grid) grid.innerHTML = '<div class="dashboard-error">Dashboard data is temporarily unavailable. Please try again.</div>';
}

function _timestamp(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (value?.toDate) return value.toDate().getTime();
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

async function _fetchProducts() {
  try {
    const snap = await FB.getDocs(FB.col('products'));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
  } catch { return []; }
}

