// ============================================================
// REPORT.JS — Daily lead report for Admin / Super Admin
// Generates a professional summary message with total leads
// and a full status breakdown for a chosen date.
// Enhanced with period selection: Today, Yesterday, Custom Date, Date Range
// ============================================================

// Friendly order + labels for the report message (kept distinct from table badge order)
const REPORT_STATUS_ORDER = [
  "Interested",
  "Not Interested",
  "Driver",
  "Transporter",
  "Job Seeker",
  "Busy",
  "Not Picking Call",
  "Not Open"
];

const REPORT_STATUS_LABEL = {
  "Interested": "Interested",
  "Not Interested": "Not Interested",
  "Driver": "Drivers",
  "Transporter": "Transporters",
  "Job Seeker": "Job Seekers",
  "Busy": "Busy (call again)",
  "Not Picking Call": "Not Picking Call",
  "Not Open": "Pending / Not Contacted"
};

// Period selection constants
const REPORT_PERIOD = {
  TODAY: "today",
  YESTERDAY: "yesterday",
  CUSTOM_DATE: "custom_date",
  DATE_RANGE: "date_range"
};

// Initialize report controls and set default period
function initReportControls() {
  const periodSelect = document.getElementById("reportPeriod");
  const dateInput = document.getElementById("reportDate");
  const dateRangeFrom = document.getElementById("reportDateRangeFrom");
  const dateRangeTo = document.getElementById("reportDateRangeTo");
  
  if (!periodSelect) return;
  
  // Set default period to Today
  periodSelect.value = REPORT_PERIOD.TODAY;
  
  // Initialize date inputs
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  if (dateInput) {
    dateInput.value = today.toISOString().slice(0, 10);
    dateInput.disabled = true; // Disabled for Today period
  }
  
  if (dateRangeFrom) {
    dateRangeFrom.value = today.toISOString().slice(0, 10);
  }
  
  if (dateRangeTo) {
    dateRangeTo.value = today.toISOString().slice(0, 10);
  }
  
  // Hide date range wrap initially
  const dateRangeWrap = document.getElementById("reportDateRangeWrap");
  if (dateRangeWrap) {
    dateRangeWrap.classList.add("d-none");
  }
  
  // Set up event listeners
  periodSelect.addEventListener("change", handlePeriodChange);
  
  if (dateInput) {
    dateInput.addEventListener("change", () => {
      if (periodSelect.value === REPORT_PERIOD.CUSTOM_DATE) {
        renderDailyReport();
      }
    });
  }
  
  if (dateRangeFrom && dateRangeTo) {
    dateRangeFrom.addEventListener("change", () => {
      if (periodSelect.value === REPORT_PERIOD.DATE_RANGE) {
        renderDailyReport();
      }
    });
    
    dateRangeTo.addEventListener("change", () => {
      if (periodSelect.value === REPORT_PERIOD.DATE_RANGE) {
        renderDailyReport();
      }
    });
  }
  
  // Initial render
  renderDailyReport();
}

// Handle period selection change
function handlePeriodChange() {
  const periodSelect = document.getElementById("reportPeriod");
  const dateInput = document.getElementById("reportDate");
  const dateRangeFrom = document.getElementById("reportDateRangeFrom");
  const dateRangeTo = document.getElementById("reportDateRangeTo");
  const dateRangeWrap = document.getElementById("reportDateRangeWrap");
  
  if (!periodSelect) return;
  
  const period = periodSelect.value;
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  // Update UI based on selected period
  switch(period) {
    case REPORT_PERIOD.TODAY:
      if (dateInput) {
        dateInput.value = today.toISOString().slice(0, 10);
        dateInput.disabled = true;
      }
      if (dateRangeWrap) dateRangeWrap.classList.add("d-none");
      break;
      
    case REPORT_PERIOD.YESTERDAY:
      if (dateInput) {
        dateInput.value = yesterday.toISOString().slice(0, 10);
        dateInput.disabled = true;
      }
      if (dateRangeWrap) dateRangeWrap.classList.add("d-none");
      break;
      
    case REPORT_PERIOD.CUSTOM_DATE:
      if (dateInput) {
        dateInput.disabled = false;
      }
      if (dateRangeWrap) dateRangeWrap.classList.add("d-none");
      break;
      
    case REPORT_PERIOD.DATE_RANGE:
      if (dateInput) {
        dateInput.disabled = true;
      }
      if (dateRangeWrap) dateRangeWrap.classList.remove("d-none");
      break;
  }
  
  // Generate report for the selected period
  renderDailyReport();
}

