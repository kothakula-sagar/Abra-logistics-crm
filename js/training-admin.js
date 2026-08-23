// ============================================================
// TRAINING-ADMIN.JS — Sales Academy Admin Features
// ============================================================
// Admin dashboard, training builder, course management
// ============================================================

// Utility functions (ensure they exist)
function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return String(text).replace(/[&<>"']/g, function(m) { return map[m]; });
}

function formatDate(date) {
  if (!date) return '—';
  if (typeof date.toDate === 'function') {
    date = date.toDate();
  }
  return date.toLocaleDateString();
}

function formatDateTime(date) {
  if (!date) return '—';
  if (typeof date.toDate === 'function') {
    date = date.toDate();
  }
  return date.toLocaleString();
}

function toast(message, type = 'info') {
  if (typeof window.toast === 'function') {
    window.toast(message, type);
  } else {
    console.log(`[${type.toUpperCase()}] ${message}`);
  }
}

// Safe access to global variables
function getActiveMembers() {
  return window.ACTIVE_MEMBERS || [];
}

function getActiveHR() {
  return window.ACTIVE_HR || [];
}

function getAllCampaigns() {
  return window.ALL_CAMPAIGNS || [];
}

function getCurrentUser() {
  return window.CURRENT_USER || { role: 'member' };
}

function getAllTrainings() {
  return window.ALL_TRAININGS || [];
}

function getAllTrainingCategories() {
  return window.ALL_TRAINING_CATEGORIES || [];
}

function getAllUsersProgress() {
  return window.ALL_USERS_PROGRESS || [];
}

function getKnowledgeBase() {
  return window.KNOWLEDGE_BASE || [];
}

// ============================================================
// ADMIN DASHBOARD
// ============================================================

function renderAdminTrainingDashboard() {
  const container = document.getElementById("trainingContentArea");
  if (!container) return;
  
  const stats = calculateAdminStats();
  const CURRENT_USER = getCurrentUser();
  const ALL_TRAINING_CATEGORIES = getAllTrainingCategories();
  const ALL_CAMPAIGNS = getAllCampaigns();
  
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
          <button class="btn btn-primary" onclick="openTrainingBuilder()">
            <i class="bi bi-plus-lg me-1"></i>New Course
          </button>
          <button class="btn btn-outline-primary" onclick="openCategoryManager()">
            <i class="bi bi-folder-plus me-1"></i>Categories
          </button>
          <button class="btn btn-outline-primary" onclick="openKnowledgeBaseManager()">
            <i class="bi bi-book me-1"></i>Knowledge Base
          </button>
          <button class="btn btn-outline-secondary" onclick="showAdminReports()">
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
              <h3 class="mb-0">${stats.totalCourses}</h3>
              <small class="text-muted">Total Courses</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-check-circle-fill text-success fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.published}</h3>
              <small class="text-muted">Published</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-pencil-square text-warning fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.draft}</h3>
              <small class="text-muted">Draft</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-briefcase-fill text-info fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.campaignTrainings}</h3>
              <small class="text-muted">Campaign Trainings</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-people-fill text-secondary fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.employeesTrained}</h3>
              <small class="text-muted">Employees Trained</small>
            </div>
          </div>
        </div>
        <div class="col-md-2">
          <div class="card h-100">
            <div class="card-body text-center">
              <i class="bi bi-award-fill text-danger fs-2 mb-2"></i>
              <h3 class="mb-0">${stats.certificatesIssued}</h3>
              <small class="text-muted">Certificates</small>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Course Management Table -->
      <div class="card">
        <div class="card-header bg-white">
          <div class="d-flex justify-content-between align-items-center">
            <h5 class="mb-0"><i class="bi bi-list-ul me-2"></i>Course Management</h5>
            <div class="input-group" style="width: 300px;">
              <span class="input-group-text"><i class="bi bi-search"></i></span>
              <input type="text" class="form-control" id="adminCourseSearch" placeholder="Search courses..." onkeyup="filterAdminCourses()">
            </div>
          </div>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead class="table-light">
                <tr>
                  <th>Course Title</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Sections</th>
                  <th>Enrolled</th>
                  <th>Completed</th>
                  <th>Created</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody id="adminCoursesTableBody">
                ${renderAdminCoursesTable()}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  `;
}

function calculateAdminStats() {
  const ALL_TRAININGS = getAllTrainings();
  const ALL_USERS_PROGRESS = getAllUsersProgress();
  const ACTIVE_MEMBERS = getActiveMembers();
  const activeHR = getActiveHR(); // Use local variable, not const ACTIVE_HR
  
  const totalCourses = ALL_TRAININGS.length;
  const published = ALL_TRAININGS.filter(t => t.status === "published").length;
  const draft = ALL_TRAININGS.filter(t => t.status === "draft").length;
  const campaignTrainings = ALL_TRAININGS.filter(t => t.campaignId).length;
  
  // Count unique users who have made progress
  const uniqueUsers = new Set(ALL_USERS_PROGRESS.map(p => p.userId));
  const employeesTrained = uniqueUsers.size;
  
  // Count total certificates
  let certificatesIssued = 0;
  try {
    // This would need to be loaded separately if not already available
    certificatesIssued = ALL_USERS_PROGRESS.filter(p => p.certificateIssued).length;
  } catch(e) {
    certificatesIssued = 0;
  }
  
  return {
    totalCourses,
    published,
    draft,
    campaignTrainings,
    employeesTrained,
    certificatesIssued
  };
}

function renderAdminCoursesTable() {
  const ALL_TRAININGS = getAllTrainings();
  const ALL_TRAINING_CATEGORIES = getAllTrainingCategories();
  const ALL_USERS_PROGRESS = getAllUsersProgress();
  const CURRENT_USER = getCurrentUser();
  
  if (ALL_TRAININGS.length === 0) {
    return `<tr><td colspan="8" class="text-center py-4 text-muted">
      <i class="bi bi-inbox display-4 d-block mb-2"></i>
      No courses yet. Click "New Course" to create your first training.
    </td></tr>`;
  }
  
  return ALL_TRAININGS.map(training => {
    const category = ALL_TRAINING_CATEGORIES.find(c => c.id === training.categoryId);
    const enrolled = ALL_USERS_PROGRESS.filter(p => p.trainingId === training.id).length;
    const completed = ALL_USERS_PROGRESS.filter(p => p.trainingId === training.id && p.status === "completed").length;
    
    let statusBadge = '';
    if (training.status === "published") {
      statusBadge = '<span class="badge bg-success">Published</span>';
    } else if (training.status === "draft") {
      statusBadge = '<span class="badge bg-secondary">Draft</span>';
    } else if (training.status === "archived") {
      statusBadge = '<span class="badge bg-dark">Archived</span>';
    }
    
    const isSuperAdmin = CURRENT_USER.role === "superadmin";
    
    return `
      <tr>
        <td>
          <div class="d-flex align-items-center">
            ${training.isMandatory ? '<i class="bi bi-exclamation-circle-fill text-danger me-2" title="Mandatory"></i>' : ''}
            <div>
              <div class="fw-bold">${escapeHtml(training.title)}</div>
              ${training.campaignId ? '<small class="text-muted"><i class="bi bi-briefcase me-1"></i>Campaign Training</small>' : ''}
            </div>
          </div>
        </td>
        <td>${category ? escapeHtml(category.name) : '—'}</td>
        <td>${statusBadge}</td>
        <td>${(training.sections || []).length} lessons</td>
        <td>${enrolled}</td>
        <td>${completed}</td>
        <td>${training.createdAt ? formatDate(training.createdAt.toDate()) : '—'}</td>
        <td>
          <div class="btn-group btn-group-sm">
            <button class="btn btn-outline-primary" onclick="editTraining('${training.id}')" title="Edit">
              <i class="bi bi-pencil"></i>
            </button>
            ${training.status === "draft" ? `
              <button class="btn btn-outline-success" onclick="publishTraining('${training.id}')" title="Publish">
                <i class="bi bi-check-lg"></i>
              </button>
            ` : ''}
            ${training.status === "published" ? `
              <button class="btn btn-outline-warning" onclick="archiveTraining('${training.id}')" title="Archive">
                <i class="bi bi-archive"></i>
              </button>
            ` : ''}
            <button class="btn btn-outline-secondary" onclick="duplicateTraining('${training.id}')" title="Duplicate">
              <i class="bi bi-files"></i>
            </button>
            ${isSuperAdmin ? `
              <button class="btn btn-outline-danger" onclick="deleteTraining('${training.id}')" title="Delete">
                <i class="bi bi-trash"></i>
              </button>
            ` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

window.filterAdminCourses = function() {
  const searchTerm = document.getElementById("adminCourseSearch")?.value.toLowerCase() || '';
  const tbody = document.getElementById("adminCoursesTableBody");
  if (!tbody) return;
  
  if (!searchTerm) {
    tbody.innerHTML = renderAdminCoursesTable();
    return;
  }
  
  const ALL_TRAININGS = getAllTrainings();
  const filtered = ALL_TRAININGS.filter(t => 
    t.title.toLowerCase().includes(searchTerm) ||
    (t.description || '').toLowerCase().includes(searchTerm)
  );
  
  // Create filtered table rows with temporary override
  const originalGetAllTrainings = window.getAllTrainings;
  window.getAllTrainings = () => filtered;
  tbody.innerHTML = renderAdminCoursesTable();
  window.getAllTrainings = originalGetAllTrainings;
};

// ============================================================
// TRAINING BUILDER
// ============================================================

window.openTrainingBuilder = function(trainingId = null) {
  CURRENT_EDITING_TRAINING = trainingId ? ALL_TRAININGS.find(t => t.id === trainingId) : null;
  
  const modal = document.getElementById("trainingBuilderModal");
  if (!modal) {
    console.error("Training builder modal not found in HTML");
    toast("Training builder not available", "danger");
    return;
  }
  
  renderTrainingBuilderModal(CURRENT_EDITING_TRAINING);
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
};

window.editTraining = function(trainingId) {
  openTrainingBuilder(trainingId);
};

function renderTrainingBuilderModal(training) {
  const isEditing = !!training;
  const modal = document.getElementById("trainingBuilderModal");
  if (!modal) return;
  
  const modalContent = modal.querySelector(".modal-content");
  if (!modalContent) return;
  
  const sections = training?.sections || [];
  const ALL_TRAINING_CATEGORIES = getAllTrainingCategories();
  const ALL_CAMPAIGNS = getAllCampaigns();
  
  modalContent.innerHTML = `
    <div class="modal-header">
      <h5 class="modal-title">
        <i class="bi bi-mortarboard-fill me-2"></i>${isEditing ? 'Edit' : 'Create'} Training Course
      </h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      <form id="trainingBuilderForm">
        <!-- Basic Information -->
        <div class="card mb-3">
          <div class="card-header bg-primary text-white">
            <h6 class="mb-0"><i class="bi bi-info-circle me-2"></i>Basic Information</h6>
          </div>
          <div class="card-body">
            <div class="mb-3">
              <label class="form-label">Course Title *</label>
              <input type="text" class="form-control" id="trainingTitle" value="${escapeHtml(training?.title || '')}" required>
            </div>
            <div class="mb-3">
              <label class="form-label">Description</label>
              <textarea class="form-control" id="trainingDescription" rows="3">${escapeHtml(training?.description || '')}</textarea>
            </div>
            <div class="row">
              <div class="col-md-6 mb-3">
                <label class="form-label">Category *</label>
                <select class="form-select" id="trainingCategory" required>
                  <option value="">Select Category</option>
                  ${ALL_TRAINING_CATEGORIES.map(cat => `
                    <option value="${cat.id}" ${training?.categoryId === cat.id ? 'selected' : ''}>${escapeHtml(cat.name)}</option>
                  `).join('')}
                </select>
              </div>
              <div class="col-md-6 mb-3">
                <label class="form-label">Campaign (Optional)</label>
                <select class="form-select" id="trainingCampaign">
                  <option value="">General Training</option>
                  ${ALL_CAMPAIGNS.map(camp => `
                    <option value="${camp.id}" ${training?.campaignId === camp.id ? 'selected' : ''}>${escapeHtml(camp.name)}</option>
                  `).join('')}
                </select>
              </div>
            </div>
            <div class="row">
              <div class="col-md-6 mb-3">
                <label class="form-label">Duration (minutes)</label>
                <input type="number" class="form-control" id="trainingDuration" value="${training?.estimatedDuration || 30}" min="1">
              </div>
              <div class="col-md-6 mb-3">
                <label class="form-label">Status *</label>
                <select class="form-select" id="trainingStatus" required>
                  <option value="draft" ${training?.status === 'draft' ? 'selected' : ''}>Draft</option>
                  <option value="published" ${training?.status === 'published' ? 'selected' : ''}>Published</option>
                </select>
              </div>
            </div>
            <div class="form-check">
              <input class="form-check-input" type="checkbox" id="trainingMandatory" ${training?.isMandatory ? 'checked' : ''}>
              <label class="form-check-label" for="trainingMandatory">
                <i class="bi bi-exclamation-circle text-danger me-1"></i>Mandatory Training
              </label>
            </div>
          </div>
        </div>
        
        <!-- Sections/Lessons -->
        <div class="card">
          <div class="card-header bg-success text-white d-flex justify-content-between align-items-center">
            <h6 class="mb-0"><i class="bi bi-list-ol me-2"></i>Course Sections</h6>
            <button type="button" class="btn btn-sm btn-light" onclick="addTrainingSection()">
              <i class="bi bi-plus-lg me-1"></i>Add Section
            </button>
          </div>
          <div class="card-body">
            <div id="trainingSectionsList">
              ${renderTrainingSections(sections)}
            </div>
          </div>
        </div>
        
        <input type="hidden" id="editingTrainingId" value="${training?.id || ''}">
      </form>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
      <button type="button" class="btn btn-primary" onclick="saveTrainingCourse()">
        <i class="bi bi-save me-1"></i>${isEditing ? 'Update' : 'Create'} Course
      </button>
    </div>
  `;
}

function renderTrainingSections(sections) {
  if (sections.length === 0) {
    return '<p class="text-muted text-center py-3">No sections yet. Click "Add Section" to create your first lesson.</p>';
  }
  
  return sections.map((section, index) => `
    <div class="card mb-2" data-section-index="${index}">
      <div class="card-header d-flex justify-content-between align-items-center">
        <div class="fw-bold">Section ${index + 1}: ${escapeHtml(section.title || 'Untitled')}</div>
        <div class="btn-group btn-group-sm">
          <button type="button" class="btn btn-outline-primary" onclick="editTrainingSection(${index})">
            <i class="bi bi-pencil"></i>
          </button>
          <button type="button" class="btn btn-outline-danger" onclick="deleteTrainingSection(${index})">
            <i class="bi bi-trash"></i>
          </button>
        </div>
      </div>
      <div class="card-body">
        <div><strong>Type:</strong> ${section.type || 'text'}</div>
        <div><strong>Content:</strong> ${section.content ? (section.content.substring(0, 100) + '...') : 'No content'}</div>
        ${section.quizQuestions && section.quizQuestions.length > 0 ? `<div><strong>Quiz Questions:</strong> ${section.quizQuestions.length}</div>` : ''}
      </div>
    </div>
  `).join('');
}

window.addTrainingSection = function() {
  const modal = new bootstrap.Modal(document.getElementById("sectionEditorModal"));
  document.getElementById("editingSectionIndex").value = "-1"; // New section
  document.getElementById("sectionEditorForm").reset();
  document.getElementById("sectionQuizQuestions").innerHTML = '';
  modal.show();
};

window.editTrainingSection = function(index) {
  const sections = getCurrentBuilderSections();
  const section = sections[index];
  
  document.getElementById("editingSectionIndex").value = index;
  document.getElementById("sectionTitle").value = section.title || '';
  document.getElementById("sectionType").value = section.type || 'text';
  document.getElementById("sectionContent").value = section.content || '';
  document.getElementById("sectionVideoUrl").value = section.videoUrl || '';
  document.getElementById("sectionPdfUrl").value = section.pdfUrl || '';
  document.getElementById("sectionImageUrl").value = section.imageUrl || '';
  
  // Render quiz questions if any
  if (section.quizQuestions && section.quizQuestions.length > 0) {
    renderQuizQuestionsInEditor(section.quizQuestions);
  }
  
  toggleSectionFields();
  const modal = new bootstrap.Modal(document.getElementById("sectionEditorModal"));
  modal.show();
};

window.deleteTrainingSection = function(index) {
  if (!confirm("Delete this section?")) return;
  
  const sections = getCurrentBuilderSections();
  sections.splice(index, 1);
  updateBuilderSections(sections);
  document.getElementById("trainingSectionsList").innerHTML = renderTrainingSections(sections);
};

function getCurrentBuilderSections() {
  const container = document.getElementById("trainingSectionsList");
  const sectionCards = container.querySelectorAll("[data-section-index]");
  let sections = [];
  
  // Try to get from temporary storage or reconstruct from DOM
  if (window.TEMP_BUILDER_SECTIONS) {
    return window.TEMP_BUILDER_SECTIONS;
  }
  
  return [];
}

function updateBuilderSections(sections) {
  window.TEMP_BUILDER_SECTIONS = sections;
}

window.saveSectionToBuilder = function() {
  const index = parseInt(document.getElementById("editingSectionIndex").value);
  const sections = getCurrentBuilderSections();
  
  const section = {
    title: document.getElementById("sectionTitle").value,
    type: document.getElementById("sectionType").value,
    content: document.getElementById("sectionContent").value,
    videoUrl: document.getElementById("sectionVideoUrl").value,
    pdfUrl: document.getElementById("sectionPdfUrl").value,
    imageUrl: document.getElementById("sectionImageUrl").value,
    quizQuestions: getQuizQuestionsFromEditor()
  };
  
  if (index === -1) {
    sections.push(section);
  } else {
    sections[index] = section;
  }
  
  updateBuilderSections(sections);
  document.getElementById("trainingSectionsList").innerHTML = renderTrainingSections(sections);
  
  bootstrap.Modal.getInstance(document.getElementById("sectionEditorModal")).hide();
  toast("Section saved", "success");
};

window.saveTrainingCourse = async function() {
  const title = document.getElementById("trainingTitle").value.trim();
  const description = document.getElementById("trainingDescription").value.trim();
  const categoryId = document.getElementById("trainingCategory").value;
  const campaignId = document.getElementById("trainingCampaign").value || null;
  const duration = parseInt(document.getElementById("trainingDuration").value) || 30;
  const status = document.getElementById("trainingStatus").value;
  const isMandatory = document.getElementById("trainingMandatory").checked;
  const sections = getCurrentBuilderSections();
  const editingId = document.getElementById("editingTrainingId").value;
  const CURRENT_USER = getCurrentUser();
  
  if (!title || !categoryId) {
    toast("Please fill in all required fields", "warning");
    return;
  }
  
  if (sections.length === 0) {
    toast("Please add at least one section", "warning");
    return;
  }
  
  try {
    // Ensure trainingsRef exists
    if (!window.trainingsRef) {
      toast("Firebase not initialized", "danger");
      return;
    }
    
    const trainingData = {
      title,
      description,
      categoryId,
      campaignId,
      estimatedDuration: duration,
      status,
      isMandatory,
      sections,
      updatedAt: firebase.firestore.Timestamp.now(),
      updatedBy: CURRENT_USER.uid || 'system'
    };
    
    if (editingId) {
      // Update existing
      await trainingsRef.doc(editingId).update(trainingData);
      toast("Training course updated successfully", "success");
    } else {
      // Create new
      trainingData.createdAt = firebase.firestore.Timestamp.now();
      trainingData.createdBy = CURRENT_USER.uid || 'system';
      trainingData.active = true;
      await trainingsRef.add(trainingData);
      toast("Training course created successfully", "success");
    }
    
    // Reload and refresh (if functions exist)
    if (typeof window.loadAllTrainings === 'function') {
      await window.loadAllTrainings();
    }
    renderAdminTrainingDashboard();
    
    const modalInstance = bootstrap.Modal.getInstance(document.getElementById("trainingBuilderModal"));
    if (modalInstance) modalInstance.hide();
    window.TEMP_BUILDER_SECTIONS = null;
    
  } catch (error) {
    console.error("Error saving training:", error);
    toast("Failed to save training course", "danger");
  }
};

// ============================================================
// COURSE ACTIONS
// ============================================================

window.publishTraining = async function(trainingId) {
  if (!confirm("Publish this training course? It will become visible to all users.")) return;
  
  try {
    if (!window.trainingsRef) {
      toast("Firebase not initialized", "danger");
      return;
    }
    
    const CURRENT_USER = getCurrentUser();
    await trainingsRef.doc(trainingId).update({
      status: "published",
      publishedAt: firebase.firestore.Timestamp.now(),
      publishedBy: CURRENT_USER.uid || 'system'
    });
    
    if (typeof window.loadAllTrainings === 'function') {
      await window.loadAllTrainings();
    }
    renderAdminTrainingDashboard();
    toast("Training published successfully", "success");
  } catch (error) {
    console.error("Error publishing training:", error);
    toast("Failed to publish training", "danger");
  }
};

window.archiveTraining = async function(trainingId) {
  if (!confirm("Archive this training course? It will no longer be visible to users.")) return;
  
  try {
    if (!window.trainingsRef) {
      toast("Firebase not initialized", "danger");
      return;
    }
    
    const CURRENT_USER = getCurrentUser();
    await trainingsRef.doc(trainingId).update({
      status: "archived",
      archivedAt: firebase.firestore.Timestamp.now(),
      archivedBy: CURRENT_USER.uid || 'system'
    });
    
    if (typeof window.loadAllTrainings === 'function') {
      await window.loadAllTrainings();
    }
    renderAdminTrainingDashboard();
    toast("Training archived", "success");
  } catch (error) {
    console.error("Error archiving training:", error);
    toast("Failed to archive training", "danger");
  }
};

window.duplicateTraining = async function(trainingId) {
  try {
    const ALL_TRAININGS = getAllTrainings();
    const training = ALL_TRAININGS.find(t => t.id === trainingId);
    if (!training) return;
    
    if (!window.trainingsRef) {
      toast("Firebase not initialized", "danger");
      return;
    }
    
    const CURRENT_USER = getCurrentUser();
    const duplicateData = {
      ...training,
      title: `${training.title} (Copy)`,
      status: "draft",
      createdAt: firebase.firestore.Timestamp.now(),
      createdBy: CURRENT_USER.uid || 'system',
      publishedAt: null,
      publishedBy: null
    };
    
    delete duplicateData.id;
    
    await trainingsRef.add(duplicateData);
    if (typeof window.loadAllTrainings === 'function') {
      await window.loadAllTrainings();
    }
    renderAdminTrainingDashboard();
    toast("Training duplicated successfully", "success");
  } catch (error) {
    console.error("Error duplicating training:", error);
    toast("Failed to duplicate training", "danger");
  }
};

window.deleteTraining = async function(trainingId) {
  const CURRENT_USER = getCurrentUser();
  if (CURRENT_USER.role !== "superadmin") {
    toast("Only Super Admin can delete trainings", "danger");
    return;
  }
  
  if (!confirm("Permanently delete this training? This cannot be undone!")) return;
  
  try {
    if (!window.trainingsRef) {
      toast("Firebase not initialized", "danger");
      return;
    }
    
    await trainingsRef.doc(trainingId).delete();
    if (typeof window.loadAllTrainings === 'function') {
      await window.loadAllTrainings();
    }
    renderAdminTrainingDashboard();
    toast("Training deleted", "success");
  } catch (error) {
    console.error("Error deleting training:", error);
    toast("Failed to delete training", "danger");
  }
};

// ============================================================
// CATEGORY MANAGER
// ============================================================

window.openCategoryManager = function() {
  const modal = new bootstrap.Modal(document.getElementById("categoryManagerModal"));
  renderCategoryManager();
  modal.show();
};

function renderCategoryManager() {
  const modal = document.getElementById("categoryManagerModal");
  if (!modal) return;
  
  const modalContent = modal.querySelector(".modal-content");
  modalContent.innerHTML = `
    <div class="modal-header">
      <h5 class="modal-title"><i class="bi bi-folder-fill me-2"></i>Training Categories</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      <button class="btn btn-primary btn-sm mb-3" onclick="addNewCategory()">
        <i class="bi bi-plus-lg me-1"></i>Add Category
      </button>
      <div class="list-group">
        ${ALL_TRAINING_CATEGORIES.map((cat, index) => `
          <div class="list-group-item d-flex justify-content-between align-items-center">
            <div>
              <strong>${escapeHtml(cat.name)}</strong>
              <br><small class="text-muted">${escapeHtml(cat.description || 'No description')}</small>
            </div>
            <div class="btn-group btn-group-sm">
              <button class="btn btn-outline-primary" onclick="editCategory('${cat.id}')">
                <i class="bi bi-pencil"></i>
              </button>
              ${CURRENT_USER.role === "superadmin" ? `
                <button class="btn btn-outline-danger" onclick="deleteCategory('${cat.id}')">
                  <i class="bi bi-trash"></i>
                </button>
              ` : ''}
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
    </div>
  `;
}

window.addNewCategory = function() {
  const name = prompt("Category Name:");
  if (!name) return;
  
  const description = prompt("Category Description (optional):");
  
  trainingCategoriesRef.add({
    name,
    description: description || "",
    order: ALL_TRAINING_CATEGORIES.length,
    active: true,
    createdAt: firebase.firestore.Timestamp.now(),
    createdBy: CURRENT_USER.uid
  }).then(() => {
    loadTrainingCategories().then(() => {
      renderCategoryManager();
      toast("Category added", "success");
    });
  }).catch(err => {
    console.error("Error adding category:", err);
    toast("Failed to add category", "danger");
  });
};

window.editCategory = function(categoryId) {
  const category = ALL_TRAINING_CATEGORIES.find(c => c.id === categoryId);
  if (!category) return;
  
  const name = prompt("Category Name:", category.name);
  if (!name) return;
  
  const description = prompt("Category Description:", category.description || "");
  
  trainingCategoriesRef.doc(categoryId).update({
    name,
    description: description || "",
    updatedAt: firebase.firestore.Timestamp.now(),
    updatedBy: CURRENT_USER.uid
  }).then(() => {
    loadTrainingCategories().then(() => {
      renderCategoryManager();
      toast("Category updated", "success");
    });
  }).catch(err => {
    console.error("Error updating category:", err);
    toast("Failed to update category", "danger");
  });
};

window.deleteCategory = function(categoryId) {
  if (CURRENT_USER.role !== "superadmin") {
    toast("Only Super Admin can delete categories", "danger");
    return;
  }
  
  const hasTrainings = ALL_TRAININGS.some(t => t.categoryId === categoryId);
  if (hasTrainings) {
    toast("Cannot delete category with existing trainings", "danger");
    return;
  }
  
  if (!confirm("Delete this category?")) return;
  
  trainingCategoriesRef.doc(categoryId).delete().then(() => {
    loadTrainingCategories().then(() => {
      renderCategoryManager();
      toast("Category deleted", "success");
    });
  }).catch(err => {
    console.error("Error deleting category:", err);
    toast("Failed to delete category", "danger");
  });
};

// ============================================================
// KNOWLEDGE BASE MANAGER
// ============================================================

window.openKnowledgeBaseManager = function() {
  const modal = new bootstrap.Modal(document.getElementById("knowledgeBaseModal"));
  renderKnowledgeBaseManager();
  modal.show();
};

function renderKnowledgeBaseManager() {
  const modal = document.getElementById("knowledgeBaseModal");
  if (!modal) return;
  
  const modalContent = modal.querySelector(".modal-content");
  modalContent.innerHTML = `
    <div class="modal-header">
      <h5 class="modal-title"><i class="bi bi-book-fill me-2"></i>Knowledge Base</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body">
      <button class="btn btn-primary btn-sm mb-3" onclick="addKnowledgeArticle()">
        <i class="bi bi-plus-lg me-1"></i>Add Article
      </button>
      <div class="accordion" id="knowledgeBaseAccordion">
        ${KNOWLEDGE_BASE.length === 0 ? '<p class="text-muted text-center py-3">No articles yet. Click "Add Article" to create knowledge base content.</p>' : ''}
        ${KNOWLEDGE_BASE.map((article, index) => `
          <div class="accordion-item">
            <h2 class="accordion-header">
              <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#kb-${article.id}">
                ${escapeHtml(article.title)}
              </button>
            </h2>
            <div id="kb-${article.id}" class="accordion-collapse collapse" data-bs-parent="#knowledgeBaseAccordion">
              <div class="accordion-body">
                <div class="mb-2">${escapeHtml(article.content)}</div>
                <div class="btn-group btn-group-sm">
                  <button class="btn btn-outline-primary" onclick="editKnowledgeArticle('${article.id}')">
                    <i class="bi bi-pencil me-1"></i>Edit
                  </button>
                  <button class="btn btn-outline-danger" onclick="deleteKnowledgeArticle('${article.id}')">
                    <i class="bi bi-trash me-1"></i>Delete
                  </button>
                </div>
                ${article.tags && article.tags.length > 0 ? `
                  <div class="mt-2">
                    ${article.tags.map(tag => `<span class="badge bg-secondary me-1">${escapeHtml(tag)}</span>`).join('')}
                  </div>
                ` : ''}
              </div>
            </div>
          </div>
        `).join('')}
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
    </div>
  `;
}

window.addKnowledgeArticle = function() {
  const title = prompt("Article Title:");
  if (!title) return;
  
  const content = prompt("Article Content:");
  if (!content) return;
  
  const tags = prompt("Tags (comma-separated, optional):");
  
  knowledgeBaseRef.add({
    title,
    content,
    tags: tags ? tags.split(',').map(t => t.trim()) : [],
    createdAt: firebase.firestore.Timestamp.now(),
    createdBy: CURRENT_USER.uid,
    active: true
  }).then(() => {
    loadKnowledgeBase().then(() => {
      renderKnowledgeBaseManager();
      toast("Article added", "success");
    });
  }).catch(err => {
    console.error("Error adding article:", err);
    toast("Failed to add article", "danger");
  });
};

window.editKnowledgeArticle = function(articleId) {
  const article = KNOWLEDGE_BASE.find(a => a.id === articleId);
  if (!article) return;
  
  const title = prompt("Article Title:", article.title);
  if (!title) return;
  
  const content = prompt("Article Content:", article.content);
  if (!content) return;
  
  const tags = prompt("Tags (comma-separated):", (article.tags || []).join(', '));
  
  knowledgeBaseRef.doc(articleId).update({
    title,
    content,
    tags: tags ? tags.split(',').map(t => t.trim()) : [],
    updatedAt: firebase.firestore.Timestamp.now(),
    updatedBy: CURRENT_USER.uid
  }).then(() => {
    loadKnowledgeBase().then(() => {
      renderKnowledgeBaseManager();
      toast("Article updated", "success");
    });
  }).catch(err => {
    console.error("Error updating article:", err);
    toast("Failed to update article", "danger");
  });
};

window.deleteKnowledgeArticle = function(articleId) {
  if (!confirm("Delete this article?")) return;
  
  knowledgeBaseRef.doc(articleId).delete().then(() => {
    loadKnowledgeBase().then(() => {
      renderKnowledgeBaseManager();
      toast("Article deleted", "success");
    });
  }).catch(err => {
    console.error("Error deleting article:", err);
    toast("Failed to delete article", "danger");
  });
};

// ============================================================
// ADMIN REPORTS
// ============================================================

window.showAdminReports = function() {
  const modal = new bootstrap.Modal(document.getElementById("trainingReportsModal"));
  renderTrainingReports();
  modal.show();
};

function renderTrainingReports() {
  const modal = document.getElementById("trainingReportsModal");
  if (!modal) return;
  
  const modalContent = modal.querySelector(".modal-content");
  
  // Get data
  const ALL_USERS_PROGRESS = getAllUsersProgress();
  const ACTIVE_MEMBERS = getActiveMembers();
  const activeHR = getActiveHR();
  const ALL_TRAININGS = getAllTrainings();
  
  // Calculate stats
  const totalUsers = ACTIVE_MEMBERS.length + activeHR.length;
  const totalProgress = ALL_USERS_PROGRESS.length;
  const completedCourses = ALL_USERS_PROGRESS.filter(p => p.status === "completed").length;
  const averageCompletion = totalProgress > 0 ? Math.round((completedCourses / totalProgress) * 100) : 0;
  
  // Get top performers
  const userCompletions = {};
  ALL_USERS_PROGRESS.forEach(p => {
    if (p.status === "completed") {
      userCompletions[p.userId] = (userCompletions[p.userId] || 0) + 1;
    }
  });
  
  const topPerformers = Object.entries(userCompletions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([userId, count]) => {
      const user = [...ACTIVE_MEMBERS, ...activeHR].find(u => u.id === userId);
      return { name: user?.name || user?.email || 'Unknown', count };
    });
  
  // Course completion breakdown
  const courseStats = ALL_TRAININGS.map(training => {
    const progressRecords = ALL_USERS_PROGRESS.filter(p => p.trainingId === training.id);
    const completed = progressRecords.filter(p => p.status === "completed").length;
    const inProgress = progressRecords.filter(p => p.status === "in_progress").length;
    const enrolled = progressRecords.length;
    return { 
      title: training.title, 
      enrolled, 
      inProgress,
      completed,
      completionRate: enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0
    };
  }).sort((a, b) => b.enrolled - a.enrolled);
  
  modalContent.innerHTML = `
    <div class="modal-header">
      <h5 class="modal-title"><i class="bi bi-graph-up-arrow me-2"></i>Training Analytics & Reports</h5>
      <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
    </div>
    <div class="modal-body" style="max-height: 70vh; overflow-y: auto;">
      <!-- Overview Stats -->
      <div class="row g-3 mb-4">
        <div class="col-md-3">
          <div class="card text-center">
            <div class="card-body">
              <h3 class="text-primary">${totalUsers}</h3>
              <small class="text-muted">Total Users</small>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card text-center">
            <div class="card-body">
              <h3 class="text-success">${completedCourses}</h3>
              <small class="text-muted">Completed Courses</small>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card text-center">
            <div class="card-body">
              <h3 class="text-warning">${totalProgress - completedCourses}</h3>
              <small class="text-muted">In Progress</small>
            </div>
          </div>
        </div>
        <div class="col-md-3">
          <div class="card text-center">
            <div class="card-body">
              <h3 class="text-info">${averageCompletion}%</h3>
              <small class="text-muted">Avg Completion</small>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Top Performers -->
      <div class="card mb-4">
        <div class="card-header bg-success text-white">
          <h6 class="mb-0"><i class="bi bi-trophy-fill me-2"></i>Top Performers</h6>
        </div>
        <div class="card-body">
          ${topPerformers.length === 0 ? '<p class="text-muted mb-0">No completed courses yet.</p>' : ''}
          <div class="list-group list-group-flush">
            ${topPerformers.map((performer, index) => `
              <div class="list-group-item d-flex justify-content-between align-items-center">
                <div>
                  <span class="badge bg-${index === 0 ? 'warning' : index === 1 ? 'secondary' : 'bronze'} me-2">#${index + 1}</span>
                  ${escapeHtml(performer.name)}
                </div>
                <span class="badge bg-success rounded-pill">${performer.count} courses</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
      
      <!-- Course Completion Breakdown -->
      <div class="card">
        <div class="card-header bg-primary text-white">
          <h6 class="mb-0"><i class="bi bi-bar-chart-fill me-2"></i>Course Completion Breakdown</h6>
        </div>
        <div class="card-body p-0">
          <div class="table-responsive">
            <table class="table table-hover mb-0">
              <thead class="table-light">
                <tr>
                  <th>Course</th>
                  <th>Enrolled</th>
                  <th>In Progress</th>
                  <th>Completed</th>
                  <th>Completion Rate</th>
                </tr>
              </thead>
              <tbody>
                ${courseStats.map(stat => `
                  <tr>
                    <td>${escapeHtml(stat.title)}</td>
                    <td>${stat.enrolled}</td>
                    <td><span class="badge bg-warning">${stat.inProgress}</span></td>
                    <td><span class="badge bg-success">${stat.completed}</span></td>
                    <td>
                      <div class="progress" style="height: 20px;">
                        <div class="progress-bar ${stat.completionRate >= 70 ? 'bg-success' : stat.completionRate >= 40 ? 'bg-warning' : 'bg-danger'}" 
                             style="width: ${stat.completionRate}%">
                          ${stat.completionRate}%
                        </div>
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn btn-outline-primary" onclick="exportTrainingReport()">
        <i class="bi bi-download me-1"></i>Export Report
      </button>
      <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Close</button>
    </div>
  `;
}

window.exportTrainingReport = function() {
  // Create CSV data
  let csv = "Course,Enrolled,In Progress,Completed,Completion Rate\n";
  
  ALL_TRAININGS.forEach(training => {
    const progressRecords = ALL_USERS_PROGRESS.filter(p => p.trainingId === training.id);
    const completed = progressRecords.filter(p => p.status === "completed").length;
    const inProgress = progressRecords.filter(p => p.status === "in_progress").length;
    const enrolled = progressRecords.length;
    const completionRate = enrolled > 0 ? Math.round((completed / enrolled) * 100) : 0;
    
    csv += `"${training.title}",${enrolled},${inProgress},${completed},${completionRate}%\n`;
  });
  
  // Download
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `training-report-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  window.URL.revokeObjectURL(url);
  
  toast("Report exported", "success");
};

// ============================================================
// HELPER FUNCTIONS
// ============================================================

function toggleSectionFields() {
  const type = document.getElementById("sectionType")?.value;
  if (!type) return;
  
  document.getElementById("fieldText")?.classList.toggle("d-none", type !== "text");
  document.getElementById("fieldVideo")?.classList.toggle("d-none", type !== "video");
  document.getElementById("fieldPdf")?.classList.toggle("d-none", type !== "pdf");
  document.getElementById("fieldImage")?.classList.toggle("d-none", type !== "image");
  document.getElementById("fieldQuiz")?.classList.toggle("d-none", type !== "quiz");
}

function renderQuizQuestionsInEditor(questions) {
  const container = document.getElementById("sectionQuizQuestions");
  if (!container) return;
  
  container.innerHTML = questions.map((q, index) => `
    <div class="card mb-2">
      <div class="card-body">
        <strong>Q${index + 1}:</strong> ${escapeHtml(q.question)}
        <ul class="mt-2 mb-0">
          ${q.options.map((opt, i) => `
            <li class="${q.correctAnswer === i ? 'text-success fw-bold' : ''}">${escapeHtml(opt)}</li>
          `).join('')}
        </ul>
      </div>
    </div>
  `).join('');
}

function getQuizQuestionsFromEditor() {
  // This would be populated from a quiz builder UI
  // For now, return empty array
  return window.TEMP_QUIZ_QUESTIONS || [];
}

// ============================================================
// QUIZ BUILDER
// ============================================================

window.addQuizQuestion = function() {
  const question = prompt("Question:");
  if (!question) return;
  
  const option1 = prompt("Option 1:");
  if (!option1) return;
  
  const option2 = prompt("Option 2:");
  if (!option2) return;
  
  const option3 = prompt("Option 3 (optional):");
  const option4 = prompt("Option 4 (optional):");
  
  const options = [option1, option2];
  if (option3) options.push(option3);
  if (option4) options.push(option4);
  
  const correctAnswer = parseInt(prompt(`Which option is correct? (1-${options.length}):`)) - 1;
  if (correctAnswer < 0 || correctAnswer >= options.length) {
    toast("Invalid correct answer", "danger");
    return;
  }
  
  if (!window.TEMP_QUIZ_QUESTIONS) {
    window.TEMP_QUIZ_QUESTIONS = [];
  }
  
  window.TEMP_QUIZ_QUESTIONS.push({
    question,
    options,
    correctAnswer
  });
  
  renderQuizQuestionsInEditor(window.TEMP_QUIZ_QUESTIONS);
  toast("Quiz question added", "success");
};

// ============================================================
// INITIALIZATION FOR BUILDER
// ============================================================

// Initialize temp sections when opening builder
window.initializeBuilderSections = function(training) {
  if (training && training.sections) {
    window.TEMP_BUILDER_SECTIONS = JSON.parse(JSON.stringify(training.sections));
  } else {
    window.TEMP_BUILDER_SECTIONS = [];
  }
};

window.openTrainingBuilder = function(trainingId = null) {
  const ALL_TRAININGS = getAllTrainings();
  CURRENT_EDITING_TRAINING = trainingId ? ALL_TRAININGS.find(t => t.id === trainingId) : null;
  
  // Initialize sections
  initializeBuilderSections(CURRENT_EDITING_TRAINING);
  
  const modal = document.getElementById("trainingBuilderModal");
  if (!modal) {
    console.error("Training builder modal not found in HTML");
    toast("Training builder not available", "danger");
    return;
  }
  
  renderTrainingBuilderModal(CURRENT_EDITING_TRAINING);
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
};

// ============================================================
// CAMPAIGN INTEGRATION
// ============================================================

// This function should be called when a new campaign is created
// It prompts admin to create or link training
window.promptCampaignTraining = async function(campaignId, campaignName) {
  if (CURRENT_USER.role !== "admin" && CURRENT_USER.role !== "superadmin") {
    return;
  }
  
  const action = confirm(
    `Campaign "${campaignName}" created successfully!\n\n` +
    `Would you like to create a training course for this campaign?\n\n` +
    `Click OK to create training, or Cancel to skip.`
  );
  
  if (!action) return;
  
  // Check if training already exists for this campaign
  const existingTraining = ALL_TRAININGS.find(t => t.campaignId === campaignId);
  if (existingTraining) {
    const link = confirm(
      `A training already exists for this campaign: "${existingTraining.title}"\n\n` +
      `Would you like to edit it?`
    );
    if (link) {
      openTrainingBuilder(existingTraining.id);
    }
    return;
  }
  
  // Create new training for campaign
  CURRENT_EDITING_TRAINING = {
    title: `${campaignName} Training`,
    description: `Training course for ${campaignName} campaign`,
    campaignId: campaignId,
    categoryId: ALL_TRAINING_CATEGORIES.length > 0 ? ALL_TRAINING_CATEGORIES[0].id : null,
    status: "draft",
    isMandatory: true,
    sections: []
  };
  
  initializeBuilderSections(CURRENT_EDITING_TRAINING);
  const modal = new bootstrap.Modal(document.getElementById("trainingBuilderModal"));
  renderTrainingBuilderModal(CURRENT_EDITING_TRAINING);
  modal.show();
};

// ============================================================
// MANDATORY ONBOARDING CHECK
// ============================================================

// Check if user has completed mandatory trainings
// This should be called before allowing access to Leads module
window.checkMandatoryTraining = async function(userId) {
  // Get mandatory trainings
  const mandatoryTrainings = ALL_TRAININGS.filter(t => 
    t.isMandatory && t.status === "published"
  );
  
  if (mandatoryTrainings.length === 0) {
    return { allowed: true, missing: [] };
  }
  
  // Check user progress
  const userProgress = ALL_USERS_PROGRESS.filter(p => p.userId === userId);
  const completedIds = userProgress
    .filter(p => p.status === "completed")
    .map(p => p.trainingId);
  
  const missingTrainings = mandatoryTrainings.filter(t => 
    !completedIds.includes(t.id)
  );
  
  return {
    allowed: missingTrainings.length === 0,
    missing: missingTrainings
  };
};

// Show mandatory training warning
window.showMandatoryTrainingWarning = function(missingTrainings) {
  const modal = document.createElement('div');
  modal.className = 'modal fade';
  modal.id = 'mandatoryTrainingWarning';
  modal.setAttribute('data-bs-backdrop', 'static');
  modal.setAttribute('data-bs-keyboard', 'false');
  modal.innerHTML = `
    <div class="modal-dialog modal-dialog-centered">
      <div class="modal-content">
        <div class="modal-header bg-warning text-dark">
          <h5 class="modal-title">
            <i class="bi bi-exclamation-triangle-fill me-2"></i>Mandatory Training Required
          </h5>
        </div>
        <div class="modal-body">
          <p>You must complete the following mandatory training courses before accessing the Leads module:</p>
          <ul class="list-group mb-3">
            ${missingTrainings.map(t => `
              <li class="list-group-item">
                <i class="bi bi-book-fill text-danger me-2"></i>${escapeHtml(t.title)}
              </li>
            `).join('')}
          </ul>
          <p class="mb-0">Click below to go to Sales Academy and start your training.</p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn btn-primary" onclick="goToSalesAcademy(); bootstrap.Modal.getInstance(document.getElementById('mandatoryTrainingWarning')).hide();">
            <i class="bi bi-mortarboard-fill me-1"></i>Go to Sales Academy
          </button>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
  const bsModal = new bootstrap.Modal(modal);
  bsModal.show();
};

window.goToSalesAcademy = function() {
  showView('training');
};

console.log("✅ Training Admin Module Loaded");
