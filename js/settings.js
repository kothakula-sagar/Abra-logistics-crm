// ============================================================
// SETTINGS.JS — CRM Settings (single Firestore doc model)
//
// Storage:  crmSettings/general  (ONE document, all sections)
// Super Admin : full read + write via UI
// Admin       : read-only view (all inputs disabled, save/reset hidden)
// Member      : read-only view (all inputs disabled, save/reset hidden)
//
// Every authenticated user subscribes via onSnapshot() so changes
// made by Super Admin propagate in real time — no page refresh needed.
// Every other module calls getCRMSetting("section.key") at runtime.
// ============================================================

// ── Single Firestore document reference ──────────────────────
const CRM_SETTINGS_DOC = db.collection("crmSettings").doc("general");

// ── Flat in-memory cache (mirrors the Firestore doc shape) ───
let CRM_CONFIG = _defaultConfig();

function _defaultConfig() {
  return {
    // § 1 Working Days
    workingDays: ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
    // § 2 Office Hours
    officeStart: "09:00",
    officeEnd:   "18:00",
    // § 3 Break Timings  (array stored under breakTimings key)
    breakTimings: [
      { id: "b1", name: "Morning Break", start: "11:00", end: "11:15" },
      { id: "b2", name: "Lunch Break",   start: "13:00", end: "14:00" },
      { id: "b3", name: "Evening Break", start: "16:30", end: "16:45" }
    ],
    // § 4 Holidays  (array stored under holidays key)
    holidays: [],
    // § 5-6 Lead / Follow-up Rules
    uncontactedAlertMinutes:           30,
    reminderAfterMinutes:              30,
    reminderFreqMinutes:               30,
    maxReminderCount:                  5,
    maxConsecutiveNotPickingAttempts:  3,   // Maximum consecutive Not Picking Call attempts
    assignmentIntervalMinutes:         30,   // gradual dispatch interval
    lunchStart:                       "13:00", // half-day boundary
    autoMoveToNoResponse:             true,  // Auto-move to "No Response" after max consecutive attempts
    autoFollowUp:                     true,
    autoReminder:                     true,
    autoEscalation:                   false,
    // § 8 Notifications
    browserNotifications:    true,
    toastNotifications:      true,
    soundAlerts:             false,
    whatsappAlerts:          false,
    emailAlerts:             false,
    telegramAlerts:           true,
    telegramOverdueAlerts:    true,
    // § 9 AI Defaults
    aiProvider:    "Groq",
    aiModel:       "llama-3.3-70b-versatile",
    aiTemperature: 0.75,
    aiMaxTokens:   1200,
    // § 10 System Settings
    timezone:    "Asia/Kolkata",
    dateFormat:  "DD MMM YYYY",
    timeFormat:  "12h",
    currency:    "INR",
    // § 11 Global CRM Font
    fontFamily:  "Inter",
    fontGoogleUrl: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap",
  };
}

// ── Public dot-path accessor ──────────────────────────────────
// Usage examples:
//   getCRMSetting("uncontactedAlertMinutes")  → 30
//   getCRMSetting("breakTimings")             → [{...}]
//   getCRMSetting("officeStart")              → "09:00"
function getCRMSetting(path) {
  return path.split(".").reduce((obj, key) => obj?.[key], CRM_CONFIG);
}

// ── Single onSnapshot subscription ───────────────────────────
// Called once at app startup for every role.
// Writes CRM_CONFIG from Firestore data, then notifies dependents.
function subscribeCRMSettings() {
  CRM_SETTINGS_DOC.onSnapshot(snap => {
    if (snap.exists) {
      // Merge Firestore data over defaults so new keys always have a value
      CRM_CONFIG = { ..._defaultConfig(), ...snap.data() };
    }
    // Apply the shared CRM font immediately for every role.
    applyCRMFont(CRM_CONFIG.fontGoogleUrl, CRM_CONFIG.fontFamily);
    // If the settings page is currently visible, re-render it
    const section = document.getElementById("view-crmsettings");
    if (section && !section.classList.contains("d-none")) {
      renderCRMSettingsView();
    }
    // Re-evaluate reminders with the new values
    if (typeof checkReminders === "function") checkReminders();
  }, err => console.error("crmSettings/general snapshot error:", err));
}