// Helper function to check if a date is within a range (inclusive)
function isDateInRange(date, fromDate, toDate) {
  return date >= fromDate && date <= toDate;
}

// Filtering functions
function getLeadsForToday() {
  const today = new Date();
  return ALL_LEADS.filter((l) => {
    if (!l.createdAt) return false;
    const created = l.createdAt.toDate();
    return created.getFullYear() === today.getFullYear() &&
           created.getMonth() === today.getMonth() &&
           created.getDate() === today.getDate();
  });
}

function getLeadsForYesterday() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  
  return ALL_LEADS.filter((l) => {
    if (!l.createdAt) return false;
    const created = l.createdAt.toDate();
    return created.getFullYear() === yesterday.getFullYear() &&
           created.getMonth() === yesterday.getMonth() &&
           created.getDate() === yesterday.getDate();
  });
}

function getLeadsForCustomDate() {
  const dateInput = document.getElementById("reportDate");
  if (!dateInput || !dateInput.value) return getLeadsForToday();
  
  const selected = dateInput.value; // "YYYY-MM-DD"
  
  return ALL_LEADS.filter((l) => {
    if (!l.createdAt) return false;
    const created = l.createdAt.toDate();
    const y = created.getFullYear();
    const m = String(created.getMonth() + 1).padStart(2, "0");
    const d = String(created.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}` === selected;
  });
}

function getLeadsForDateRange() {
  const dateRangeFrom = document.getElementById("reportDateRangeFrom");
  const dateRangeTo = document.getElementById("reportDateRangeTo");
  
  if (!dateRangeFrom || !dateRangeTo || !dateRangeFrom.value || !dateRangeTo.value) {
    return getLeadsForToday();
  }
  
  const fromDate = new Date(dateRangeFrom.value + "T00:00:00");
  const toDate = new Date(dateRangeTo.value + "T23:59:59");
  
  return ALL_LEADS.filter((l) => {
    if (!l.createdAt) return false;
    const created = l.createdAt.toDate();
    return isDateInRange(created, fromDate, toDate);
  });
}

// Main function to get leads based on selected period
function getLeadsForSelectedPeriod() {
  const periodSelect = document.getElementById("reportPeriod");
  if (!periodSelect) return getLeadsForToday();
  
  switch(periodSelect.value) {
    case REPORT_PERIOD.TODAY:
      return getLeadsForToday();
      
    case REPORT_PERIOD.YESTERDAY:
      return getLeadsForYesterday();
      
    case REPORT_PERIOD.CUSTOM_DATE:
      return getLeadsForCustomDate();
      
    case REPORT_PERIOD.DATE_RANGE:
      return getLeadsForDateRange();
      
    default:
      return getLeadsForToday();
  }
}

function computeStatusCounts(leads) {
  const counts = {};
  REPORT_STATUS_ORDER.forEach((s) => (counts[s] = 0));
  leads.forEach((l) => {
    if (counts[l.status] !== undefined) counts[l.status]++;
    else counts[l.status] = (counts[l.status] || 0) + 1;
  });
  return counts;
}

function renderDailyReport() {
  const grid = document.getElementById("reportStatsGrid");
  const box = document.getElementById("reportMessageBox");
  if (!grid || !box) return;

  const leads = getLeadsForSelectedPeriod();
  const counts = computeStatusCounts(leads);
  const total = leads.length;

  // ---- Stat cards ----
  grid.innerHTML = `
    <div class="col-6 col-md-3">
      <div class="report-stat-card report-stat-total">
        <div class="report-stat-value">${total}</div>
        <div class="report-stat-label">Total Leads</div>
      </div>
    </div>
    ${REPORT_STATUS_ORDER.map((s) => `
      <div class="col-6 col-md-3">
        <div class="report-stat-card">
          <div class="report-stat-value">${counts[s] || 0}</div>
          <div class="report-stat-label">${REPORT_STATUS_LABEL[s]}</div>
        </div>
      </div>`).join("")}
  `;

  // ---- Message text ----
  box.textContent = buildReportMessage(leads, counts, total);
}

function buildReportMessage(leads, counts, total) {
  const periodSelect = document.getElementById("reportPeriod");
  const dateInput = document.getElementById("reportDate");
  const dateRangeFrom = document.getElementById("reportDateRangeFrom");
  const dateRangeTo = document.getElementById("reportDateRangeTo");
  const managerName = (document.getElementById("reportManagerName")?.value || "Team").trim();
  
  let dateLabel = "";
  const period = periodSelect ? periodSelect.value : REPORT_PERIOD.TODAY;
  
  switch(period) {
    case REPORT_PERIOD.TODAY:
      const today = new Date();
      dateLabel = today.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      break;
      
    case REPORT_PERIOD.YESTERDAY:
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      dateLabel = yesterday.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      break;
      
    case REPORT_PERIOD.CUSTOM_DATE:
      if (dateInput && dateInput.value) {
        const dateObj = new Date(dateInput.value + "T00:00:00");
        dateLabel = dateObj.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      } else {
        const today = new Date();
        dateLabel = today.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      }
      break;
      
    case REPORT_PERIOD.DATE_RANGE:
      if (dateRangeFrom && dateRangeTo && dateRangeFrom.value && dateRangeTo.value) {
        const fromDate = new Date(dateRangeFrom.value + "T00:00:00");
        const toDate = new Date(dateRangeTo.value + "T00:00:00");
        dateLabel = `${fromDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })} - ${toDate.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}`;
      } else {
        const today = new Date();
        dateLabel = today.toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
      }
      break;
  }

  const lines = [];
  
  if (period === REPORT_PERIOD.DATE_RANGE) {
    lines.push(`Hi ${managerName}, here is the lead summary for Abra Logistics (${dateLabel}):`);
  } else {
    lines.push(`Hi ${managerName}, here is today's lead summary for Abra Logistics (${dateLabel}):`);
  }
  
  lines.push("");
  lines.push(`Total leads received: ${total}`);
  lines.push("");

  REPORT_STATUS_ORDER.forEach((s) => {
    lines.push(`${REPORT_STATUS_LABEL[s]}: ${counts[s] || 0}`);
  });

  lines.push("");
  const pendingCount = counts["Not Open"] || 0;
  if (pendingCount > 0) {
    lines.push(`Note: ${pendingCount} lead(s) are still pending first contact — following up shortly.`);
  } else {
    lines.push("All leads received have been contacted at least once.");
  }
  lines.push("");
  lines.push("Regards,");
  lines.push(CURRENT_USER?.name || "Abra Logistics Sales Team");

  return lines.join("\n");
}

function copyReportMessage() {
  const box = document.getElementById("reportMessageBox");
  if (!box) return;
  navigator.clipboard.writeText(box.textContent).then(
    () => toast("Report copied to clipboard.", "success"),
    () => toast("Could not copy — please select and copy manually.", "danger")
  );
}

function shareReportOnWhatsApp() {
  const box = document.getElementById("reportMessageBox");
  if (!box) return;
  const encoded = encodeURIComponent(box.textContent);
  window.open(`https://wa.me/?text=${encoded}`, "_blank");
}