/**
 * ui.js - All DOM manipulation helpers
 * No Firebase, no AI logic here.
 */

// ── TOAST ────────────────────────────────────────────────────
let _toastTimer = null;
export function showToast(msg, duration = 4000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), duration);
}

export function focusFirstInput(container = document) {
  const root = container && typeof container.querySelector === 'function' ? container : document;
  const priority = root.querySelector('input:not([type="hidden"]), select, textarea');
  if (priority) priority.focus();
}

// ── ALERTS ───────────────────────────────────────────────────
export function showAlert(id, msg, type = 'danger') {
  const el = document.getElementById(id);
  if (!el) return;
  el.className = `alert alert-${type}`;
  el.textContent = msg;
  el.style.display = 'block';
}
export function hideAlert(id) {
  const el = document.getElementById(id);
  if (el) el.style.display = 'none';
}

// ── LOADING OVERLAY ──────────────────────────────────────────
export function showLoading(title, steps = []) {
  const el = document.getElementById('loading-overlay');
  if (!el) return;
  document.getElementById('loading-title').textContent    = title;
  document.getElementById('loading-subtitle').textContent = 'Please wait...';
  document.getElementById('progress-pct').textContent     = '0%';
  document.getElementById('progress-fill').style.width    = '0%';
  document.getElementById('loading-steps').innerHTML = steps.map((s, i) =>
    `<div class="loading-step" id="lstep-${i}">
       <div class="step-num">${i + 1}</div>
       <span>${s}</span>
     </div>`
  ).join('');
  el.style.display = 'flex';
}

export function setLoadingProgress(pct, subtitle) {
  const fill = document.getElementById('progress-fill');
  const pctEl = document.getElementById('progress-pct');
  if (fill)  fill.style.width = pct + '%';
  if (pctEl) pctEl.textContent = pct + '%';
  if (subtitle) {
    const sub = document.getElementById('loading-subtitle');
    if (sub) sub.textContent = subtitle;
  }
}

export function completeStep(index, pct, subtitle) {
  const step = document.getElementById(`lstep-${index}`);
  if (step) step.classList.add('done');
  setLoadingProgress(pct, subtitle);
}

export function hideLoading() {
  const el = document.getElementById('loading-overlay');
  if (el) el.style.display = 'none';
}

// ── MODALS ───────────────────────────────────────────────────
let _activeModalIds = new Set();
let _savedScrollPosition = { x: 0, y: 0 };

function getScrollTarget() {
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

function getScrollPosition() {
  const scrollTarget = getScrollTarget();
  if (scrollTarget === window) {
    return {
      x: window.scrollX || window.pageXOffset || 0,
      y: window.scrollY || window.pageYOffset || 0
    };
  }

  return {
    x: typeof scrollTarget.scrollLeft === 'number' ? scrollTarget.scrollLeft : 0,
    y: typeof scrollTarget.scrollTop === 'number' ? scrollTarget.scrollTop : 0
  };
}

function restoreModalScrollPosition(id) {
  if (id === 'campaign-item-modal' && typeof window.Marketing?.restoreCampaignDetailScrollState === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.Marketing.restoreCampaignDetailScrollState();
      });
    });
    return;
  }

  if (id === 'product-modal' && typeof window.Marketing?.restoreProductsScrollState === 'function') {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        window.Marketing.restoreProductsScrollState();
      });
    });
  }
}

function lockBodyScroll() {
  if (_activeModalIds.size === 0) {
    _savedScrollPosition = getScrollPosition();

    const body = document.body;
    const html = document.documentElement;

    body.classList.add('modal-open');
    html.classList.add('modal-open');
    body.classList.add('no-scroll');
    html.classList.add('no-scroll');
    body.classList.add('overflow-hidden');
    html.classList.add('overflow-hidden');

    body.style.position = 'fixed';
    body.style.top = `-${_savedScrollPosition.y}px`;
    body.style.left = `-${_savedScrollPosition.x}px`;
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    html.style.position = 'relative';
  }
}

function unlockBodyScroll() {
  if (_activeModalIds.size === 0) {
    const body = document.body;
    const html = document.documentElement;
    [body, html].forEach(el => {
      el.classList.remove('modal-open', 'no-scroll', 'overflow-hidden');
    });

    body.style.position = '';
    body.style.top = '';
    body.style.left = '';
    body.style.width = '';
    body.style.overflow = '';
    html.style.overflow = '';
    html.style.position = '';

    const restoreScroll = () => {
      const scrollTarget = getScrollTarget();
      if (scrollTarget && typeof scrollTarget.scrollTo === 'function') {
        scrollTarget.scrollTo(_savedScrollPosition.x, _savedScrollPosition.y);
      } else {
        window.scrollTo(_savedScrollPosition.x, _savedScrollPosition.y);
      }
    };
    if (typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(restoreScroll);
    } else {
      setTimeout(restoreScroll, 0);
    }
  }
}