// ── Schedule helpers (used by leads.js checkReminders) ───────
function isOfficeHoursNow() {
  const now = new Date();
  const dayName = ["Sunday","Monday","Tuesday","Wednesday",
                   "Thursday","Friday","Saturday"][now.getDay()];
  if (!(CRM_CONFIG.workingDays || []).includes(dayName)) return false;
  const [sh, sm] = (CRM_CONFIG.officeStart || "09:00").split(":").map(Number);
  const [eh, em] = (CRM_CONFIG.officeEnd   || "18:00").split(":").map(Number);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return nowMin >= sh * 60 + sm && nowMin < eh * 60 + em;
}

function isBreakTimeNow() {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  return (CRM_CONFIG.breakTimings || []).some(b => {
    const [sh, sm] = (b.start || "00:00").split(":").map(Number);
    const [eh, em] = (b.end   || "00:00").split(":").map(Number);
    return nowMin >= sh * 60 + sm && nowMin < eh * 60 + em;
  });
}

function isHolidayToday() {
  const t = new Date();
  const todayStr = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
  return (CRM_CONFIG.holidays || []).some(h => {
    if (!h.date) return false;
    return h.recurring ? h.date.slice(5) === todayStr.slice(5) : h.date === todayStr;
  });
}

function shouldSuppressReminders() {
  return isHolidayToday() || isBreakTimeNow() || !isOfficeHoursNow();
}

// =============================================================
//  SETTINGS PAGE RENDERER
//  • Super Admin  → fully editable, Save + Reset buttons shown
//  • Admin/Member → read-only (all inputs disabled), buttons hidden
// =============================================================

function renderCRMSettingsView() {
  const wrap = document.getElementById("view-crmsettings");
  if (!wrap) return;

  const isSA       = CURRENT_USER.role === "superadmin";
  const isAdmin     = CURRENT_USER.role === "admin";
  const canEditFont = isSA || isAdmin;
  const isReadOnly  = !isSA;          // Business settings remain Super Admin-only
  const ro          = isReadOnly ? "disabled" : "";   // HTML attribute string

  const g  = CRM_CONFIG;
  const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

  // ── Page header ─────────────────────────────────────────────
  wrap.innerHTML = `
  <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-4">
    <div>
      <h1 class="page-title"><i class="bi bi-gear-fill me-2"></i>CRM Settings</h1>
      <p class="page-subtitle">
        ${isSA
          ? "All business rules. Changes take effect for every user in real time."
          : (isAdmin
            ? "Business rules are read-only for Admin. Global CRM font can be changed here."
            : "Current CRM configuration — read-only for your role.")}
      </p>
    </div>
    ${isSA ? `
    <div class="d-flex gap-2">
      <button class="btn btn-brand" onclick="saveAllCRMSettings()">
        <i class="bi bi-floppy-fill me-1"></i>Save All Settings
      </button>
    </div>` : `
    <span class="badge crm-readonly-badge">
      <i class="bi bi-lock-fill me-1"></i>Read-only — ${ROLE_LABELS[CURRENT_USER.role] || CURRENT_USER.role}
    </span>`}
  </div>

  ${isReadOnly ? `
  <div class="alert crm-readonly-alert mb-4" role="alert">
    <i class="bi bi-info-circle-fill me-2"></i>
    Business settings are managed by the Super Admin. Admin can change only the Global CRM Font.
  </div>` : ""}

  <div class="row g-4">
    <div class="col-12 col-xl-6">
      ${_card("bi-type",            "Global CRM Font",       _sectionGlobalFont(g, canEditFont))}
      ${_card("bi-calendar-week", "Working Days",   _sectionWorkingDays(DAYS, g, ro))}
      ${_card("bi-clock",         "Office Hours",   _sectionOfficeHours(g, ro))}
      ${_card("bi-cup-hot",       "Break Timings",  _sectionBreaks(g, ro, isSA))}
      ${_card("bi-calendar-x",    "Holidays",       _sectionHolidays(g, ro, isSA))}
      ${_card("bi-globe",         "System Settings",_sectionSystem(g, ro))}
    </div>
    <div class="col-12 col-xl-6">
      ${_card("bi-arrow-repeat",  "Follow-up Settings",    _sectionFollowUp(g, ro))}
      ${_card("bi-telephone-x",   "Not Picking Call Rule", _sectionNotPicking(g, ro))}
      ${_card("bi-toggles",       "Auto Status Rules",     _sectionAutoStatus(g, ro))}
      ${_card("bi-bell",          "Notification Settings", _sectionNotifications(g, ro))}
      ${_card("bi-robot",         "AI Defaults (Global)",  _sectionAIDefaults(g, ro))}
    </div>
  </div>

  ${isSA ? `
  <div class="mt-4 d-flex gap-2">
    <button class="btn btn-brand btn-lg" onclick="saveAllCRMSettings()">
      <i class="bi bi-floppy-fill me-1"></i>Save All Settings
    </button>
    <button class="btn btn-outline-secondary btn-lg" onclick="renderCRMSettingsView()">
      <i class="bi bi-arrow-counterclockwise me-1"></i>Discard Changes
    </button>
  </div>` : ""}`;

  _bindCRMFontPreview();
}

