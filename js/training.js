// ============================================================
// TRAINING.JS — Sales Academy (Knowledge Center)
// ============================================================
// Complete dynamic training platform for ABRA Logistics CRM
// ============================================================

let ALL_TRAINING_CATEGORIES = [];
let ALL_TRAININGS = [];
let ALL_QUIZZES = [];
let USER_PROGRESS = {};
let USER_CERTIFICATES = [];
let KNOWLEDGE_BASE = [];
let CURRENT_TRAINING = null;
let CURRENT_SECTION_INDEX = 0;
let ALL_USERS_PROGRESS = []; // For admin analytics
let CURRENT_EDITING_TRAINING = null; // For training builder

// ============================================================
// UTILITY FUNCTIONS (must be defined first)
// ============================================================

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(date) {
  if (!date) return '—';
  const options = { year: 'numeric', month: 'long', day: 'numeric' };
  return date.toLocaleDateString('en-US', options);
}

function formatDateTime(date) {
  if (!date) return '—';
  const options = { 
    year: 'numeric', 
    month: 'short', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  };
  return date.toLocaleDateString('en-US', options);
}

// ============================================================
// LOAD TRAINING VIEW
// ============================================================

window.loadTrainingView = async function() {
  const container = document.getElementById("trainingContentArea");
  if (!container) return;
  
  container.innerHTML = '<div class="text-center py-5"><div class="spinner-border text-primary"></div><p class="mt-2">Loading Sales Academy...</p></div>';
  
  try {
    await Promise.all([
      loadTrainingCategories(),
      loadAllTrainings(),
      loadUserProgress(),
      loadUserCertificates(),
      loadKnowledgeBase(),
      loadAllUsersProgress() // For admin stats
    ]);
    
    // Role-based rendering
    if (CURRENT_USER.role === "member") {
      renderMemberTrainingDashboard();
    } else if (CURRENT_USER.role === "admin" || CURRENT_USER.role === "superadmin") {
      renderAdminTrainingDashboard();
    } else {
      renderMemberTrainingDashboard();
    }
    
    // Update sidebar badge
    updateProgressBadge();
  } catch (error) {
    console.error("Error loading training view:", error);
    container.innerHTML = '<div class="alert alert-danger">Failed to load Sales Academy. Please refresh the page.</div>';
  }
}

// ============================================================
// DATA LOADING
// ============================================================

