// ============================================================
// CALL-AUDIT.JS — Mandatory Call Audit for "Not Interested"
//
// Workflow:
// 1. Sales Member selects "Not Interested" → blocked, modal opens
// 2. Upload recording + select reason + submit
// 3. Lead status → "Pending Approval"
// 4. Admin/Super Admin reviews in Call Audit Dashboard
// 5. Approve → "Not Interested" | Reject → restore status | Re-Call → "Re-Call Required"
//
// Storage: Uses Cloudinary (Firebase Storage removed - Spark plan limitation)
// ============================================================

(function() {
  'use strict';

  // ── Constants ─────────────────────────────────────────────────
  var CALL_AUDIT_REASONS = [
    "Customer selected another transporter",
    "Budget Issue",
    "Service not required",
    "Wrong Requirement",
    "Already using another logistics company",
    "Not planning now",
    "Other"
  ];

  var CALL_AUDIT_STATUS = {
    PENDING: "Pending",
    APPROVED: "Approved",
    REJECTED: "Rejected",
    RECALL_REQUESTED: "Re-Call Requested"
  };

  var SUPPORTED_AUDIO_FORMATS = [
    "audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4",
    "audio/aac", "audio/ogg", "audio/webm", "video/webm", "video/mp4"
  ];

  // ── Cloudinary Configuration ──────────────────────────────────
  var CLOUDINARY_CLOUD_NAME = "hazf1hmf";
  var CLOUDINARY_UPLOAD_PRESET = "abra-logistic-call-recordings";
  var CLOUDINARY_UPLOAD_URL = "https://api.cloudinary.com/v1_1/" + CLOUDINARY_CLOUD_NAME + "/auto/upload";

  // ── In-memory cache ───────────────────────────────────────────
  var ALL_CALL_AUDITS = [];
  var currentAuditLeadId = null;
  var currentAuditLead = null;
  var uploadedRecordingUrl = null;
  var uploadedRecordingPublicId = null;
  var uploadedRecordingFileName = null;
  var uploadedRecordingDuration = null;
  var isUploading = false;

  // ── Helper: Get CURRENT_USER safely ───────────────────────────
  function getCurrentUser() {
    return window.CURRENT_USER || { role: 'member', uid: '', name: '' };
  }

  // ── Helper: Check if Firestore is available ───────────────────
  function isFirestoreReady() {
    return window.callAuditsRef && window.leadsRef && window.notificationsRef;
  }

  // ── Helper: Get toast function ─────────────────────────────────
  function showToast(msg, type) {
    if (typeof window.toast === 'function') {
      window.toast(msg, type || 'primary');
    } else {
      console.log('Toast:', msg);
      alert(msg);
    }
  }

  // ── Helper: Extract service from direct lead fields or campaign data ──
  function extractLeadService(lead) {
    if (!lead) return "—";

    var directValues = [
      lead.serviceNeeded,
      lead.service,
      lead.requestedService,
      lead.freightService
    ];

    for (var i = 0; i < directValues.length; i++) {
      if (directValues[i] !== undefined && directValues[i] !== null && String(directValues[i]).trim()) {
        return String(directValues[i]).trim();
      }
    }

    var data = lead.campaignData;
    if (data && typeof data === "object") {
      var preferredKeys = [
        "service", "serviceNeeded", "requestedService", "freightService",
        "what service do you require", "which freight service do you require"
      ];

      for (var k = 0; k < preferredKeys.length; k++) {
        var wanted = preferredKeys[k].toLowerCase();
        var keys = Object.keys(data);
        for (var j = 0; j < keys.length; j++) {
          if (keys[j].toLowerCase() === wanted && data[keys[j]] !== undefined && data[keys[j]] !== null && String(data[keys[j]]).trim()) {
            return String(data[keys[j]]).trim();
          }
        }
      }

      var allKeys = Object.keys(data);
      for (var x = 0; x < allKeys.length; x++) {
        var key = allKeys[x];
        var lower = key.toLowerCase();
        var value = data[key];
        if ((lower.indexOf("service") !== -1 || lower.indexOf("requirement") !== -1) && value !== undefined && value !== null && String(value).trim()) {
          return String(value).trim();
        }
      }
    }

    return "—";
  }

  // ── Helper: Format date time ──────────────────────────────────
  function formatDateTime(date) {
    if (!date) return "—";
    try {
      var d = date.toDate ? date.toDate() : new Date(date);
      return d.toLocaleString("en-IN", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit"
      });
    } catch (e) {
      return "—";
    }
  }

  // ── Helper: Escape HTML ───────────────────────────────────────
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── Cloudinary Upload Function ────────────────────────────────
  // Returns: { url: data.secure_url, publicId: data.public_id, originalFilename: data.original_filename }
  // Throws: Error if upload fails
  async function uploadRecordingToCloudinary(file) {
    if (!file) {
      throw new Error('No file provided for upload');
    }

    var formData = new FormData();
    formData.append('file', file);
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);

    try {
      var response = await fetch(CLOUDINARY_UPLOAD_URL, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        var errorText = await response.text().catch(function() { return 'Unknown error'; });
        console.error('Cloudinary upload error:', response.status, errorText);
        throw new Error('Upload failed with status ' + response.status);
      }

      var data = await response.json();
      
      return {
        url: data.secure_url,
        publicId: data.public_id,
        originalFilename: data.original_filename
      };
    } catch (err) {
      console.error('Cloudinary upload failed:', err);
      throw err;
    }
  }

  // ── Initialize Call Audit subscription ─────────────────────────
  window.subscribeCallAudits = function() {
    if (!isFirestoreReady()) {
      console.warn('Call Audits: Firestore not ready');
      return;
    }
    
    window.callAuditsRef.orderBy("createdAt", "desc").onSnapshot(function(snap) {
      ALL_CALL_AUDITS = [];
      snap.forEach(function(doc) {
        ALL_CALL_AUDITS.push({ id: doc.id, ...doc.data() });
      });
      
      // Refresh the view if visible
      var section = document.getElementById("view-callaudit");
      if (section && !section.classList.contains("d-none")) {
        window.renderCallAuditDashboard();
      }
    }, function(err) {
      console.error("Call audits snapshot error:", err);
    });
  };

  // ── Check if user can mark "Not Interested" directly ───────────
  window.canDirectlyMarkNotInterested = function() {
    var user = getCurrentUser();
    return user.role === "superadmin" || (user.role === "admin" && hasPermission("callAudit.approve"));
  };

  // ── Intercept "Not Interested" status change ───────────────────
  window.handleNotInterestedStatus = function(leadId, lead) {
    var user = getCurrentUser();
    
    currentAuditLeadId = leadId;
    currentAuditLead = lead;
    uploadedRecordingUrl = null;
    uploadedRecordingPublicId = null;
    uploadedRecordingFileName = null;
    uploadedRecordingDuration = null;

    // Sales Members MUST go through audit workflow
    if (user.role === "member") {
      // Close the status modal first
      var statusModalEl = document.getElementById("statusModal");
      if (statusModalEl) {
        var modal = bootstrap.Modal.getInstance(statusModalEl);
        if (modal) modal.hide();
      }
      
      // Open the Call Audit Upload Modal
      window.openCallAuditUploadModal(lead);
      return true;
    }
    
    return false;
  };

  // ── Call Audit Upload Modal ───────────────────────────────────
  window.openCallAuditUploadModal = function(lead) {
    if (!lead) return;
    
    var leadNameEl = document.getElementById("callAuditLeadName");
    var leadPhoneEl = document.getElementById("callAuditLeadPhone");
    var leadCompanyEl = document.getElementById("callAuditLeadCompany");
    var reasonSelect = document.getElementById("callAuditReason");
    
    if (leadNameEl) leadNameEl.textContent = lead.fullName;
    if (leadPhoneEl) leadPhoneEl.textContent = lead.phoneNumber;
    if (leadCompanyEl) leadCompanyEl.textContent = lead.companyName || "—";
    
    // Populate reason dropdown
    if (reasonSelect) {
      reasonSelect.innerHTML = '<option value="">-- Select Reason --</option>' +
        CALL_AUDIT_REASONS.map(function(r) {
          return '<option value="' + escapeHtml(r) + '">' + escapeHtml(r) + '</option>';
        }).join("");
    }
    
    // Reset form
    var fileInput = document.getElementById("callAuditRecordingFile");
    if (fileInput) fileInput.value = "";
    
    var remarksInput = document.getElementById("callAuditRemarks");
    if (remarksInput) remarksInput.value = "";
    
    var progressWrap = document.getElementById("callAuditUploadProgressWrap");
    if (progressWrap) progressWrap.classList.add("d-none");
    
    var submitBtn = document.getElementById("callAuditSubmitBtn");
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Submit for Approval';
    }
    
    // Reset upload state
    uploadedRecordingUrl = null;
    uploadedRecordingPublicId = null;
    uploadedRecordingFileName = null;
    uploadedRecordingDuration = null;
    
    // Show modal
    var modalEl = document.getElementById("callAuditUploadModal");
    if (modalEl) {
      new bootstrap.Modal(modalEl).show();
    }
  };

  // ── Handle file selection ─────────────────────────────────────
  window.handleCallAuditFileSelect = function(input) {
    var file = input.files[0];
    var label = document.getElementById("callAuditRecordingLabel");
    var infoDiv = document.getElementById("callAuditRecordingInfo");
    var submitBtn = document.getElementById("callAuditSubmitBtn");
    
    if (!file) {
      if (label) label.textContent = "No file selected";
      if (infoDiv) infoDiv.classList.add("d-none");
      if (submitBtn) submitBtn.disabled = true;
      uploadedRecordingUrl = null;
      uploadedRecordingFileName = null;
      return;
    }
    
    // Validate file type
    var isValidType = SUPPORTED_AUDIO_FORMATS.includes(file.type) || 
                      file.name.match(/\.(mp3|wav|m4a|aac|ogg|webm|mp4)$/i);
    
    if (!isValidType) {
      showToast("Invalid file format. Please upload MP3, WAV, M4A, AAC, OGG, WebM, or MP4 audio files.", "danger");
      input.value = "";
      if (label) label.textContent = "No file selected";
      if (infoDiv) infoDiv.classList.add("d-none");
      if (submitBtn) submitBtn.disabled = true;
      return;
    }
    
    if (label) label.textContent = file.name;
    uploadedRecordingFileName = file.name;
    
    // Get audio duration
    var audio = new Audio();
    audio.preload = "metadata";
    audio.onloadedmetadata = function() {
      var duration = Math.round(audio.duration);
      uploadedRecordingDuration = duration;
      var mins = Math.floor(duration / 60);
      var secs = duration % 60;
      var durationEl = document.getElementById("callAuditRecordingDuration");
      if (durationEl) {
        durationEl.textContent = mins + ":" + secs.toString().padStart(2, "0");
      }
      if (infoDiv) infoDiv.classList.remove("d-none");
    };
    audio.onerror = function() {
      console.warn("Could not load audio metadata");
      if (infoDiv) infoDiv.classList.remove("d-none");
    };
    audio.src = URL.createObjectURL(file);
    
    // Upload the file
    window.uploadCallRecording(file);
  };

  // ── Upload recording to Cloudinary ────────────────────────────
  window.uploadCallRecording = function(file) {
    var progressWrap = document.getElementById("callAuditUploadProgressWrap");
    var progressBar = document.getElementById("callAuditUploadProgress");
    var progressText = document.getElementById("callAuditUploadProgressText");
    var submitBtn = document.getElementById("callAuditSubmitBtn");
    
    if (progressWrap) progressWrap.classList.remove("d-none");
    if (progressBar) {
      progressBar.style.width = "0%";
      progressBar.classList.remove("bg-success", "bg-danger");
    }
    if (progressText) progressText.textContent = "Uploading...";
    if (submitBtn) submitBtn.disabled = true;
    
    // Validate currentAuditLeadId is set
    if (!currentAuditLeadId || !currentAuditLead) {
      showToast("Lead information not available. Please try again.", "danger");
      if (progressWrap) progressWrap.classList.add("d-none");
      if (submitBtn) submitBtn.disabled = false;
      return;
    }
    
    // Set upload state
    isUploading = true;
    
    // Show indeterminate progress (since fetch doesn't provide progress)
    if (progressBar) {
      progressBar.classList.add("progress-bar-animated");
      progressBar.style.width = "100%";
    }
    
    uploadRecordingToCloudinary(file)
      .then(function(result) {
        uploadedRecordingUrl = result.url;
        uploadedRecordingPublicId = result.publicId;
        
        if (progressText) progressText.textContent = "Upload complete ✓";
        if (progressBar) {
          progressBar.classList.remove("progress-bar-animated");
          progressBar.style.width = "100%";
          progressBar.classList.add("bg-success");
        }
        if (submitBtn) submitBtn.disabled = false;
        showToast("Recording uploaded successfully.", "success");
      })
      .catch(function(err) {
        console.error("Upload failed:", err);
        showToast("Recording upload failed. Please try again.", "danger");
        if (progressText) progressText.textContent = "Upload failed";
        if (progressBar) {
          progressBar.classList.remove("progress-bar-animated");
          progressBar.classList.add("bg-danger");
        }
        if (submitBtn) submitBtn.disabled = false;
      })
      .finally(function() {
        isUploading = false;
      });
  };

  // ── Submit Call Audit Request ─────────────────────────────────
  window.submitCallAuditRequest = function() {
    var reasonSelect = document.getElementById("callAuditReason");
    var remarksInput = document.getElementById("callAuditRemarks");
    var submitBtn = document.getElementById("callAuditSubmitBtn");
    
    var reason = reasonSelect ? reasonSelect.value : "";
    var remarks = remarksInput ? remarksInput.value.trim() : "";
    
    if (!uploadedRecordingUrl) {
      showToast("Please upload a call recording first.", "warning");
      return;
    }
    
    if (!reason) {
      showToast("Please select a reason.", "warning");
      return;
    }
    
    if (!isFirestoreReady()) {
      showToast("Database connection error. Please refresh the page.", "danger");
      return;
    }
    
    // Validate lead exists
    if (!currentAuditLead || !currentAuditLeadId) {
      showToast("Lead information not available. Please try again.", "danger");
      return;
    }
    
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Submitting...';
    }
    
    var user = getCurrentUser();
    var now = firebase.firestore.Timestamp.now();
    var auditId = "audit_" + Date.now();
    var previousStatus = currentAuditLead.status;
    
    // Create audit record
    window.callAuditsRef.doc(auditId).set({
      id: auditId,
      leadId: currentAuditLeadId,
      slNo: currentAuditLead.slNo,
      customerName: currentAuditLead.fullName,
      phoneNumber: currentAuditLead.phoneNumber,
      companyName: currentAuditLead.companyName || "",
      serviceNeeded: extractLeadService(currentAuditLead),
      salesMemberId: user.uid,
      salesMemberName: user.name || user.email,
      previousStatus: previousStatus,
      reason: reason,
      remarks: remarks,
      recordingUrl: uploadedRecordingUrl,
      recordingPublicId: uploadedRecordingPublicId,
      recordingFileName: uploadedRecordingFileName,
      recordingDuration: uploadedRecordingDuration,
      status: CALL_AUDIT_STATUS.PENDING,
      createdAt: now,
      createdBy: user.uid,
      createdByName: user.name || user.email
    }).then(function() {
      // Update lead status to "Pending Approval"
      var historyEntry = {
        text: "Not Interested requested. Reason: " + reason + ". Recording uploaded. Waiting for admin approval.",
        statusAtTime: "Pending Approval",
        updatedBy: user.uid,
        updatedByName: user.name || user.email,
        timestamp: new Date().toISOString()
      };
      
      return window.leadsRef.doc(currentAuditLeadId).update({
        status: "Pending Approval",
        callAuditStatus: CALL_AUDIT_STATUS.PENDING,
        callAuditId: auditId,
        previousStatusBeforeAudit: previousStatus,
        lastCallSummary: remarks || reason || "",
        lastStatusNote: remarks || reason || "",
        callAuditReason: reason || "",
        history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
      });
    }).then(function() {
      // Notify Admins and Super Admins
      window.notifyAdminsForCallAudit(currentAuditLead, reason);
      
      // Close modal and show success
      var modalEl = document.getElementById("callAuditUploadModal");
      if (modalEl) {
        bootstrap.Modal.getInstance(modalEl).hide();
      }
      showToast("Call audit request submitted. Waiting for admin approval.", "success");
      
      // Reset state
      uploadedRecordingUrl = null;
      uploadedRecordingPublicId = null;
      uploadedRecordingFileName = null;
      uploadedRecordingDuration = null;
      currentAuditLead = null;
      currentAuditLeadId = null;
      
    }).catch(function(err) {
      console.error("Submit call audit error:", err);
      showToast("Failed to submit audit request. Please try again.", "danger");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<i class="bi bi-check-lg me-1"></i>Submit for Approval';
      }
    });
  };

  // ── Notify Admins for Call Audit ──────────────────────────────
  window.notifyAdminsForCallAudit = function(lead, reason) {
    if (!window.notificationsRef) return;
    
    window.notificationsRef.where("userId", "!=", "").get().then(function(snap) {
      var notificationPromises = [];
      snap.forEach(function(doc) {
        var admin = doc.data();
        if (admin.role === "admin" || admin.role === "superadmin") {
          notificationPromises.push(
            window.notificationsRef.add({
              userId: doc.id,
              userName: admin.name || admin.email,
              type: "call_audit_review",
              title: "New Call Audit Requires Review",
              message: "Lead #" + lead.slNo + " - " + lead.fullName + " requested 'Not Interested' status. Reason: " + reason,
              leadId: currentAuditLeadId,
              read: false,
              createdAt: firebase.firestore.Timestamp.now()
            })
          );
        }
      });
      return Promise.all(notificationPromises);
    }).catch(function(err) {
      console.error("Failed to send notifications:", err);
    });
  };

  // ── Call Audit Status Badge Helper ───────────────────────────
  window._callAuditStatusBadge = function(status) {
    var badges = {};
    badges[CALL_AUDIT_STATUS.PENDING] = '<span class="badge bg-warning text-dark"><i class="bi bi-clock me-1"></i>Pending Review</span>';
    badges[CALL_AUDIT_STATUS.APPROVED] = '<span class="badge bg-success"><i class="bi bi-check-circle me-1"></i>Approved</span>';
    badges[CALL_AUDIT_STATUS.REJECTED] = '<span class="badge bg-danger"><i class="bi bi-x-circle me-1"></i>Rejected</span>';
    badges[CALL_AUDIT_STATUS.RECALL_REQUESTED] = '<span class="badge bg-info"><i class="bi bi-telephone me-1"></i>Re-Call Required</span>';
    return badges[status] || '<span class="badge bg-secondary">' + escapeHtml(status) + '</span>';
  };

  // ── Call Audit Dashboard ──────────────────────────────────────
  window.renderCallAuditDashboard = function() {
    var wrap = document.getElementById("view-callaudit");
    if (!wrap) return;
    
    var user = getCurrentUser();
    var isStaff = user.role === "admin" || user.role === "superadmin";
    
    if (!isStaff) {
      wrap.innerHTML = '<div class="alert alert-danger"><i class="bi bi-lock-fill me-2"></i>Access Denied. Only Admins can view Call Audit Dashboard.</div>';
      return;
    }
    
    // Filter tabs
    var statusFilterEl = document.getElementById("callAuditStatusFilter");
    var statusFilter = statusFilterEl ? statusFilterEl.value : "all";
    
    var filteredAudits = ALL_CALL_AUDITS;
    if (statusFilter !== "all") {
      filteredAudits = ALL_CALL_AUDITS.filter(function(a) {
        return a.status === statusFilter;
      });
    }
    
    // Stats
    var pendingCount = ALL_CALL_AUDITS.filter(function(a) { return a.status === CALL_AUDIT_STATUS.PENDING; }).length;
    var approvedCount = ALL_CALL_AUDITS.filter(function(a) { return a.status === CALL_AUDIT_STATUS.APPROVED; }).length;
    var rejectedCount = ALL_CALL_AUDITS.filter(function(a) { return a.status === CALL_AUDIT_STATUS.REJECTED; }).length;
    var recallCount = ALL_CALL_AUDITS.filter(function(a) { return a.status === CALL_AUDIT_STATUS.RECALL_REQUESTED; }).length;
    
    wrap.innerHTML = '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">' +
      '<div><h1 class="page-title"><i class="bi bi-clipboard-check me-2"></i>Call Audit</h1>' +
      '<p class="page-subtitle">Review and approve "Not Interested" requests with call recordings.</p></div></div>' +
      
      '<div class="row g-3 mb-4">' +
      '<div class="col-6 col-md-3"><div class="dash-stat-card" style="border-left: 4px solid var(--amber);">' +
      '<div class="dash-stat-value" style="color: var(--amber);">' + pendingCount + '</div><div class="dash-stat-label">Pending Review</div></div></div>' +
      '<div class="col-6 col-md-3"><div class="dash-stat-card" style="border-left: 4px solid #1E7A34;">' +
      '<div class="dash-stat-value" style="color: #1E7A34;">' + approvedCount + '</div><div class="dash-stat-label">Approved</div></div></div>' +
      '<div class="col-6 col-md-3"><div class="dash-stat-card" style="border-left: 4px solid #B23434;">' +
      '<div class="dash-stat-value" style="color: #B23434;">' + rejectedCount + '</div><div class="dash-stat-label">Rejected</div></div></div>' +
      '<div class="col-6 col-md-3"><div class="dash-stat-card" style="border-left: 4px solid #6339B5;">' +
      '<div class="dash-stat-value" style="color: #6339B5;">' + recallCount + '</div><div class="dash-stat-label">Re-Call Requested</div></div></div></div>' +
      
      '<div class="row g-2 mb-3"><div class="col-6 col-md-3">' +
      '<label class="form-label small mb-1">Filter by Status</label>' +
      '<select id="callAuditStatusFilter" class="form-select form-select-sm" onchange="window.renderCallAuditDashboard()">' +
      '<option value="all"' + (statusFilter === "all" ? ' selected' : '') + '>All Requests</option>' +
      '<option value="' + CALL_AUDIT_STATUS.PENDING + '"' + (statusFilter === CALL_AUDIT_STATUS.PENDING ? ' selected' : '') + '>Pending Review</option>' +
      '<option value="' + CALL_AUDIT_STATUS.APPROVED + '"' + (statusFilter === CALL_AUDIT_STATUS.APPROVED ? ' selected' : '') + '>Approved</option>' +
      '<option value="' + CALL_AUDIT_STATUS.REJECTED + '"' + (statusFilter === CALL_AUDIT_STATUS.REJECTED ? ' selected' : '') + '>Rejected</option>' +
      '<option value="' + CALL_AUDIT_STATUS.RECALL_REQUESTED + '"' + (statusFilter === CALL_AUDIT_STATUS.RECALL_REQUESTED ? ' selected' : '') + '>Re-Call Requested</option></select></div></div>' +
      
      '<div class="table-card"><div class="table-responsive"><table class="table align-middle table-hover mb-0">' +
      '<thead><tr><th>Lead #</th><th>Customer</th><th>Phone</th><th>Sales Member</th><th>Reason</th><th>Recording</th><th>Requested</th><th>Status</th><th>Actions</th></tr></thead>' +
      '<tbody>' +
      (filteredAudits.length === 0 
        ? '<tr><td colspan="9" class="text-center text-muted py-4">No call audit requests found.</td></tr>'
        : filteredAudits.map(function(audit) {
            return '<tr><td><span class="fw-semibold">#' + audit.slNo + '</span></td>' +
              '<td>' + escapeHtml(audit.customerName) + '</td>' +
              '<td>' + escapeHtml(audit.phoneNumber) + '</td>' +
              '<td>' + escapeHtml(audit.salesMemberName) + '</td>' +
              '<td><span class="badge bg-secondary">' + escapeHtml(audit.reason) + '</span></td>' +
              '<td><button class="btn btn-sm btn-outline-primary" onclick="window.openCallAuditReviewModal(\'' + audit.id + '\')"><i class="bi bi-play-circle me-1"></i>Play</button></td>' +
              '<td>' + (audit.createdAt ? formatDateTime(audit.createdAt.toDate()) : "—") + '</td>' +
              '<td>' + window._callAuditStatusBadge(audit.status) + '</td>' +
              '<td class="text-nowrap">' +
              (audit.status === CALL_AUDIT_STATUS.PENDING 
                ? '<button class="btn btn-sm btn-success" onclick="window.openCallAuditReviewModal(\'' + audit.id + '\')" title="Review"><i class="bi bi-check-circle"></i> Review</button>'
                : '<button class="btn btn-sm btn-outline-secondary" onclick="window.openCallAuditReviewModal(\'' + audit.id + '\')" title="View Details"><i class="bi bi-eye"></i> View</button>') +
              '</td></tr>';
          }).join("")) +
      '</tbody></table></div></div>';
  };

  // ── Call Audit Review Modal ───────────────────────────────────
  window.openCallAuditReviewModal = function(auditId) {
    var audit = ALL_CALL_AUDITS.find(function(a) { return a.id === auditId; });
    if (!audit) {
      showToast("Audit record not found.", "danger");
      return;
    }
    
    var isPending = audit.status === CALL_AUDIT_STATUS.PENDING;
    var user = getCurrentUser();
    var canReview = user.role === "admin" || user.role === "superadmin";
    
    var leadNameEl = document.getElementById("callAuditReviewLeadName");
    var leadPhoneEl = document.getElementById("callAuditReviewLeadPhone");
    var leadCompanyEl = document.getElementById("callAuditReviewLeadCompany");
    var leadServiceEl = document.getElementById("callAuditReviewLeadService");
    var salesMemberEl = document.getElementById("callAuditReviewSalesMember");
    var reasonEl = document.getElementById("callAuditReviewReason");
    var remarksEl = document.getElementById("callAuditReviewRemarks");
    var dateEl = document.getElementById("callAuditReviewDate");
    var statusEl = document.getElementById("callAuditReviewStatus");
    
    if (leadNameEl) leadNameEl.textContent = audit.customerName;
    if (leadPhoneEl) leadPhoneEl.textContent = audit.phoneNumber;
    if (leadCompanyEl) leadCompanyEl.textContent = audit.companyName || "—";
    if (leadServiceEl) leadServiceEl.textContent = audit.serviceNeeded || "—";
    if (salesMemberEl) salesMemberEl.textContent = audit.salesMemberName;
    if (reasonEl) reasonEl.textContent = audit.reason;
    if (remarksEl) remarksEl.textContent = audit.remarks || "No remarks provided";
    if (dateEl) dateEl.textContent = audit.createdAt ? formatDateTime(audit.createdAt.toDate()) : "—";
    if (statusEl) statusEl.innerHTML = window._callAuditStatusBadge(audit.status);
    
    // Audio player
    var audioPlayer = document.getElementById("callAuditReviewAudio");
    if (audioPlayer) {
      audioPlayer.src = audit.recordingUrl;
    }
    
    var fileNameEl = document.getElementById("callAuditReviewFileName");
    if (fileNameEl) fileNameEl.textContent = audit.recordingFileName || "Recording";
    
    var durationEl = document.getElementById("callAuditReviewDuration");
    if (durationEl) {
      if (audit.recordingDuration) {
        var mins = Math.floor(audit.recordingDuration / 60);
        var secs = audit.recordingDuration % 60;
        durationEl.textContent = mins + ":" + secs.toString().padStart(2, "0");
      } else {
        durationEl.textContent = "—";
      }
    }
    
    // Download link
    var downloadBtn = document.getElementById("callAuditReviewDownloadBtn");
    if (downloadBtn) {
      downloadBtn.href = audit.recordingUrl;
      downloadBtn.download = audit.recordingFileName || "recording.mp3";
    }
    
    // Admin remarks
    var adminRemarksEl = document.getElementById("callAuditReviewAdminRemarks");
    if (adminRemarksEl) {
      adminRemarksEl.value = audit.adminRemarks || "";
    }
    
    // Show/hide action buttons based on status and role
    var actionsDiv = document.getElementById("callAuditReviewActions");
    if (actionsDiv) {
      if (isPending && canReview) {
        actionsDiv.classList.remove("d-none");
        if (adminRemarksEl) adminRemarksEl.disabled = false;
      } else {
        actionsDiv.classList.add("d-none");
        if (adminRemarksEl) adminRemarksEl.disabled = true;
      }
    }
    
    // Show previous approval info if exists
    var approvalInfo = document.getElementById("callAuditReviewApprovalInfo");
    if (approvalInfo) {
      if (audit.status !== CALL_AUDIT_STATUS.PENDING && audit.reviewedByName) {
        approvalInfo.classList.remove("d-none");
        var reviewedByEl = document.getElementById("callAuditReviewReviewedBy");
        var reviewedAtEl = document.getElementById("callAuditReviewReviewedAt");
        if (reviewedByEl) reviewedByEl.textContent = audit.reviewedByName;
        if (reviewedAtEl) reviewedAtEl.textContent = audit.reviewedAt ? formatDateTime(audit.reviewedAt.toDate()) : "—";
      } else {
        approvalInfo.classList.add("d-none");
      }
    }
    
    // Store current audit id for actions
    var modalEl = document.getElementById("callAuditReviewModal");
    if (modalEl) {
      modalEl.dataset.auditId = auditId;
    }
    
    // Show modal
    if (modalEl) {
      new bootstrap.Modal(modalEl).show();
    }
  };

  // ── Admin Actions ─────────────────────────────────────────────
  window.approveCallAudit = function(withRemarks) {
    var auditId = document.getElementById("callAuditReviewModal")?.dataset.auditId;
    if (!auditId) return;
    
    var audit = ALL_CALL_AUDITS.find(function(a) { return a.id === auditId; });
    if (!audit) return;
    
    var adminRemarksEl = document.getElementById("callAuditReviewAdminRemarks");
    var adminRemarks = adminRemarksEl ? adminRemarksEl.value.trim() : "";
    
    if (withRemarks && !adminRemarks) {
      showToast("Please add remarks for this approval.", "warning");
      return;
    }
    
    var user = getCurrentUser();
    var now = firebase.firestore.Timestamp.now();
    
    // Update audit record
    window.callAuditsRef.doc(auditId).update({
      status: CALL_AUDIT_STATUS.APPROVED,
      reviewedBy: user.uid,
      reviewedByName: user.name || user.email,
      reviewedAt: now,
      adminRemarks: adminRemarks
    }).then(function() {
      // Update lead status to "Not Interested"
      var historyEntry = {
        text: "Call audit approved. Lead marked as Not Interested." + (adminRemarks ? " Remarks: " + adminRemarks : ""),
        statusAtTime: "Not Interested",
        updatedBy: user.uid,
        updatedByName: user.name || user.email,
        timestamp: new Date().toISOString()
      };
      
      return window.leadsRef.doc(audit.leadId).update({
        status: "Not Interested",
        callAuditStatus: CALL_AUDIT_STATUS.APPROVED,
        history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
      });
    }).then(function() {
      // Close modal and show success
      var modalEl = document.getElementById("callAuditReviewModal");
      if (modalEl) {
        bootstrap.Modal.getInstance(modalEl).hide();
      }
      showToast("Call audit approved. Lead marked as Not Interested.", "success");
    }).catch(function(err) {
      console.error("Approve error:", err);
      showToast("Failed to approve audit request.", "danger");
    });
  };

  window.rejectCallAudit = function() {
    var auditId = document.getElementById("callAuditReviewModal")?.dataset.auditId;
    if (!auditId) return;
    
    var audit = ALL_CALL_AUDITS.find(function(a) { return a.id === auditId; });
    if (!audit) return;
    
    var adminRemarksEl = document.getElementById("callAuditReviewAdminRemarks");
    var adminRemarks = adminRemarksEl ? adminRemarksEl.value.trim() : "";
    
    if (!adminRemarks) {
      showToast("Please provide remarks explaining why this request is rejected.", "warning");
      return;
    }
    
    var user = getCurrentUser();
    var now = firebase.firestore.Timestamp.now();
    
    // Update audit record
    window.callAuditsRef.doc(auditId).update({
      status: CALL_AUDIT_STATUS.REJECTED,
      reviewedBy: user.uid,
      reviewedByName: user.name || user.email,
      reviewedAt: now,
      adminRemarks: adminRemarks
    }).then(function() {
      // Restore previous lead status
      var previousStatus = audit.previousStatus || "Not Open";
      var historyEntry = {
        text: "Call audit rejected. Status restored to " + previousStatus + ". Remarks: " + adminRemarks,
        statusAtTime: previousStatus,
        updatedBy: user.uid,
        updatedByName: user.name || user.email,
        timestamp: new Date().toISOString()
      };
      
      return window.leadsRef.doc(audit.leadId).update({
        status: previousStatus,
        callAuditStatus: firebase.firestore.FieldValue.delete(),
        callAuditId: firebase.firestore.FieldValue.delete(),
        previousStatusBeforeAudit: firebase.firestore.FieldValue.delete(),
        history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
      });
    }).then(function() {
      // Close modal and show success
      var modalEl = document.getElementById("callAuditReviewModal");
      if (modalEl) {
        bootstrap.Modal.getInstance(modalEl).hide();
      }
      showToast("Call audit rejected. Lead status restored.", "success");
    }).catch(function(err) {
      console.error("Reject error:", err);
      showToast("Failed to reject audit request.", "danger");
    });
  };

  window.requestRecallAudit = function() {
    var auditId = document.getElementById("callAuditReviewModal")?.dataset.auditId;
    if (!auditId) return;
    
    var audit = ALL_CALL_AUDITS.find(function(a) { return a.id === auditId; });
    if (!audit) return;
    
    var adminRemarksEl = document.getElementById("callAuditReviewAdminRemarks");
    var adminRemarks = adminRemarksEl ? adminRemarksEl.value.trim() : "";
    
    if (!adminRemarks) {
      showToast("Please provide remarks for the re-call request.", "warning");
      return;
    }
    
    var user = getCurrentUser();
    var now = firebase.firestore.Timestamp.now();
    
    // Update audit record
    window.callAuditsRef.doc(auditId).update({
      status: CALL_AUDIT_STATUS.RECALL_REQUESTED,
      reviewedBy: user.uid,
      reviewedByName: user.name || user.email,
      reviewedAt: now,
      adminRemarks: adminRemarks
    }).then(function() {
      // Update lead status to "Re-Call Required"
      var historyEntry = {
        text: "Admin requested re-call. " + adminRemarks,
        statusAtTime: "Re-Call Required",
        updatedBy: user.uid,
        updatedByName: user.name || user.email,
        timestamp: new Date().toISOString()
      };
      
      return window.leadsRef.doc(audit.leadId).update({
        status: "Re-Call Required",
        callAuditStatus: CALL_AUDIT_STATUS.RECALL_REQUESTED,
        history: firebase.firestore.FieldValue.arrayUnion(historyEntry)
      });
    }).then(function() {
      // Close modal and show success
      var modalEl = document.getElementById("callAuditReviewModal");
      if (modalEl) {
        bootstrap.Modal.getInstance(modalEl).hide();
      }
      showToast("Re-call requested. Sales member has been notified.", "success");
    }).catch(function(err) {
      console.error("Re-call error:", err);
      showToast("Failed to request re-call.", "danger");
    });
  };

  // Expose enums globally for external use
  window.callAuditReasons = CALL_AUDIT_REASONS;
  window.callAuditStatus = CALL_AUDIT_STATUS;

})();