// ── Section builders (each returns an HTML string) ───────────

function _card(icon, title, body) {
  return `
  <div class="crm-settings-card mb-4">
    <div class="crm-settings-card-header"><i class="bi ${icon} me-2"></i>${title}</div>
    <div class="crm-settings-card-body">${body}</div>
  </div>`;
}

function _sectionGlobalFont(g, canEditFont) {
  const disabled = canEditFont ? "" : "disabled";
  const family = g.fontFamily || "Inter";
  const googleUrl = g.fontGoogleUrl || "";
  return `
  <div class="mb-3">
    <label class="form-label small fw-semibold">Google Fonts embed code or CSS URL</label>
    <textarea id="cfg_fontGoogleInput" class="form-control" rows="3" ${disabled}
      placeholder="Paste the <link ...> code or https://fonts.googleapis.com/css2?...">${escapeHtml(googleUrl)}</textarea>
    <div class="form-text">
      In Google Fonts, choose a font, open <strong>Get embed code</strong>, then paste the <code>&lt;link&gt;</code> code here.
      The CRM extracts the font family automatically.
    </div>
  </div>
  <div class="row g-3 align-items-end">
    <div class="col-md-7">
      <label class="form-label small fw-semibold">Font Family</label>
      <input id="cfg_fontFamily" class="form-control" value="${escapeHtml(family)}" ${disabled}
        placeholder="Inter">
      <div class="form-text">Used across the CRM, including headings, tables, buttons and forms.</div>
    </div>
    <div class="col-md-5">
      <div class="p-3 rounded border bg-light" id="crmFontPreview" style="font-family: '${escapeHtml(family).replace(/'/g, "&#39;")}';">
        <div class="small text-muted mb-1">Preview</div>
        <div style="font-size:1.15rem;font-weight:700;">Abra Logistics CRM</div>
        <div class="small">Customer • Marketing • Reports • Settings</div>
      </div>
    </div>
  </div>
  ${canEditFont ? `
  <div class="mt-3 d-flex flex-wrap gap-2">
    <button type="button" class="btn btn-brand" onclick="saveCRMFont()">
      <i class="bi bi-check2-circle me-1"></i>Save / Update Font
    </button>
    <button type="button" class="btn btn-outline-secondary" onclick="resetCRMFontToDefault()">
      <i class="bi bi-arrow-counterclockwise me-1"></i>Reset to Inter
    </button>
  </div>` : `
  <div class="alert alert-light border mb-0 mt-3 py-2 small">
    <i class="bi bi-lock-fill me-1"></i>Only Super Admin and Admin can change the CRM font.
  </div>`}`;
}

function _sectionWorkingDays(DAYS, g, ro) {
  return `
  <div class="crm-day-grid">
    ${DAYS.map(d => `
    <label class="crm-day-chip ${ro ? "crm-day-chip-ro" : ""}">
      <input type="checkbox" id="wd_${d}" ${(g.workingDays||[]).includes(d) ? "checked" : ""} ${ro}>
      <span>${d.slice(0,3)}</span>
    </label>`).join("")}
  </div>`;
}