async function loadTrainingCategories() {
  try {
    const snap = await trainingCategoriesRef
      .where("active", "==", true)
      .orderBy("order", "asc")
      .get();
    ALL_TRAINING_CATEGORIES = [];
    snap.forEach(doc => {
      ALL_TRAINING_CATEGORIES.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error("Error loading categories:", error);
    ALL_TRAINING_CATEGORIES = [];
  }
}

async function loadAllTrainings() {
  try {
    let query = trainingsRef;
    if (CURRENT_USER.role === "member") {
      query = query.where("status", "==", "published");
    }
    const snap = await query.get();
    ALL_TRAININGS = [];
    snap.forEach(doc => {
      ALL_TRAININGS.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error("Error loading trainings:", error);
    ALL_TRAININGS = [];
  }
}

async function loadUserProgress() {
  try {
    const snap = await trainingProgressRef
      .where("userId", "==", CURRENT_USER.uid)
      .get();
    USER_PROGRESS = {};
    snap.forEach(doc => {
      const data = doc.data();
      USER_PROGRESS[data.trainingId] = { id: doc.id, ...data };
    });
  } catch (error) {
    console.error("Error loading progress:", error);
    USER_PROGRESS = {};
  }
}

async function loadUserCertificates() {
  try {
    const snap = await certificatesRef
      .where("userId", "==", CURRENT_USER.uid)
      .orderBy("issuedAt", "desc")
      .get();
    USER_CERTIFICATES = [];
    snap.forEach(doc => {
      USER_CERTIFICATES.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error("Error loading certificates:", error);
    USER_CERTIFICATES = [];
  }
}

async function loadKnowledgeBase() {
  try {
    const snap = await db.collection("knowledgeBase")
      .where("status", "==", "published")
      .orderBy("order", "asc")
      .get();
    KNOWLEDGE_BASE = [];
    snap.forEach(doc => {
      KNOWLEDGE_BASE.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error("Error loading knowledge base:", error);
    KNOWLEDGE_BASE = [];
  }
}

async function loadAllUsersProgress() {
  // Only load for admins
  if (CURRENT_USER.role !== "admin" && CURRENT_USER.role !== "superadmin") {
    ALL_USERS_PROGRESS = [];
    return;
  }
  
  try {
    const snap = await trainingProgressRef.get();
    ALL_USERS_PROGRESS = [];
    snap.forEach(doc => {
      ALL_USERS_PROGRESS.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error("Error loading all users progress:", error);
    ALL_USERS_PROGRESS = [];
  }
}

// ============================================================
// MEMBER DASHBOARD
// ============================================================

function renderMemberTrainingDashboard() {
  const container = document.getElementById("trainingContentArea");
  if (!container) return;
  
  const stats = calculateMemberStats();
  
  container.innerHTML = `
    <div class="training-dashboard">
      <!-- Hero Section -->
      <div class="training-hero mb-4">
        <div class="row align-items-center">
          <div class="col-md-8">
            <h1 class="training-hero-title">
              <i class="bi bi-mortarboard-fill me-2"></i>Sales Academy
            </h1>
            <p class="training-hero-subtitle">
              Master your sales skills. Learn campaigns, CRM workflows, and professional customer handling.
            </p>
          </div>
          <div class="col-md-4">
            <div class="training-progress-ring-container">
              <svg class="training-progress-ring" width="120" height="120">
                <circle class="training-progress-ring-circle-bg" cx="60" cy="60" r="52"></circle>
                <circle class="training-progress-ring-circle" cx="60" cy="60" r="52" 
                        style="stroke-dashoffset: ${327 - (327 * stats.overallProgress / 100)}"></circle>
              </svg>
              <div class="training-progress-ring-text">
                <div class="training-progress-ring-value">${stats.overallProgress}%</div>
                <div class="training-progress-ring-label">Complete</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Stats Cards -->
      <div class="row g-3 mb-4">
        <div class="col-6 col-md-3">
          <div class="training-stat-card">
            <div class="training-stat-icon text-success"><i class="bi bi-check-circle-fill"></i></div>
            <div class="training-stat-value">${stats.completed}</div>
            <div class="training-stat-label">Completed</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="training-stat-card">
            <div class="training-stat-icon text-warning"><i class="bi bi-clock-history"></i></div>
            <div class="training-stat-value">${stats.inProgress}</div>
            <div class="training-stat-label">In Progress</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="training-stat-card">
            <div class="training-stat-icon text-primary"><i class="bi bi-book"></i></div>
            <div class="training-stat-value">${stats.totalCourses}</div>
            <div class="training-stat-label">Total Courses</div>
          </div>
        </div>
        <div class="col-6 col-md-3">
          <div class="training-stat-card">
            <div class="training-stat-icon text-info"><i class="bi bi-award-fill"></i></div>
            <div class="training-stat-value">${stats.certificates}</div>
            <div class="training-stat-label">Certificates</div>
          </div>
        </div>
      </div>
      
      <!-- Navigation Tabs -->
      <ul class="nav nav-tabs training-tabs mb-4" role="tablist">
        <li class="nav-item">
          <button class="nav-link active" data-bs-toggle="tab" data-bs-target="#tab-my-learning">
            <i class="bi bi-person-workspace me-1"></i>My Learning
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-browse" onclick="renderBrowseCourses()">
            <i class="bi bi-grid-3x3-gap me-1"></i>Browse Courses
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-certificates" onclick="renderCertificatesTab()">
            <i class="bi bi-award me-1"></i>Certificates
          </button>
        </li>
        <li class="nav-item">
          <button class="nav-link" data-bs-toggle="tab" data-bs-target="#tab-knowledge" onclick="renderKnowledgeBaseTab()">
            <i class="bi bi-book-half me-1"></i>Knowledge Base
          </button>
        </li>
      </ul>
      
      <!-- Tab Content -->
      <div class="tab-content">
        <div class="tab-pane fade show active" id="tab-my-learning">
          ${renderMyLearningTab()}
        </div>
        <div class="tab-pane fade" id="tab-browse"></div>
        <div class="tab-pane fade" id="tab-certificates"></div>
        <div class="tab-pane fade" id="tab-knowledge"></div>
      </div>
    </div>
  `;
}

function calculateMemberStats() {
  const completed = Object.values(USER_PROGRESS).filter(p => p.status === "completed").length;
  const inProgress = Object.values(USER_PROGRESS).filter(p => p.status === "in_progress").length;
  const totalCourses = ALL_TRAININGS.length;
  const certificates = USER_CERTIFICATES.length;
  const overallProgress = totalCourses > 0 ? Math.round((completed / totalCourses) * 100) : 0;
  
  return { completed, inProgress, totalCourses, certificates, overallProgress };
}

// ============================================================
// ADMIN DASHBOARD
// ============================================================

function renderAdminTrainingDashboard() {
  const container = document.getElementById("trainingContentArea");
  if (!container) return;
  
  // Calculate admin stats
  const totalCourses = ALL_TRAININGS.length;
  const published = ALL_TRAININGS.filter(t => t.status === "published").length;
  const draft = ALL_TRAININGS.filter(t => t.status === "draft").length;
  const campaignTrainings = ALL_TRAININGS.filter(t => t.campaignId).length;
  const uniqueUsers = new Set(ALL_USERS_PROGRESS.map(p => p.userId));
  const employeesTrained = uniqueUsers.size;
  const certificatesIssued = ALL_USERS_PROGRESS.filter(p => p.certificateIssued).length;
  
  container.innerHTML = `
    <div class="training-admin-dashboard">
      <!-- Admin Header -->
      <div class="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 class="mb-1">
            <i class="bi bi-mortarboard-fill me-2"></i>Sales Academy Management
          </h1>
          <p class="text-muted mb-0">Create and manage training courses, track team progress</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-primary" onclick="toast('Training builder coming soon', 'info')">
            <i class="bi bi-plus-lg me-1"></i>New Course
          </button>
          <button class="btn btn-outline-primary" onclick="toast('Category manager coming soon', 'info')">
            <i class="bi bi-folder-plus me-1"></i>Categories
          </button>
          <button class="btn btn-outline-primary" onclick="toast('Knowledge base manager coming soon', 'info')">
            <i class="bi bi-book me-1"></i>Knowledge Base
          </button>
          <button class="btn btn-outline-secondary" onclick="toast('Reports coming soon', 'info')">
            <i class="bi bi-graph-up me-1"></i>Reports
          </button>
        </div>
      </div>
      
      <!-- Admin KPI Cards -->
      <div class="row g-3 mb-4">
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-book-fill text-primary fs-2 mb-2"></i>
              <h3 class="mb-0">${totalCourses}</h3>
              <small class="text-muted">Total Courses</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-check-circle-fill text-success fs-2 mb-2"></i>
              <h3 class="mb-0">${published}</h3>
              <small class="text-muted">Published</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-pencil-square text-warning fs-2 mb-2"></i>
              <h3 class="mb-0">${draft}</h3>
              <small class="text-muted">Draft</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-briefcase-fill text-info fs-2 mb-2"></i>
              <h3 class="mb-0">${campaignTrainings}</h3>
              <small class="text-muted">Campaign Trainings</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-people-fill text-secondary fs-2 mb-2"></i>
              <h3 class="mb-0">${employeesTrained}</h3>
              <small class="text-muted">Employees Trained</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-award-fill text-danger fs-2 mb-2"></i>
              <h3 class="mb-0">${certificatesIssued}</h3>
              <small class="text-muted">Certificates</small>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Quick Info -->
      <div class="alert alert-info">
        <i class="bi bi-info-circle me-2"></i>
        <strong>Admin Dashboard Active</strong> - Full training builder and management features will be available in the next update. Currently showing overview and statistics.
      </div>
      
      <!-- Show member view below for browsing -->
      <hr class="my-4">
      <h4 class="mb-3"><i class="bi bi-eye me-2"></i>Preview: Member Learning Experience</h4>
    </div>
  `;
  
  // Append member dashboard for preview
  const memberPreview = document.createElement('div');
  memberPreview.style.opacity = '0.8';
  container.appendChild(memberPreview);
  
  // Temporarily render member dashboard into preview
  const originalContainer = document.getElementById("trainingContentArea");
  const tempDiv = document.createElement('div');
  document.body.appendChild(tempDiv);
  tempDiv.id = "temp-training-container";
  
  // Temporarily change container reference
  const oldGetElement = document.getElementById;
  document.getElementById = function(id) {
    if (id === "trainingContentArea") return tempDiv;
    return oldGetElement.call(document, id);
  };
  
  renderMemberTrainingDashboard();
  
  // Restore
  document.getElementById = oldGetElement;
  originalContainer.appendChild(tempDiv);
  tempDiv.id = "";
  tempDiv.style.marginTop = "20px";
}


function renderMyLearningTab() {
  const mandatory = ALL_TRAININGS.filter(t => t.isMandatory && !USER_PROGRESS[t.id]?.status);
  const continuelearning = Object.entries(USER_PROGRESS)
    .filter(([_, p]) => p.status === "in_progress")
    .map(([tid, p]) => ({ ...ALL_TRAININGS.find(t => t.id === tid), progress: p }))
    .filter(t => t.id);
  const recommended = ALL_TRAININGS.filter(t => !t.isMandatory && !USER_PROGRESS[t.id]).slice(0, 6);
  
  let html = '';
  
  // Mandatory Training Alert
  if (mandatory.length > 0) {
    html += `
      <div class="alert alert-warning mb-4">
        <div class="d-flex align-items-center">
          <i class="bi bi-exclamation-triangle-fill fs-3 me-3"></i>
          <div class="flex-grow-1">
            <h6 class="mb-1 fw-bold">Complete Mandatory Training</h6>
            <p class="mb-0 small">You have ${mandatory.length} mandatory course(s) pending. Complete them to unlock full CRM access.</p>
          </div>
        </div>
      </div>
      <h5 class="mb-3"><i class="bi bi-exclamation-circle me-2"></i>Mandatory Courses</h5>
      <div class="row g-3 mb-4">
        ${mandatory.map(t => renderTrainingCard(t, true)).join('')}
      </div>
    `;
  }
  
  // Continue Learning
  if (continuelearning.length > 0) {
    html += `
      <h5 class="mb-3"><i class="bi bi-play-circle me-2"></i>Continue Learning</h5>
      <div class="row g-3 mb-4">
        ${continuelearning.map(t => renderTrainingCard(t)).join('')}
      </div>
    `;
  }
  
  // Recommended
  if (recommended.length > 0) {
    html += `
      <h5 class="mb-3"><i class="bi bi-stars me-2"></i>Recommended for You</h5>
      <div class="row g-3">
        ${recommended.map(t => renderTrainingCard(t)).join('')}
      </div>
    `;
  }
  
  if (mandatory.length === 0 && continuelearning.length === 0 && recommended.length === 0) {
    html = '<div class="text-center py-5 text-muted"><i class="bi bi-check-circle display-1 d-block mb-3"></i><h5>All caught up!</h5><p>You\'ve completed all available training.</p></div>';
  }
  
  return html;
}

// ============================================================
// TRAINING CARD RENDERING
// ============================================================

function renderTrainingCard(training, isMandatory = false) {
  const progress = USER_PROGRESS[training.id];
  const progressPercent = progress ? calculateTrainingProgress(training, progress) : 0;
  const category = ALL_TRAINING_CATEGORIES.find(c => c.id === training.categoryId);
  
  let statusBadge = '';
  let actionButton = '';
  
  if (progress) {
    if (progress.status === "completed") {
      statusBadge = '<span class="badge bg-success">Completed</span>';
      actionButton = '<button class="btn btn-sm btn-outline-primary w-100" onclick="openTrainingPlayer(\'' + training.id + '\')">Review</button>';
    } else {
      statusBadge = '<span class="badge bg-warning">In Progress</span>';
      actionButton = '<button class="btn btn-sm btn-primary w-100" onclick="openTrainingPlayer(\'' + training.id + '\')">Continue</button>';
    }
  } else {
    if (isMandatory) {
      statusBadge = '<span class="badge bg-danger">Mandatory</span>';
    }
    actionButton = '<button class="btn btn-sm btn-primary w-100" onclick="openTrainingPlayer(\'' + training.id + '\')">Start Learning</button>';
  }
  
  return `
    <div class="col-md-6 col-lg-4">
      <div class="training-card">
        <div class="training-card-header">
          ${category ? '<span class="training-category-badge"><i class="bi ' + (category.icon || 'bi-folder') + ' me-1"></i>' + escapeHtml(category.name) + '</span>' : ''}
          ${statusBadge}
        </div>
        <div class="training-card-body">
          <h5 class="training-card-title">${escapeHtml(training.title)}</h5>
          <p class="training-card-desc">${escapeHtml(training.description || 'No description available')}</p>
          <div class="training-card-meta">
            <span><i class="bi bi-clock me-1"></i>${training.estimatedDuration || 30} min</span>
            <span><i class="bi bi-file-text me-1"></i>${(training.sections || []).length} lessons</span>
            ${training.difficulty ? '<span><i class="bi bi-bar-chart me-1"></i>' + training.difficulty + '</span>' : ''}
          </div>
        </div>
        <div class="training-card-footer">
          <div class="progress mb-2" style="height: 6px;">
            <div class="progress-bar bg-success" style="width: ${progressPercent}%"></div>
          </div>
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="small text-muted">${progressPercent}% complete</span>
          </div>
          ${actionButton}
        </div>
      </div>
    </div>
  `;
}

function calculateTrainingProgress(training, progress) {
  if (!training.sections || training.sections.length === 0) return 0;
  const completedSections = (progress.sectionsCompleted || []).length;
  return Math.round((completedSections / training.sections.length) * 100);
}

// ============================================================
// BROWSE COURSES
// ============================================================

window.renderBrowseCourses = function() {
  const container = document.getElementById("tab-browse");
  if (!container) return;
  
  container.innerHTML = `
    <div class="mb-4">
      <div class="row g-2">
        <div class="col-md-6">
          <input type="text" class="form-control" id="trainingSearchInput" placeholder="Search courses..." onkeyup="filterTrainings()">
        </div>
        <div class="col-md-3">
          <select class="form-select" id="trainingCategoryFilter" onchange="filterTrainings()">
            <option value="">All Categories</option>
            ${ALL_TRAINING_CATEGORIES.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="col-md-3">
          <select class="form-select" id="trainingStatusFilter" onchange="filterTrainings()">
            <option value="">All Status</option>
            <option value="not_started">Not Started</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>
        </div>
      </div>
    </div>
    <div id="browseCoursesGrid"></div>
  `;
  
  filterTrainings();
}

window.filterTrainings = function() {
  const searchTerm = document.getElementById("trainingSearchInput")?.value.toLowerCase() || '';
  const categoryFilter = document.getElementById("trainingCategoryFilter")?.value || '';
  const statusFilter = document.getElementById("trainingStatusFilter")?.value || '';
  
  let filtered = ALL_TRAININGS.filter(t => {
    const matchesSearch = t.title.toLowerCase().includes(searchTerm) || 
                         (t.description || '').toLowerCase().includes(searchTerm);
    const matchesCategory = !categoryFilter || t.categoryId === categoryFilter;
    
    let matchesStatus = true;
    if (statusFilter) {
      const progress = USER_PROGRESS[t.id];
      if (statusFilter === "not_started") matchesStatus = !progress;
      else if (statusFilter === "in_progress") matchesStatus = progress?.status === "in_progress";
      else if (statusFilter === "completed") matchesStatus = progress?.status === "completed";
    }
    
    return matchesSearch && matchesCategory && matchesStatus;
  });
  
  const grid = document.getElementById("browseCoursesGrid");
  if (!grid) return;
  
  if (filtered.length === 0) {
    grid.innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-search display-1"></i><h5 class="mt-3">No courses found</h5><p>Try adjusting your filters</p></div>';
    return;
  }
  
  grid.innerHTML = `<div class="row g-3">${filtered.map(t => renderTrainingCard(t)).join('')}</div>`;
}

// ============================================================
// CERTIFICATES TAB
// ============================================================

window.renderCertificatesTab = function() {
  const container = document.getElementById("tab-certificates");
  if (!container) return;
  
  if (USER_CERTIFICATES.length === 0) {
    container.innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-award display-1"></i><h5 class="mt-3">No Certificates Yet</h5><p>Complete courses and pass quizzes to earn certificates</p></div>';
    return;
  }
  
  container.innerHTML = `
    <div class="row g-3">
      ${USER_CERTIFICATES.map(cert => `
        <div class="col-md-6 col-lg-4">
          <div class="certificate-card">
            <div class="certificate-card-header">
              <i class="bi bi-award-fill"></i>
            </div>
            <div class="certificate-card-body">
              <h5 class="certificate-title">${escapeHtml(cert.trainingTitle)}</h5>
              <div class="certificate-meta">
                <div class="certificate-meta-item">
                  <span class="certificate-label">Score:</span>
                  <span class="certificate-value">${cert.score}%</span>
                </div>
                <div class="certificate-meta-item">
                  <span class="certificate-label">Issued:</span>
                  <span class="certificate-value">${formatDate(cert.issuedAt.toDate())}</span>
                </div>
                <div class="certificate-meta-item">
                  <span class="certificate-label">Certificate #:</span>
                  <span class="certificate-value">${cert.certificateNumber || cert.id.substring(0, 8).toUpperCase()}</span>
                </div>
              </div>
              <button class="btn btn-primary btn-sm w-100 mt-3" onclick="downloadCertificate('${cert.id}')">
                <i class="bi bi-download me-1"></i>Download PDF
              </button>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ============================================================
// KNOWLEDGE BASE TAB
// ============================================================

window.renderKnowledgeBaseTab = function() {
  const container = document.getElementById("tab-knowledge");
  if (!container) return;
  
  container.innerHTML = `
    <div class="mb-4">
      <input type="text" class="form-control" id="knowledgeSearchInput" placeholder="Search knowledge base..." onkeyup="filterKnowledgeBase()">
    </div>
    <div id="knowledgeBaseList"></div>
  `;
  
  filterKnowledgeBase();
}

window.filterKnowledgeBase = function() {
  const searchTerm = document.getElementById("knowledgeSearchInput")?.value.toLowerCase() || '';
  const list = document.getElementById("knowledgeBaseList");
  if (!list) return;
  
  const filtered = KNOWLEDGE_BASE.filter(kb => 
    kb.title.toLowerCase().includes(searchTerm) || 
    (kb.content || '').toLowerCase().includes(searchTerm) ||
    (kb.tags || []).some(tag => tag.toLowerCase().includes(searchTerm))
  );
  
  if (filtered.length === 0) {
    list.innerHTML = '<div class="text-center py-5 text-muted"><i class="bi bi-search display-1"></i><h5 class="mt-3">No results found</h5></div>';
    return;
  }
  
  list.innerHTML = filtered.map(kb => `
    <div class="knowledge-card mb-3">
      <div class="knowledge-card-header" onclick="toggleKnowledgeCard('${kb.id}')">
        <h6 class="mb-0"><i class="bi bi-question-circle me-2"></i>${escapeHtml(kb.title)}</h6>
        <i class="bi bi-chevron-down"></i>
      </div>
      <div class="knowledge-card-body collapse" id="kb-${kb.id}">
        <div class="knowledge-content">${kb.content || 'No content available'}</div>
        ${kb.tags && kb.tags.length > 0 ? `
          <div class="knowledge-tags mt-2">
            ${kb.tags.map(tag => `<span class="badge bg-secondary">${escapeHtml(tag)}</span>`).join(' ')}
          </div>
        ` : ''}
      </div>
    </div>
  `).join('');
}

window.toggleKnowledgeCard = function(id) {
  const card = document.getElementById('kb-' + id);
  if (card) {
    const bsCollapse = new bootstrap.Collapse(card, { toggle: true });
  }
}

// ============================================================
// TRAINING PLAYER
// ============================================================

window.openTrainingPlayer = async function(trainingId) {
  try {
    // Load training
    const training = ALL_TRAININGS.find(t => t.id === trainingId);
    if (!training) {
      toast("Training not found", "danger");
      return;
    }
    
    CURRENT_TRAINING = training;
    
    // Load or create progress
    let progress = USER_PROGRESS[trainingId];
    if (!progress) {
      const progressId = CURRENT_USER.uid + '_' + trainingId;
      await trainingProgressRef.doc(progressId).set({
        userId: CURRENT_USER.uid,
        trainingId: trainingId,
        status: "in_progress",
        startedAt: firebase.firestore.Timestamp.now(),
        lastViewedAt: firebase.firestore.Timestamp.now(),
        sectionsCompleted: [],
        timeSpent: 0,
        quizAttempts: [],
        bestScore: 0,
        certificateIssued: false
      });
      await loadUserProgress();
      progress = USER_PROGRESS[trainingId];
    } else {
      // Update last viewed
      await trainingProgressRef.doc(progress.id).update({
        lastViewedAt: firebase.firestore.Timestamp.now()
      });
    }
    
    // Find last incomplete section
    CURRENT_SECTION_INDEX = 0;
    if (progress.sectionsCompleted && progress.sectionsCompleted.length > 0) {
      const lastCompleted = progress.sectionsCompleted[progress.sectionsCompleted.length - 1];
      const lastIndex = training.sections.findIndex(s => s.id === lastCompleted);
      if (lastIndex >= 0 && lastIndex < training.sections.length - 1) {
        CURRENT_SECTION_INDEX = lastIndex + 1;
      }
    }
    
    // Show modal
    renderTrainingPlayer();
    const modal = new bootstrap.Modal(document.getElementById("trainingPlayerModal"));
    modal.show();
    
  } catch (error) {
    console.error("Error opening training player:", error);
    toast("Failed to open training", "danger");
  }
}

function renderTrainingPlayer() {
  const modal = document.getElementById("trainingPlayerModal");
  if (!modal) return;
  
  const training = CURRENT_TRAINING;
  const section = training.sections[CURRENT_SECTION_INDEX];
  const progress = USER_PROGRESS[training.id];
  const isCompleted = progress?.sectionsCompleted?.includes(section.id) || false;
  
  modal.querySelector(".modal-title").innerHTML = `
    <i class="bi bi-mortarboard me-2"></i>${escapeHtml(training.title)}
  `;
  
  modal.querySelector(".modal-body").innerHTML = `
    <div class="training-player">
      <div class="training-player-sidebar">
        <h6 class="training-sidebar-title">Course Content</h6>
        <div class="training-sections-list">
          ${training.sections.map((s, idx) => {
            const sectionCompleted = progress?.sectionsCompleted?.includes(s.id) || false;
            const isActive = idx === CURRENT_SECTION_INDEX;
            return `
              <div class="training-section-item ${isActive ? 'active' : ''} ${sectionCompleted ? 'completed' : ''}" 
                   onclick="navigateToSection(${idx})">
                <div class="training-section-number">${idx + 1}</div>
                <div class="training-section-info">
                  <div class="training-section-name">${escapeHtml(s.title)}</div>
                  <div class="training-section-type">
                    <i class="bi ${getSectionIcon(s.type)}"></i>${s.type}
                  </div>
                </div>
                ${sectionCompleted ? '<i class="bi bi-check-circle-fill text-success"></i>' : ''}
              </div>
            `;
          }).join('')}
        </div>
      </div>
      <div class="training-player-content">
        <div class="training-content-header">
          <h4 class="training-content-title">${escapeHtml(section.title)}</h4>
          <span class="training-section-badge">
            <i class="bi ${getSectionIcon(section.type)}"></i>${section.type}
          </span>
        </div>
        <div class="training-content-body">
          ${renderSectionContent(section)}
        </div>
        <div class="training-content-footer">
          <div class="d-flex justify-content-between align-items-center">
            <button class="btn btn-outline-secondary" onclick="navigateToSection(${CURRENT_SECTION_INDEX - 1})" 
                    ${CURRENT_SECTION_INDEX === 0 ? 'disabled' : ''}>
              <i class="bi bi-chevron-left me-1"></i>Previous
            </button>
            
            ${!isCompleted ? `
              <button class="btn btn-success" onclick="markSectionComplete()">
                <i class="bi bi-check-lg me-1"></i>Mark as Complete
              </button>
            ` : '<span class="text-success"><i class="bi bi-check-circle-fill me-1"></i>Completed</span>'}
            
            <button class="btn btn-primary" onclick="navigateToSection(${CURRENT_SECTION_INDEX + 1})" 
                    ${CURRENT_SECTION_INDEX >= training.sections.length - 1 ? 'disabled' : ''}>
              Next<i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getSectionIcon(type) {
  const icons = {
    'text': 'bi-file-text',
    'video': 'bi-play-circle',
    'pdf': 'bi-file-pdf',
    'audio': 'bi-music-note',
    'quiz': 'bi-patch-question',
    'conversation': 'bi-chat-dots',
    'objections': 'bi-shield-check',
    'image': 'bi-image'
  };
  return icons[type] || 'bi-file-text';
}

function renderSectionContent(section) {
  switch (section.type) {
    case 'text':
      return `<div class="training-text-content">${section.content || 'No content available'}</div>`;
    
    case 'video':
      return renderVideoContent(section);
    
    case 'pdf':
      return `
        <div class="training-pdf-content">
          <iframe src="${section.pdfUrl}" width="100%" height="600px" frameborder="0"></iframe>
          <a href="${section.pdfUrl}" download class="btn btn-primary btn-sm mt-3">
            <i class="bi bi-download me-1"></i>Download PDF
          </a>
        </div>
      `;
    
    case 'conversation':
      return renderConversationContent(section);
    
    case 'objections':
      return renderObjectionsContent(section);
    
    case 'quiz':
      return `
        <div class="text-center py-5">
          <i class="bi bi-patch-question display-1 text-primary"></i>
          <h5 class="mt-3">Ready for Assessment?</h5>
          <p class="text-muted">Test your knowledge with a quiz</p>
          <button class="btn btn-primary" onclick="startQuiz('${section.quizId}')">
            <i class="bi bi-play-fill me-1"></i>Start Quiz
          </button>
        </div>
      `;
    
    case 'image':
      return `<div class="training-image-content"><img src="${section.imageUrl}" class="img-fluid" alt="${escapeHtml(section.title)}"></div>`;
    
    default:
      return `<div class="alert alert-info">Content type: ${section.type}</div>`;
  }
}

function renderVideoContent(section) {
  if (!section.videoUrl) return '<div class="alert alert-warning">No video URL provided</div>';
  
  // YouTube
  if (section.videoUrl.includes('youtube.com') || section.videoUrl.includes('youtu.be')) {
    let videoId = '';
    if (section.videoUrl.includes('youtu.be/')) {
      videoId = section.videoUrl.split('youtu.be/')[1].split('?')[0];
    } else {
      const urlParams = new URLSearchParams(new URL(section.videoUrl).search);
      videoId = urlParams.get('v');
    }
    return `<div class="training-video-content"><iframe width="100%" height="500" src="https://www.youtube.com/embed/${videoId}" frameborder="0" allowfullscreen></iframe></div>`;
  }
  
  // Vimeo
  if (section.videoUrl.includes('vimeo.com')) {
    const videoId = section.videoUrl.split('vimeo.com/')[1];
    return `<div class="training-video-content"><iframe src="https://player.vimeo.com/video/${videoId}" width="100%" height="500" frameborder="0" allowfullscreen></iframe></div>`;
  }
  
  // Direct MP4
  return `<div class="training-video-content"><video controls width="100%"><source src="${section.videoUrl}" type="video/mp4"></video></div>`;
}

function renderConversationContent(section) {
  if (!section.conversationSteps || section.conversationSteps.length === 0) {
    return '<div class="alert alert-warning">No conversation steps defined</div>';
  }
  
  return `
    <div class="conversation-flow">
      ${section.conversationSteps.map((step, idx) => `
        <div class="conversation-step">
          <div class="conversation-step-number">${step.step || idx + 1}</div>
          <div class="conversation-step-content">
            <h6 class="conversation-step-stage">${escapeHtml(step.stage)}</h6>
            <div class="conversation-step-script">${escapeHtml(step.script)}</div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

function renderObjectionsContent(section) {
  if (!section.objections || section.objections.length === 0) {
    return '<div class="alert alert-warning">No objections defined</div>';
  }
  
  return `
    <div class="objections-list">
      ${section.objections.map(obj => `
        <div class="objection-card">
          <div class="objection-question">
            <i class="bi bi-person-fill text-danger me-2"></i>
            <strong>Customer:</strong> "${escapeHtml(obj.objection)}"
          </div>
          <div class="objection-response">
            <i class="bi bi-chat-left-text text-success me-2"></i>
            <strong>You:</strong> ${escapeHtml(obj.response)}
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

window.navigateToSection = function(index) {
  const training = CURRENT_TRAINING;
  if (index < 0 || index >= training.sections.length) return;
  
  CURRENT_SECTION_INDEX = index;
  renderTrainingPlayer();
}

window.markSectionComplete = async function() {
  try {
    const training = CURRENT_TRAINING;
    const section = training.sections[CURRENT_SECTION_INDEX];
    const progress = USER_PROGRESS[training.id];
    
    if (!progress) {
      toast("Progress not found", "danger");
      return;
    }
    
    const sectionsCompleted = progress.sectionsCompleted || [];
    if (!sectionsCompleted.includes(section.id)) {
      sectionsCompleted.push(section.id);
      
      const allCompleted = sectionsCompleted.length === training.sections.length;
      
      await trainingProgressRef.doc(progress.id).update({
        sectionsCompleted: sectionsCompleted,
        status: allCompleted ? "completed" : "in_progress",
        completedAt: allCompleted ? firebase.firestore.Timestamp.now() : null,
        lastViewedAt: firebase.firestore.Timestamp.now()
      });
      
      await loadUserProgress();
      toast("Section marked as complete!", "success");
      
      if (allCompleted) {
        toast("🎉 Course completed! You can now take the quiz.", "success");
      }
      
      renderTrainingPlayer();
      updateProgressBadge();
    }
  } catch (error) {
    console.error("Error marking section complete:", error);
    toast("Failed to mark section complete", "danger");
  }
}

function updateProgressBadge() {
  const badge = document.getElementById("trainingProgressBadge");
  if (!badge) return;
  
  const stats = calculateMemberStats();
  if (stats.overallProgress > 0) {
    badge.textContent = stats.overallProgress + '%';
    badge.classList.remove('d-none');
  } else {
    badge.classList.add('d-none');
  }
}


// ============================================================
// CERTIFICATE DOWNLOAD
// ============================================================

window.downloadCertificate = async function(certId) {
  try {
    const cert = USER_CERTIFICATES.find(c => c.id === certId);
    if (!cert) {
      toast("Certificate not found", "danger");
      return;
    }
    
    // Generate PDF using jsPDF (already loaded in dashboard.html)
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({
      orientation: 'landscape',
      unit: 'mm',
      format: 'a4'
    });
    
    // Certificate design
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    
    // Border
    doc.setDrawColor(15, 44, 70); // Navy
    doc.setLineWidth(2);
    doc.rect(10, 10, pageWidth - 20, pageHeight - 20);
    
    // Title
    doc.setFontSize(28);
    doc.setTextColor(15, 44, 70);
    doc.setFont(undefined, 'bold');
    doc.text('ABRA LOGISTICS', pageWidth / 2, 30, { align: 'center' });
    
    doc.setFontSize(16);
    doc.setFont(undefined, 'normal');
    doc.text('Sales CRM', pageWidth / 2, 40, { align: 'center' });
    
    // Certificate of Completion
    doc.setFontSize(24);
    doc.setFont(undefined, 'bold');
    doc.text('CERTIFICATE OF COMPLETION', pageWidth / 2, 60, { align: 'center' });
    
    // Decorative line
    doc.setDrawColor(232, 163, 61); // Amber
    doc.setLineWidth(0.5);
    doc.line(60, 65, pageWidth - 60, 65);
    
    // Body text
    doc.setFontSize(14);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text('This certifies that', pageWidth / 2, 80, { align: 'center' });
    
    doc.setFontSize(20);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(15, 44, 70);
    doc.text(cert.userName || CURRENT_USER.name || CURRENT_USER.email, pageWidth / 2, 95, { align: 'center' });
    
    doc.setFontSize(14);
    doc.setFont(undefined, 'normal');
    doc.setTextColor(0, 0, 0);
    doc.text('has successfully completed', pageWidth / 2, 110, { align: 'center' });
    
    doc.setFontSize(18);
    doc.setFont(undefined, 'bold');
    doc.text(cert.trainingTitle || 'Training Course', pageWidth / 2, 125, { align: 'center' });
    
    // Score and date
    doc.setFontSize(12);
    doc.setFont(undefined, 'normal');
    doc.text(`Score: ${cert.score}%`, pageWidth / 2, 145, { align: 'center' });
    doc.text(`Date: ${formatDate(cert.issuedAt.toDate())}`, pageWidth / 2, 155, { align: 'center' });
    doc.text(`Certificate #: ${cert.certificateNumber || cert.id.substring(0, 8).toUpperCase()}`, pageWidth / 2, 165, { align: 'center' });
    
    // Signature line
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.line(pageWidth / 2 - 30, pageHeight - 30, pageWidth / 2 + 30, pageHeight - 30);
    doc.setFontSize(10);
    doc.text('Authorized Signature', pageWidth / 2, pageHeight - 25, { align: 'center' });
    
    // Save
    const fileName = `${cert.trainingTitle.replace(/[^a-z0-9]/gi, '_')}_Certificate.pdf`;
    doc.save(fileName);
    
    toast("Certificate downloaded successfully", "success");
    
  } catch (error) {
    console.error("Error downloading certificate:", error);
    toast("Failed to download certificate", "danger");
  }
}

// ============================================================
// QUIZ SYSTEM (PLACEHOLDER)
// ============================================================

window.startQuiz = async function(quizId) {
  toast("Quiz system coming soon! Complete the course sections first.", "info");
  console.log("Quiz ID:", quizId);
  // TODO: Implement full quiz system
  // For now, just show a message
}
