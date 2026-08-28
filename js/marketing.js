/**
 * marketing.js - AI Marketing Creative Generator Module
 * Handles Products and Sale Campaigns functionality with Cloudinary integration
 */

import { FB } from './firebase.js';
import { getUser, getUserDoc, isAdmin } from './auth.js';
import { showToast, showAlert, hideAlert, openModal, closeModal } from './ui.js';
import { safeStr, escapeHtml, formatDate, generateSlug } from './utils.js';
import { uploadImage, getThumbnail, getResponsive, isFirebaseStorageUrl } from './cloudinary.js';
import { normalizeModelNumber, normalizeProductName, checkModelNumberExists, normalizeDiscountPercent } from './product-model.js';

const ABRA_ZYLO_STORE_URL = 'https://abra-zylo.com';

// ── STATE ────────────────────────────────────────────────────
let _products = [];
let _productsLoaded = false;
let _productsLoadPromise = null;
let _productsLoadError = null;
let _productsQueryCount = 0;
let _campaignItemsCache = new Map();
let _campaignItemsLoadPromise = new Map();
let _campaignDetailsLoadPromise = new Map();
let _productsCreatorLookupCount = 0;
let _productsRenderCount = 0;
let _productsRenderTimer = null;
let _compareProductSelection = []; // store selected product ids for comparison
let _campaigns = [];
let _campaignItems = [];
let _metaCatalogItems = [];
let _metaCatalogFilter = 'all';
let _metaCatalogActiveCampaignId = null;
let _currentCampaign = null;
let _selectedProductIds = new Set();
let _currentEditingProduct = null;
let _productEditOriginal = null;
let _productImageChanged = false;
let _currentCampaignItem = null;
let _currentCampaignItemName = '';
let _currentActiveTab = 'pending';
let _campaignProductSelectionMode = 'start';
let _productsFilterState = new Set();
let _productsSortMode = 'newest';
let _productUserCache = {};
let _productsScrollState = null;
let _campaignDetailScrollState = null;
let _campaignViewState = {
  campaignId: null,
  activeTab: 'pending',
  productId: null,
  scrollTop: 0,
  scrollContainer: 'window'
};
let _productsViewCache = { signature: '', creatorLabels: {}, duplicateProductNameSet: new Set() };
let _activeMetaProductItemId = null;
let _activeMetaProductDetails = null;
let _metaProductLookupCache = {};
let _metaProductModalScrollState = null;
let _metaCatalogCache = {
  campaigns: [],
  campaignItems: [],
  metaItems: [],
  campaignsById: new Map(),
  campaignItemsByCampaign: new Map(),
  productsById: new Map(),
  metaByCampaignItemId: new Map(),
  loaded: false,
  loadPromise: null,
  syncPromise: null
};
let _metaCatalogRenderTimer = null;
let _metaFirestoreReadCount = 0;

function recordMetaPerfMetric(name, value) {
  if (!window.__metaCatalogPerf) window.__metaCatalogPerf = {};
  window.__metaCatalogPerf[name] = value;
  console.log(`[PERF] ${name}: ${value.toFixed(2)}ms`);
}

function recordMetaFirestoreRead(label) {
  _metaFirestoreReadCount += 1;
  if (!window.__metaCatalogPerf) window.__metaCatalogPerf = {};
  window.__metaCatalogPerf.firestoreReads = _metaFirestoreReadCount;
  console.log(`[PERF] Meta Firestore read: ${label}`);
}

function rebuildMetaCatalogLookups() {
  const campaignsById = new Map(_metaCatalogCache.campaigns.map(campaign => [campaign.id, campaign]));
  const campaignItemsByCampaign = new Map();
  _metaCatalogCache.campaignItems.forEach(item => {
    const items = campaignItemsByCampaign.get(item.campaignId) || [];
    items.push(item);
    campaignItemsByCampaign.set(item.campaignId, items);
  });
  const productsById = new Map(_products.map(product => [product.id, product]));
  const metaByCampaignItemId = new Map(
    _metaCatalogCache.metaItems.map(entry => [entry.campaignItemId || entry.id, entry])
  );
  _metaCatalogCache = {
    ..._metaCatalogCache,
    campaignsById,
    campaignItemsByCampaign,
    productsById,
    metaByCampaignItemId
  };
}

function invalidateMetaCatalogCache() {
  _metaCatalogCache = {
    ..._metaCatalogCache,
    loaded: false,
    loadPromise: null,
    syncPromise: null
  };
}

// ── PRODUCTS MODULE ──────────────────────────────────────────