function _sectionOfficeHours(g, ro) {
  return `
  <div class="row g-3">
    <div class="col-6">
      <label class="form-label small fw-semibold">Start Time</label>
      <input type="time" id="cfg_officeStart" class="form-control" value="${g.officeStart||'09:00'}" ${ro}>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">End Time</label>
      <input type="time" id="cfg_officeEnd" class="form-control" value="${g.officeEnd||'18:00'}" ${ro}>
    </div>
  </div>`;
}

function _sectionBreaks(g, ro, isSA) {
  const rows = (g.breakTimings || []).map(b => `
  <div class="crm-list-row" id="breakRow_${b.id}">
    <input type="text" class="form-control form-control-sm" placeholder="Break name"
           id="brk_name_${b.id}" value="${escapeHtml(b.name)}" ${ro}>
    <input type="time" class="form-control form-control-sm" id="brk_start_${b.id}" value="${b.start}" ${ro}>
    <span class="text-muted small">to</span>
    <input type="time" class="form-control form-control-sm" id="brk_end_${b.id}" value="${b.end}" ${ro}>
    ${isSA ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteBreakRow('${b.id}')">
      <i class="bi bi-trash"></i></button>` : ""}
  </div>`).join("") || `<p class="text-muted small mb-2">No breaks configured.</p>`;
  return rows + (isSA ? `
  <button class="btn btn-sm btn-outline-primary mt-2" onclick="addBreakRow()">
    <i class="bi bi-plus-lg me-1"></i>Add Break
  </button>` : "");
}

function _sectionHolidays(g, ro, isSA) {
  const rows = (g.holidays || []).map(h => `
  <div class="crm-list-row" id="holRow_${h.id}">
    <input type="text" class="form-control form-control-sm" placeholder="Holiday name"
           id="hol_name_${h.id}" value="${escapeHtml(h.name)}" ${ro}>
    <input type="date" class="form-control form-control-sm" id="hol_date_${h.id}" value="${h.date}" ${ro}>
    <select class="form-select form-select-sm" id="hol_type_${h.id}" ${ro}>
      ${["National","Regional","Company"].map(t => `<option ${t===h.type?"selected":""}>${t}</option>`).join("")}
    </select>
    <div class="form-check form-switch mb-0 ms-1">
      <input class="form-check-input" type="checkbox" role="switch"
             id="hol_rec_${h.id}" title="Recurring" ${h.recurring?"checked":""} ${ro}>
      <label class="form-check-label small" for="hol_rec_${h.id}">Recurring</label>
    </div>
    ${isSA ? `<button class="btn btn-sm btn-outline-danger" onclick="deleteHolidayRow('${h.id}')">
      <i class="bi bi-trash"></i></button>` : ""}
  </div>`).join("") || `<p class="text-muted small mb-2">No holidays configured.</p>`;
  return rows + (isSA ? `
  <button class="btn btn-sm btn-outline-primary mt-2" onclick="addHolidayRow()">
    <i class="bi bi-plus-lg me-1"></i>Add Holiday
  </button>` : "");
}

function _sectionSystem(g, ro) {
  const _sel = (id, opts, val) =>
    `<select id="${id}" class="form-select form-select-sm" ${ro}>
      ${opts.map(o => `<option ${o===val?"selected":""}>${o}</option>`).join("")}
    </select>`;
  return `
  <div class="row g-3">
    <div class="col-6">
      <label class="form-label small fw-semibold">Timezone</label>
      ${_sel("cfg_timezone",["Asia/Kolkata","Asia/Dubai","Europe/London","America/New_York","America/Los_Angeles","Asia/Singapore","Asia/Tokyo"], g.timezone)}
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Date Format</label>
      ${_sel("cfg_dateFormat",["DD MMM YYYY","MM/DD/YYYY","YYYY-MM-DD","DD/MM/YYYY"], g.dateFormat)}
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Time Format</label>
      <select id="cfg_timeFormat" class="form-select form-select-sm" ${ro}>
        <option value="12h" ${g.timeFormat==="12h"?"selected":""}>12-hour (AM/PM)</option>
        <option value="24h" ${g.timeFormat==="24h"?"selected":""}>24-hour</option>
      </select>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Currency</label>
      ${_sel("cfg_currency",["INR","USD","EUR","GBP","AED","SGD"], g.currency)}
    </div>
  </div>`;
}

function _sectionFollowUp(g, ro) {
  const _opt = (vals, cur) => vals.map(m =>
    `<option value="${m}" ${m==cur?"selected":""}>${m<60?m+" min":m/60+" hr"}</option>`).join("");
  return `
  <div class="row g-3">
    <div class="col-6">
      <label class="form-label small fw-semibold">First Reminder After</label>
      <select id="cfg_reminderAfter" class="form-select form-select-sm" ${ro}>
        ${_opt([15,30,45,60,120], g.reminderAfterMinutes)}
      </select>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Reminder Frequency</label>
      <select id="cfg_reminderFreq" class="form-select form-select-sm" ${ro}>
        ${[15,30,45,60].map(m=>`<option value="${m}" ${m==g.reminderFreqMinutes?"selected":""}>${m} min</option>`).join("")}
      </select>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Uncontacted Alert After</label>
      <select id="cfg_uncontactedAlert" class="form-select form-select-sm" ${ro}>
        ${_opt([15,30,45,60,120], g.uncontactedAlertMinutes)}
      </select>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Max Reminder Count</label>
      <input type="number" id="cfg_maxReminder" class="form-control form-control-sm"
             min="1" max="20" value="${g.maxReminderCount||5}" ${ro}>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Assignment Interval</label>
      <select id="cfg_assignInterval" class="form-select form-select-sm" ${ro}>
        ${[10,15,20,30,45,60].map(m=>
          `<option value="${m}" ${m==(g.assignmentIntervalMinutes||30)?"selected":""}>${m} min</option>`
        ).join("")}
      </select>
    </div>
    <div class="col-6">
      <label class="form-label small fw-semibold">Lunch Start (Half-day boundary)</label>
      <input type="time" id="cfg_lunchStart" class="form-control form-control-sm"
             value="${g.lunchStart||'13:00'}" ${ro}>
    </div>
  </div>`;
}

function _sectionNotPicking(g, ro) {
  return `
  <label class="form-label small fw-semibold">Maximum Consecutive Not Picking Call Attempts</label>
  <div class="d-flex align-items-center gap-3 mt-1">
    <input type="number" id="cfg_maxConsecutiveAttempts" class="form-control"
           style="max-width:100px" min="1" max="20" value="${g.maxConsecutiveNotPickingAttempts||3}" ${ro}>
    <span class="text-muted small">After this count of consecutive attempts with no answer, status becomes <strong>No Response</strong>.</span>
  </div>`;
}

function _toggle(id, label, checked, ro) {
  return `
  <div class="d-flex justify-content-between align-items-center crm-toggle-row">
    <span class="crm-toggle-label">${label}</span>
    <div class="form-check form-switch mb-0">
      <input class="form-check-input crm-toggle-input" type="checkbox" role="switch"
             id="${id}" ${checked ? "checked" : ""} ${ro}>
    </div>
  </div>`;
}

function _sectionAutoStatus(g, ro) {
  return `
  <div class="d-flex flex-column gap-3">
    ${_toggle("cfg_autoMoveNoResponse", "Auto Move to No Response", g.autoMoveToNoResponse, ro)}
    ${_toggle("cfg_autoFollowUp",  "Auto Follow-up Scheduling",   g.autoFollowUp,          ro)}
    ${_toggle("cfg_autoReminder",  "Auto Reminder Toasts",        g.autoReminder,          ro)}
    ${_toggle("cfg_autoEscalation","Auto Escalation to Admin",    g.autoEscalation,        ro)}
  </div>`;
}

function _sectionNotifications(g, ro) {
  return `
  <div class="d-flex flex-column gap-3">
    ${_toggle("cfg_notifBrowser",  "Browser Notifications", g.browserNotifications, ro)}
    ${_toggle("cfg_notifToast",    "Toast Notifications",   g.toastNotifications,   ro)}
    ${_toggle("cfg_notifSound",    "Sound Alerts",          g.soundAlerts,          ro)}
    ${_toggle("cfg_notifWhatsapp", "WhatsApp Alerts",       g.whatsappAlerts,       ro)}
    ${_toggle("cfg_notifEmail",    "Email Alerts",          g.emailAlerts,          ro)}
    ${_toggle("cfg_notifTelegram", "Telegram New Lead Alerts", g.telegramAlerts, ro)}
    ${_toggle("cfg_notifTelegramOverdue", "Telegram Overdue Reminders", g.telegramOverdueAlerts, ro)}
  </div>`;
}

function _sectionAIDefaults(g, ro) {
  return `
  <p class="small text-muted mb-3">Users can override these in their own AI Settings.</p>
  <div class="row g-3">
    <div class="col-6">
      <label class="form-label small fw-semibold">Default Model</label>
      <select id="cfg_aiModel" class="form-select form-select-sm" ${ro}>
        ${["llama-3.3-70b-versatile","llama-3.1-8b-instant","deepseek-r1-distill-llama-70b"]
          .map(m=>`<option ${m===g.aiModel?"selected":""}>${m}</option>`).join("")}
      </select>
    </div>
    <div class="col-3">
      <label class="form-label small fw-semibold">Temperature</label>
      <input type="number" id="cfg_aiTemp" class="form-control form-control-sm"
             min="0" max="2" step="0.05" value="${g.aiTemperature||0.75}" ${ro}>
    </div>
    <div class="col-3">
      <label class="form-label small fw-semibold">Max Tokens</label>
      <input type="number" id="cfg_aiTokens" class="form-control form-control-sm"
             min="100" max="8000" step="100" value="${g.aiMaxTokens||1200}" ${ro}>
    </div>
  </div>`;
}

// ── Add / Delete rows (Super Admin only — called from onclick) ─

function addBreakRow() {
  const id = "br_" + Date.now();
  CRM_CONFIG.breakTimings.push({ id, name: "", start: "12:00", end: "12:30" });
  document.getElementById("breaksContainer") &&
    (document.getElementById("breaksContainer").innerHTML =
      _sectionBreaks(CRM_CONFIG, "", true));
  renderCRMSettingsView(); // full re-render to keep ids consistent
}

function deleteBreakRow(id) {
  CRM_CONFIG.breakTimings = (CRM_CONFIG.breakTimings || []).filter(b => b.id !== id);
  renderCRMSettingsView();
}

function addHolidayRow() {
  const id = "hol_" + Date.now();
  CRM_CONFIG.holidays.push({ id, name: "", date: new Date().toISOString().slice(0,10),
                              type: "National", recurring: false });
  renderCRMSettingsView();
}

function deleteHolidayRow(id) {
  CRM_CONFIG.holidays = (CRM_CONFIG.holidays || []).filter(h => h.id !== id);
  renderCRMSettingsView();
}

function _extractGoogleFontUrl(input) {
  let value = String(input || "").trim();
  if (!value) return "";

  // Accept the complete Google Fonts <link> snippet.
  const hrefMatch = value.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  if (hrefMatch) value = hrefMatch[1];

  // Accept CSS @import url("...") snippets as well.
  const importMatch = value.match(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)/i);
  if (importMatch) value = importMatch[1];

  // Decode the common HTML entity produced by copied embed code.
  value = value.replace(/&amp;/gi, "&").trim();

  try {
    const url = new URL(value, window.location.origin);
    if (url.protocol !== "https:" || url.hostname !== "fonts.googleapis.com") return "";
    return url.toString();
  } catch (_) {
    return "";
  }
}

function _extractGoogleFontFamily(url) {
  try {
    const u = new URL(url);
    const family = u.searchParams.get("family");
    if (!family) return "";
    // If multiple families were supplied, use the first one.
    const first = family.split("&family=")[0].split(":")[0];
    return decodeURIComponent(first.replace(/\+/g, " ")).trim();
  } catch (_) {
    return "";
  }
}

function _safeFontFamily(value) {
  const cleaned = String(value || "").trim().replace(/[{}<>;\"`]/g, "");
  return cleaned || "Inter";
}

