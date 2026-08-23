/**
 * accounts.js - Admin user management
 */

import { FB } from './firebase.js';
import { getUser, isAdmin } from './auth.js';
import { safeStr, formatDate } from './utils.js';
import { showToast } from './ui.js';

// ── RENDER ACCOUNTS PAGE ─────────────────────────────────────
export async function render() {
  if (!isAdmin()) return;
  const container = document.getElementById('accounts-container');
  if (!container) return;
  container.innerHTML = '<p class="empty-msg">Loading users...</p>';

  try {
    const snap  = await FB.getDocs(FB.col('users'));
    const users = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const pending  = users.filter(u => !u.approved && !u.blocked && u.role !== 'admin');
    const approved = users.filter(u => u.approved  && !u.blocked && u.role !== 'admin');
    const blocked  = users.filter(u => u.blocked);

    container.innerHTML = `
      <div class="card" style="margin-bottom:1.25rem">
        <div class="card-header"><h3>Account Management</h3></div>
        <div class="card-body">
          <div class="info-box info-box-orange">
            Admin only. Approve, block, or delete user accounts from here.
          </div>
          <div class="acct-stats">
            <div class="stat-card"><div class="stat-label">Pending</div><div class="stat-val">${pending.length}</div></div>
            <div class="stat-card"><div class="stat-label">Approved</div><div class="stat-val">${approved.length}</div></div>
            <div class="stat-card"><div class="stat-label">Blocked</div><div class="stat-val">${blocked.length}</div></div>
          </div>
        </div>
      </div>

      <div class="card" style="margin-bottom:1.25rem">
        <div class="card-header"><h3>Pending Approval (${pending.length})</h3></div>
        <div class="card-body" id="list-pending">
          ${pending.length ? _userList(pending, ['approve','block']) : '<p class="empty-msg">No pending users.</p>'}
        </div>
      </div>

      <div class="card" style="margin-bottom:1.25rem">
        <div class="card-header"><h3>Approved Users (${approved.length})</h3></div>
        <div class="card-body" id="list-approved">
          ${approved.length ? _userList(approved, ['block','delete']) : '<p class="empty-msg">No approved users.</p>'}
        </div>
      </div>

      <div class="card">
        <div class="card-header"><h3>Blocked Users (${blocked.length})</h3></div>
        <div class="card-body" id="list-blocked">
          ${blocked.length ? _userList(blocked, ['unblock','delete']) : '<p class="empty-msg">No blocked users.</p>'}
        </div>
      </div>
    `;
  } catch (e) {
    container.innerHTML = `<p class="empty-msg">Error loading users: ${e.message}</p>`;
  }
}

// ── USER LIST HTML ────────────────────────────────────────────
function _userList(users, actions) {
  return users.map(u => {
    const statusLabel = u.blocked ? 'Blocked' : u.approved ? 'Approved' : 'Pending';
    const statusCls   = u.blocked ? 'sb-blocked' : u.approved ? 'sb-approved' : 'sb-pending';
    const btns = actions.map(a => {
      const labels = { approve: 'Approve', block: 'Block', unblock: 'Unblock', delete: 'Delete' };
      const styles = {
        approve: 'btn-accent',
        block:   'btn-danger',
        unblock: 'btn-outline',
        delete:  'btn-danger'
      };
      return `<button class="btn ${styles[a]} btn-sm" onclick="window.Accounts.action('${a}','${u.id}')">${labels[a]}</button>`;
    }).join('');

    return `
      <div class="account-row">
        <div class="account-details">
          <p class="account-name">${safeStr(u.displayName || u.name || u.email || 'Unknown')}</p>
          <p class="account-meta">${safeStr(u.email)} &middot; ${safeStr(u.role || 'user')}</p>
          <p class="account-meta">Last login: ${formatDate(u.lastLogin)} &middot; Created: ${formatDate(u.createdAt)}</p>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.4rem">
          <span class="status-badge ${statusCls}">${statusLabel}</span>
          <div class="account-actions">${btns}</div>
        </div>
      </div>`;
  }).join('');
}

// ── ACTIONS ───────────────────────────────────────────────────
export async function action(type, uid) {
  if (!isAdmin()) return;
  const updates = {
    approve:  { approved: true,  blocked: false },
    block:    { blocked: true,   approved: false },
    unblock:  { blocked: false },
    delete:   null
  };

  if (type === 'delete') {
    if (!confirm('Delete this user record from Firestore? Their Firebase Auth account remains.')) return;
    try {
      await FB.deleteDoc(FB.docRef('users', uid));
      showToast('User record deleted.');
    } catch (e) { showToast('Error: ' + e.message); }
  } else if (updates[type]) {
    try {
      await FB.updateDoc(FB.docRef('users', uid), updates[type]);
      showToast(`User ${type}d.`);
    } catch (e) { showToast('Error: ' + e.message); }
  }
  render();
}