function getProductTimestampValue(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (ts?.toDate) return ts.toDate().getTime();
  const parsed = new Date(ts);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function formatProductDateTime(ts) {
  if (!ts) return '';
  const date = typeof ts === 'number'
    ? new Date(ts)
    : (ts?.toDate ? ts.toDate() : new Date(ts));
  if (Number.isNaN(date.getTime())) return '';
  const datePart = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  const timePart = date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
  return `${datePart} • ${timePart}`;
}

function formatProductShortDate(ts) {
  if (!ts) return '';
  const date = typeof ts === 'number'
    ? new Date(ts)
    : (ts?.toDate ? ts.toDate() : new Date(ts));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatProductLongDateTime(ts) {
  if (!ts) return '';
  const date = typeof ts === 'number'
    ? new Date(ts)
    : (ts?.toDate ? ts.toDate() : new Date(ts));
  if (Number.isNaN(date.getTime())) return '';
  return `${date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}\n${date.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
}

function isNewProduct(createdAt) {
  if (!createdAt) return false;
  const created = typeof createdAt === 'number'
    ? new Date(createdAt)
    : (createdAt?.toDate ? createdAt.toDate() : new Date(createdAt));
  if (Number.isNaN(created.getTime())) return false;
  return Date.now() - created.getTime() <= 24 * 60 * 60 * 1000;
}

function getUserDisplayName(userData, fallback = 'Unknown User') {
  return userData?.displayName || userData?.name || userData?.fullName || fallback;
}

async function resolveCreatorLabels(products) {
  const creatorLabels = {};
  const uniqueCreatorIds = [...new Set((products || []).map(product => product?.createdBy).filter(Boolean))];

  if (!uniqueCreatorIds.length) {
    return creatorLabels;
  }

  const resolvedByCreatorId = {};

  for (const uid of uniqueCreatorIds) {
    if (resolvedByCreatorId[uid] !== undefined) continue;

    if (_productUserCache[uid] !== undefined) {
      resolvedByCreatorId[uid] = _productUserCache[uid];
      continue;
    }

    _productsCreatorLookupCount += 1;

    try {
      const userDoc = await FB.getDoc(FB.docRef('users', uid));
      if (userDoc.exists()) {
        const userData = userDoc.data() || {};
        const resolved = getUserDisplayName(userData, 'Unknown User');
        _productUserCache[uid] = resolved;
        resolvedByCreatorId[uid] = resolved;
      } else {
        resolvedByCreatorId[uid] = 'Unknown User';
      }
    } catch (error) {
      console.error('Error resolving creator labels:', error);
      resolvedByCreatorId[uid] = 'Unknown User';
    }
  }

  (products || []).forEach(product => {
    const uid = product?.createdBy;
    const createdByName = product?.createdByName || '';
    creatorLabels[product.id] = createdByName || resolvedByCreatorId[uid] || product?.createdByEmail || 'Unknown User';
  });

  return creatorLabels;
}

async function resolveCreatorLabel(product) {
  if (!product) return 'Unknown User';
  if (product.createdByName) return product.createdByName;
  if (!product.createdBy) return product.createdByEmail || 'Unknown User';
  if (_productUserCache[product.createdBy] !== undefined) {
    return _productUserCache[product.createdBy];
  }
  const labels = await resolveCreatorLabels([product]);
  return labels[product.id] || product.createdByEmail || 'Unknown User';
}

function getProductsSortMode() {
  const select = document.getElementById('products-sort');
  return select?.value || _productsSortMode || 'newest';
}

function recordProductsPerfMetric(name, value) {
  if (!window.__productsPerf) {
    window.__productsPerf = {};
  }
  window.__productsPerf[name] = value;
  console.log(`[PERF] ${name}: ${value.toFixed(2)}ms`);
}

function getProductsCacheSnapshot() {
  return {
    loaded: _productsLoaded,
    count: _products.length,
    queryCount: _productsQueryCount,
    creatorLookups: _productsCreatorLookupCount,
    renderCount: _productsRenderCount,
    viewCacheSignature: _productsViewCache.signature
  };
}

function invalidateProductsViewCache() {
  _productsViewCache = { signature: '', creatorLabels: {}, duplicateProductNameSet: new Set() };
}

function buildProductsViewSignature(products) {
  return (products || []).map(product => `${product.id}:${product.createdBy || ''}:${product.createdByName || ''}:${product.modelNumber || ''}:${product.productName || ''}:${product.updatedAt || ''}:${product.createdAt || ''}`).join('|');
}

function normalizeMetaStatus(value = 'pending') {
  const status = String(value || 'pending').trim().toLowerCase();
  return status === 'added' ? 'added' : 'pending';
}

function getMetaStatusLabel(value = 'pending') {
  return normalizeMetaStatus(value) === 'added' ? 'Added' : 'Pending';
}

function normalizeNumericPriceValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const cleaned = value.toString().trim().replace(/[^\d.-]/g, '');
    if (!cleaned) return null;
    const numericValue = Number(cleaned);
    return Number.isFinite(numericValue) ? numericValue : null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function normalizeProductPricing(source = {}) {
  const getFirstPrice = (keys = []) => {
    for (const key of keys) {
      const normalizedValue = normalizeNumericPriceValue(source?.[key]);
      if (normalizedValue !== null) return normalizedValue;
    }
    return null;
  };

  const mrp = getFirstPrice(['mrp', 'MRP', 'originalPrice', 'original_price', 'regularPrice', 'regular_price', 'price']);
  const sellingPrice = getFirstPrice(['sellingPrice', 'selling_price', 'salePrice', 'sale_price', 'specialPrice', 'special', 'price']);
  const effectiveSellingPrice = sellingPrice !== null ? sellingPrice : mrp;
  const youSave = mrp !== null && effectiveSellingPrice !== null ? mrp - effectiveSellingPrice : null;
  const discount = mrp !== null && mrp > 0 && youSave !== null ? Math.round((youSave / mrp) * 100) : 0;

  return {
    mrp,
    sellingPrice: effectiveSellingPrice,
    youSave,
    discount
  };
}

function resolvePricingPreference(product = {}, campaignItem = {}, metaEntry = {}) {
  // Prefer prices from the main product record if available.
  const fromProduct = normalizeProductPricing(product || {});
  if (fromProduct.mrp !== null || fromProduct.sellingPrice !== null) {
    return fromProduct;
  }

  // Then try campaign item
  const fromCampaign = normalizeProductPricing(campaignItem || {});
  if (fromCampaign.mrp !== null || fromCampaign.sellingPrice !== null) {
    return fromCampaign;
  }

  // Finally try meta entry
  const fromMeta = normalizeProductPricing(metaEntry || {});
  return fromMeta;
}

function formatMetaCurrency(value) {
  const numericValue = normalizeNumericPriceValue(value);
  if (numericValue === null) return '₹0';
  return `₹${numericValue.toLocaleString('en-IN')}`;
}

function normalizeMetaProductSlug(slug = '') {
  const trimmed = safeStr(slug).trim().toLowerCase();
  if (!trimmed) return '';
  return trimmed.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\s+/g, '-');
}

function isProductionAbraZyloUrl(value = '') {
  const candidate = safeStr(value).trim();
  if (!candidate) return false;
  try {
    const parsed = new URL(candidate);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'abra-zylo.com' || hostname === 'www.abra-zylo.com';
  } catch (error) {
    return false;
  }
}

function buildMetaProductUrl(product = {}, slugOverride = '') {
  const directUrlCandidates = [
    product?.productUrl,
    product?.product_url,
    product?.url,
    product?.seoUrl,
    product?.seo_url,
    product?.storeUrl,
    product?.store_url,
    slugOverride
  ];

  for (const candidate of directUrlCandidates) {
    const value = safeStr(candidate).trim();
    if (!value) continue;
    if (/^https?:\/\//i.test(value)) {
      if (isProductionAbraZyloUrl(value)) return value;
      if (!/^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)/i.test(value)) {
        return value;
      }
    }
  }

  const slug = normalizeMetaProductSlug(slugOverride || product?.seo_slug || product?.seoSlug || product?.slug || '');
  if (slug) {
    return `${ABRA_ZYLO_STORE_URL}/${slug}`;
  }

  const fallbackName = safeStr(product?.productName || '').trim();
  if (fallbackName) {
    return `${ABRA_ZYLO_STORE_URL}/${normalizeMetaProductSlug(generateSlug(fallbackName))}`;
  }

  return 'Not Added';
}

function hasCopyValue(value) {
  if (value === undefined || value === null) return false;
  const text = String(value).trim();
  return text !== '' && text !== 'Not Added';
}

async function loadMetaProductDetailData(metaEntry) {
  const cacheKey = metaEntry?.campaignItemId || metaEntry?.id || metaEntry?.productId || '';
  if (cacheKey && _metaProductLookupCache[cacheKey]) {
    return _metaProductLookupCache[cacheKey];
  }

  try {
    const productId = metaEntry?.productId || '';
    const campaignItemId = metaEntry?.campaignItemId || metaEntry?.id;
    let product = _metaCatalogCache.productsById.get(productId) || null;
    // If the product is not in the meta-catalog cache (timing/load issues),
    // use the campaign item doc's productId as a fallback before fetching.
    const effectiveProductId = productId || (campaignItemDoc && campaignItemDoc.productId) || '';
    if (!product && effectiveProductId) {
      try {
        const latest = await getLatestProductData(effectiveProductId);
        if (latest) product = latest;
      } catch (e) {
        console.warn('Failed to fetch latest product for meta detail fallback', e);
      }
    }
    const campaignItemDoc = _metaCatalogCache.campaignItems.find(item => item.id === campaignItemId) || null;
    const seoHistoryItems = await (
      productId
        ? (async () => {
            try {
              const q = FB.query(FB.col('SEO_History'), FB.where('productId', '==', productId));
              recordMetaFirestoreRead('SEO_History for popup');
              const snapshot = await FB.getDocs(q);
              const items = [];
              snapshot.forEach(doc => items.push({ id: doc.id, ...doc.data() }));
              return items;
            } catch (error) {
              console.error('Error fetching SEO history for meta product details:', error);
              return [];
            }
          })()
        : Promise.resolve([])
    );

    const latestSeoHistory = (seoHistoryItems || []).sort((a, b) => {
      const aTime = a?.generatedAt?.toDate ? a.generatedAt.toDate().getTime() : new Date(a?.generatedAt || 0).getTime();
      const bTime = b?.generatedAt?.toDate ? b.generatedAt.toDate().getTime() : new Date(b?.generatedAt || 0).getTime();
      return bTime - aTime;
    })[0] || null;

    const seoChecklist = latestSeoHistory?.seoChecklist || {};
    const seoDescription = safeStr(
      seoChecklist.productDescription ||
      seoChecklist.product_description ||
      seoChecklist.description ||
      product?.productDescription ||
      product?.product_description ||
      product?.description ||
      ''
    ).trim();
    const seoSlug = safeStr(
      seoChecklist.seoSlug ||
      seoChecklist.seo_slug ||
      seoChecklist.slug ||
      product?.seo_slug ||
      product?.seoSlug ||
      product?.slug ||
      ''
    ).trim();

    const pricing = resolvePricingPreference(product, campaignItemDoc, metaEntry);

    const detail = {
      productName: safeStr(product?.productName || metaEntry?.productName || 'Untitled Product').trim() || 'Untitled Product',
      productDescription: seoDescription || 'Not Added',
      productUrl: buildMetaProductUrl(product || {}, seoSlug),
      mrp: pricing.mrp ?? 0,
      sellingPrice: pricing.sellingPrice ?? 0,
      modelNumber: safeStr(product?.modelNumber || metaEntry?.modelNumber || '').trim() || 'Not Added',
      imageUrl: product?.imageUrl || '',
      metaStatus: normalizeMetaStatus(metaEntry?.metaStatus)
    };

    if (cacheKey) {
      _metaProductLookupCache[cacheKey] = detail;
    }
    return detail;
  } catch (error) {
    console.error('Error resolving meta product detail data:', error);
    const pricing = normalizeProductPricing(metaEntry || {});
    return {
      productName: safeStr(metaEntry?.productName || 'Untitled Product').trim() || 'Untitled Product',
      productDescription: 'Not Added',
      productUrl: 'Not Added',
      mrp: pricing.mrp ?? 0,
      sellingPrice: pricing.sellingPrice ?? 0,
      modelNumber: 'Not Added',
      imageUrl: '',
      metaStatus: normalizeMetaStatus(metaEntry?.metaStatus)
    };
  }
}

async function loadMetaCatalogItemsMap() {
  return _metaCatalogCache.metaByCampaignItemId;
}

async function syncCompletedCampaignItemsToMetaCatalog(items = _metaCatalogCache.campaignItems) {
  if (_metaCatalogCache.syncPromise) return _metaCatalogCache.syncPromise;

  _metaCatalogCache.syncPromise = (async () => {
  try {
    const metaMap = _metaCatalogCache.metaByCampaignItemId;
    const batch = FB.writeBatch();
    const createdDocs = [];

    (items || []).forEach(item => {
      if (String(item.status || '').trim().toLowerCase() !== 'completed') return;
      if (metaMap.has(item.id)) return;

      const metaDoc = {
        campaignId: item.campaignId || '',
        campaignItemId: item.id,
        productId: item.productId || '',
        metaStatus: 'pending',
        createdAt: FB.serverTimestamp(),
        updatedAt: FB.serverTimestamp()
      };
      batch.set(FB.docRef('metaCatalogItems', item.id), metaDoc);
      createdDocs.push({ id: item.id, ...metaDoc });
    });

    if (createdDocs.length > 0) {
      await batch.commit();
      _metaCatalogCache.metaItems = [..._metaCatalogCache.metaItems, ...createdDocs];
      rebuildMetaCatalogLookups();
    }
  } catch (error) {
    console.error('Error syncing completed campaign items to meta catalog:', error);
  }
  })();

  try {
    await _metaCatalogCache.syncPromise;
  } finally {
    _metaCatalogCache.syncPromise = null;
  }
}

async function loadMetaCatalogData(options = {}) {
  const { force = false } = options;
  if (!force && _metaCatalogCache.loaded && ! _metaCatalogCache.loadPromise) {
    return _metaCatalogCache;
  }
  if (_metaCatalogCache.loadPromise) return _metaCatalogCache.loadPromise;

  const loadStart = performance.now();
  _metaCatalogCache.loadPromise = (async () => {
    try {
      const campaignStart = performance.now();
      const campaignsQuery = FB.query(FB.col('saleCampaigns'), FB.orderBy('createdAt', 'desc'));
      recordMetaFirestoreRead('saleCampaigns');
      const campaignsSnapshot = await FB.getDocs(campaignsQuery);
      const campaigns = [];
      campaignsSnapshot.forEach(doc => campaigns.push({ id: doc.id, ...doc.data() }));
      recordMetaPerfMetric('Meta Campaigns Load', performance.now() - campaignStart);

      const itemsStart = performance.now();
      recordMetaFirestoreRead('campaignItems');
      const itemsSnapshot = await FB.getDocs(FB.col('campaignItems'));
      const campaignItems = [];
      itemsSnapshot.forEach(doc => campaignItems.push({ id: doc.id, ...doc.data() }));
      recordMetaPerfMetric('Campaign Items Load', performance.now() - itemsStart);

      const statusStart = performance.now();
      recordMetaFirestoreRead('metaCatalogItems');
      const metaSnapshot = await FB.getDocs(FB.col('metaCatalogItems'));
      const metaItems = [];
      metaSnapshot.forEach(doc => metaItems.push({ id: doc.id, ...doc.data() }));
      recordMetaPerfMetric('Meta Status Load', performance.now() - statusStart);

      _metaCatalogCache = {
        ..._metaCatalogCache,
        campaigns,
        campaignItems,
        metaItems,
        loaded: true
      };
      await loadProductsCatalog();
      _campaigns = campaigns;
      _metaCatalogItems = metaItems;
      rebuildMetaCatalogLookups();
      await syncCompletedCampaignItemsToMetaCatalog(campaignItems);
      recordMetaPerfMetric('Meta Catalog Data Load', performance.now() - loadStart);
      return _metaCatalogCache;
    } catch (error) {
      console.error('Error loading Meta Catalog data:', error);
      throw error;
    } finally {
      _metaCatalogCache.loadPromise = null;
    }
  })();

  return _metaCatalogCache.loadPromise;
}

function applyProductsSort(products) {
  const sortMode = getProductsSortMode();
  const list = [...products];

  switch (sortMode) {
    case 'oldest':
      return list.sort((a, b) => getProductTimestampValue(a.createdAt) - getProductTimestampValue(b.createdAt));
    case 'recently-updated':
      return list.sort((a, b) => getProductTimestampValue(b.updatedAt || b.createdAt) - getProductTimestampValue(a.updatedAt || a.createdAt));
    case 'name-az':
      return list.sort((a, b) => (a.productName || '').localeCompare(b.productName || '', undefined, { sensitivity: 'base' }));
    case 'name-za':
      return list.sort((a, b) => (b.productName || '').localeCompare(a.productName || '', undefined, { sensitivity: 'base' }));
    case 'newest':
    default:
      return list.sort((a, b) => getProductTimestampValue(b.createdAt) - getProductTimestampValue(a.createdAt));
  }
}

function isSameDay(value, targetDate = new Date()) {
  if (!value) return false;
  const date = typeof value === 'number'
    ? new Date(value)
    : (value?.toDate ? value.toDate() : new Date(value));
  if (Number.isNaN(date.getTime())) return false;
  return date.getFullYear() === targetDate.getFullYear()
    && date.getMonth() === targetDate.getMonth()
    && date.getDate() === targetDate.getDate();
}

function toggleProductsFilter(filterKey) {
  if (_productsFilterState.has(filterKey)) {
    _productsFilterState.delete(filterKey);
  } else {
    _productsFilterState.add(filterKey);
  }
  updateProductsFilterButtons();
  renderProducts();
}

function clearProductFilters() {
  _productsFilterState.clear();
  updateProductsFilterButtons();
  renderProducts();
}

function updateProductsFilterButtons() {
  document.querySelectorAll('.products-filter-chip').forEach(btn => {
    const isActive = _productsFilterState.has(btn.dataset.filter);
    btn.classList.toggle('active', isActive);
  });

  const clearButton = document.getElementById('products-clear-filters');
  if (clearButton) {
    clearButton.style.display = _productsFilterState.size > 0 ? 'inline-flex' : 'none';
  }
}

function getProductsScrollTarget() {
  const windowScrollY = window.scrollY || window.pageYOffset || 0;
  const documentScrollTop = document.documentElement?.scrollTop || 0;
  const bodyScrollTop = document.body?.scrollTop || 0;

  if (windowScrollY > 0 || documentScrollTop > 0 || bodyScrollTop > 0) {
    return window;
  }

  const scrollTarget = document.scrollingElement || document.documentElement || document.body;
  if (scrollTarget && typeof scrollTarget.scrollTo === 'function' && (scrollTarget.scrollTop > 0 || scrollTarget.scrollHeight > scrollTarget.clientHeight)) {
    return scrollTarget;
  }

  return window;
}

function preserveProductsScrollState() {
  const scrollTarget = getProductsScrollTarget();
  _productsScrollState = {
    x: (scrollTarget && typeof scrollTarget.scrollLeft === 'number' ? scrollTarget.scrollLeft : window.scrollX || window.pageXOffset || 0),
    y: (scrollTarget && typeof scrollTarget.scrollTop === 'number' ? scrollTarget.scrollTop : window.scrollY || window.pageYOffset || 0)
  };
}

function restoreProductsScrollState() {
  if (!_productsScrollState) return;

  const restoreScroll = () => {
    const scrollTarget = getProductsScrollTarget();
    if (scrollTarget && typeof scrollTarget.scrollTo === 'function') {
      scrollTarget.scrollTo(_productsScrollState.x, _productsScrollState.y);
    } else {
      window.scrollTo(_productsScrollState.x, _productsScrollState.y);
    }
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(restoreScroll);
  } else {
    setTimeout(restoreScroll, 0);
  }
}

function preserveCampaignDetailScrollState(productId = null) {
  const scrollTarget = getProductsScrollTarget();
  _campaignDetailScrollState = {
    x: (scrollTarget && typeof scrollTarget.scrollLeft === 'number' ? scrollTarget.scrollLeft : window.scrollX || window.pageXOffset || 0),
    y: (scrollTarget && typeof scrollTarget.scrollTop === 'number' ? scrollTarget.scrollTop : window.scrollY || window.pageYOffset || 0)
  };

  _campaignViewState = {
    campaignId: _currentCampaign?.id || null,
    activeTab: _currentActiveTab || 'pending',
    productId: productId || _currentCampaignItem?.productId || null,
    scrollTop: _campaignDetailScrollState.y,
    scrollContainer: scrollTarget === window ? 'window' : 'container'
  };
}

function restoreCampaignDetailScrollState() {
  if (!_campaignDetailScrollState && !_campaignViewState?.campaignId) return;

  const restoreScroll = () => {
    const scrollTarget = getProductsScrollTarget();
    const targetTop = _campaignViewState?.scrollTop ?? _campaignDetailScrollState?.y ?? 0;

    if (scrollTarget && typeof scrollTarget.scrollTo === 'function') {
      scrollTarget.scrollTo(_campaignDetailScrollState?.x ?? 0, targetTop);
    } else {
      window.scrollTo(_campaignDetailScrollState?.x ?? 0, targetTop);
    }

    if (_campaignViewState?.productId) {
      const productCard = document.querySelector(`[data-product-id="${CSS.escape(String(_campaignViewState.productId))}"]`);
      if (productCard && typeof productCard.scrollIntoView === 'function') {
        productCard.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restoreScroll);
    });
  } else {
    setTimeout(restoreScroll, 0);
  }
}

function getMetaCatalogScrollTarget() {
  const candidates = [
    document.scrollingElement,
    document.querySelector('.main-content'),
    document.querySelector('.page-body'),
    document.documentElement,
    document.body
  ].filter(Boolean);

  const scrollableCandidate = candidates.find(candidate => {
    if (!candidate || typeof candidate.scrollTo !== 'function') return false;
    const overflowY = (candidate.style && candidate.style.overflowY) || '';
    const computedOverflowY = window.getComputedStyle(candidate).overflowY;
    const canScrollVertically = candidate.scrollHeight > candidate.clientHeight;
    return canScrollVertically || overflowY === 'auto' || overflowY === 'scroll' || computedOverflowY === 'auto' || computedOverflowY === 'scroll';
  });

  return scrollableCandidate || window;
}

function preserveMetaProductModalScrollState() {
  const scrollTarget = getMetaCatalogScrollTarget();
  const currentScrollX = scrollTarget === window
    ? (window.scrollX || window.pageXOffset || 0)
    : (typeof scrollTarget.scrollLeft === 'number' ? scrollTarget.scrollLeft : 0);
  const currentScrollY = scrollTarget === window
    ? (window.scrollY || window.pageYOffset || 0)
    : (typeof scrollTarget.scrollTop === 'number' ? scrollTarget.scrollTop : 0);

  _metaProductModalScrollState = {
    element: scrollTarget === window ? null : scrollTarget,
    x: currentScrollX,
    y: currentScrollY
  };
}

function restoreMetaProductModalScrollState() {
  if (!_metaProductModalScrollState) return;

  const restoreScroll = () => {
    const scrollTarget = _metaProductModalScrollState.element || getMetaCatalogScrollTarget();
    if (scrollTarget && scrollTarget !== window && typeof scrollTarget.scrollTo === 'function') {
      scrollTarget.scrollTo(_metaProductModalScrollState.x, _metaProductModalScrollState.y);
    } else {
      window.scrollTo(_metaProductModalScrollState.x, _metaProductModalScrollState.y);
    }
  };

  if (typeof window.requestAnimationFrame === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(restoreScroll);
    });
  } else {
    setTimeout(restoreScroll, 0);
  }
}

function matchesProductsViewFilters(product, searchTerm, currentUserId) {
  const creatorLabel = (product.createdByName || product.createdByEmail || '').toLowerCase();
  const searchableText = [product.productName, creatorLabel, product.createdByEmail].join(' ').toLowerCase();
  const matchesSearch = !searchTerm || searchableText.includes(searchTerm);
  const matchesAddedByMe = !_productsFilterState.has('added-by-me') || (currentUserId && product.createdBy === currentUserId);
  const matchesAddedToday = !_productsFilterState.has('added-today') || isSameDay(product.createdAt);
  const matchesUpdatedToday = !_productsFilterState.has('updated-today') || isSameDay(product.updatedAt);
  return matchesSearch && matchesAddedByMe && matchesAddedToday && matchesUpdatedToday;
}

function buildProductCardMarkup(product, creatorLabels, duplicateProductNameSet, currentUserId) {
  let imageSrc = '';
  if (product.imageUrl) {
    imageSrc = getResponsive(product.imageUrl, 280);
  } else if (product.image) {
    imageSrc = getResponsive(product.image, 280);
  }
  const isNew = isNewProduct(product.createdAt);
  const isDuplicateName = duplicateProductNameSet.has(normalizeProductName(product.productName));
  const modelNumberLabel = normalizeModelNumber(product.modelNumber || '') || 'Not Added';
  const addedByLabel = escapeHtml(creatorLabels[product.id] || 'Unknown User');
  const createdDateLabel = escapeHtml(formatProductShortDate(product.createdAt));
  const canEdit = canEditProduct(product);
  const canDelete = canDeleteProduct(product);
  const pricing = normalizeProductPricing(product);

  return `
    <div class="product-card" data-product-id="${escapeHtml(product.id || '')}">
      <div class="product-card-top">
        <label class="product-compare-pill" onclick="event.stopPropagation();">
          <input type="checkbox" ${_compareProductSelection.includes(product.id) ? 'checked' : ''} onclick="event.stopPropagation(); window.Marketing.toggleProductCompare('${product.id}')" />
          <span>Compare</span>
        </label>
        <div class="product-badge-group">
          ${isDuplicateName ? '<span class="product-duplicate-badge">DUPLICATE</span>' : ''}
          ${isNew ? '<span class="product-new-badge">🟢 NEW</span>' : ''}
        </div>
      </div>
      <div class="product-image ${!imageSrc ? 'empty' : ''}">
        ${imageSrc 
          ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(product.productName || 'Product')}" loading="lazy" decoding="async" onerror="this.onerror=null;this.parentElement.innerHTML='No Image';"/>`
          : 'No Image'
        }
      </div>
      <div class="product-name">${escapeHtml(product.productName || 'Untitled Product')}</div>
      <div class="product-model">Model: ${escapeHtml(modelNumberLabel)}</div>
      <div class="product-pricing">
        <div class="product-mrp">MRP ${formatMetaCurrency(pricing.mrp)}</div>
        <div class="product-selling-price">${formatMetaCurrency(pricing.sellingPrice)}</div>
        <div class="product-discount">
          <span class="you-save">Save ${formatMetaCurrency(pricing.youSave)}</span>
          <span class="discount-badge">${normalizeDiscountPercent(pricing.discount)}% OFF</span>
        </div>
      </div>
      <div class="product-card-meta">
        <div class="product-meta-main">
          <span class="product-meta-user">👤 ${addedByLabel}</span>
          <span class="product-meta-date">🗓 ${createdDateLabel}</span>
        </div>
        <div class="product-actions">
          ${canEdit ? `
            <button class="product-action-btn" title="Edit Product" onclick="event.stopPropagation(); window.Marketing.editProduct('${product.id}')">
              ✏️
            </button>
          ` : ''}
          ${canDelete ? `
            <button class="product-action-btn product-action-btn-delete" title="Delete Product" onclick="event.stopPropagation(); window.Marketing.deleteProduct('${product.id}')">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    </div>`;
}

async function updateEditedProductCard(product) {
  const container = document.getElementById('products-grid');
  if (!container || !product) return false;

  const searchTerm = document.getElementById('products-search')?.value?.trim().toLowerCase() || '';
  const currentUser = getUser();
  const currentUserId = currentUser?.uid || '';
  const shouldRemainVisible = matchesProductsViewFilters(product, searchTerm, currentUserId);
  const existingCard = container.querySelector(`[data-product-id="${product.id}"]`);

  if (!shouldRemainVisible) {
    if (existingCard) {
      existingCard.remove();
    }
    return true;
  }

  if (existingCard) {
    const creatorLabels = await resolveCreatorLabels([product]);
    const duplicateNameCounts = new Map();
    _products.forEach(item => {
      const normalizedName = normalizeProductName(item.productName);
      if (!normalizedName) return;
      duplicateNameCounts.set(normalizedName, (duplicateNameCounts.get(normalizedName) || 0) + 1);
    });
    const duplicateProductNameSet = new Set(
      Array.from(duplicateNameCounts.entries())
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    );

    existingCard.outerHTML = buildProductCardMarkup(product, { [product.id]: creatorLabels[product.id] || 'Unknown User' }, duplicateProductNameSet, currentUserId);
    return true;
  }

  const existingProducts = container.querySelectorAll('.product-card');
  if (existingProducts.length === 0) {
    await renderProducts({ force: true });
    return true;
  }

  return false;
}

async function loadProductsCatalog(options = {}) {
  const { force = false } = options;

  if (!force && _productsLoaded && _products.length && !_productsLoadPromise) {
    return _products;
  }

  if (_productsLoadPromise) {
    return _productsLoadPromise;
  }

  const loadStart = performance.now();
  _productsLoadPromise = (async () => {
    try {
      _productsQueryCount += 1;
      const q = FB.query(
        FB.col('products'),
        FB.orderBy('createdAt', 'desc')
      );
      const snapshot = await FB.getDocs(q);

      const products = [];
      snapshot.forEach(doc => {
        products.push({ id: doc.id, ...doc.data() });
      });

      _products = products;
      _productsLoaded = true;
      _productsLoadError = null;
      invalidateProductsViewCache();
      recordProductsPerfMetric('Products Firestore Load', performance.now() - loadStart);
      return _products;
    } catch (error) {
      _productsLoadError = error;
      console.error('Error loading products catalog:', error);
      throw error;
    } finally {
      _productsLoadPromise = null;
    }
  })();

  return _productsLoadPromise;
}

/**
 * Load and render products list
 */
async function renderProducts(options = {}) {
  const container = document.getElementById('products-grid');
  if (!container) return;

  const renderStart = performance.now();
  _productsRenderCount += 1;

  try {
    const products = await loadProductsCatalog(options);
    const searchTerm = document.getElementById('products-search')?.value?.trim().toLowerCase() || '';
    const currentUser = getUser();
    const currentUserId = currentUser?.uid || '';

    const signature = buildProductsViewSignature(products);
    let creatorLabels = _productsViewCache.creatorLabels;
    let duplicateProductNameSet = _productsViewCache.duplicateProductNameSet;

    if (_productsViewCache.signature !== signature) {
      const creatorStart = performance.now();
      creatorLabels = await resolveCreatorLabels(products);
      recordProductsPerfMetric('Creator Resolution', performance.now() - creatorStart);

      const duplicateStart = performance.now();
      const duplicateNameCounts = new Map();
      products.forEach(product => {
        const normalizedName = normalizeProductName(product.productName);
        if (!normalizedName) return;
        duplicateNameCounts.set(normalizedName, (duplicateNameCounts.get(normalizedName) || 0) + 1);
      });
      duplicateProductNameSet = new Set(
        Array.from(duplicateNameCounts.entries())
          .filter(([, count]) => count > 1)
          .map(([name]) => name)
      );
      _productsViewCache = { signature, creatorLabels, duplicateProductNameSet };
      recordProductsPerfMetric('Duplicate Map', performance.now() - duplicateStart);
    }

    let filteredProducts = products.filter(product => matchesProductsViewFilters(product, searchTerm, currentUserId));

    filteredProducts = applyProductsSort(filteredProducts);

    const badge = document.getElementById('products-badge');
    if (badge) badge.textContent = products.length;

    updateProductsFilterButtons();

    if (filteredProducts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
            <line x1="16" y1="2" x2="16" y2="6"/>
            <line x1="8" y1="2" x2="8" y2="6"/>
          </svg>
          <h3>No Products Found</h3>
          <p>${searchTerm || _productsFilterState.size ? 'No products match your current search or filters.' : 'Get started by adding your first product.'}</p>
          ${!searchTerm && !_productsFilterState.size ? '<button class="btn btn-accent" onclick="window.Marketing.showAddProduct()">Add Product</button>' : ''}
        </div>`;
      recordProductsPerfMetric('Products Render', performance.now() - renderStart);
      recordProductsPerfMetric('Total Products', performance.now() - renderStart);
      return;
    }

    const markup = filteredProducts.map(product => buildProductCardMarkup(product, creatorLabels, duplicateProductNameSet, currentUserId)).join('');

    container.innerHTML = markup;
    recordProductsPerfMetric('Products Render', performance.now() - renderStart);
    recordProductsPerfMetric('Total Products', performance.now() - renderStart);
  } catch (error) {
    console.error('Error loading products:', error);
    showToast('Failed to load products');
    container.innerHTML = `
      <div class="empty-state">
        <h3>Products temporarily unavailable</h3>
        <p>${_productsLoadError ? 'The products list could not be loaded right now.' : 'Please try again.'}</p>
        <button class="btn btn-accent" onclick="window.Marketing.renderProducts({ force: true })">Retry</button>
      </div>`;
  }
}

function handleProductsSearchInput() {
  if (_productsRenderTimer) {
    clearTimeout(_productsRenderTimer);
  }
  _productsRenderTimer = setTimeout(() => {
    renderProducts();
  }, 250);
}

function toggleProductCompare(productId) {
  const idx = _compareProductSelection.indexOf(productId);
  if (idx > -1) {
    _compareProductSelection.splice(idx, 1);
    showToast('Removed from compare');
  } else {
    if (_compareProductSelection.length >= 2) {
      showToast('You can compare up to 2 products only');
      return;
    }
    _compareProductSelection.push(productId);
    showToast('Selected for compare');
  }
  // Update compare button state
  const btn = document.getElementById('product-compare-btn');
  if (btn) btn.disabled = _compareProductSelection.length !== 2;
  renderProducts();
}

async function compareSelectedProducts() {
  if (_compareProductSelection.length !== 2) {
    showToast('Select 2 products to compare');
    return;
  }

  const p1 = _products.find(p => p.id === _compareProductSelection[0]);
  const p2 = _products.find(p => p.id === _compareProductSelection[1]);
  if (!p1 || !p2) {
    showToast('Selected products not found');
    return;
  }

  // Try to fetch latest performance reports for both products
  try {
    const report1 = await window.AuditHistory.getLatestReportForProduct(p1);
    const report2 = await window.AuditHistory.getLatestReportForProduct(p2);

    if (!report1 && !report2) {
      showToast('No saved performance reports found for the selected products');
      return;
    }

    if (!report1 || !report2) {
      showToast('One of the selected products does not have a saved performance report');
      return;
    }

    // Open comparison modal using audit-history helper
    window.AuditHistory.openComparisonModalForReports(report1, report2);
  } catch (e) {
    console.error('Error comparing products:', e);
    showToast('Failed to compare products');
  }
}

/**
 * Show add product modal
 */
function showAddProduct() {
  preserveProductsScrollState();
  _currentEditingProduct = null;
  _productEditOriginal = null;
  _productImageChanged = false;
  document.getElementById('product-modal-title').textContent = 'Add Product';
  document.getElementById('product-form').reset();
  document.getElementById('product-img-preview').style.display = 'none';
  document.getElementById('product-upload-placeholder').style.display = 'flex';
  document.getElementById('product-model-number').value = '';
  document.getElementById('product-discount').value = '';
  document.getElementById('product-you-save').value = '';
  const historyBlock = document.getElementById('product-history-block');
  if (historyBlock) historyBlock.style.display = 'none';
  hideAlert('product-alert');
  openModal('product-modal');
}

/**
 * Edit existing product
 */
async function editProduct(productId) {
  try {
    const product = _products.find(p => p.id === productId);
    if (!product) {
      showToast('Product not found');
      return;
    }
    
    if (!canEditProduct(product)) {
      showToast('Please log in to edit products');
      return;
    }
    
    preserveProductsScrollState();
    _currentEditingProduct = product;
    _productEditOriginal = { ...product };
    _productImageChanged = false;
    document.getElementById('product-modal-title').textContent = 'Edit Product';
    document.getElementById('product-name').value = product.productName || '';
    document.getElementById('product-model-number').value = normalizeModelNumber(product.modelNumber || '');
    const pricing = normalizeProductPricing(product);
    document.getElementById('product-mrp').value = pricing.mrp === null ? '' : pricing.mrp;
    document.getElementById('product-selling-price').value = pricing.sellingPrice === null ? '' : pricing.sellingPrice;
    const historyBlock = document.getElementById('product-history-block');
    const createdByEl = document.getElementById('product-created-by');
    const createdOnEl = document.getElementById('product-created-on');
    const updatedByEl = document.getElementById('product-updated-by');
    const updatedOnEl = document.getElementById('product-updated-on');
    if (historyBlock) {
      historyBlock.style.display = 'block';
    }
    if (createdByEl) {
      createdByEl.textContent = await resolveCreatorLabel(product);
    }
    if (createdOnEl) {
      createdOnEl.textContent = formatProductLongDateTime(product.createdAt) || '—';
    }
    if (updatedByEl) {
      updatedByEl.textContent = product.updatedByName || product.updatedBy || 'Never';
    }
    if (updatedOnEl) {
      updatedOnEl.textContent = product.updatedAt ? formatProductLongDateTime(product.updatedAt) : 'Never';
    }
    
    // Show image if exists
    const preview = document.getElementById('product-img-preview');
    const placeholder = document.getElementById('product-upload-placeholder');
    
    if (product.imageUrl) {
      preview.src = getResponsive(product.imageUrl, 400);
      preview.style.display = 'block';
      placeholder.style.display = 'none';
    } else {
      preview.style.display = 'none';
      placeholder.style.display = 'flex';
    }
    
    calculateDiscount();
    hideAlert('product-alert');
    openModal('product-modal');
    
  } catch (error) {
    console.error('Error loading product for edit:', error);
    showToast('Failed to load product details');
  }
}

/**
 * Handle product image selection
 */
function onProductImageSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  _productImageChanged = true;
  
  // Validate file
  if (!file.type.startsWith('image/')) {
    showAlert('product-alert', 'Please select a valid image file');
    return;
  }
  
  if (file.size > 10 * 1024 * 1024) {
    showAlert('product-alert', 'Image size must be less than 10MB');
    return;
  }
  
  // Show preview
  const reader = new FileReader();
  reader.onload = (e) => {
    const preview = document.getElementById('product-img-preview');
    const placeholder = document.getElementById('product-upload-placeholder');
    
    preview.src = e.target.result;
    preview.style.display = 'block';
    placeholder.style.display = 'none';
  };
  reader.readAsDataURL(file);
}

/**
 * Calculate discount and you save amounts
 */
function calculateDiscount() {
  const mrp = parseFloat(document.getElementById('product-mrp').value) || 0;
  const sellingPrice = parseFloat(document.getElementById('product-selling-price').value) || 0;
  
  if (mrp <= 0 || sellingPrice < 0) {
    document.getElementById('product-discount').value = '';
    document.getElementById('product-you-save').value = '';
    return;
  }
  
  if (sellingPrice > mrp || sellingPrice < 0) {
    document.getElementById('product-discount').value = '';
    document.getElementById('product-you-save').value = '';
    return;
  }
  
  const youSave = mrp - sellingPrice;
  const discount = mrp > 0 ? Math.round(((youSave / mrp) * 100)) : 0;
  
  document.getElementById('product-discount').value = `${discount}%`;
  document.getElementById('product-you-save').value = `₹${youSave}`;
}

/**
 * Hide product modal
 */
function hideProductModal() {
  _productImageChanged = false;
  _productEditOriginal = null;
  closeModal('product-modal');
}

/**
 * Handle product form submission
 */
async function handleProductSubmit(event) {
  event.preventDefault();
  
  const user = getUser();
  if (!user) {
    showAlert('product-alert', 'Please log in to continue');
    return;
  }
  
  // Get form data
  const productName = document.getElementById('product-name').value.trim();
  const modelNumber = normalizeModelNumber(document.getElementById('product-model-number').value);
  const mrp = parseFloat(document.getElementById('product-mrp').value);
  const sellingPrice = parseFloat(document.getElementById('product-selling-price').value);
  const fileInput = document.getElementById('product-file-inp');
  
  // Validate
  if (!productName) {
    showAlert('product-alert', 'Product name is required');
    return;
  }
  
  if (!mrp || mrp <= 0) {
    showAlert('product-alert', 'Valid MRP is required');
    return;
  }
  
  if (!sellingPrice || sellingPrice <= 0) {
    showAlert('product-alert', 'Valid selling price is required');
    return;
  }
  
  if (sellingPrice > mrp) {
    showAlert('product-alert', 'Selling price cannot be greater than MRP');
    return;
  }
  
  // Check if image is required for new products
  if (!_currentEditingProduct && !fileInput.files[0] && !document.getElementById('product-img-preview').src) {
    showAlert('product-alert', 'Product image is required');
    return;
  }
  // Get button reference and store original text before try block
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent || '';
  
  try {
    hideAlert('product-alert');
    if (submitBtn) {
      submitBtn.textContent = 'Saving...';
      submitBtn.disabled = true;
    }
    
    let imageUrl = _currentEditingProduct?.imageUrl || '';
    let publicId = _currentEditingProduct?.publicId || '';
    
    // Upload new image only if the user explicitly selected one.
    if (_productImageChanged && fileInput.files[0]) {
      const file = fileInput.files[0];
      
      showToast('Uploading image to Cloudinary...');
      
      try {
        const uploadResult = await uploadImage(file, 'products', {
          publicId: `product_${user.uid}_${Date.now()}`
        });
        
        imageUrl = uploadResult.secure_url;
        publicId = uploadResult.public_id;
        
        showToast('Image uploaded successfully!');
        
      } catch (uploadError) {
        console.error('Cloudinary upload error:', uploadError);
        showAlert('product-alert', uploadError.message);
        return;
      }
    }
    
    const originalProduct = _productEditOriginal || _currentEditingProduct || null;
    const normalizedProductName = productName.trim();
    const normalizedModelNumber = normalizeModelNumber(modelNumber);
    const normalizedMrp = Number.isFinite(mrp) ? mrp : 0;
    const normalizedSellingPrice = Number.isFinite(sellingPrice) ? sellingPrice : 0;
    const youSave = (normalizedMrp || 0) - (normalizedSellingPrice || 0);
    const discount = normalizedMrp > 0 ? Math.round(((youSave / normalizedMrp) * 100)) : 0;

    if (originalProduct && modelNumber) {
      const duplicateInCache = _products.some(product => 
        product.id !== originalProduct.id &&
        normalizeModelNumber(product.modelNumber || '') === normalizedModelNumber
      );

      if (duplicateInCache) {
        const duplicateName = _products.find(product => product.id !== originalProduct.id && normalizeModelNumber(product.modelNumber || '') === normalizedModelNumber)?.productName || 'Unknown Product';
        showAlert('product-alert', `Model number ${normalizedModelNumber} is already available for ${duplicateName}. Check your database and update it.`);
        return;
      }

      const duplicate = await checkModelNumberExists(normalizedModelNumber, originalProduct.id || null);
      if (duplicate) {
        const duplicateName = duplicate.productName || 'Unknown Product';
        showAlert('product-alert', `Model number ${normalizedModelNumber} is already available for ${duplicateName}. Check your database and update it.`);
        return;
      }
    }

    const changes = {};

    if (originalProduct) {
      const originalName = String(originalProduct.productName || '').trim();
      const originalModelNumber = normalizeModelNumber(originalProduct.modelNumber || '');
      const originalMrp = Number.isFinite(Number(originalProduct.mrp)) ? Number(originalProduct.mrp) : 0;
      const originalSellingPrice = Number.isFinite(Number(originalProduct.sellingPrice)) ? Number(originalProduct.sellingPrice) : 0;

      if (normalizedProductName !== originalName) {
        changes.productName = normalizedProductName;
      }

      if (originalModelNumber !== normalizedModelNumber) {
        changes.modelNumber = normalizedModelNumber;
      }

      const mrpChanged = normalizedMrp !== originalMrp;
      const sellingPriceChanged = normalizedSellingPrice !== originalSellingPrice;

      if (mrpChanged) {
        changes.mrp = normalizedMrp;
      }
      if (sellingPriceChanged) {
        changes.sellingPrice = normalizedSellingPrice;
      }
      if (mrpChanged || sellingPriceChanged) {
        changes.discount = discount;
        changes.youSave = youSave;
      }

      if (_productImageChanged) {
        changes.imageUrl = imageUrl;
        changes.publicId = publicId;
      }
    } else {
      const createPayload = {
        productName: normalizedProductName,
        imageUrl,
        publicId,
        mrp: normalizedMrp || 0,
        sellingPrice: normalizedSellingPrice || 0,
        discount,
        youSave,
        ...(normalizedModelNumber ? { modelNumber: normalizedModelNumber } : {})
      };

      const createPayloadWithMeta = {
        ...createPayload,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || 'Unknown User',
        createdByEmail: user.email || '',
        createdAt: FB.serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: user.displayName || user.email || 'Unknown User',
        updatedAt: FB.serverTimestamp()
      };

      const createdDoc = await FB.addDoc(FB.col('products'), createPayloadWithMeta);
      _products.unshift({
        id: createdDoc.id,
        ...createPayloadWithMeta,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      _productsLoaded = true;
      invalidateProductsViewCache();
      if (_metaCatalogCache.loaded) rebuildMetaCatalogLookups();
      showToast('Product added successfully');
      hideProductModal();
      renderProducts();
      return;
    }

    if (Object.keys(changes).length === 0) {
      showToast('No changes detected');
      hideProductModal();
      return;
    }

    if (_currentEditingProduct) {
      const updatePayload = {
        ...changes,
        updatedBy: user.uid,
        updatedByName: user.displayName || user.email || 'Unknown User',
        updatedAt: FB.serverTimestamp()
      };
      await FB.updateDoc(FB.docRef('products', _currentEditingProduct.id), updatePayload);
      const existingIndex = _products.findIndex(product => product.id === _currentEditingProduct.id);
      if (existingIndex >= 0) {
        const updatedProduct = {
          ..._products[existingIndex],
          ...changes,
          updatedBy: user.uid,
          updatedByName: user.displayName || user.email || 'Unknown User',
          updatedAt: Date.now()
        };
        _products[existingIndex] = updatedProduct;
        invalidateProductsViewCache();
        if (_metaCatalogCache.loaded) rebuildMetaCatalogLookups();
        showToast('Product updated successfully');
        hideProductModal();
        await updateEditedProductCard(updatedProduct);
        restoreProductsScrollState();
        return;
      }
    } else {
      const createPayload = {
        ...productData,
        createdBy: user.uid,
        createdByName: user.displayName || user.email || 'Unknown User',
        createdByEmail: user.email || '',
        createdAt: FB.serverTimestamp(),
        updatedBy: user.uid,
        updatedByName: user.displayName || user.email || 'Unknown User',
        updatedAt: FB.serverTimestamp()
      };
      const createdDoc = await FB.addDoc(FB.col('products'), createPayload);
      _products.unshift({
        id: createdDoc.id,
        ...createPayload,
        createdAt: Date.now(),
        updatedAt: Date.now()
      });
      _productsLoaded = true;
      invalidateProductsViewCache();
      if (_metaCatalogCache.loaded) rebuildMetaCatalogLookups();
      showToast('Product added successfully');
    }
    
    hideProductModal();
    renderProducts();
    
  } catch (error) {
    console.error('Error saving product:', error);
    showAlert('product-alert', 'Failed to save product. Please try again.');
  } finally {
    if (submitBtn) {
      submitBtn.textContent = originalText; // FIX: Product submit button reset
      submitBtn.disabled = false;
    }
  }
}

/**
 * Delete campaign and its items
 */
async function deleteCampaign(campaignId) {
  if (!confirm('Delete this campaign and all its campaign items? This removes the campaign and its occurrences only. Master Products will remain in Products.')) return;

  try {
    const campaign = _campaigns.find(c => c.id === campaignId) || (await FB.getDoc(FB.docRef('saleCampaigns', campaignId))).data();
    if (!campaign) {
      showToast('Campaign not found');
      return;
    }

    const itemsQuery = FB.query(
      FB.col('campaignItems'),
      FB.where('campaignId', '==', campaignId)
    );
    const itemsSnapshot = await FB.getDocs(itemsQuery);

    const metaQuery = FB.query(
      FB.col('metaCatalogItems'),
      FB.where('campaignId', '==', campaignId)
    );
    const metaSnapshot = await FB.getDocs(metaQuery);

    const batch = FB.writeBatch();
    itemsSnapshot.forEach(doc => {
      batch.delete(FB.docRef('campaignItems', doc.id));
    });
    metaSnapshot.forEach(doc => {
      batch.delete(FB.docRef('metaCatalogItems', doc.id));
    });

    batch.delete(FB.docRef('saleCampaigns', campaignId));

    await batch.commit();

    invalidateMetaCatalogCache();

    showToast('Campaign deleted successfully');
    renderCampaigns();

    if (_currentCampaign && _currentCampaign.id === campaignId) {
      _currentCampaign = null;
      window.App.go('campaigns');
    }

  } catch (error) {
    console.error('Error deleting campaign:', error);
    showToast('Failed to delete campaign');
  }
}

/**
 * Delete product
 */
async function deleteProduct(productId) {
  if (!confirm('Are you sure you want to delete this product?')) return;
  
  try {
    const product = _products.find(p => p.id === productId);
    if (!product) {
      showToast('Product not found');
      return;
    }
    
    if (!canDeleteProduct(product)) {
      showToast('Only admins can delete products');
      return;
    }
    
    await FB.deleteDoc(FB.docRef('products', productId));
    _products = _products.filter(product => product.id !== productId);
    _productsLoaded = true;
    invalidateProductsViewCache();
    if (_metaCatalogCache.loaded) rebuildMetaCatalogLookups();
    showToast('Product deleted successfully');
    renderProducts();
    
  } catch (error) {
    console.error('Error deleting product:', error);
    showToast('Failed to delete product');
  }
}

// ── CAMPAIGNS MODULE ─────────────────────────────────────────

/**
 * Load and render campaigns list
 */
async function renderCampaigns() {
  if (!isAdmin()) return;
  
  const container = document.getElementById('campaigns-grid');
  if (!container) return;
  
  try {
    const q = FB.query(
      FB.col('saleCampaigns'),
      FB.orderBy('createdAt', 'desc')
    );
    const snapshot = await FB.getDocs(q);
    
    _campaigns = [];
    snapshot.forEach(doc => {
      _campaigns.push({ id: doc.id, ...doc.data() });
    });
    
    const searchTerm = document.getElementById('campaigns-search')?.value?.toLowerCase() || '';
    const filteredCampaigns = _campaigns.filter(campaign =>
      campaign.saleName?.toLowerCase().includes(searchTerm)
    );
    
    const badge = document.getElementById('campaigns-badge');
    if (badge) badge.textContent = _campaigns.length;
    if (filteredCampaigns.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12l2 2 4-4"/>
          </svg>
          <h3>No Campaigns Found</h3>
          <p>${searchTerm ? 'No campaigns match your search.' : 'Create your first sale campaign to get started.'}</p>
          ${!searchTerm ? '<button class="btn btn-accent" onclick="window.Marketing.showCreateCampaign()">Create Campaign</button>' : ''}
        </div>`;
      return;
    }
    
    container.innerHTML = filteredCampaigns.map(campaign => `
      <div class="campaign-card" onclick="window.Marketing.openCampaign('${campaign.id}')">
        <div class="campaign-name">${escapeHtml(campaign.saleName)}</div>
        <div class="campaign-prompt">${escapeHtml(campaign.prompt)}</div>
        <div class="campaign-meta">
          <div class="campaign-date">${formatDate(campaign.createdAt)}</div>
<div class="campaign-actions">

    <button
        class="btn btn-accent btn-sm"
        onclick="event.stopPropagation(); window.Marketing.openCampaign('${campaign.id}')">
        Open
    </button>

    <button
        class="btn btn-outline btn-sm"
        onclick="event.stopPropagation(); window.Marketing.editCampaign('${campaign.id}')">
        Edit
    </button>

    <button
        class="btn btn-danger btn-sm"
        onclick="event.stopPropagation(); window.Marketing.deleteCampaign('${campaign.id}')">
        Delete
    </button>

</div>
        </div>
      </div>
    `).join('');
    
  } catch (error) {
    console.error('Error loading campaigns:', error);
    showToast('Failed to load campaigns');
    container.innerHTML = '<div class="empty-state"><p>Error loading campaigns</p></div>';
  }
}

function bindMetaProductModalCopyButtons(details) {
  const modal = document.getElementById('meta-product-modal');
  if (!modal) return;

  modal.querySelectorAll('.meta-copy-btn').forEach(button => {
    const originalText = button.dataset.originalText || 'Copy';
    button.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (button.disabled) return;
      const field = button.dataset.copyField;
      const value = details[field];
      try {
        await navigator.clipboard.writeText(String(value ?? ''));
        button.textContent = '✓ Copied';
        button.classList.add('is-copied');
        window.setTimeout(() => {
          button.textContent = originalText;
          button.classList.remove('is-copied');
        }, 1600);
        showToast('Copied to clipboard');
      } catch (error) {
        console.error('Error copying meta product field:', error);
        showToast('Unable to copy field');
      }
    });
  });
}