function applyCRMFont(googleUrl, family) {
  const safeFamily = _safeFontFamily(family);
  const root = document.documentElement;
  root.style.setProperty("--crm-font-family", `"${safeFamily}", sans-serif`);

  let link = document.getElementById("crmDynamicGoogleFont");
  const safeUrl = _extractGoogleFontUrl(googleUrl);
  if (!safeUrl) return;
  if (!link) {
    link = document.createElement("link");
    link.id = "crmDynamicGoogleFont";
    link.rel = "stylesheet";
    document.head.appendChild(link);
  }
  if (link.href !== safeUrl) link.href = safeUrl;
}

function updateCRMFontPreview() {
  const familyInput = document.getElementById("cfg_fontFamily");
  const preview = document.getElementById("crmFontPreview");
  if (!familyInput || !preview) return;
  const family = _safeFontFamily(familyInput.value);
  preview.style.fontFamily = `"${family}", sans-serif`;
}

function _bindCRMFontPreview() {
  const input = document.getElementById("cfg_fontGoogleInput");
  const familyInput = document.getElementById("cfg_fontFamily");
  if (input) {
    input.addEventListener("blur", () => {
      const url = _extractGoogleFontUrl(input.value);
      if (!url) return;
      const family = _extractGoogleFontFamily(url);
      if (familyInput && family) familyInput.value = family;
      updateCRMFontPreview();
      applyCRMFont(url, family || familyInput?.value || "Inter");
    });
  }
  if (familyInput) familyInput.addEventListener("input", updateCRMFontPreview);
}

