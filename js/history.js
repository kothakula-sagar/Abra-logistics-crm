/**
 * history.js - SEO Generation Workflow Dashboard
 * Primary data source: Products collection
 * Shows all products with their current generation status
 */

import { FB } from './firebase.js';
import { getUser, isAdmin } from './auth.js';
import { safeStr, formatDate, escapeHtml } from './utils.js';
import { showToast, openModal, closeModal } from './ui.js';
import { setProductContext } from './seo-generator.js';
import { getResponsive, getThumbnail } from './cloudinary.js';

let _products = [];

// ── RENDER HISTORY LIST (NOW DRIVEN BY PRODUCTS COLLECTION) ───
export async function render() {
  const list = document.getElementById('history-list');
  if (!list) return;
  list.innerHTML = '<p class="empty-msg" style="text-align:center;padding:2rem">Loading generation history...</p>';

  const search = (document.getElementById('hist-search')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('hist-status')?.value || '';
  const languageFilter = document.getElementById('hist-lang')?.value || '';

  let products = await _fetchAllProducts();

  if (search) {
    products = products.filter(p =>
      safeStr(p.productName).toLowerCase().includes(search) ||
      safeStr(p.category).toLowerCase().includes(search) ||
      safeStr(p._seoHistory?.map(seo => _languageName(seo.language)).join(' ')).toLowerCase().includes(search)
    );
  }

  if (statusFilter) {
    products = products.filter(p => (p.generationStatus || 'Pending') === statusFilter);
  }

  if (languageFilter) {
    products = products.filter(p => (p._seoHistory || []).some(seo => seo.language === languageFilter));
  }

  _products = products;

  if (!products.length) {
    list.innerHTML = `<div style="text-align:center;padding:3rem">
      <p style="color:var(--text3);font-size:.875rem">${search || statusFilter ? 'No products match your filters.' : 'No generation history yet. Create your first SEO product to get started.'}</p>
    </div>`;
    return;
  }

  list.innerHTML = products.map((p, i) => {
    const directSeoStatus = (_hasDirectSeoContent(p) || _getProductHistoryVersions(p).length) ? 'Completed' : 'Pending';
    const status = p.generationStatus || directSeoStatus;
    const statusColors = {
      'Pending': { bg: '#fff7ed', color: '#ea580c', icon: '⏳' },
      'Generating': { bg: '#eff6ff', color: '#2563eb', icon: '🔄' },
      'Completed': { bg: '#f0fdf4', color: '#16a34a', icon: '✅' }
    };
    const statusStyle = statusColors[status] || statusColors['Pending'];
    const generations = _getProductHistoryVersions(p);

    const generationHtml = generations.length
      ? generations.map((seo, j) => {
          const metaTitle = seo.seoChecklist?.metaTitle || seo.metaTitle || 'SEO content generated';
          return `
            <div class="generation-item" onclick="event.stopPropagation();window.History.loadSeoVersion(${i}, '${seo.id}')">
              <div class="generation-item-top">
                <span class="generation-pill">${escapeHtml(_languageName(seo.language))}</span>
                <span class="generation-date">${formatDate(seo.generatedAt)}</span>
              </div>
              <div class="generation-title">${escapeHtml(metaTitle)}</div>
              <div class="generation-meta">${escapeHtml(seo.aiModel || 'Unknown model')} · ${escapeHtml(seo.generatedBy || 'Unknown user')}</div>
            </div>`;
        }).join('')
      : '<div class="generation-item empty-generation">No SEO generations available yet.</div>';

    return `
      <div class="history-card" onclick="window.History.open(${i})">
        <div class="history-card-head">
          <div class="history-thumb">
            ${getProductImageHtml(p)}
          </div>
          <div class="history-card-info">
            <div class="history-card-title-row">
              <h4>${escapeHtml(p.productName || 'Untitled Product')}</h4>
              <span class="status-badge" style="background:${statusStyle.bg};color:${statusStyle.color}">
                ${statusStyle.icon} ${status}
              </span>
            </div>
            <div class="history-card-meta">
              <span>${generations.length} SEO version${generations.length === 1 ? '' : 's'}</span>
            </div>
          </div>
        </div>
      </div>`;
  }).join('');
}

/**
 * Get image HTML for product with fallback handling
 */
function getProductImageHtml(product) {
  if (product.imageUrl) {
    return `<img src="${getThumbnail(product.imageUrl, 60)}" alt="${escapeHtml(product.productName || 'Product')}" loading="lazy" onerror="this.parentElement.innerHTML='📦'"/>`;
  }
  return '📦';
}

/**
 * Get image HTML for detail modal
 */
function getProductImageForDetail(product) {
  if (product.imageUrl) {
    return `<img src="${getResponsive(product.imageUrl, 200)}" style="max-height:110px;border-radius:10px;margin-bottom:1rem" loading="lazy"/>`;
  }
  return '';
}

function _hasDirectSeoContent(product) {
  return Boolean(
    product.meta_title ||
    product.meta_description ||
    product.seo_slug ||
    (product.focus_keywords && product.focus_keywords.length) ||
    product.product_description
  );
}

function _getProductHistoryVersions(product) {
  const existingHistory = Array.isArray(product._seoHistory) ? product._seoHistory.slice() : [];
  if (existingHistory.length) return existingHistory;

  if (!_hasDirectSeoContent(product)) return [];

  return [{
    id: `product_${product.id}`,
    language: product.lang || 'en',
    generatedAt: product.updatedAt || product.createdAt || product.timestamp || Date.now(),
    aiModel: product.aiModel || 'Firebase',
    generatedBy: product.createdBy || product.uid || 'Unknown user',
    seoChecklist: {
      metaTitle: safeStr(product.meta_title),
      metaDescription: safeStr(product.meta_description),
      focusKeywords: Array.isArray(product.focus_keywords) ? product.focus_keywords : [],
      productDescription: safeStr(product.product_description),
      seoSlug: safeStr(product.seo_slug),
      productTags: Array.isArray(product.product_tags) ? product.product_tags : [],
      socialMedia: product.socialMedia || product.social_media || {}
    },
    meta_title: safeStr(product.meta_title),
    meta_description: safeStr(product.meta_description),
    seo_slug: safeStr(product.seo_slug),
    focus_keywords: Array.isArray(product.focus_keywords) ? product.focus_keywords : [],
    product_description: safeStr(product.product_description),
    product_tags: Array.isArray(product.product_tags) ? product.product_tags : []
  }];
}

// ── OPEN PRODUCT DETAIL MODAL ─────────────────────────────────
export async function open(idx) {
  const cachedProduct = _products[idx];
  if (!cachedProduct) return;

  // Always resolve the Product again so the popup reflects the latest catalog
  // data rather than the list's cached snapshot.
  const productDoc = await FB.getDoc(FB.docRef('products', cachedProduct.id));
  const product = productDoc.exists()
    ? { id: productDoc.id, ...productDoc.data() }
    : cachedProduct;

  // Fetch SEO history for this product
  const language = document.getElementById('hist-lang')?.value || '';
  const seoHistory = await _fetchSeoHistoryForProduct(product.id, language);
  const historyVersions = seoHistory.length ? seoHistory : _getProductHistoryVersions(product);
  
  const status = product.generationStatus || (_hasDirectSeoContent(product) || historyVersions.length ? 'Completed' : 'Pending');
  const statusColors = {
    'Pending': { bg: '#fff7ed', color: '#ea580c', icon: '⏳' },
    'Generating': { bg: '#eff6ff', color: '#2563eb', icon: '🔄' },
    'Completed': { bg: '#f0fdf4', color: '#16a34a', icon: '✅' }
  };
  const statusStyle = statusColors[status] || statusColors['Pending'];

  document.getElementById('hm-title').textContent = product.productName || 'Untitled Product';

  const seoHistoryHtml = historyVersions.length > 0 ? `
    <div class="history-modal-section" style="margin-top:1rem">
      <div class="history-modal-section-title">Generation History (${historyVersions.length})</div>
      ${historyVersions.map((seo, i) => `
        <div class="version-item" onclick="window.History.loadSeoVersion(${idx}, '${seo.id}')">
          <div class="version-head">
            <span class="version-num">${escapeHtml(_languageName(seo.language))} • Generation ${i + 1}</span>
            <span class="version-date">${formatDate(seo.generatedAt)}</span>
          </div>
          <div class="version-title">${escapeHtml(seo.seoChecklist?.metaTitle || 'SEO content generated')}</div>
          <div class="version-date" style="margin-top:.25rem">${escapeHtml(seo.aiModel || 'Unknown model')} · ${escapeHtml(seo.generatedBy || 'Unknown user')}</div>
        </div>
      `).join('')}
    </div>` : `
    <div style="margin-top:1rem;padding:1rem;background:var(--surface2);border-radius:8px;text-align:center">
      <p style="color:var(--text3);font-size:.875rem;margin:0">No SEO content generated yet</p>
    </div>`;

  document.getElementById('hm-body').innerHTML = `
    ${getProductImageForDetail(product)}
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:1rem;align-items:center">
      <span class="status-badge" style="background:${statusStyle.bg};color:${statusStyle.color};padding:4px 12px;border-radius:99px;font-size:.75rem;font-weight:600">
        ${statusStyle.icon} ${status}
      </span>
      ${product.category ? `<span style="background:var(--surface2);color:var(--text2);padding:4px 12px;border-radius:99px;font-size:.72rem">${escapeHtml(product.category)}</span>` : ''}
      <span style="background:var(--surface2);color:var(--text2);padding:4px 12px;border-radius:99px;font-size:.72rem">₹${product.sellingPrice || 0}</span>
      ${product.discount ? `<span style="background:var(--green-bg);color:var(--green);padding:4px 12px;border-radius:99px;font-size:.72rem;font-weight:700">${Math.round(Number(product.discount || 0))}% OFF</span>` : ''}
    </div>
    
    <div class="product-details" style="margin-bottom:1rem">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem">
        <div>
          <label style="font-size:.75rem;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:.25rem;display:block">MRP</label>
          <div style="font-size:.9rem;color:var(--text1)">₹${product.mrp || 0}</div>
        </div>
        <div>
          <label style="font-size:.75rem;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:.25rem;display:block">You Save</label>
          <div style="font-size:.9rem;color:var(--green)">₹${product.youSave || 0}</div>
        </div>
      </div>
      <div>
        <label style="font-size:.75rem;font-weight:700;text-transform:uppercase;color:var(--text2);margin-bottom:.25rem;display:block">Created</label>
        <div style="font-size:.9rem;color:var(--text1)">${formatDate(product.createdAt)}</div>
      </div>
    </div>

    ${seoHistoryHtml}
    
    <div style="margin-top:1.25rem;display:flex;gap:.5rem;flex-wrap:wrap">
      ${status === 'Pending' ? `<button class="btn btn-accent btn-sm" onclick="window.History.startGeneration(${idx})">Generate SEO</button>` : ''}
      ${status === 'Generating' ? `<button class="btn btn-primary btn-sm" onclick="window.History.markCompleted(${idx})">Mark Complete</button>` : ''}
      ${status === 'Completed' ? `<button class="btn btn-accent btn-sm" onclick="window.History.regenerateSeo(${idx})">Regenerate SEO</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="window.History.editProduct(${idx})">Edit Product</button>
      ${isAdmin() ? `<button class="btn btn-danger btn-sm" onclick="window.History.deleteProduct(${idx})">Delete</button>` : ''}
      <button class="btn btn-outline btn-sm" onclick="window.UI.closeModal('hist-modal')">Close</button>
    </div>`;

  openModal('hist-modal');
}

// ── STATUS MANAGEMENT FUNCTIONS ───────────────────────────────
export async function startGeneration(idx) {
  const product = _products[idx];
  if (!product) return;

  try {
    // Update status to Generating
    await FB.updateDoc(FB.docRef('products', product.id), {
      generationStatus: 'Generating',
      updatedAt: FB.serverTimestamp()
    });

    // Update local cache
    _products[idx].generationStatus = 'Generating';

    showToast('Status updated to Generating');
    closeModal('hist-modal');
    
    // Navigate to SEO Generator with this product
    loadProductIntoGenerator(product);
    
    render(); // Refresh the list
  } catch (error) {
    console.error('Error updating generation status:', error);
    showToast('Failed to update status');
  }
}

export async function markCompleted(idx) {
  const product = _products[idx];
  if (!product) return;

  try {
    // Update status to Completed
    await FB.updateDoc(FB.docRef('products', product.id), {
      generationStatus: 'Completed',
      updatedAt: FB.serverTimestamp()
    });

    // Update local cache
    _products[idx].generationStatus = 'Completed';

    showToast('Status updated to Completed');
    closeModal('hist-modal');
    render(); // Refresh the list
  } catch (error) {
    console.error('Error updating generation status:', error);
    showToast('Failed to update status');
  }
}

export async function regenerateSeo(idx) {
  const product = _products[idx];
  if (!product) return;

  try {
    // Update status back to Generating for regeneration
    await FB.updateDoc(FB.docRef('products', product.id), {
      generationStatus: 'Generating',
      updatedAt: FB.serverTimestamp()
    });

    // Update local cache
    _products[idx].generationStatus = 'Generating';

    showToast('Ready for SEO regeneration');
    closeModal('hist-modal');
    
    // Navigate to SEO Generator with this product
    loadProductIntoGenerator(product);
    
    render(); // Refresh the list
  } catch (error) {
    console.error('Error updating generation status:', error);
    showToast('Failed to update status');
  }
}

export function editProduct(idx) {
  const product = _products[idx];
  if (!product) return;

  closeModal('hist-modal');
  
  // Navigate to Marketing module to edit the product
  window.App.go('marketing');
  
  // Trigger edit in Marketing module
  if (window.Marketing && window.Marketing.editProduct) {
    // Small delay to ensure Marketing module is loaded
    setTimeout(() => {
      window.Marketing.editProduct(product.id);
    }, 100);
  }
}

export async function deleteProduct(idx) {
  if (!isAdmin()) return;
  
  const product = _products[idx];
  if (!product) return;

  if (!confirm(`Delete "${product.productName}" and all its SEO history? This cannot be undone.`)) return;

  try {
    // Delete the product
    await FB.deleteDoc(FB.docRef('products', product.id));
    
    // Delete associated SEO history
    const seoHistory = await _fetchSeoHistoryForProduct(product.id);
    await Promise.all(seoHistory.map(seo => 
      FB.deleteDoc(FB.docRef('SEO_History', seo.id))
    ));

    closeModal('hist-modal');
    showToast('Product and SEO history deleted');
    render();
  } catch (error) {
    console.error('Error deleting product:', error);
    showToast('Delete failed: ' + error.message);
  }
}

export async function loadSeoVersion(productIdx, seoId) {
  const selectedProduct = _products[productIdx];
  if (!selectedProduct) return;

  try {
    const localVersions = _getProductHistoryVersions(selectedProduct);
    const localVersion = localVersions.find(v => v.id === seoId);
    if (localVersion) {
      renderSeoChecklist(selectedProduct, localVersion, productIdx);
      return;
    }

    const seoDoc = await FB.getDoc(FB.docRef('SEO_History', seoId));
    if (seoDoc.exists()) {
      const seoData = seoDoc.data();
      const productDoc = await FB.getDoc(FB.docRef('products', seoData.productId));
      const product = productDoc.exists()
        ? { id: productDoc.id, ...productDoc.data() }
        : selectedProduct;
      renderSeoChecklist(product, seoData, productIdx);
    }
  } catch (error) {
    console.error('Error loading SEO version:', error);
    showToast('Failed to load SEO version');
  }
}

function renderSeoChecklist(product, seoData, productIdx) {
  const checklist = seoData.seoChecklist || {};
  // Read the normalized schema, with compatibility fallbacks for documents
  // written before the field names were standardized.
  const social = checklist.socialMedia || checklist.socialMediaContent || {};
  const field = (label, value) => `
    <div style="margin-bottom:1rem">
      <label style="font-size:.72rem;font-weight:700;text-transform:uppercase;color:var(--text2);display:block;margin-bottom:.25rem">${label}</label>
      <div style="font-size:.875rem;color:var(--text1);white-space:pre-wrap;word-break:break-word">${escapeHtml(Array.isArray(value) ? value.join(', ') : value || '—')}</div>
    </div>`;

  document.getElementById('hm-title').textContent = `${product.productName || 'Product'} — SEO Version`;
  document.getElementById('hm-body').innerHTML = `
    <div style="margin-bottom:1rem;color:var(--text2);font-size:.8rem">
      ${escapeHtml(_languageName(seoData.language))} · Generated: ${formatDate(seoData.generatedAt)} · ${escapeHtml(seoData.aiModel || 'Unknown model')}
    </div>
    ${field('Meta Title', checklist.metaTitle)}
    ${field('Meta Description', checklist.metaDescription)}
    ${field('Focus Keywords', checklist.focusKeywords)}
    ${field('Product Description', checklist.productDescription)}
    ${field('SEO URL', checklist.seoSlug || checklist.seoUrlSlug)}
    ${field('Product Tags', checklist.productTags)}
    ${field('Instagram Caption', social.instagram)}
    ${field('Facebook Caption', social.facebook)}
    ${field('X (Twitter) Caption', social.twitter || social.xTwitter)}
    ${field('YouTube Description', social.youtube)}
    <div style="margin-top:1.25rem;display:flex;gap:.5rem">
      <button class="btn btn-outline btn-sm" onclick="window.History.open(${productIdx})">Back to SEO History</button>
      <button class="btn btn-outline btn-sm" onclick="window.UI.closeModal('hist-modal')">Close</button>
    </div>`;
  openModal('hist-modal');
}

function _languageName(language) {
  return ({ en: 'English', hi: 'Hindi', te: 'Telugu' })[language] || language || 'English';
}

// ── GENERATOR INTEGRATION ─────────────────────────────────────
function loadProductIntoGenerator(product) {
  // Set product values in SEO generator form
  const setVal = (id, val) => { 
    const el = document.getElementById(id); 
    if (el) el.value = val || ''; 
  };
  
  setVal('prod-name', product.productName);
  setVal('prod-cat', product.category);
  setVal('prod-lang', 'en'); // Default language
  setProductContext(product);
  
  // Navigate to generator
  window.App.go('generate');
  
  // Navigate to the Generate SEO page  
  window.App.go('generate');
}

// ── EXPORT FUNCTIONS ──────────────────────────────────────────
export async function exportJSON() {
  const [products, seoHistory, saleCampaigns] = await Promise.all([
    _fetchAllProducts(),
    _fetchAllSeoHistory(),
    _fetchAllSaleCampaigns()
  ]);
  const blob = new Blob(
    [JSON.stringify({
      exported: new Date().toISOString(),
      productsCount: products.length,
      seoHistoryCount: seoHistory.length,
      saleCampaignsCount: saleCampaigns.length,
      products,
      seo_history: seoHistory,
      sale_campaigns: saleCampaigns
    }, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `abrazylo-generation-history-${Date.now()}.json`;
  a.click();
}

// ── DATA FETCHING ─────────────────────────────────────────────
async function _fetchAllSeoHistory() {
  try {
    const snapshot = await FB.getDocs(FB.col('SEO_History'));
    return snapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => _dateValue(b.generatedAt) - _dateValue(a.generatedAt));
  } catch (error) {
    console.error('Error fetching SEO history:', error);
    return [];
  }
}

async function _fetchAllSaleCampaigns() {
  try {
    const collectionsToTry = ['Sale_Campaigns', 'sale_campaigns', 'campaigns'];
    for (const collectionName of collectionsToTry) {
      try {
        const snapshot = await FB.getDocs(FB.col(collectionName));
        return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      } catch (error) {
        // Try the next collection name if present.
      }
    }
  } catch (error) {
    console.error('Error fetching sale campaigns:', error);
  }
  return [];
}

async function _fetchAllProducts() {
  try {
    // Products is the only source for product fields. SEO_History is loaded
    // separately and attached only as an in-memory display index.
    const [snapshot, historySnapshot] = await Promise.all([
      FB.getDocs(FB.col('products')),
      FB.getDocs(FB.col('SEO_History'))
    ]);

    const products = [];
    const productIds = new Set();

    snapshot.forEach(doc => {
      const product = { id: doc.id, ...doc.data() };
      products.push(product);
      productIds.add(product.id);
    });

    const historyByProduct = new Map();
    historySnapshot.forEach(doc => {
      const seo = { id: doc.id, ...doc.data() };
      const candidateIds = [];

      if (seo.productId) candidateIds.push(String(seo.productId));
      if (seo.product?.id) candidateIds.push(String(seo.product.id));
      if (seo.product?.productId) candidateIds.push(String(seo.product.productId));

      const historyIdMatch = String(seo.historyId || '').match(/^seo_([^_]+)_/);
      if (historyIdMatch?.[1]) candidateIds.push(historyIdMatch[1]);

      const matchedProductId = candidateIds.find(id => productIds.has(id));
      if (matchedProductId) {
        const records = historyByProduct.get(matchedProductId) || [];
        records.push(seo);
        historyByProduct.set(matchedProductId, records);
      }
    });

    products.forEach(product => {
      const versions = (historyByProduct.get(product.id) || [])
        .sort((a, b) => _dateValue(b.generatedAt) - _dateValue(a.generatedAt));
      product._seoHistory = versions;
      if (!product.generationStatus) {
        product.generationStatus = versions.length || _hasDirectSeoContent(product) ? 'Completed' : 'Pending';
      }
    });

    products.sort((a, b) => _dateValue(b.createdAt || b.updatedAt) - _dateValue(a.createdAt || a.updatedAt));
    
    console.log(`[History] Loaded ${products.length} products from Products collection`);
    return products;
    
  } catch (error) {
    console.error('Error fetching products:', error);
    return [];
  }
}

async function _fetchSeoHistoryForProduct(productId, language = '') {
  try {
    console.info('[History] Query productId:', productId);
    console.info('[History] Query language:', language || '(all)');

    const normalizeId = id => id === undefined || id === null ? '' : String(id);
    const targetId = normalizeId(productId);

    let snapshot;
    try {
      const constraints = [FB.where('productId', '==', targetId)];
      if (language) constraints.push(FB.where('language', '==', language));
      snapshot = await FB.getDocs(FB.query(FB.col('SEO_History'), ...constraints));
    } catch (queryError) {
      console.warn('[History] Indexed SEO query failed; retrying by productId only:', queryError);
      snapshot = await FB.getDocs(FB.query(
        FB.col('SEO_History'),
        FB.where('productId', '==', targetId)
      ));
    }

    let records = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    if (!records.length) {
      console.warn('[History] No SEO_History found by direct productId, falling back to full scan.');
      const fullSnapshot = await FB.getDocs(FB.col('SEO_History'));
      records = fullSnapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .filter(seo => {
          const seoProductId = normalizeId(seo.productId || seo.product?.id || seo.product?.productId);
          const historyIdMatch = String(seo.historyId || '').match(/^seo_([^_]+)_/);
          const derivedProductId = historyIdMatch?.[1] ? normalizeId(historyIdMatch[1]) : '';
          return seoProductId === targetId || derivedProductId === targetId;
        });
    }

    records = records
      .filter(seo => !language || seo.language === language)
      .sort((a, b) => _dateValue(b.generatedAt) - _dateValue(a.generatedAt));

    console.info('[History] Query result count:', records.length);
    return records;
    
  } catch (error) {
    console.error('Error fetching SEO history for product:', error);
    console.info('[History] Query result count:', 0);
    return [];
  }
}

function _dateValue(value) {
  if (!value) return 0;
  if (typeof value === 'number') return value;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value.toDate === 'function') return value.toDate().getTime();
  return new Date(value).getTime() || 0;
}

// ── LEGACY COMPATIBILITY ──────────────────────────────────────
// Keep these functions for backward compatibility but they now work with the new system

export function loadIntoGenerator(idx) {
  const product = _products[idx];
  if (product) {
    loadProductIntoGenerator(product);
  }
}

export async function deleteItem(idx, docId) {
  // This is now handled by deleteProduct
  await deleteProduct(idx);
}

export async function clearAll() {
  if (!isAdmin()) return;
  if (!confirm('Delete ALL products and SEO history? This CANNOT be undone.')) return;
  
  try {
    // Delete all products
    const productsSnap = await FB.getDocs(FB.col('products'));
    await Promise.all(productsSnap.docs.map(doc => 
      FB.deleteDoc(FB.docRef('products', doc.id))
    ));
    
    // Delete all SEO history
    const historySnap = await FB.getDocs(FB.col('SEO_History'));
    await Promise.all(historySnap.docs.map(doc => 
      FB.deleteDoc(FB.docRef('SEO_History', doc.id))
    ));
    
    showToast('All products and SEO history cleared');
    render();
  } catch (error) {
    console.error('Error clearing all:', error);
    showToast('Error: ' + error.message);
  }
}