async function openMetaProductDetails(itemId) {
  const popupStart = performance.now();
  _activeMetaProductItemId = itemId;
  try {
    const metaEntry = _metaCatalogItems.find(entry => (entry.campaignItemId || entry.id) === itemId || entry.id === itemId) || null;
    if (!metaEntry) {
      showToast('Meta product not found');
      return;
    }

    const details = await loadMetaProductDetailData(metaEntry);
    const metaState = normalizeMetaStatus(metaEntry?.metaStatus);
    const isAdded = metaState === 'added';

    _activeMetaProductDetails = {
      itemId,
      metaState,
      ...details
    };

    const detailFields = [
      { key: 'productName', label: 'Product Name', value: details.productName, copyValue: details.productName },
      { key: 'productDescription', label: 'Product Description', value: details.productDescription, copyValue: details.productDescription },
      { key: 'productUrl', label: 'Product URL', value: details.productUrl, copyValue: details.productUrl },
      { key: 'mrp', label: 'MRP', value: formatMetaCurrency(details.mrp), copyValue: String(details.mrp) },
      { key: 'sellingPrice', label: 'Selling Price', value: formatMetaCurrency(details.sellingPrice), copyValue: String(details.sellingPrice) },
      { key: 'modelNumber', label: 'Model Number', value: details.modelNumber, copyValue: details.modelNumber }
    ];

    const imageMarkup = details.imageUrl
      ? `<div class="meta-product-summary-image"><img src="${escapeHtml(getThumbnail(details.imageUrl, 320))}" alt="${escapeHtml(details.productName)}" loading="lazy" decoding="async" onerror="this.style.display='none';"/></div>`
      : '<div class="meta-product-summary-image meta-product-detail-placeholder">No Image</div>';

    const fieldsMarkup = detailFields.map(field => {
      const hasValue = hasCopyValue(field.copyValue);
      return `
        <div class="meta-product-detail-field">
          <div class="meta-product-detail-meta">
            <div class="meta-product-detail-label">${escapeHtml(field.label)}</div>
            <div class="meta-product-detail-value">${escapeHtml(field.value)}</div>
          </div>
          <button class="btn btn-ghost btn-xs meta-copy-btn" data-original-text="Copy" data-copy-field="${field.key}" ${hasValue ? '' : 'disabled'}>Copy</button>
        </div>
      `;
    }).join('');

    document.getElementById('meta-product-modal-title').textContent = details.productName;
    document.getElementById('meta-product-modal-body').innerHTML = `
      <div class="meta-product-detail-card">
        <div class="meta-product-summary-row">
          ${imageMarkup}
          <div class="meta-product-summary-info">
            <div class="meta-product-summary-name">${escapeHtml(details.productName)}</div>
            <div class="meta-product-summary-status">
              <span class="status-badge ${metaState}">${metaState === 'added' ? 'ADDED' : 'PENDING'}</span>
            </div>
          </div>
        </div>
        <div class="meta-product-detail-fields">${fieldsMarkup}</div>
      </div>
    `;

    const footer = document.getElementById('meta-product-modal-footer');
    if (footer) {
      footer.innerHTML = `
        <button type="button" class="btn btn-outline" onclick="window.Marketing.hideMetaProductModal()">Close</button>
        <button type="button" class="btn ${isAdded ? 'btn-outline' : 'btn-accent'} btn-sm meta-modal-action-btn" ${isAdded ? 'disabled' : ''} onclick="event.stopPropagation(); window.Marketing.toggleMetaProductAdded()">
          ${isAdded ? '✓ Added' : 'Mark Added'}
        </button>
      `;
    }

    bindMetaProductModalCopyButtons(_activeMetaProductDetails);
    preserveMetaProductModalScrollState();
    openModal('meta-product-modal');
    recordMetaPerfMetric('Meta Product Popup Open', performance.now() - popupStart);
  } catch (error) {
    console.error('Error opening meta product details:', error);
    showToast('Failed to load product details');
  }
}