async function saveCRMFont() {
  const role = CURRENT_USER?.role;
  if (!(role === "superadmin" || role === "admin")) {
    toast("Only Super Admin or Admin can change the CRM font.", "danger");
    return;
  }

  const input = document.getElementById("cfg_fontGoogleInput")?.value || "";
  const manualFamily = _safeFontFamily(document.getElementById("cfg_fontFamily")?.value || "Inter");
  const googleUrl = _extractGoogleFontUrl(input);
  if (!googleUrl) {
    toast("Paste a valid Google Fonts embed code or fonts.googleapis.com CSS URL.", "warning");
    return;
  }

  const extractedFamily = _extractGoogleFontFamily(googleUrl);
  const fontFamily = _safeFontFamily(extractedFamily || manualFamily);
  const btn = document.querySelector('[onclick="saveCRMFont()"]');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…'; }

  try {
    await CRM_SETTINGS_DOC.set({ fontFamily, fontGoogleUrl: googleUrl }, { merge: true });
    applyCRMFont(googleUrl, fontFamily);
    toast(`CRM font updated to ${fontFamily}.`, "success");
  } catch (err) {
    console.error("Save CRM font failed:", err);
    toast("Failed to update CRM font. Please try again.", "danger");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i>Save / Update Font'; }
  }
}

