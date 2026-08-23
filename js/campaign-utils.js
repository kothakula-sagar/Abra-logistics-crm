// ============================================================
// CAMPAIGN-UTILS.JS — Shared Campaign Calculation Functions
//
// Purpose: Prevent code duplication between campaign-analytics.js
// and campaign-reports.js by centralizing common calculations.
//
// All functions are pure (no Firestore calls) and rely on the
// already-cached ALL_CAMPAIGNS, CAMPAIGN_FIELDS_CACHE, and ALL_LEADS
// arrays that are kept live by campaigns.js and leads.js.
// ============================================================

// Statuses that indicate a lead has been converted/won
const CONVERTED_STATUSES = ["Interested"];

// ── Lead Scope Helpers ────────────────────────────────────────

/**
 * Get all campaign leads (or leads for a specific campaign)
 * @param {string|null} campaignId - Optional campaign ID to filter by
 * @returns {Array} Filtered leads array
 */
function _campaignLeadsScope(campaignId) {
  const base = (typeof ALL_LEADS !== "undefined" ? ALL_LEADS : []).filter(l => l.campaignId);
  return campaignId ? base.filter(l => l.campaignId === campaignId) : base;
}

/**
 * Count leads created today for campaigns
 * @returns {number} Count of today's campaign leads
 */
function _todayCampaignLeadsCount() {
  const today = new Date();
  return _campaignLeadsScope(null).filter(l => {
    if (!l.createdAt) return false;
    const d = l.createdAt.toDate();
    return d.getFullYear() === today.getFullYear() && 
           d.getMonth() === today.getMonth() && 
           d.getDate() === today.getDate();
  }).length;
}

// ── Statistical Calculations ──────────────────────────────────

/**
 * Compute comprehensive statistics for a campaign (or all campaigns)
 * @param {string|null} campaignId - Optional campaign ID, null for all campaigns
 * @returns {Object} Statistics object with total, counts, converted, convRate, avgResponseMin
 */
function computeCampaignStats(campaignId) {
  const leads = _campaignLeadsScope(campaignId);
  const total = leads.length;

  const counts = {
    "Interested": 0, 
    "Not Interested": 0, 
    "Busy": 0, 
    "Not Picking Call": 0,
    "Not Open": 0, 
    "Job Seeker": 0, 
    "Driver": 0, 
    "Transporter": 0
  };
  
  let converted = 0;
  let responseSumMin = 0;
  let responseCount = 0;

  leads.forEach(l => {
    // Count by status
    if (counts[l.status] !== undefined) counts[l.status]++;
    
    // Count conversions
    if (CONVERTED_STATUSES.includes(l.status)) converted++;
    
    // Calculate average response time
    if (l.createdAt && l.lastContactedAt) {
      const mins = (l.lastContactedAt.toDate() - l.createdAt.toDate()) / 60000;
      if (mins >= 0) { 
        responseSumMin += mins; 
        responseCount++; 
      }
    }
  });

  const convRate = total > 0 ? Math.round((converted / total) * 100) : 0;
  const avgResponseMin = responseCount > 0 ? Math.round(responseSumMin / responseCount) : null;

  return { 
    total, 
    counts, 
    converted, 
    convRate, 
    avgResponseMin 
  };
}

/**
 * Calculate conversion rate for a set of leads
 * @param {Array} leads - Array of lead objects
 * @returns {number} Conversion rate percentage (0-100)
 */
function calculateConversionRate(leads) {
  if (!leads || leads.length === 0) return 0;
  const converted = leads.filter(l => CONVERTED_STATUSES.includes(l.status)).length;
  return Math.round((converted / leads.length) * 100);
}

/**
 * Calculate average response time in minutes
 * @param {Array} leads - Array of lead objects
 * @returns {number|null} Average response time in minutes, or null if no data
 */
function calculateResponseTime(leads) {
  if (!leads || leads.length === 0) return null;
  
  let responseSumMin = 0;
  let responseCount = 0;
  
  leads.forEach(l => {
    if (l.createdAt && l.lastContactedAt) {
      const mins = (l.lastContactedAt.toDate() - l.createdAt.toDate()) / 60000;
      if (mins >= 0) { 
        responseSumMin += mins; 
        responseCount++; 
      }
    }
  });
  
  return responseCount > 0 ? Math.round(responseSumMin / responseCount) : null;
}

/**
 * Group leads by campaign
 * @param {Array} leads - Array of lead objects
 * @returns {Object} Object with campaignId as keys and lead arrays as values
 */
function groupLeadsByCampaign(leads) {
  const grouped = {};
  
  if (!leads) return grouped;
  
  leads.forEach(l => {
    if (!l.campaignId) return;
    if (!grouped[l.campaignId]) grouped[l.campaignId] = [];
    grouped[l.campaignId].push(l);
  });
  
  return grouped;
}

/**
 * Group leads by date (YYYY-MM-DD format)
 * @param {Array} leads - Array of lead objects
 * @returns {Object} Object with date strings as keys and lead arrays as values
 */
function groupLeadsByDate(leads) {
  const grouped = {};
  
  if (!leads) return grouped;
  
  leads.forEach(l => {
    if (!l.createdAt) return;
    const dateStr = l.createdAt.toDate().toISOString().slice(0, 10);
    if (!grouped[dateStr]) grouped[dateStr] = [];
    grouped[dateStr].push(l);
  });
  
  return grouped;
}

/**
 * Group leads by assigned member
 * @param {Array} leads - Array of lead objects
 * @returns {Object} Object with member ID as keys and lead arrays as values
 */
function groupLeadsByMember(leads) {
  const grouped = {};
  
  if (!leads) return grouped;
  
  leads.forEach(l => {
    if (!l.assignedTo) return;
    if (!grouped[l.assignedTo]) grouped[l.assignedTo] = [];
    grouped[l.assignedTo].push(l);
  });
  
  return grouped;
}

// ── Formatting Helpers ────────────────────────────────────────

/**
 * Format minutes into human-readable duration
 * @param {number|null} mins - Minutes to format
 * @returns {string} Formatted duration string
 */
function formatDuration(mins) {
  if (mins === null || mins === undefined) return "—";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

/**
 * Format a date for display
 * @param {Date|Timestamp} date - Date to format
 * @returns {string} Formatted date string
 */
function formatCampaignDate(date) {
  if (!date) return "—";
  try {
    const d = date.toDate ? date.toDate() : new Date(date);
    return d.toLocaleDateString("en-IN", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch (e) {
    return "—";
  }
}

// ── Export check (for module systems) ─────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONVERTED_STATUSES,
    _campaignLeadsScope,
    _todayCampaignLeadsCount,
    computeCampaignStats,
    calculateConversionRate,
    calculateResponseTime,
    groupLeadsByCampaign,
    groupLeadsByDate,
    groupLeadsByMember,
    formatDuration,
    formatCampaignDate
  };
}