function hideMetaProductModal() {
  _activeMetaProductItemId = null;
  _activeMetaProductDetails = null;
  closeModal('meta-product-modal');
  restoreMetaProductModalScrollState();
}

async function toggleMetaProductAdded() {
  if (!_activeMetaProductItemId) return;

  try {
    const currentEntry = _metaCatalogCache.metaByCampaignItemId.get(_activeMetaProductItemId) || {};
    const nextStatus = normalizeMetaStatus(currentEntry.metaStatus) === 'added' ? 'pending' : 'added';
    await persistMetaCatalogStatus(_activeMetaProductItemId, nextStatus, currentEntry);
    if (_metaCatalogActiveCampaignId) {
      await openMetaCatalogCampaign(_metaCatalogActiveCampaignId);
    }
    hideMetaProductModal();
    showToast(`Meta product marked as ${nextStatus}`);
  } catch (error) {
    console.error('Error updating meta product status:', error);
    showToast('Failed to update meta product status');
  }
}

async function persistMetaCatalogStatus(itemId, nextStatus, currentEntry = {}) {
  const updatedEntry = {
    id: itemId,
    ...currentEntry,
    campaignItemId: itemId,
    metaStatus: nextStatus,
    updatedAt: FB.serverTimestamp(),
    createdAt: currentEntry.createdAt || FB.serverTimestamp()
  };
  await FB.setDoc(FB.docRef('metaCatalogItems', itemId), {
    campaignId: updatedEntry.campaignId || '',
    campaignItemId: itemId,
    productId: updatedEntry.productId || '',
    metaStatus: nextStatus,
    updatedAt: updatedEntry.updatedAt,
    createdAt: updatedEntry.createdAt
  }, { merge: true });

  const existingIndex = _metaCatalogCache.metaItems.findIndex(entry => (entry.campaignItemId || entry.id) === itemId);
  if (existingIndex >= 0) {
    _metaCatalogCache.metaItems[existingIndex] = { ..._metaCatalogCache.metaItems[existingIndex], ...updatedEntry };
  } else {
    _metaCatalogCache.metaItems.push(updatedEntry);
  }
  _metaCatalogItems = _metaCatalogCache.metaItems;
  rebuildMetaCatalogLookups();
}