async function resetCRMFontToDefault() {
  const role = CURRENT_USER?.role;
  if (!(role === "superadmin" || role === "admin")) {
    toast("Only Super Admin or Admin can change the CRM font.", "danger");
    return;
  }
  const googleUrl = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap";
  try {
    await CRM_SETTINGS_DOC.set({ fontFamily: "Inter", fontGoogleUrl: googleUrl }, { merge: true });
    applyCRMFont(googleUrl, "Inter");
    toast("CRM font reset to Inter.", "success");
  } catch (err) {
    console.error("Reset CRM font failed:", err);
    toast("Failed to reset CRM font.", "danger");
  }
}

// ── Save (Super Admin only) ───────────────────────────────────
async function saveAllCRMSettings() {
  if (!requirePermission("crmSettings.edit")) return;

  // Hard guard — Firestore rules enforce this server-side too
  if (CURRENT_USER.role !== "superadmin") {
    toast("Permission denied.", "danger");
    return;
  }

  const btns = document.querySelectorAll('[onclick="saveAllCRMSettings()"]');
  btns.forEach(b => { b.disabled = true; b.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Saving…'; });

  try {
    const workingDays = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"]
      .filter(d => document.getElementById("wd_"+d)?.checked);

    // Collect breaks from live DOM inputs
    const breakTimings = (CRM_CONFIG.breakTimings || []).map(b => ({
      id:    b.id,
      name:  document.getElementById("brk_name_"+b.id)?.value.trim()  ?? b.name,
      start: document.getElementById("brk_start_"+b.id)?.value        ?? b.start,
      end:   document.getElementById("brk_end_"+b.id)?.value          ?? b.end,
    }));

    // Collect holidays from live DOM inputs
    const holidays = (CRM_CONFIG.holidays || []).map(h => ({
      id:        h.id,
      name:      document.getElementById("hol_name_"+h.id)?.value.trim() ?? h.name,
      date:      document.getElementById("hol_date_"+h.id)?.value        ?? h.date,
      type:      document.getElementById("hol_type_"+h.id)?.value        ?? h.type,
      recurring: document.getElementById("hol_rec_"+h.id)?.checked       ?? h.recurring,
    }));

    const payload = {
      workingDays,
      officeStart:  document.getElementById("cfg_officeStart")?.value     || "09:00",
      officeEnd:    document.getElementById("cfg_officeEnd")?.value       || "18:00",
      breakTimings,
      holidays,
      uncontactedAlertMinutes: parseInt(document.getElementById("cfg_uncontactedAlert")?.value) || 30,
      reminderAfterMinutes:    parseInt(document.getElementById("cfg_reminderAfter")?.value)    || 30,
      reminderFreqMinutes:     parseInt(document.getElementById("cfg_reminderFreq")?.value)     || 30,
      maxReminderCount:        parseInt(document.getElementById("cfg_maxReminder")?.value)      || 5,
      maxConsecutiveNotPickingAttempts: parseInt(document.getElementById("cfg_maxConsecutiveAttempts")?.value) || 3,
      assignmentIntervalMinutes: parseInt(document.getElementById("cfg_assignInterval")?.value) || 30,
      lunchStart:              document.getElementById("cfg_lunchStart")?.value                  || "13:00",
      autoMoveToNoResponse:    document.getElementById("cfg_autoMoveNoResponse")?.checked ?? true,
      autoFollowUp:            document.getElementById("cfg_autoFollowUp")?.checked    ?? true,
      autoReminder:            document.getElementById("cfg_autoReminder")?.checked    ?? true,
      autoEscalation:          document.getElementById("cfg_autoEscalation")?.checked  ?? false,
      browserNotifications:    document.getElementById("cfg_notifBrowser")?.checked    ?? true,
      toastNotifications:      document.getElementById("cfg_notifToast")?.checked      ?? true,
      soundAlerts:             document.getElementById("cfg_notifSound")?.checked      ?? false,
      whatsappAlerts:          document.getElementById("cfg_notifWhatsapp")?.checked   ?? false,
      emailAlerts:             document.getElementById("cfg_notifEmail")?.checked      ?? false,
      telegramAlerts:           document.getElementById("cfg_notifTelegram")?.checked   ?? true,
      telegramOverdueAlerts:    document.getElementById("cfg_notifTelegramOverdue")?.checked ?? true,
      aiProvider:    "Groq",
      aiModel:       document.getElementById("cfg_aiModel")?.value   || "llama-3.3-70b-versatile",
      aiTemperature: parseFloat(document.getElementById("cfg_aiTemp")?.value)    || 0.75,
      aiMaxTokens:   parseInt(document.getElementById("cfg_aiTokens")?.value)    || 1200,
      timezone:      document.getElementById("cfg_timezone")?.value   || "Asia/Kolkata",
      dateFormat:    document.getElementById("cfg_dateFormat")?.value || "DD MMM YYYY",
      timeFormat:    document.getElementById("cfg_timeFormat")?.value || "12h",
      currency:      document.getElementById("cfg_currency")?.value   || "INR",
    };

    // Single document write — onSnapshot propagates to all users in real time
    await CRM_SETTINGS_DOC.set(payload, { merge: true });
    toast("Settings saved. All users will see the updated values immediately.", "success");
  } catch (err) {
    console.error("Save CRM settings failed:", err);
    toast("Failed to save settings. Please try again.", "danger");
  } finally {
    btns.forEach(b => { b.disabled = false; b.innerHTML = '<i class="bi bi-floppy-fill me-1"></i>Save All Settings'; });
  }
}
