/*
 * MARKETING CHANNELS
 * Shared customer cache + Email Marketing + WhatsApp Marketing.
 *
 * Design goal: marketing does NOT perform a second leads query for normal use.
 * It consumes the leads already loaded by the Leads view and keeps a small
 * marketingContacts collection for manually added contacts and persistence.
 */
(function () {
  'use strict';

  const contactsRef = () => db.collection('marketingContacts');
  const emailCampaignsRef = () => db.collection('emailMarketingCampaigns');
  const whatsappCampaignsRef = () => db.collection('whatsappMarketingCampaigns');

  const state = {
    email: { contacts: [], campaigns: [], activeCampaignId: null, search: '' },
    whatsapp: { contacts: [], campaigns: [], activeCampaignId: null, search: '' }
  };

  let contactUnsubscribe = null;
  let emailCampaignUnsubscribe = null;
  let whatsappCampaignUnsubscribe = null;
  let contactCacheLoaded = false;
  let contactLoadPromise = null;

  const isAdmin = () => ['admin', 'superadmin'].includes(window.CURRENT_USER?.role);
  const isActiveUser = () => !!window.CURRENT_USER?.active;
  const canEdit = () => isActiveUser();
  const canDelete = () => isAdmin();

  function esc(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function asDate(value) {
    if (!value) return null;
    if (value.toDate) return value.toDate();
    if (value instanceof Date) return value;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  function fmtDate(value) {
    const d = asDate(value);
    return d ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  }

  function normalisePhone(raw) {
    let phone = String(raw || '').replace(/[\s\-().+]/g, '');
    if (phone.startsWith('0')) phone = '91' + phone.slice(1);
    return /^\d{10,15}$/.test(phone) ? phone : '';
  }

  function cleanStatus(status) {
    return String(status || '').trim() === 'Not Interested' ? 'Not Interested' : 'Interested';
  }

  function getCampaignRef(channel) {
    return channel === 'email' ? emailCampaignsRef() : whatsappCampaignsRef();
  }

  function getState(channel) {
    return state[channel];
  }

  function ensureView(channel) {
    const root = document.getElementById(`view-${channel}marketing`);
    if (!root) return;
    root.innerHTML = `
      <div class="marketing-channel-page">
        <div class="marketing-channel-header">
          <div>
            <h1 class="page-title"><i class="bi ${channel === 'email' ? 'bi-envelope-at' : 'bi-whatsapp'} me-2"></i>${channel === 'email' ? 'Email Marketing' : 'WhatsApp Marketing'}</h1>
            <p class="page-subtitle">Create campaigns and open personalized messages for subscribed customers.</p>
          </div>
          <div class="marketing-toolbar-actions">
            ${isAdmin() ? '<button class="btn btn-outline-secondary" onclick="window.MarketingChannels.syncExistingLeads()"><i class="bi bi-arrow-repeat me-1"></i>Sync Existing Leads</button>' : ''}
            <button class="btn btn-outline-secondary" onclick="window.MarketingChannels.openContactModal('${channel}')"><i class="bi bi-person-plus me-1"></i>Add Customer</button>
            <button class="btn btn-brand" onclick="window.MarketingChannels.openCampaignModal('${channel}')"><i class="bi bi-plus-lg me-1"></i>New Campaign</button>
            <div class="small text-muted w-100 text-end">Shortcuts: <kbd>Alt + /</kbd> Add Customer · <kbd>Alt + O</kbd> Open Next</div>
          </div>
        </div>
        <div id="${channel}MarketingBody"></div>
      </div>`;
  }

  function renderChannel(channel) {
    ensureView(channel);
    const body = document.getElementById(`${channel}MarketingBody`);
    if (!body) return;
    const s = getState(channel);
    const campaigns = s.campaigns;
    const active = campaigns.find(c => c.id === s.activeCampaignId);

    if (active) {
      renderCampaignDetail(channel, active, body);
      return;
    }

    const q = s.search.toLowerCase();
    const filtered = campaigns.filter(c => `${c.name} ${c.subject || ''}`.toLowerCase().includes(q));
    body.innerHTML = `
      <div class="marketing-stats-row">
        <div class="marketing-stat"><span>Campaigns</span><strong>${campaigns.length}</strong></div>
        <div class="marketing-stat"><span>Subscribed ${channel === 'email' ? 'email' : 'WhatsApp'} contacts</span><strong>${eligibleContacts(channel).length}</strong></div>
        <div class="marketing-stat"><span>Total contacts</span><strong>${s.contacts.length}</strong></div>
      </div>
      <div class="marketing-card mb-3">
        <div class="d-flex justify-content-between align-items-center gap-2 flex-wrap">
          <div class="marketing-card-title">Campaigns</div>
          <input class="form-control marketing-search" placeholder="Search campaigns..." value="${esc(s.search)}" oninput="window.MarketingChannels.setSearch('${channel}', this.value)">
        </div>
      </div>
      ${filtered.length ? `<div class="marketing-campaign-grid">${filtered.map(c => campaignCard(channel, c)).join('')}</div>` : `
        <div class="marketing-empty">
          <i class="bi bi-megaphone"></i>
          <h3>${q ? 'No campaigns found' : 'No campaigns yet'}</h3>
          <p>${q ? 'Try another search.' : 'Create your first campaign to start messaging customers.'}</p>
        </div>`}
      ${renderCustomers(channel)}`;
  }

  function renderCustomers(channel) {
    const contacts = getState(channel).contacts;
    if (!contacts.length) return `
      <div class="marketing-card mt-3"><div class="marketing-card-title mb-2">Customers</div><div class="text-muted">No marketing customers yet. Add one or sync existing leads.</div></div>`;
    return `
      <div class="marketing-card mt-3">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div><div class="marketing-card-title">Customer Directory</div><div class="small text-muted">${contacts.length} customers · ${eligibleContacts(channel).length} subscribed for this channel</div></div>
          <button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openContactModal('${channel}')"><i class="bi bi-person-plus me-1"></i>Add Customer</button>
        </div>
        <div class="table-responsive">
          <table class="table align-middle marketing-table mb-0">
            <thead><tr><th>Sl No</th><th>Name</th><th>${channel === 'email' ? 'Email' : 'Number'}</th><th>Company</th><th>Sub / Unsub</th><th>Source</th><th>Actions</th></tr></thead>
            <tbody>${contacts.map((c, i) => `
              <tr>
                <td>${i + 1}</td><td><strong>${esc(c.name)}</strong></td><td>${esc(channel === 'email' ? (c.email || '—') : (c.phone || '—'))}</td><td>${esc(c.company || '—')}</td>
                <td><span class="badge ${c.marketingStatus === 'Not Interested' ? 'bg-danger-subtle text-danger' : 'bg-success-subtle text-success'}">${c.marketingStatus === 'Not Interested' ? 'Not Interested' : 'Interested'}</span></td>
                <td>${c.source === 'lead' ? 'Lead' : 'Manual'}</td>
                <td><div class="d-flex gap-1">${canEdit() ? `<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openContactModal('${channel}','${c.id}')">Edit</button>` : ''}${canDelete() ? `<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteContact('${c.id}')">Delete</button>` : ''}</div></td>
              </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>`;
  }

  function campaignCard(channel, campaign) {
    const recipients = eligibleContacts(channel).length;
    return `
      <div class="marketing-campaign-card">
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div>
            <div class="marketing-campaign-name">${esc(campaign.name)}</div>
            <div class="small text-muted">${channel === 'email' ? 'Subject' : 'Message'}: ${esc(campaign.subject || campaign.body || '')}</div>
          </div>
          <div class="d-flex flex-column align-items-end gap-1"><span class="badge bg-light text-dark">${recipients} recipients</span>${channel === 'email' ? `<span class="badge bg-primary-subtle text-primary">${esc(campaign.emailProvider === 'Outlook' ? 'Outlook App' : (campaign.emailProvider || 'Gmail'))}</span>` : '<span class="badge bg-success-subtle text-success">WhatsApp</span>'}</div>
        </div>
        <div class="marketing-campaign-preview">${esc(campaign.body || '')}</div>
        <div class="marketing-campaign-meta">
          <span>${fmtDate(campaign.createdAt)}</span>
          <div class="d-flex gap-2">
            <button class="btn btn-sm btn-brand" onclick="window.MarketingChannels.openCampaign('${channel}','${campaign.id}')">Open</button>
            ${canEdit() ? `<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openCampaignModal('${channel}','${campaign.id}')">Edit</button>` : ''}
            ${canDelete() ? `<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteCampaign('${channel}','${campaign.id}')">Delete</button>` : ''}
          </div>
        </div>
      </div>`;
  }

  function renderCampaignDetail(channel, campaign, body) {
    const contacts = eligibleContacts(channel);
    const sentMap = campaign.sentRecipients || {};
    const q = getState(channel).search.toLowerCase();
    const filtered = contacts.filter(c => `${c.name} ${c.email} ${c.phone} ${c.company}`.toLowerCase().includes(q));

    body.innerHTML = `
      <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
        <button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.closeCampaign('${channel}')"><i class="bi bi-arrow-left me-1"></i>Back to ${channel === 'email' ? 'Email' : 'WhatsApp'} Marketing</button>
        <div class="d-flex gap-2">
          ${canEdit() ? `<button class="btn btn-sm btn-outline-secondary" onclick="window.MarketingChannels.openCampaignModal('${channel}','${campaign.id}')"><i class="bi bi-pencil me-1"></i>Edit</button>` : ''}
          ${canDelete() ? `<button class="btn btn-sm btn-outline-danger" onclick="window.MarketingChannels.deleteCampaign('${channel}','${campaign.id}')"><i class="bi bi-trash me-1"></i>Delete</button>` : ''}
        </div>
      </div>
      <div class="marketing-detail-heading">
        <h2>${esc(campaign.name)}</h2>
        <p>${channel === 'email' ? `Subject: ${esc(campaign.subject || '')} · Opens in ${esc(campaign.emailProvider === 'Outlook' ? 'Outlook App' : (campaign.emailProvider || 'Gmail'))}` : 'Personalized WhatsApp message'}</p>
      </div>
      <div class="marketing-message-preview">
        ${channel === 'email' ? `<div><strong>Subject</strong><div>${esc(campaign.subject || '')}</div></div>` : ''}
        <div><strong>Body</strong><pre>${esc(campaign.body || '')}</pre></div>
      </div>
      <div class="marketing-card">
        <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
          <div>
            <div class="marketing-card-title">Campaign Recipients</div>
            <div class="small text-muted">${contacts.length} subscribed recipients</div>
          </div>
          <input class="form-control marketing-search" placeholder="Search recipients..." value="${esc(q)}" oninput="window.MarketingChannels.setSearch('${channel}', this.value)">
        </div>
        <div class="table-responsive">
          <table class="table align-middle marketing-table mb-0">
            <thead><tr><th>Sl No</th><th>Name</th><th>${channel === 'email' ? 'Email' : 'Number'}</th><th>Status</th><th>Sent Through</th><th>Action</th><th>Sent By</th></tr></thead>
            <tbody>
              ${filtered.length ? filtered.map((c, i) => recipientRow(channel, campaign, c, i + 1, sentMap[c.id])).join('') : `<tr><td colspan="7" class="text-center py-4 text-muted">No matching subscribed customers.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  function recipientRow(channel, campaign, contact, index, sent) {
    const destination = channel === 'email' ? contact.email : normalisePhone(contact.phone);
    const opened = !!sent;
    const sentBy = sent?.sentByName || '—';
    const sentThrough = sent?.sentThrough || (channel === 'email' ? (campaign.emailProvider === 'Outlook' ? 'Outlook App' : (campaign.emailProvider || 'Gmail')) : 'WhatsApp');
    const sentText = opened ? `Opened · ${fmtDate(sent.openedAt)}` : 'Not Sent';
    const action = destination
      ? `<button class="btn btn-sm ${channel === 'email' ? 'btn-brand' : 'btn-success'}" onclick="window.MarketingChannels.openMessage('${channel}','${campaign.id}','${contact.id}')"><i class="bi ${channel === 'email' ? 'bi-envelope-at' : 'bi-whatsapp'} me-1"></i>${channel === 'email' ? 'Send Email' : 'Open WhatsApp'}</button>`
      : '<span class="text-muted">Missing contact</span>';
    return `<tr>
      <td>${index}</td>
      <td><strong>${esc(contact.name)}</strong></td>
      <td>${esc(channel === 'email' ? contact.email : contact.phone)}</td>
      <td><span class="badge ${opened ? 'bg-success-subtle text-success' : 'bg-light text-dark'}">${esc(sentText)}</span></td>
      <td><span class="badge bg-light text-dark">${esc(sentThrough)}</span></td>
      <td>${action}</td>
      <td>${esc(sentBy)}</td>
    </tr>`;
  }

  function eligibleContacts(channel) {
    return state[channel].contacts.filter(c => c.marketingStatus !== 'Not Interested' && (channel === 'email' ? !!String(c.email || '').trim() : !!normalisePhone(c.phone)));
  }

  async function loadContacts() {
    if (contactCacheLoaded) return;
    if (contactLoadPromise) return contactLoadPromise;
    contactLoadPromise = contactsRef().orderBy('createdAt', 'asc').get().then(snap => {
      const all = [];
      snap.forEach(doc => all.push({ id: doc.id, ...doc.data() }));
      state.email.contacts = all;
      state.whatsapp.contacts = all;
      contactCacheLoaded = true;
      contactLoadPromise = null;
    }).catch(err => {
      contactLoadPromise = null;
      console.error('Marketing contacts load failed:', err);
      if (typeof toast === 'function') toast('Failed to load marketing contacts.', 'danger');
    });
    return contactLoadPromise;
  }

  function subscribeChannel(channel) {
    const ref = getCampaignRef(channel);
    const callback = snap => {
      state[channel].campaigns = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderChannel(channel);
    };
    const unsubscribe = ref.orderBy('createdAt', 'desc').onSnapshot(callback, err => {
      console.error(`${channel} marketing campaigns listener failed:`, err);
      if (typeof toast === 'function') toast(`Failed to load ${channel} campaigns.`, 'danger');
    });
    if (channel === 'email') emailCampaignUnsubscribe = unsubscribe;
    else whatsappCampaignUnsubscribe = unsubscribe;
  }

  async function initChannel(channel) {
    if (!isActiveUser()) return;
    await loadContacts();
    subscribeChannel(channel);
    renderChannel(channel);
  }

  function openView(channel) {
    initChannel(channel).catch(err => console.error(err));
  }

  function setSearch(channel, value) {
    state[channel].search = value || '';
    renderChannel(channel);
  }

  function closeCampaign(channel) {
    state[channel].activeCampaignId = null;
    state[channel].search = '';
    renderChannel(channel);
  }

  function openCampaign(channel, id) {
    state[channel].activeCampaignId = id;
    state[channel].search = '';
    renderChannel(channel);
  }

  function openContactModal(channel, id = '') {
    if (!canEdit()) return;
    const existing = id ? state[channel].contacts.find(c => c.id === id) : null;
    document.getElementById('marketingContactModalTitle').textContent = existing ? 'Edit Customer' : 'Add Customer';
    document.getElementById('marketingContactId').value = existing?.id || '';
    document.getElementById('marketingContactName').value = existing?.name || '';
    document.getElementById('marketingContactEmail').value = existing?.email || '';
    document.getElementById('marketingContactPhone').value = existing?.phone || '';
    document.getElementById('marketingContactCompany').value = existing?.company || '';
    document.getElementById('marketingContactChannel').value = channel;
    new bootstrap.Modal(document.getElementById('marketingContactModal')).show();
  }

  async function saveContact() {
    if (!canEdit()) return;
    const id = document.getElementById('marketingContactId').value.trim();
    const channel = document.getElementById('marketingContactChannel').value;
    const payload = {
      name: document.getElementById('marketingContactName').value.trim(),
      email: document.getElementById('marketingContactEmail').value.trim(),
      phone: document.getElementById('marketingContactPhone').value.trim(),
      company: document.getElementById('marketingContactCompany').value.trim(),
      marketingStatus: id ? cleanStatus((getState(channel).contacts.find(c => c.id === id)?.marketingStatus) || 'Interested') : 'Interested',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: window.CURRENT_USER.uid,
      updatedByName: window.CURRENT_USER.name || window.CURRENT_USER.email
    };
    if (!payload.name) throw new Error('Customer name is required.');
    if (!payload.email && !payload.phone) throw new Error('Add an email or phone number.');

    try {
      const btn = document.getElementById('marketingContactSaveBtn');
      btn.disabled = true;
      if (id) {
        await contactsRef().doc(id).update(payload);
      } else {
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        payload.source = 'manual';
        await contactsRef().add(payload);
      }
      await refreshContacts();
      bootstrap.Modal.getInstance(document.getElementById('marketingContactModal'))?.hide();
      renderChannel(channel);
      if (typeof toast === 'function') toast(id ? 'Customer updated.' : 'Customer added.', 'success');
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast(err.message || 'Failed to save customer.', 'danger');
    } finally {
      document.getElementById('marketingContactSaveBtn').disabled = false;
    }
  }

  async function deleteContact(id) {
    if (!canDelete()) return;
    if (!confirm('Delete this marketing customer?')) return;
    try {
      await contactsRef().doc(id).delete();
      await refreshContacts();
      renderChannel('email');
      renderChannel('whatsapp');
      if (typeof toast === 'function') toast('Customer deleted.', 'success');
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Failed to delete customer.', 'danger');
    }
  }

  function openCampaignModal(channel, id = '') {
    if (!canEdit()) return;
    const campaign = id ? getState(channel).campaigns.find(c => c.id === id) : null;
    document.getElementById('marketingCampaignModalTitle').textContent = campaign ? 'Edit Campaign' : 'Create Campaign';
    document.getElementById('marketingCampaignId').value = campaign?.id || '';
    document.getElementById('marketingCampaignChannel').value = channel;
    document.getElementById('marketingCampaignName').value = campaign?.name || '';
    document.getElementById('marketingCampaignSubject').value = campaign?.subject || '';
    document.getElementById('marketingCampaignEmailProvider').value = campaign?.emailProvider || 'Gmail';
    document.getElementById('marketingCampaignBody').value = campaign?.body || '';
    document.getElementById('marketingCampaignSubjectWrap').classList.toggle('d-none', channel !== 'email');
    document.getElementById('marketingCampaignEmailProviderWrap').classList.toggle('d-none', channel !== 'email');
    document.getElementById('marketingCampaignPlaceholderHelp').textContent = channel === 'email'
      ? 'Use {{Name}} in the subject or body. It will be replaced with each customer’s name.'
      : 'Use {{Name}} in the message. It will be replaced with each customer’s name.';
    new bootstrap.Modal(document.getElementById('marketingCampaignModal')).show();
  }

  async function saveCampaign() {
    if (!canEdit()) return;
    const id = document.getElementById('marketingCampaignId').value.trim();
    const channel = document.getElementById('marketingCampaignChannel').value;
    const name = document.getElementById('marketingCampaignName').value.trim();
    const subject = document.getElementById('marketingCampaignSubject').value.trim();
    const emailProvider = document.getElementById('marketingCampaignEmailProvider').value;
    const body = document.getElementById('marketingCampaignBody').value.trim();
    if (!name || !body) {
      if (typeof toast === 'function') toast('Campaign name and body are required.', 'warning');
      return;
    }
    if (channel === 'email' && !subject) {
      if (typeof toast === 'function') toast('Email subject is required.', 'warning');
      return;
    }
    const payload = {
      name,
      subject: channel === 'email' ? subject : '',
      body,
      emailProvider: channel === 'email' ? (emailProvider === 'Outlook' ? 'Outlook' : 'Gmail') : '',
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: window.CURRENT_USER.uid,
      updatedByName: window.CURRENT_USER.name || window.CURRENT_USER.email
    };
    try {
      const btn = document.getElementById('marketingCampaignSaveBtn');
      btn.disabled = true;
      const ref = getCampaignRef(channel);
      if (id) await ref.doc(id).update(payload);
      else await ref.add({ ...payload, createdAt: firebase.firestore.FieldValue.serverTimestamp(), createdBy: window.CURRENT_USER.uid, createdByName: window.CURRENT_USER.name || window.CURRENT_USER.email, sentRecipients: {} });
      bootstrap.Modal.getInstance(document.getElementById('marketingCampaignModal'))?.hide();
      if (typeof toast === 'function') toast(id ? 'Campaign updated.' : 'Campaign created.', 'success');
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Failed to save campaign.', 'danger');
    } finally {
      document.getElementById('marketingCampaignSaveBtn').disabled = false;
    }
  }

  async function deleteCampaign(channel, id) {
    if (!canDelete()) return;
    if (!confirm('Delete this campaign? This cannot be undone.')) return;
    try {
      await getCampaignRef(channel).doc(id).delete();
      if (state[channel].activeCampaignId === id) state[channel].activeCampaignId = null;
      if (typeof toast === 'function') toast('Campaign deleted.', 'success');
      renderChannel(channel);
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Failed to delete campaign.', 'danger');
    }
  }

  function replacePlaceholders(text, contact) {
    const values = {
      name: contact.name || '',
      email: contact.email || '',
      phone: contact.phone || '',
      company: contact.company || ''
    };
    return String(text || '').replace(/\{\{\s*(name|email|phone|company)\s*\}\}/gi, (_, key) => values[key.toLowerCase()] ?? '');
  }

  async function openMessage(channel, campaignId, contactId, options = {}) {
    const campaign = getState(channel).campaigns.find(c => c.id === campaignId);
    const contact = getState(channel).contacts.find(c => c.id === contactId);
    if (!campaign || !contact) return;
    if (contact.marketingStatus === 'Not Interested') {
      if (typeof toast === 'function') toast('This customer is unsubscribed and cannot be messaged.', 'warning');
      return;
    }
    const body = replacePlaceholders(campaign.body, contact);
    let url = '';
    if (channel === 'email') {
      const subject = replacePlaceholders(campaign.subject, contact);
      const provider = campaign.emailProvider === 'Outlook' ? 'Outlook' : 'Gmail';
      if (provider === 'Outlook') {
        // Use the Windows mailto scheme so the installed/default Outlook desktop
        // app opens a NEW compose window with To, Subject and Body prefilled.
        // The ms-outlook://compose scheme can launch Outlook but is not reliable
        // on Windows desktop for carrying the compose fields into the new Outlook UI.
        url = `mailto:${encodeURIComponent(contact.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      } else {
        url = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(contact.email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      }
    } else {
      const phone = normalisePhone(contact.phone);
      if (!phone) {
        if (typeof toast === 'function') toast('Valid WhatsApp number is missing.', 'warning');
        return;
      }
      url = `https://wa.me/${phone}?text=${encodeURIComponent(body)}`;
    }
    if (channel === 'email' && campaign.emailProvider === 'Outlook') {
      // mailto: is handled by Windows' default mail application. Set Outlook as
      // the default mail app on the CRM computer to ensure this opens Outlook.
      window.location.href = url;
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }

    const sentRecord = {
      openedAt: new Date(),
      sentThrough: channel === 'email' ? (campaign.emailProvider === 'Outlook' ? 'Outlook App' : 'Gmail') : 'WhatsApp',
      sentBy: window.CURRENT_USER.uid,
      sentByName: window.CURRENT_USER.name || window.CURRENT_USER.email
    };
    campaign.sentRecipients = { ...(campaign.sentRecipients || {}), [contactId]: sentRecord };
    if (options.shortcutIndex && typeof toast === 'function') {
      toast(`Lead no ${options.shortcutIndex}, customer name ${contact.name} is opened`, 'success');
    }
    renderChannel(channel);

    try {
      await getCampaignRef(channel).doc(campaignId).update({
        [`sentRecipients.${contactId}`]: {
          openedAt: firebase.firestore.FieldValue.serverTimestamp(),
          sentThrough: sentRecord.sentThrough,
          sentBy: sentRecord.sentBy,
          sentByName: sentRecord.sentByName
        }
      });
    } catch (err) {
      console.error('Failed to record marketing open:', err);
    }
  }

  function getVisibleMarketingChannel() {
    const emailView = document.getElementById('view-emailmarketing');
    const whatsappView = document.getElementById('view-whatsappmarketing');
    if (emailView && !emailView.classList.contains('d-none')) return 'email';
    if (whatsappView && !whatsappView.classList.contains('d-none')) return 'whatsapp';
    return null;
  }

  function isModalVisible(id) {
    const el = document.getElementById(id);
    return !!el && el.classList.contains('show');
  }

  async function openNextRecipient(channel) {
    const s = getState(channel);
    const campaign = s.campaigns.find(c => c.id === s.activeCampaignId);
    if (!campaign) {
      if (typeof toast === 'function') toast(`Open a ${channel === 'email' ? 'email' : 'WhatsApp'} campaign first.`, 'warning');
      return;
    }

    const recipients = eligibleContacts(channel);
    const sentMap = campaign.sentRecipients || {};
    const nextIndex = recipients.findIndex(contact => !sentMap[contact.id]);
    if (nextIndex === -1) {
      if (typeof toast === 'function') toast(`All ${recipients.length} ${channel === 'email' ? 'email' : 'WhatsApp'} leads in this campaign are opened.`, 'success');
      return;
    }

    const contact = recipients[nextIndex];
    await openMessage(channel, campaign.id, contact.id, { shortcutIndex: nextIndex + 1 });
  }

  function bindMarketingShortcuts() {
    if (window.__marketingShortcutsBound) return;
    window.__marketingShortcutsBound = true;

    document.addEventListener('keydown', async (event) => {
      const channel = getVisibleMarketingChannel();
      if (!channel) return;

      const target = event.target;
      const tag = String(target?.tagName || '').toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;

      // Alt + / = open the Add Customer popup for the currently visible marketing section.
      if (event.altKey && (event.key === '/' || event.code === 'Slash')) {
        event.preventDefault();
        event.stopPropagation();
        if (!isModalVisible('marketingContactModal')) {
          openContactModal(channel);
        }
        return;
      }

      // Alt + O = open the next unsent recipient in the currently open campaign.
      if (event.altKey && (event.key === 'o' || event.key === 'O' || event.code === 'KeyO')) {
        event.preventDefault();
        event.stopPropagation();
        if (!isTyping || !isModalVisible('marketingContactModal') && !isModalVisible('marketingCampaignModal')) {
          await openNextRecipient(channel);
        }
        return;
      }

      // Enter submits the Add Customer form while the modal is open.
      // Textareas are intentionally excluded so Enter can still create a new line.
      if (event.key === 'Enter' && isModalVisible('marketingContactModal') && !event.shiftKey && tag !== 'textarea') {
        const contactForm = document.querySelector('#marketingContactModal form');
        if (contactForm && contactForm.contains(target)) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof contactForm.requestSubmit === 'function') contactForm.requestSubmit();
          else window.MarketingChannels.saveContact();
        }
      }
    }, true);
  }

  async function refreshContacts() {
    contactCacheLoaded = false;
    contactLoadPromise = null;
    await loadContacts();
    renderChannel('email');
    renderChannel('whatsapp');
  }

  // Called by the Leads page after it has already loaded a page. No new lead read.
  async function syncLoadedLeads(leads) {
    // Only sync when the marketing contact cache is already in use. This keeps
    // the Leads screen from generating extra writes for users who never open
    // a marketing module.
    if (!contactCacheLoaded || !Array.isArray(leads) || !leads.length || !isActiveUser()) return;
    const batch = db.batch();
    let writes = 0;
    leads.forEach(lead => {
      const id = `lead_${lead.id}`;
      const ref = contactsRef().doc(id);
      const existing = [...state.email.contacts, ...state.whatsapp.contacts].find(c => c.id === id);
      const payload = {
        source: 'lead',
        sourceLeadId: lead.id,
        name: lead.fullName || '',
        email: lead.email || '',
        phone: lead.phoneNumber || '',
        company: lead.companyName || '',
        marketingStatus: existing?.marketingStatus === 'Not Interested' || lead.status === 'Not Interested' ? 'Not Interested' : (existing?.marketingStatus || 'Interested'),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      if (!existing) payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      batch.set(ref, payload, { merge: true });
      writes++;
    });
    if (writes) {
      try {
        await batch.commit();
        if (contactCacheLoaded) await refreshContacts();
      } catch (err) {
        console.error('Loaded lead marketing sync failed:', err);
      }
    }
  }

  // One-time migration for existing leads. Deliberately explicit because it is
  // the only operation that scans the full leads collection for this module.
  async function syncExistingLeads() {
    if (!isAdmin()) return;
    if (!confirm('Sync all existing leads into Marketing Contacts? This performs one full leads read, then future marketing screens use the marketing contact cache.')) return;
    try {
      const snap = await leadsRef.get();
      let batch = db.batch();
      let count = 0;
      let batchCount = 0;
      for (const doc of snap.docs) {
        const lead = { id: doc.id, ...doc.data() };
        const ref = contactsRef().doc(`lead_${lead.id}`);
        const payload = {
          source: 'lead', sourceLeadId: lead.id, name: lead.fullName || '', email: lead.email || '', phone: lead.phoneNumber || '', company: lead.companyName || '',
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(), createdAt: firebase.firestore.FieldValue.serverTimestamp()
        };
        // A lead marked Not Interested must be unsubscribed. Otherwise leave an
        // existing marketing preference untouched so a manual unsubscribe is
        // never accidentally reversed by a later sync.
        if (lead.status === 'Not Interested') payload.marketingStatus = 'Not Interested';
        batch.set(ref, payload, { merge: true });
        count++; batchCount++;
        if (batchCount === 450) { await batch.commit(); batch = db.batch(); batchCount = 0; }
      }
      if (batchCount) await batch.commit();
      await refreshContacts();
      if (typeof toast === 'function') toast(`Synced ${count} existing leads into Marketing Contacts.`, 'success');
    } catch (err) {
      console.error(err);
      if (typeof toast === 'function') toast('Failed to sync existing leads.', 'danger');
    }
  }

  async function syncLeadUpdate(lead) {
    if (!lead?.id || !isActiveUser()) return;
    const ref = contactsRef().doc(`lead_${lead.id}`);
    const existing = getState('email').contacts.find(c => c.id === `lead_${lead.id}`) || null;
    await ref.set({
      source: 'lead', sourceLeadId: lead.id, name: lead.fullName || '', email: lead.email || '', phone: lead.phoneNumber || '', company: lead.companyName || '',
      marketingStatus: lead.status === 'Not Interested' ? 'Not Interested' : (existing?.marketingStatus || 'Interested'),
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      createdAt: firebase.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    if (contactCacheLoaded) await refreshContacts();
  }

  bindMarketingShortcuts();

  window.MarketingChannels = {
    openView, setSearch, closeCampaign, openCampaign, openContactModal, saveContact, deleteContact,
    openCampaignModal, saveCampaign, deleteCampaign, openMessage, syncLoadedLeads, syncLeadUpdate, syncExistingLeads
  };
})();