async function renderMetaCatalog(options = {}) {
  if (!isAdmin()) return;

  const container = document.getElementById('meta-campaigns-grid');
  const detail = document.getElementById('meta-catalog-detail');
  const detailProductsGrid = document.getElementById('meta-catalog-products-grid');

  if (!container) return;

  const renderStart = performance.now();
  try {
    if (!_metaCatalogCache.loaded) {
      container.innerHTML = '<div class="empty-state"><p>Loading Meta Product Catalog...</p></div>';
    }
    const data = await loadMetaCatalogData(options);

    const searchTerm = document.getElementById('meta-campaign-search')?.value?.toLowerCase() || '';
    const filteredCampaigns = data.campaigns.filter(campaign =>
      (campaign.saleName || '').toLowerCase().includes(searchTerm)
    );

    if (detail) detail.style.display = 'none';
    if (detailProductsGrid) detailProductsGrid.innerHTML = '';
    if (container) container.style.display = 'grid';

    if (filteredCampaigns.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="10"/>
            <path d="M8 12l2 2 4-4"/>
          </svg>
          <h3>No Campaigns Available</h3>
          <p>No completed campaigns are available for the Meta Product Catalog yet.</p>
        </div>`;
      recordMetaPerfMetric('Meta Catalog Render', performance.now() - renderStart);
      return;
    }

    const campaignCards = filteredCampaigns.map(campaign => {
      return `
        <div class="campaign-card" onclick="window.Marketing.openMetaCatalogCampaign('${campaign.id}')">
          <div class="campaign-name">${escapeHtml(campaign.saleName)}</div>
          <div class="campaign-prompt">${escapeHtml(campaign.prompt)}</div>
          <div class="campaign-meta">
            <div class="campaign-date">${formatDate(campaign.createdAt)}</div>
            <div class="campaign-actions">
              <button class="btn btn-accent btn-sm" onclick="event.stopPropagation(); window.Marketing.openMetaCatalogCampaign('${campaign.id}')">Open</button>
            </div>
          </div>
        </div>
      `;
    });

    container.innerHTML = campaignCards.join('');
    recordMetaPerfMetric('Meta Catalog Render', performance.now() - renderStart);
  } catch (error) {
    console.error('Error rendering meta catalog:', error);
    showToast('Failed to load Meta Product Catalog');
    container.innerHTML = '<div class="empty-state"><h3>Meta Product Catalog unavailable</h3><p>Try loading the catalog again.</p><button class="btn btn-accent" onclick="window.Marketing.renderMetaCatalog({ force: true })">Retry</button></div>';
  }
}

function filterMetaCatalog(filter) {
  _metaCatalogFilter = filter;
  document.querySelectorAll('.meta-status-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.filter === filter);
  });
  if (_metaCatalogActiveCampaignId) {
    openMetaCatalogCampaign(_metaCatalogActiveCampaignId);
  }
}

function handleMetaCatalogSearchInput() {
  if (_metaCatalogRenderTimer) clearTimeout(_metaCatalogRenderTimer);
  _metaCatalogRenderTimer = setTimeout(() => renderMetaCatalog(), 250);
}

function closeMetaCatalogCampaign() {
  _metaCatalogActiveCampaignId = null;
  const container = document.getElementById('meta-campaigns-grid');
  const detail = document.getElementById('meta-catalog-detail');
  const detailProductsGrid = document.getElementById('meta-catalog-products-grid');
  if (container) container.style.display = 'grid';
  if (detail) detail.style.display = 'none';
  if (detailProductsGrid) detailProductsGrid.innerHTML = '';
}

async function openMetaCatalogCampaign(campaignId) {
  const openStart = performance.now();
  _metaCatalogActiveCampaignId = campaignId;
  const container = document.getElementById('meta-campaigns-grid');
  const detail = document.getElementById('meta-catalog-detail');
  const detailProductsGrid = document.getElementById('meta-catalog-products-grid');
  const campaign = _metaCatalogCache.campaignsById.get(campaignId) || _campaigns.find(item => item.id === campaignId);
  if (!detail || !detailProductsGrid || !campaign) return;

  if (container) container.style.display = 'none';
  detail.style.display = 'block';
  detailProductsGrid.innerHTML = '';

  try {
    const data = await loadMetaCatalogData();
    const items = data.campaignItemsByCampaign.get(campaignId) || [];

    const metaMap = new Map([...data.metaByCampaignItemId.entries()].map(([id, entry]) => [id, normalizeMetaStatus(entry.metaStatus)]));
    const eligibleItems = items.filter(item => String(item.status || '').trim().toLowerCase() === 'completed');
    const totalCount = eligibleItems.length;
    const pendingCount = eligibleItems.filter(item => (metaMap.get(item.id) || 'pending') === 'pending').length;
    const addedCount = eligibleItems.filter(item => (metaMap.get(item.id) || 'pending') === 'added').length;

    document.getElementById('meta-total-count').textContent = String(totalCount);
    document.getElementById('meta-pending-count').textContent = String(pendingCount);
    document.getElementById('meta-added-count').textContent = String(addedCount);

    const finalizedItems = eligibleItems.filter(item => {
      const metaState = metaMap.get(item.id) || 'pending';
      if (_metaCatalogFilter === 'pending') return metaState === 'pending';
      if (_metaCatalogFilter === 'added') return metaState === 'added';
      return true;
    });

    document.getElementById('meta-campaign-detail-name').textContent = campaign.saleName || 'Campaign';
    document.getElementById('meta-campaign-detail-subtitle').textContent = 'Meta Product Catalog';

    if (finalizedItems.length === 0) {
      detailProductsGrid.innerHTML = `<div class="empty-state"><p>No matching Meta products for this campaign.</p></div>`;
      return;
    }

    const productLookupStart = performance.now();
    const productRecords = data.productsById;
    recordMetaPerfMetric('Product Lookup', performance.now() - productLookupStart);

    detailProductsGrid.innerHTML = finalizedItems.map(item => {
      const productId = item.productId;
      const latestProduct = productRecords.get(productId) || {};
      const productImage = latestProduct.imageUrl || latestProduct.image || '';
      const metaState = metaMap.get(item.id) || 'pending';
      const buttonLabel = metaState === 'added' ? '✓ Added to Meta' : 'Mark Added';
      const buttonClass = metaState === 'added' ? 'btn btn-outline btn-sm meta-card-button disabled' : 'btn btn-accent btn-sm meta-card-button';
      const modelLabel = latestProduct.modelNumber || 'Not Added';
      const image = productImage ? `<img src="${escapeHtml(getThumbnail(productImage, 200))}" alt="${escapeHtml(item.productName || 'Product')}" loading="lazy" decoding="async" onerror="this.style.display='none';"/>` : '<div style="display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>';
      const actionMarkup = metaState === 'added'
        ? `<button class="${buttonClass}" disabled>✓ Added to Meta</button>`
        : `<button class="${buttonClass}" onclick="event.stopPropagation(); window.Marketing.toggleMetaCatalogStatus('${item.id}')">${buttonLabel}</button>`;

      return `
        <div class="meta-product-card" onclick="event.stopPropagation(); window.Marketing.openMetaProductDetails('${item.id}')">
          <div class="meta-product-image">${image}</div>
          <div class="meta-product-body">
            <div class="meta-product-name">${escapeHtml(item.productName || 'Untitled Product')}</div>
            <div class="meta-product-model">Model: ${escapeHtml(modelLabel)}</div>
            <div class="meta-product-status-row">
              <span class="status-badge completed">COMPLETED</span>
              <span class="status-badge ${metaState}">${getMetaStatusLabel(metaState).toUpperCase()}</span>
            </div>
            <div class="meta-product-actions">
              <button class="btn btn-outline btn-sm meta-card-button" onclick="event.stopPropagation(); window.Marketing.openMetaProductDetails('${item.id}')">View Details</button>
              ${actionMarkup}
            </div>
          </div>
        </div>
      `;
    }).join('');

    detail.style.display = 'block';
  recordMetaPerfMetric('Meta Campaign Open', performance.now() - openStart);
  } catch (error) {
    console.error('Error opening meta catalog campaign:', error);
    showToast('Failed to load Meta catalog details');
  }
}

async function toggleMetaCatalogStatus(itemId) {
  try {
    const currentEntry = _metaCatalogCache.metaByCampaignItemId.get(itemId) || {};
    const nextStatus = normalizeMetaStatus(currentEntry.metaStatus) === 'added' ? 'pending' : 'added';
    await persistMetaCatalogStatus(itemId, nextStatus, currentEntry);
    if (_metaCatalogActiveCampaignId) {
      await openMetaCatalogCampaign(_metaCatalogActiveCampaignId);
    }
    showToast(`Meta product marked as ${nextStatus}`);
  } catch (error) {
    console.error('Error updating meta catalog status:', error);
    showToast('Failed to update meta catalog status');
  }
}

/**
 * Show create campaign modal
 */
function showCreateCampaign() {
    if (!isAdmin()) {
        showToast("Only admins can create campaigns");
        return;
    }

    _currentEditingCampaign = null;

    document.getElementById("campaign-modal-title").textContent = "Create Campaign";

    document.getElementById("campaign-form").reset();

    const submitBtn = document.querySelector("#campaign-form button[type='submit']");
    if (submitBtn) submitBtn.textContent = "Create Campaign";

    hideAlert("campaign-alert");

    openModal("campaign-modal");
}
let _currentEditingCampaign = null;

async function editCampaign(campaignId) {

    try {

        const campaign = _campaigns.find(c => c.id === campaignId);

        if (!campaign) {
            showToast("Campaign not found");
            return;
        }

        _currentEditingCampaign = campaign;

        document.getElementById("campaign-modal-title").textContent = "Edit Campaign";

        document.getElementById("campaign-name").value = campaign.saleName || "";

        document.getElementById("campaign-prompt").value = campaign.prompt || "";
        const submitBtn = document.querySelector("#campaign-form button[type='submit']");
if (submitBtn) submitBtn.textContent = "Update Campaign";
        hideAlert("campaign-alert");

        openModal("campaign-modal");

    } catch (error) {

        console.error(error);

        showToast("Failed to load campaign");

    }

}
/**
 * Hide campaign modal
 */
function hideCampaignModal() {
  closeModal('campaign-modal');
}

/**
 * Handle campaign form submission
 */
async function handleCampaignSubmit(event) {
  event.preventDefault();
  
  const user = getUser();
  if (!user || !isAdmin()) {
    showAlert('campaign-alert', 'Only admins can create campaigns');
    return;
  }
  
  // Get form data
  const saleName = document.getElementById('campaign-name').value.trim();
  const prompt = document.getElementById('campaign-prompt').value.trim();
  
  // Validate
  if (!saleName) {
    showAlert('campaign-alert', 'Sale name is required');
    return;
  }
  
  if (!prompt) {
    showAlert('campaign-alert', 'Prompt is required');
    return;
  }
  
  // Get button reference and store original text before try block
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn?.textContent || '';
  const isEditing = Boolean(_currentEditingCampaign);
  
  try {
    hideAlert('campaign-alert');
    if (submitBtn) {
      submitBtn.textContent = isEditing ? 'Updating...' : 'Creating...'; // FIX: Campaign button loading state
      submitBtn.disabled = true;
    }
    
    const campaignData = {
      saleName,
      prompt,
      updatedAt: FB.serverTimestamp() // FIX: Preserve createdAt and createdBy on update
    };

    if (isEditing) {
      await FB.updateDoc(
        FB.docRef('saleCampaigns', _currentEditingCampaign.id),
        campaignData
      );

      showToast('Campaign updated successfully');

      if (_currentCampaign && _currentCampaign.id === _currentEditingCampaign.id) {
        _currentCampaign.saleName = saleName; // FIX: Campaign edit refresh
        _currentCampaign.prompt = prompt; // FIX: Campaign edit refresh
        const detailName = document.getElementById('campaign-detail-name');
        const detailPrompt = document.getElementById('campaign-detail-prompt');
        if (detailName) detailName.textContent = saleName;
        if (detailPrompt) detailPrompt.textContent = prompt;
      }

      const regeneratePending = confirm('Campaign updated. Regenerate pending campaign items with the new prompt? This will only update pending items.');
      if (regeneratePending) {
        await regeneratePendingCampaignItems(_currentEditingCampaign.id, prompt);
      }

      if (_currentCampaign && _currentCampaign.id === _currentEditingCampaign.id) {
        await renderCampaignDetail();
      }
    } else {
      const createCampaignData = {
        ...campaignData,
        createdBy: user.uid,
        createdAt: FB.serverTimestamp()
      };

      await FB.addDoc(
        FB.col('saleCampaigns'),
        createCampaignData
      );

      showToast('Campaign created successfully');
    }
    
    hideCampaignModal();
    renderCampaigns();
    
  } catch (error) {
    console.error('Error creating campaign:', error);
    showAlert('campaign-alert', 'Failed to create campaign. Please try again.');
  } finally {
    if (submitBtn) {
      submitBtn.textContent = originalText; // FIX: Campaign button restore
      submitBtn.disabled = false;
    }
  }
}
/**
 * Open campaign details
 */
async function openCampaign(campaignId) {
  if (!isAdmin()) {
    showToast('Only admins can access campaigns');
    return;
  }

  try {
    const campaign = _campaigns.find(c => c.id === campaignId) || (await FB.getDoc(FB.docRef('saleCampaigns', campaignId))).data();

    if (!campaign) {
      showToast('Campaign not found');
      return;
    }

    _currentCampaign = { id: campaignId, ...campaign };

    // Update UI immediately from cached data
    document.getElementById('campaign-detail-name').textContent = campaign.saleName;
    document.getElementById('campaign-detail-prompt').textContent = campaign.prompt;

    const cachedItems = _campaignItemsCache.get(campaignId) || [];
    const hasItems = cachedItems.length > 0;

    const addProductsBtn = document.getElementById('campaign-add-products-btn');
    if (addProductsBtn) {
      addProductsBtn.style.display = hasItems ? 'inline-flex' : 'none';
    }

    if (!hasItems) {
      document.getElementById('product-selection').style.display = 'block';
      document.getElementById('campaign-tabs').style.display = 'none';
      document.getElementById('campaign-items-grid').style.display = 'none';
      _campaignProductSelectionMode = 'start';
      updateCampaignSelectionUi();
      await renderCampaignProducts();
    } else {
      document.getElementById('product-selection').style.display = 'none';
      document.getElementById('campaign-tabs').style.display = 'flex';
      document.getElementById('campaign-items-grid').style.display = 'grid';
      await loadCampaignItems(campaignId, { force: false });
      switchCampaignTab(_currentActiveTab);
    }

    window.App.go('campaign-detail');
  } catch (error) {
    console.error('Error loading campaign:', error);
    showToast('Failed to load campaign details');
  }
}

function updateCampaignSelectionUi() {
  const selectionTitle = document.getElementById('campaign-selection-title');
  if (selectionTitle) {
    selectionTitle.textContent = _campaignProductSelectionMode === 'add'
      ? 'Add Products to Campaign'
      : 'Select Products for Campaign';
  }

  const submitBtn = document.getElementById('campaign-selection-submit-btn');
  if (submitBtn) {
    submitBtn.textContent = _campaignProductSelectionMode === 'add' ? 'Add Products' : 'Start Campaign';
  }
}

async function showCampaignProductSelector(mode = 'start') {
  if (!_currentCampaign) return;

  _campaignProductSelectionMode = mode;
  _selectedProductIds.clear();
  updateCampaignSelectionUi();

  document.getElementById('product-selection').style.display = 'block';
  document.getElementById('campaign-tabs').style.display = 'flex';
  document.getElementById('campaign-items-grid').style.display = 'grid';

  await loadCampaignItems();
  await renderCampaignProducts();
}

/**
 * Render products for campaign selection
 */
async function renderCampaignProducts() {
  const container = document.getElementById('campaign-products-list');
  if (!container) return;

  updateCampaignSelectionUi();

  try {
    const products = await loadProductsCatalog();
    const existingProductIds = new Set((_campaignItemsCache.get(_currentCampaign?.id) || []).map(item => item.productId));

    const searchTerm = document.getElementById('campaign-products-search')?.value?.toLowerCase() || '';
    const filteredProducts = products.filter(product => {
      if (_campaignProductSelectionMode === 'add' && existingProductIds.has(product.id)) {
        return false;
      }
      return product.productName?.toLowerCase().includes(searchTerm);
    });

    if (filteredProducts.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <p>${searchTerm ? 'No products match your search.' : 'No products available to add.'}</p>
        </div>`;
      return;
    }
  
    container.innerHTML = filteredProducts.map(product => {
      let imageSrc = '';
      if (product.imageUrl) {
        imageSrc = getThumbnail(product.imageUrl, 40);
      } else if (product.image) {
        imageSrc = getThumbnail(product.image, 40);
      }

      return `
      <div class="campaign-product-item ${_selectedProductIds.has(product.id) ? 'selected' : ''}" 
           onclick="window.Marketing.toggleProductSelection('${product.id}')">
        <div class="campaign-product-header">
          <input type="checkbox" ${_selectedProductIds.has(product.id) ? 'checked' : ''} 
                 onchange="window.Marketing.toggleProductSelection('${product.id}')" 
                 onclick="event.stopPropagation()"/>
          <div class="campaign-product-image">
            ${imageSrc 
              ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(product.productName || 'Product')}" loading="lazy" onerror="this.style.display='none';"/>`
              : '<div style="width:40px;height:40px;background:#f0f0f0;border-radius:4px;"></div>'
            }
          </div>
          <div class="campaign-product-info">
            <div class="campaign-product-name">${escapeHtml(product.productName || 'Untitled Product')}</div>
            <div class="campaign-product-price">₹${product.sellingPrice || 0} (${normalizeDiscountPercent(product.discount)}% OFF)</div>
          </div>
        </div>
      </div>`;
    }).join('');
  } catch (error) {
    console.error('Error rendering campaign products:', error);
    container.innerHTML = '<div class="empty-state"><p>Failed to load products.</p></div>';
  }
}

/**
 * Toggle product selection
 */
function toggleProductSelection(productId) {
  if (_selectedProductIds.has(productId)) {
    _selectedProductIds.delete(productId);
  } else {
    _selectedProductIds.add(productId);
  }
  
  // Update select all checkbox
  const selectAllCheckbox = document.getElementById('select-all-products');
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = _selectedProductIds.size === _products.length;
  }
  
  renderCampaignProducts();
}
/**
 * Toggle select all products
 */
function toggleSelectAll() {
  const selectAllCheckbox = document.getElementById('select-all-products');
  const isChecked = selectAllCheckbox.checked;
  
  if (isChecked) {
    _products.forEach(product => _selectedProductIds.add(product.id));
  } else {
    _selectedProductIds.clear();
  }
  
  renderCampaignProducts();
}

/**
 * Start campaign with selected products
 */
async function startCampaign() {
  if (!_currentCampaign || _selectedProductIds.size === 0) {
    showToast('Please select at least one product');
    return;
  }
  
  try {
    hideAlert('product-alert');
    const batch = FB.writeBatch();
    const selectedProductIds = [..._selectedProductIds];
    const selectedProducts = await Promise.all(selectedProductIds.map(async id => {
      const latestProduct = await getLatestProductData(id);
      return latestProduct || _products.find(p => p.id === id);
    }));

    const existingProductIds = new Set(_campaignItems.map(item => item.productId));
    const newProducts = selectedProducts.filter(product => product && !existingProductIds.has(product.id));

    if (newProducts.length === 0) {
      showToast('All selected products are already in this campaign');
      return;
    }
    
    showToast(_campaignProductSelectionMode === 'add' ? 'Adding products...' : 'Starting campaign...');
    
    for (const product of newProducts) {
      if (!product) continue;
      const generatedPrompt = buildGeneratedPrompt(_currentCampaign.prompt || '', product); // FIX: Prompt placeholder generation
      const campaignItemData = {
        campaignId: _currentCampaign.id,
        productId: product.id, // Store only productId, not image URL
        productName: product.productName || 'Untitled Product',
        // Remove imageUrl - will be fetched from product document when needed
        mrp: product.mrp || 0,
        sellingPrice: product.sellingPrice || 0,
        discount: product.discount || 0,
        youSave: product.youSave || 0,
        generatedPrompt,
        status: 'pending',
        createdAt: FB.serverTimestamp()
      };
      
      const docRef = FB.docRef('campaignItems', `${_currentCampaign.id}_${product.id}_${Date.now()}`);
      batch.set(docRef, campaignItemData);
    }
    
    await batch.commit();
    
    // Clear selection and reload
    _selectedProductIds.clear();
    showToast(_campaignProductSelectionMode === 'add' ? 'Products added to campaign' : 'Campaign started successfully');
    
    // Switch to campaign view
    document.getElementById('product-selection').style.display = 'none';
    document.getElementById('campaign-tabs').style.display = 'flex';
    document.getElementById('campaign-items-grid').style.display = 'grid';
    
    await loadCampaignItems();
    switchCampaignTab('pending');
    
  } catch (error) {
    console.error('Error starting campaign:', error);
    showToast('Failed to start campaign');
  }
}

/**
 * Build prompt from campaign template and product values
 */
function buildGeneratedPrompt(template, product) {
  if (!template) return '';
  return template
    .replace(/\{\{PRODUCT_NAME\}\}/g, product.productName || '')
    .replace(/\{\{MRP\}\}/g, product.mrp || 0)
    .replace(/\{\{SALE_PRICE\}\}/g, product.sellingPrice || 0)
    .replace(/\{\{DISCOUNT\}\}/g, product.discount || 0)
    .replace(/\{\{YOU_SAVE\}\}/g, product.youSave || 0);
}

async function getLatestProductData(productId) {
  try {
    const productDoc = await FB.getDoc(FB.docRef('products', productId));
    if (!productDoc.exists()) return null;
    return { id: productDoc.id, ...productDoc.data() };
  } catch (error) {
    console.error('Error fetching latest product data:', error);
    return null;
  }
}

/**
 * Regenerate only pending campaign items when campaign prompt updates
 */
async function regeneratePendingCampaignItems(campaignId, promptTemplate) {
  try {
    const itemsQuery = FB.query(
      FB.col('campaignItems'),
      FB.where('campaignId', '==', campaignId),
      FB.where('status', '==', 'pending')
    );
    const snapshot = await FB.getDocs(itemsQuery);

    if (snapshot.empty) return;

    const updates = [];
    snapshot.forEach(doc => {
      updates.push({ id: doc.id, data: doc.data() });
    });

    const chunks = [];
    for (let i = 0; i < updates.length; i += 500) {
      chunks.push(updates.slice(i, i + 500));
    }

    for (const chunk of chunks) {
      const batch = FB.writeBatch();
      for (const item of chunk) {
        const data = item.data;
        const latestProduct = await getLatestProductData(data.productId);
        const productData = latestProduct || {
          productName: data.productName || '',
          mrp: data.mrp || 0,
          sellingPrice: data.sellingPrice || 0,
          discount: data.discount || 0,
          youSave: data.youSave || 0
        };
        const regeneratedPrompt = buildGeneratedPrompt(promptTemplate, productData);
        const updatePayload = {
          generatedPrompt: regeneratedPrompt,
          updatedAt: FB.serverTimestamp()
        };
        if (latestProduct && latestProduct.productName) {
          updatePayload.productName = latestProduct.productName;
        }
        batch.update(FB.docRef('campaignItems', item.id), updatePayload);
      }
      await batch.commit();
    }
  } catch (error) {
    console.error('Error regenerating pending campaign items:', error);
  }
}

/**
 * Load campaign items
 */
async function loadCampaignItems(campaignId = _currentCampaign?.id, options = {}) {
  if (!campaignId) return;

  const { force = false } = options;
  const cachedItems = _campaignItemsCache.get(campaignId);

  if (!force && cachedItems) {
    _campaignItems = cachedItems;
    updateCampaignItemCounts(cachedItems);
    return cachedItems;
  }

  if (_campaignItemsLoadPromise.has(campaignId)) {
    return _campaignItemsLoadPromise.get(campaignId);
  }

  const loadStart = performance.now();
  const promise = (async () => {
    try {
      const q = FB.query(
        FB.col('campaignItems'),
        FB.where('campaignId', '==', campaignId),
        FB.orderBy('createdAt', 'desc')
      );
      const snapshot = await FB.getDocs(q);

      const items = [];
      snapshot.forEach(doc => {
        items.push({ id: doc.id, ...doc.data() });
      });

      _campaignItemsCache.set(campaignId, items);
      _campaignItems = items;
      updateCampaignItemCounts(items);
      console.log('[CampaignPerf]', { campaignItemsFetch: performance.now() - loadStart, campaignId });
      return items;
    } catch (error) {
      console.error('Error loading campaign items:', error);
      showToast('Failed to load campaign items');
      throw error;
    } finally {
      _campaignItemsLoadPromise.delete(campaignId);
    }
  })();

  _campaignItemsLoadPromise.set(campaignId, promise);
  return promise;
}

function updateCampaignItemCounts(items = _campaignItems) {
  const pendingCount = items.filter(item => item.status === 'pending').length;
  const generatingCount = items.filter(item => item.status === 'generating').length;
  const completedCount = items.filter(item => item.status === 'completed').length;

  const pendingEl = document.getElementById('pending-count');
  const generatingEl = document.getElementById('generating-count');
  const completedEl = document.getElementById('completed-count');

  if (pendingEl) pendingEl.textContent = pendingCount;
  if (generatingEl) generatingEl.textContent = generatingCount;
  if (completedEl) completedEl.textContent = completedCount;
}

/**
 * Switch campaign tab
 */
function switchCampaignTab(status) {
  _currentActiveTab = status;
  
  // Update tab buttons
  document.querySelectorAll('.campaign-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.status === status);
  });
  
  renderCampaignItems();
}

/**
 * Render campaign items for current tab
 */
async function renderCampaignItems() {
  const container = document.getElementById('campaign-items-grid');
  if (!container) return;

  const filteredItems = _campaignItems.filter(item => item.status === _currentActiveTab);

  if (filteredItems.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
        </svg>
        <h3>No ${_currentActiveTab} items</h3>
        <p>No items in ${_currentActiveTab} status.</p>
      </div>`;
    return;
  }

  const productIds = [...new Set(filteredItems.map(item => item.productId))];
  const productImages = await getProductImages(productIds);

  container.innerHTML = filteredItems.map(item => {
    const productImage = productImages[item.productId] || '';
    let imageSrc = '';
    if (productImage) {
      imageSrc = getThumbnail(productImage, 140);
    }

    return `
      <div class="campaign-item-card" data-item-id="${escapeHtml(item.id || '')}" data-product-id="${escapeHtml(item.productId || '')}" onclick="window.Marketing.openCampaignItem('${item.id}')">
        <div class="campaign-item-card-header">
          <div class="campaign-item-name">${escapeHtml(item.productName || 'Untitled Product')}</div>
          <button class="campaign-item-delete-btn" onclick="event.stopPropagation(); window.Marketing.deleteCampaignItem('${item.id}')" aria-label="Delete campaign item">🗑️</button>
        </div>
        <div class="campaign-item-image">
          ${imageSrc 
? `
<img
    src="${escapeHtml(imageSrc)}"
    alt="${escapeHtml(item.productName || 'Product')}"
    loading="lazy"
    onerror="this.style.display='none';"
/>
`            : '<div style="display:flex;align-items:center;justify-content:center;color:var(--text3)">No Image</div>'
          }
        </div>
        <div class="campaign-item-status">
          <span class="status-badge ${item.status}">${item.status.toUpperCase()}</span>
        </div>
        <div class="campaign-item-actions">
          <button class="btn btn-outline btn-sm" onclick="event.stopPropagation(); window.Marketing.openCampaignItem('${item.id}')">
            Open
          </button>
        </div>
      </div>
    `;
  }).join('');
}

/**
 * Get product images by product IDs
 */
async function getProductImages(productIds) {
  if (!productIds || productIds.length === 0) {
    return {};
  }

  try {
    const productImages = {};
    const productsById = new Map(_products.map(product => [product.id, product]));

    productIds.forEach(productId => {
      const product = productsById.get(productId);
      if (product) {
        productImages[productId] = product.imageUrl || product.image || '';
      }
    });

    return productImages;
  } catch (error) {
    console.error('Error fetching product images:', error);
    return {};
  }
}

/**
 * Render campaign detail (used when navigating back to campaign)
 */
async function renderCampaignDetail() {
  if (_currentCampaign) {
    const start = performance.now();
    await loadCampaignItems(_currentCampaign.id, { force: false });
    switchCampaignTab(_currentActiveTab);
    console.log('[CampaignPerf]', { campaignRender: performance.now() - start, campaignId: _currentCampaign.id });
  }
}

/**
 * Delete a single campaign item without removing the product
 */
async function deleteCampaignItem(itemId) {
  const item = _campaignItems.find(i => i.id === itemId);
  if (!item) {
    showToast('Campaign item not found');
    return;
  }

  let confirmationMessage = 'Remove this product from this campaign only? The original product will remain in Products.';
  if (item.status === 'generating') {
    confirmationMessage = 'This campaign item is currently generating. Remove it from this campaign only? The original product will remain in Products.';
  } else if (item.status === 'completed') {
    confirmationMessage = 'This completed campaign item will be removed from this campaign only. The original product will remain in Products. Continue?';
  }

  if (!confirm(confirmationMessage)) return;

  if (item.status === 'completed' && !confirm('Completed items require an additional confirmation before removal. Continue?')) {
    return;
  }

  try {
    await FB.deleteDoc(FB.docRef('campaignItems', itemId));
    try {
      await FB.deleteDoc(FB.docRef('metaCatalogItems', itemId));
    } catch (metaDeleteError) {
      console.info('No meta catalog record to remove for campaign item:', itemId);
    }
    if (_metaCatalogCache.loaded) {
      _metaCatalogCache.campaignItems = _metaCatalogCache.campaignItems.filter(entry => entry.id !== itemId);
      _metaCatalogCache.metaItems = _metaCatalogCache.metaItems.filter(entry => (entry.campaignItemId || entry.id) !== itemId);
      rebuildMetaCatalogLookups();
      _metaCatalogItems = _metaCatalogCache.metaItems;
    }
    showToast('Campaign item removed');
    const updatedItems = _campaignItems.filter(item => item.id !== itemId);
    _campaignItems = updatedItems;
    _campaignItemsCache.set(_currentCampaign?.id, updatedItems);
    updateCampaignItemCounts(updatedItems);
    switchCampaignTab(_currentActiveTab);
  } catch (error) {
    console.error('Error deleting campaign item:', error);
    showToast('Failed to remove campaign item');
  }
}

/**
 * Open campaign item modal
 */
async function openCampaignItem(itemId) {
  try {
    const item = _campaignItems.find(i => i.id === itemId);
    if (!item) {
      showToast('Campaign item not found');
      return;
    }
    
    _currentCampaignItem = item;
    
    // Fetch the latest product data for accurate prompt generation
    let latestProduct = null;
    let productImage = '';
    if (item.productId) {
      latestProduct = await getLatestProductData(item.productId);
      if (latestProduct) {
        productImage = getResponsive(latestProduct.imageUrl || latestProduct.image || '', 120) || '';
      }
    }
    
    const displayProduct = latestProduct || {
      productName: item.productName || '',
      mrp: item.mrp || 0,
      sellingPrice: item.sellingPrice || 0,
      discount: item.discount || 0,
      youSave: item.youSave || 0
    };
    const regeneratedPrompt = buildGeneratedPrompt(_currentCampaign?.prompt || '', displayProduct);
    const promptToShow = regeneratedPrompt || item.generatedPrompt || '';
    
    if (latestProduct && promptToShow !== item.generatedPrompt) {
      try {
        await FB.updateDoc(FB.docRef('campaignItems', itemId), {
          generatedPrompt: promptToShow,
          productName: latestProduct.productName || item.productName,
          updatedAt: FB.serverTimestamp()
        });
        item.generatedPrompt = promptToShow;
        item.productName = latestProduct.productName || item.productName;
      } catch (error) {
        console.error('Error updating campaign item prompt:', error);
      }
    }
    
    document.getElementById('campaign-item-modal-title').textContent = `${displayProduct.productName || 'Product'} - ${item.status.toUpperCase()}`;
    document.getElementById('campaign-item-image').src = productImage || '';
    const displayedName = displayProduct.productName || 'Untitled Product';
    _currentCampaignItemName = displayedName;
    document.getElementById('campaign-item-product-name').textContent = displayedName;
    document.getElementById('campaign-item-status').textContent = item.status;
    document.getElementById('campaign-item-status').className = `status-badge ${item.status}`;
    document.getElementById('campaign-item-prompt').value = promptToShow;
    
    // Show appropriate action buttons based on status
    const markGeneratingBtn = document.getElementById('mark-generating-btn');
    const markCompletedBtn = document.getElementById('mark-completed-btn');
    
    markGeneratingBtn.style.display = item.status === 'pending' ? 'inline-block' : 'none';
    markCompletedBtn.style.display = item.status === 'generating' ? 'inline-block' : 'none';
    
    // Make prompt editable only for pending and generating status
    document.getElementById('campaign-item-prompt').readOnly = item.status === 'completed';
    
    hideAlert('campaign-item-alert');
    preserveCampaignDetailScrollState(item.productId || item.id || null);
    openModal('campaign-item-modal');
    
  } catch (error) {
    console.error('Error opening campaign item:', error);
    showToast('Failed to load campaign item details');
  }
}

/**
 * Hide campaign item modal
 */
function hideCampaignItemModal() {
  closeModal('campaign-item-modal');
}

/**
 * Copy prompt to clipboard
 */
async function copyPrompt() {
  const promptTextarea = document.getElementById('campaign-item-prompt');
  const prompt = promptTextarea.value;
  
  if (!prompt) {
    showToast('No prompt to copy');
    return;
  }
  
  try {
    await navigator.clipboard.writeText(prompt);
    showToast('Prompt copied to clipboard');
  } catch (error) {
    // Fallback for older browsers
    promptTextarea.select();
    document.execCommand('copy');
    showToast('Prompt copied to clipboard');
  }
}

async function copyCampaignItemName() {
  const productName = _currentCampaignItemName || document.getElementById('campaign-item-product-name')?.textContent || '';
  if (!productName) {
    showToast('No product name to copy');
    return;
  }

  try {
    await navigator.clipboard.writeText(productName);
    showToast('Product name copied');
  } catch (error) {
    const textarea = document.createElement('textarea');
    textarea.value = productName;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    showToast('Product name copied');
  }
}

/**
 * Mark item as generating
 */
async function markGenerating() {
  if (!_currentCampaignItem || _currentCampaignItem.status !== 'pending') {
    showToast('Invalid status transition');
    return;
  }
  
  await updateCampaignItemStatus('generating');
}

/**
 * Mark item as completed
 */
async function markCompleted() {
  if (!_currentCampaignItem || _currentCampaignItem.status !== 'generating') {
    showToast('Invalid status transition');
    return;
  }
  
  await updateCampaignItemStatus('completed');
}
/**
 * Update campaign item status
 */
async function updateCampaignItemStatus(newStatus) {
  try {
    const updatedPrompt = document.getElementById('campaign-item-prompt').value;
    
    const updateData = {
      status: newStatus,
      updatedAt: FB.serverTimestamp()
    };
    
    // Save updated prompt if changed
    if (updatedPrompt !== _currentCampaignItem.generatedPrompt) {
      updateData.generatedPrompt = updatedPrompt;
    }
    
    // Add completed date for completed status
    if (newStatus === 'completed') {
      updateData.completedAt = FB.serverTimestamp();
    }
    
    await FB.updateDoc(FB.docRef('campaignItems', _currentCampaignItem.id), updateData);

    if (newStatus === 'completed') {
      await FB.setDoc(FB.docRef('metaCatalogItems', _currentCampaignItem.id), {
        campaignId: _currentCampaign?.id || '',
        campaignItemId: _currentCampaignItem.id,
        productId: _currentCampaignItem.productId || '',
        metaStatus: 'pending',
        updatedAt: FB.serverTimestamp(),
        createdAt: FB.serverTimestamp()
      }, { merge: true });
      invalidateMetaCatalogCache();
    }
    
    showToast(`Status updated to ${newStatus}`);
    hideCampaignItemModal();
    
    const updatedItems = _campaignItems.map(item => item.id === _currentCampaignItem.id ? { ...item, status: newStatus, updatedAt: Date.now() } : item);
    _campaignItems = updatedItems;
    _campaignItemsCache.set(_currentCampaign?.id, updatedItems);
    updateCampaignItemCounts(updatedItems);
    renderCampaignItems();
    
  } catch (error) {
    console.error('Error updating campaign item status:', error);
    showAlert('campaign-item-alert', 'Failed to update status. Please try again.');
  }
}

// ── UTILITY FUNCTIONS ────────────────────────────────────────

/**
 * Check if user can edit product
 */
function canEditProduct(product) {
  const user = getUser();
  return Boolean(user); // FIX: Allow all logged-in users to add/edit products
}

/**
 * Check if user can delete product
 */
function canDeleteProduct(product) {
  const user = getUser();
  return Boolean(user && isAdmin()); // FIX: Only admins can delete products
}

// ── INITIALIZATION ───────────────────────────────────────────

/**
 * Initialize event listeners when DOM is ready
 */
document.addEventListener('DOMContentLoaded', function() {
  // Product form submission
  const productForm = document.getElementById('product-form');
  if (productForm) {
    productForm.addEventListener('submit', handleProductSubmit);
  }
  
  // Campaign form submission
  const campaignForm = document.getElementById('campaign-form');
  if (campaignForm) {
    campaignForm.addEventListener('submit', handleCampaignSubmit);
  }
  
  // Auto-calculate discount on input change
  const mrpInput = document.getElementById('product-mrp');
  const sellingPriceInput = document.getElementById('product-selling-price');
  
  if (mrpInput && sellingPriceInput) {
    mrpInput.addEventListener('input', calculateDiscount);
    sellingPriceInput.addEventListener('input', calculateDiscount);
  }
});

// ── EXPORTS ──────────────────────────────────────────────────

// Export all functions that need to be accessible from HTML onclick attributes
export {
  renderProducts,
  loadProductsCatalog,
  loadMetaCatalogData,
  handleProductsSearchInput,
  getProductsCacheSnapshot,
  showAddProduct,
  editProduct,
  deleteProduct,
  toggleProductsFilter,
  clearProductFilters,
  onProductImageSelect,
  calculateDiscount,
  hideProductModal,
  renderCampaigns,
  renderMetaCatalog,
  handleMetaCatalogSearchInput,
  filterMetaCatalog,
  closeMetaCatalogCampaign,
  openMetaCatalogCampaign,
  openMetaProductDetails,
  hideMetaProductModal,
  toggleMetaProductAdded,
  toggleMetaCatalogStatus,
  showCreateCampaign,
  hideCampaignModal,
  editCampaign,
  openCampaign,
  renderCampaignProducts,
  showCampaignProductSelector,
  toggleProductSelection,
  toggleSelectAll,
  toggleProductCompare,
  startCampaign,
  deleteCampaignItem,
  switchCampaignTab,
  renderCampaignDetail,
  openCampaignItem,
  hideCampaignItemModal,
  copyPrompt,
  copyCampaignItemName,
  markGenerating,
  markCompleted,
  deleteCampaign,
  compareSelectedProducts
};