export function hasOpenModal() {
  return _activeModalIds.size > 0;
}

export function openModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (_activeModalIds.has(id) || el.style.display === 'flex' || el.style.display === 'block') return;

  el.style.display = 'flex';
  _activeModalIds.add(id);
  lockBodyScroll();
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;

  const wasVisible = _activeModalIds.has(id) || el.style.display === 'flex' || el.style.display === 'block';
  if (!wasVisible) return;

  el.style.display = 'none';
  _activeModalIds.delete(id);

  if (_activeModalIds.size === 0) {
    unlockBodyScroll();
    restoreModalScrollPosition(id);
  }
}

export function closeAllModals() {
  const modalEls = Array.from(document.querySelectorAll('.overlay'));
  modalEls.forEach(el => {
    if (el.style.display !== 'none') {
      el.style.display = 'none';
    }
  });

  _activeModalIds.clear();
  if (_activeModalIds.size === 0) {
    unlockBodyScroll();
  }
}

// ── SIDEBAR ──────────────────────────────────────────────────
export function toggleSidebar() {
  document.querySelector('.sidebar')?.classList.toggle('open');
  document.getElementById('sidebar-backdrop')?.classList.toggle('show');
}
export function closeSidebar() {
  document.querySelector('.sidebar')?.classList.remove('open');
  document.getElementById('sidebar-backdrop')?.classList.remove('show');
}

// ── TABS ─────────────────────────────────────────────────────
const TAB_TITLES = {
  dashboard: 'Dashboard',
  generate:  'Generate SEO Content',
  history:   'Generation History',
  audit:     'SEO Audit Tool',
  auditHistory: 'Audit History',
  settings:  'Settings',
  accounts:  'Accounts',
  products:  'Products',
  campaigns: 'Sale Campaigns',
  'meta-catalog': 'Meta Product Catalog',
  'campaign-detail': 'Campaign Details'
};

export function switchTab(name) {
  document.querySelectorAll('.tab-section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const section = document.getElementById(`tab-${name}`);
  const navItem = document.getElementById(`nav-${name}`);
  if (section) section.classList.add('active');
  if (navItem)  navItem.classList.add('active');
  const title = document.getElementById('topbar-title');
  if (title) title.textContent = TAB_TITLES[name] || name;
  window.scrollTo(0, 0);
  if (window.innerWidth <= 768) closeSidebar();
}

// ── THEME ────────────────────────────────────────────────────
export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'system') {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
  } else {
    root.setAttribute('data-theme', theme);
  }
  localStorage.setItem('az-theme', theme);
}

export function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

export function initTheme() {
  const saved = localStorage.getItem('az-theme') || 'light';
  applyTheme(saved);
}

// ── RESULT TABS ──────────────────────────────────────────────
export function switchResultTab(name, container) {
  const parent = container || document;
  parent.querySelectorAll('.tab-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === name)
  );
  parent.querySelectorAll('.tab-pane').forEach(p =>
    p.classList.toggle('active', p.id === `rtab-${name}`)
  );
}

// ── SCORE RING ───────────────────────────────────────────────
export function animateScoreRing(score, color, ringId, valId, circumference = 565) {
  const ring  = document.getElementById(ringId);
  const valEl = document.getElementById(valId);
  if (!ring || !valEl) return;
  ring.style.stroke = color;
  ring.style.strokeDashoffset = circumference;
  const offset = circumference - (circumference * Math.min(score, 100) / 100);
  setTimeout(() => { ring.style.strokeDashoffset = offset; }, 100);
  // Animate number
  let curr = 0;
  const step = Math.max(1, Math.ceil(score / 45));
  const iv = setInterval(() => {
    curr = Math.min(curr + step, score);
    valEl.textContent = curr;
    if (curr >= score) clearInterval(iv);
  }, 30);
}

// ── CHAR PILL ────────────────────────────────────────────────
export function charPill(len, min, max) {
  const cls = (len >= min && len <= max) ? 'char-ok' : (len < min ? 'char-warn' : 'char-bad');
  return `<span class="char-pill ${cls}">${len}/${max}</span>`;
}

// ── COPY TO CLIPBOARD ────────────────────────────────────────
export function copyText(text) {
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard'));
}
