// ============================================================
// ASSIGNMENT.JS — Smart Lead Assignment Engine
//
// Business rules (all values read from CRM_CONFIG at runtime):
//  • No assignment outside office hours
//  • No assignment on holidays
//  • No assignment to members on approved full-day leave
//  • Half-day morning leave: member eligible only after lunch
//  • Half-day afternoon leave: member eligible only before lunch
//  • Pending leads assigned gradually (interval from settings)
//  • Assignment activity is kept in lead history; the retired Audit Log collection is not read or written.
// ============================================================

const assignmentQueueRef = db.collection("assignmentQueue");
const leavesRef          = db.collection("leaves");


function getAssignmentRoleForLead(lead) {
  if (!lead) return DEFAULT_ASSIGNMENT_ROLE;
  if (lead.assignmentRole) return lead.assignmentRole;
  if (lead.campaignId && typeof ALL_CAMPAIGNS !== "undefined") {
    const campaign = ALL_CAMPAIGNS.find((c) => c.id === lead.campaignId);
    if (campaign && campaign.defaultAssignmentRole) return campaign.defaultAssignmentRole;
  }
  return DEFAULT_ASSIGNMENT_ROLE;
}


// ── Determine if current moment is valid for assignment ───────
function isValidAssignmentTime() {
  if (isHolidayToday())   return false;
  if (!isOfficeHoursNow()) return false;
  if (isBreakTimeNow())    return false;
  return true;
}

// ── Fetch today's approved leaves ────────────────────────────
async function getTodayLeaves() {
  const today = new Date().toISOString().slice(0, 10);
  
  // Get single day leaves for today
  const singleDaySnap = await leavesRef
    .where("date", "==", today)
    .where("status", "==", "Approved")
    .get();
  
  const leaves = [];
  singleDaySnap.forEach(d => leaves.push({ id: d.id, ...d.data() }));
  
  // Get multiple day leaves that span today
  const multipleDaySnap = await leavesRef
    .where("leaveType", "==", "Multiple Days")
    .where("status", "==", "Approved")
    .get();
  
  multipleDaySnap.forEach(d => {
    const leaveData = d.data();
    if (leaveData.dateFrom && leaveData.dateTo) {
      // Check if today falls within the range
      if (today >= leaveData.dateFrom && today <= leaveData.dateTo) {
        leaves.push({ id: d.id, ...leaveData });
      }
    }
  });
  
  return leaves;
}

// ── Check if a specific user is available right now ──────────
function isUserAvailableNow(userId, todayLeaves) {
  const leave = todayLeaves.find(l => l.memberId === userId);
  if (!leave) return true;

  const type = leave.leaveType;
  
  // Full day absences
  if (type === "Full Day" || type === "Sick Leave" || type === "Emergency Leave" || type === "Multiple Days") {
    return false;
  }
  
  // Work from home - member is available
  if (type === "Work From Home") return true;

  // Half day leaves - check time boundary
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const [lh, lm] = (CRM_CONFIG.lunchStart || "13:00").split(":").map(Number);
  const lunchMin = lh * 60 + lm;

  // Half Day Morning: absent AM, available after lunch
  if (type === "Half Day Morning") return nowMin >= lunchMin;
  
  // Half Day Afternoon: available AM, absent after lunch
  if (type === "Half Day Afternoon") return nowMin < lunchMin;

  return true;
}

function isMemberAvailableNow(memberId, todayLeaves) {
  return isUserAvailableNow(memberId, todayLeaves);
}

function canManualAssignNow(overrideOfficeHours = false) {
  if (CURRENT_USER.role !== "admin" && CURRENT_USER.role !== "superadmin") {
    return false;
  }

  if (isHolidayToday()) return false;
  if (isBreakTimeNow()) return false;

  const officeOpen = isOfficeHoursNow();
  if (!officeOpen && !overrideOfficeHours) return false;

  return true;
}

async function getManualAssignableMembers() {
  await refreshActiveMembers();
  const todayLeaves = await getTodayLeaves();
  const assignable = [];

  for (const member of ACTIVE_MEMBERS || []) {
    const isAvailable = isUserAvailableNow(member.id, todayLeaves);
    if (!isAvailable) continue;

    const activeLeadsCount = await countAssignedLeads(member.id, false);
    const todayAssignedCount = await countAssignedLeads(member.id, true);

    assignable.push({
      ...member,
      role: member.role || "member",
      activeLeadsCount,
      todayAssignedCount,
      availabilityStatus: "Available"
    });
  }

  return assignable;
}

async function countAssignedLeads(memberId, todayOnly = false) {
  if (!leadsRef || !memberId) return 0;

  let query = leadsRef.where("assignedTo", "==", memberId);
  if (todayOnly) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    query = query.where("assignedAt", ">=", firebase.firestore.Timestamp.fromDate(start));
  }

  const snapshot = await query.get();
  return snapshot.size || 0;
}

function isAssignedLead(lead) {
  const assignedTo = lead?.assignedTo;
  return !!(assignedTo && assignedTo !== "Pending" && assignedTo !== "" && assignedTo !== null);
}

function isPendingLead(lead) {
  if (!lead) return false;
  const assignedTo = typeof lead.assignedTo === "string" ? lead.assignedTo.trim().toLowerCase() : lead.assignedTo;
  const assignmentStatus = typeof lead.assignmentStatus === "string" ? lead.assignmentStatus.trim().toLowerCase() : lead.assignmentStatus;

  return !!(
    lead.assignmentPending ||
    assignedTo === "pending" ||
    assignedTo === null ||
    assignedTo === "" ||
    assignmentStatus === "pending" ||
    lead.assignedMemberId === null ||
    lead.assignedMember === null
  );
}

async function getPendingLeadCandidates() {
  if (!leadsRef) return [];

  const snapshot = await leadsRef.get();
  if (!snapshot || snapshot.empty) return [];

  const pendingLeadMap = new Map();
  snapshot.forEach(doc => {
    const lead = doc.data();
    if (isPendingLead(lead)) {
      pendingLeadMap.set(doc.id, { id: doc.id, ...lead });
    }
  });

  const pendingLeads = Array.from(pendingLeadMap.values()).sort((a, b) => {
    const aTime = getLeadTimestampValue(a.createdAt || a.assignedAt || a.updatedAt);
    const bTime = getLeadTimestampValue(b.createdAt || b.assignedAt || b.updatedAt);
    return (aTime || 0) - (bTime || 0);
  });

  return pendingLeads;
}

function getLeadTimestampValue(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function getLeadReminders(lead) {
  const now = Date.now();
  const reminderDelayMs = (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000;
  const assignedAtMs = getLeadTimestampValue(lead?.assignedAt || lead?.createdAt);
  const dueTimeMs = getLeadTimestampValue(lead?.dueTime);
  const nextReminderMs = getLeadTimestampValue(lead?.nextReminder);

  if (!assignedAtMs) return { dueTimeMs: null, nextReminderMs: null };

  const fallbackDueTime = assignedAtMs + reminderDelayMs;
  const fallbackNextReminder = assignedAtMs + reminderDelayMs;

  return {
    dueTimeMs: dueTimeMs || fallbackDueTime,
    nextReminderMs: nextReminderMs || fallbackNextReminder
  };
}

function recalculateLeadState(lead) {
  const nextState = {
    ...lead,
    overdue: false,
    isOverdue: false,
    reminderSent: false,
    dueTime: null,
    nextReminder: null
  };

  const isPendingAssignment = isPendingLead(lead);

  if (isPendingAssignment) {
    return nextState;
  }

  const officeOpen = typeof isOfficeHoursNow === "function" ? isOfficeHoursNow() : true;
  const isAssigned = isAssignedLead(lead);
  const { dueTimeMs, nextReminderMs } = getLeadReminders(lead);

  if (!officeOpen || !isAssigned || !dueTimeMs) {
    return nextState;
  }

  const now = Date.now();
  const isOverdue = officeOpen && isAssigned && lead.status === "Not Open" && now > dueTimeMs;
  const reminderSent = !!(lead.reminderSent || (nextReminderMs && now >= nextReminderMs));

  return {
    ...nextState,
    dueTime: dueTimeMs ? (lead?.dueTime ? lead.dueTime : firebase.firestore.Timestamp.fromDate(new Date(dueTimeMs))) : null,
    nextReminder: nextReminderMs ? (lead?.nextReminder ? lead.nextReminder : firebase.firestore.Timestamp.fromDate(new Date(nextReminderMs))) : null,
    reminderSent,
    isOverdue,
    overdue: isOverdue
  };
}

async function getNextAvailableUserByRole(role, todayLeaves) {
  if (role === "hr") {
    await refreshActiveHR();
  } else {
    await refreshActiveMembers();
  }

  const activeList = role === "hr" ? ACTIVE_HR : ACTIVE_MEMBERS;
  if (!activeList || activeList.length === 0) return null;

  const roundRobinDocId = role === "member" ? "roundRobin_member" : `roundRobin_${role}`;
  const rrSnap = await metaRef.doc(roundRobinDocId).get();
  let lastIndex = rrSnap.exists ? (rrSnap.data().lastIndex ?? -1) : -1;

  // Backwards compatibility for the original shared round robin document.
  if (role === "member" && lastIndex < 0) {
    const legacySnap = await metaRef.doc("roundRobin").get();
    if (legacySnap.exists) lastIndex = legacySnap.data().lastIndex ?? -1;
  }

  for (let i = 1; i <= activeList.length; i++) {
    const idx = (lastIndex + i) % activeList.length;
    const user = activeList[idx];
    if (isUserAvailableNow(user.id, todayLeaves)) {
      await metaRef.doc(roundRobinDocId).set({ lastIndex: idx }, { merge: true });
      return user;
    }
  }
  return null; // all users unavailable
}

async function getNextAvailableMember(todayLeaves) {
  return getNextAvailableUserByRole("member", todayLeaves);
}

async function assignLead(leadDoc) {
  if (!leadDoc || !leadDoc.id) return false;

  console.log("Assigning Lead:");
  console.log("Lead ID:", leadDoc.id);

  const leadSnap = await leadsRef.doc(leadDoc.id).get();
  if (!leadSnap.exists) {
    return false;
  }

  const leadData = leadSnap.data();
  if (!isPendingLead(leadData)) {
    return false;
  }

  const assignmentRole = getAssignmentRoleForLead(leadData);
  const todayLeaves = await getTodayLeaves();
  const member = await getNextAvailableUserByRole(assignmentRole, todayLeaves);

  if (!member) {
    console.log("Assigned To:", "No available employee");
    return false;
  }

  console.log("Assigned To:", member.id);

  const now = firebase.firestore.Timestamp.now();
  await leadsRef.doc(leadDoc.id).update({
    assignedTo:        member.id,
    assignedToName:    member.name || member.email,
    assignedAt:        now,
    assignedBy:        "System Auto Assignment",
    assignmentPending: false,
    assignmentStatus:  "assigned",
    assignmentReason:  null,
    overdue:           false,
    isOverdue:         false,
    reminderSent:     false,
    dueTime:           firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000)),
    nextReminder:      firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000)),
    history:           firebase.firestore.FieldValue.arrayUnion({
      text:          `Auto-assigned to ${ASSIGNMENT_ROLE_LABELS[assignmentRole] || assignmentRole} ${member.name || member.email} at office opening`,
      statusAtTime:  "Not Open",
      updatedBy:     "system",
      updatedByName: "System Auto Assignment",
      timestamp:     new Date().toISOString()
    })
  });

  console.log("Assignment Completed");
  return true;
}

async function assignLeadToEmployee(leadId, memberId, overrideOfficeHours = false) {
  if (!(CURRENT_USER.role === "admin" || CURRENT_USER.role === "superadmin")) {
    throw new Error("Manual lead assignment is restricted to Admin and Super Admin.");
  }

  if (!leadId || !memberId) {
    throw new Error("Lead and employee are required for manual assignment.");
  }

  if (!canManualAssignNow(overrideOfficeHours)) {
    throw new Error("Manual assignment is only allowed during office hours unless Super Admin enables override.");
  }

  const leadDoc = await leadsRef.doc(leadId).get();
  if (!leadDoc.exists) {
    throw new Error("Lead does not exist.");
  }

  const leadData = leadDoc.data();
  if (!isPendingLead(leadData)) {
    throw new Error("This lead is no longer pending and cannot be manually assigned.");
  }

  const employee = (await getManualAssignableMembers()).find((m) => m.id === memberId);
  if (!employee) {
    throw new Error("Selected employee is not available for assignment.");
  }

  const now = firebase.firestore.Timestamp.now();
  const assignedToName = employee.name || employee.email;

  await leadsRef.doc(leadId).update({
    assignedTo: employee.id,
    assignedToName,
    assignedAt: now,
    assignedBy: `${CURRENT_USER.name || CURRENT_USER.email} (${CURRENT_USER.role})`,
    assignedById: CURRENT_USER.uid,
    assignmentType: "Manual",
    assignmentPending: false,
    assignmentReason: null,
    assignmentStatus: "assigned",
    overdue: false,
    isOverdue: false,
    reminderSent: false,
    dueTime: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000)),
    nextReminder: firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000)),
    history: firebase.firestore.FieldValue.arrayUnion({
      text: `Lead manually assigned by ${CURRENT_USER.name || CURRENT_USER.email} to ${assignedToName}`,
      statusAtTime: leadData.status || "Not Open",
      updatedBy: CURRENT_USER.uid,
      updatedByName: CURRENT_USER.name || CURRENT_USER.email,
      timestamp: new Date().toISOString()
    })
  });

  await notificationsRef?.add({
    userId: employee.id,
    title: "New Lead Assigned",
    message: `Lead #${leadData.slNo} (${leadData.fullName}) has been assigned to you manually.`,
    createdAt: now,
    read: false
  });

  if (getCRMSetting("browserNotifications") !== false) {
    try {
      if (typeof showBrowserNotification === "function") {
        showBrowserNotification("New Lead Assigned", `Lead #${leadData.slNo} has been assigned to ${assignedToName}.`);
      }
    } catch (_) {}
  }

  if (getCRMSetting("emailAlerts") === true && employee.email) {
    console.log("Email notification queued for:", employee.email);
  }

  if (getCRMSetting("whatsappAlerts") === true && employee.phoneNumber) {
    console.log("WhatsApp notification queued for:", employee.phoneNumber);
  }

  return { leadId, assignedTo: assignedToName };
}

// ── Smart createLead — used instead of the original ───────────
async function smartCreateLead(formData) {
  const assignmentRole = formData.assignmentRole || DEFAULT_ASSIGNMENT_ROLE;
  if (assignmentRole === "hr") {
    await refreshActiveHR();
    if (!ACTIVE_HR || ACTIVE_HR.length === 0) {
      throw new Error("No active HR users exist. Add an HR user before creating leads for this campaign.");
    }
  } else {
    await refreshActiveMembers();
    if (!ACTIVE_MEMBERS || ACTIVE_MEMBERS.length === 0) {
      throw new Error("No active sales members exist. Add a member before creating leads.");
    }
  }

  const counterDocRef = metaRef.doc("leadCounter");
  const newLeadRef    = leadsRef.doc();
  const now           = firebase.firestore.Timestamp.now();
  const canAssign     = isValidAssignmentTime();
  const todayLeaves   = canAssign ? await getTodayLeaves() : [];
  const assignedMember = canAssign ? await getNextAvailableUserByRole(assignmentRole, todayLeaves) : null;

  let nextSlNo = 1;

  await db.runTransaction(async t => {
    const counterSnap = await t.get(counterDocRef);
    nextSlNo = (counterSnap.exists ? counterSnap.data().count : 0) + 1;

    const baseFields = {
      slNo:          nextSlNo,
      serviceNeeded: formData.serviceNeeded,
      email:         formData.email || "",
      fullName:      formData.fullName,
      phoneNumber:   formData.phoneNumber,
      companyName:   formData.companyName || "",
      status:        "Not Open",
      createdBy:     CURRENT_USER.uid,
      createdByName: CURRENT_USER.name || CURRENT_USER.email,
      createdAt:     now,
      lastContactedAt: null,
      nextFollowUpAt:  null,
      consecutiveNotPickingAttempts: 0,  // Track consecutive "Not Picking Call" attempts
      assignmentRole: assignmentRole,
      assignmentPending: false,
      assignmentStatus: "assigned",
      overdue: false,
      isOverdue: false,
      reminderSent: false,
      dueTime: null,
      nextReminder: null,
      // Campaign Form Builder — null/"" when the legacy "General / No Campaign" path is used
      campaignId:         formData.campaignId || null,
      campaignName:        formData.campaignName || null,
      campaignData:        formData.campaignData || null,
      campaignFieldsMeta:  formData.campaignFieldsMeta || null,
    };

    if (assignedMember) {
      // ── Immediate assignment ──────────────────────────────
      t.set(newLeadRef, {
        ...baseFields,
        assignedTo:          assignedMember.id,
        assignedToName:      assignedMember.name || assignedMember.email,
        assignedAt:          now,
        assignedBy:          "System Auto Assignment",
        assignmentPending:   false,
        assignmentStatus:    "assigned",
        assignmentReason:    null,
        overdue:             false,
        isOverdue:           false,
        reminderSent:       false,
        dueTime:             firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000)),
        nextReminder:        firebase.firestore.Timestamp.fromDate(new Date(Date.now() + (getCRMSetting("reminderAfterMinutes") || 30) * 60 * 1000)),
        history: [{
          text: `Lead created and auto-assigned to ${assignedMember.name || assignedMember.email}`,
          statusAtTime: "Not Open",
          updatedBy:     CURRENT_USER.uid,
          updatedByName: CURRENT_USER.name || CURRENT_USER.email,
          timestamp:     new Date().toISOString()
        }]
      });
    } else {
      // ── Pending assignment ────────────────────────────────
      const reason = isHolidayToday()
        ? "Holiday — no assignment today"
        : !isOfficeHoursNow()
          ? "Outside Office Hours"
          : isBreakTimeNow()
            ? "Break Time"
            : assignmentRole === "hr"
              ? "No HR available"
              : "No Sales Members available";

      t.set(newLeadRef, {
        ...baseFields,
        assignedTo:        null,
        assignedToName:    null,
        assignedAt:        null,
        assignedBy:        null,
        assignmentPending: true,
        assignmentStatus:  "pending",
        assignmentReason:  reason,
        overdue:           false,
        isOverdue:         false,
        reminderSent:     false,
        dueTime:           null,
        nextReminder:      null,
        history: [{
          text: `Lead created — pending assignment (${reason})`,
          statusAtTime: "Not Open",
          updatedBy:     CURRENT_USER.uid,
          updatedByName: CURRENT_USER.name || CURRENT_USER.email,
          timestamp:     new Date().toISOString()
        }]
      });

      // Add to assignment queue
      t.set(assignmentQueueRef.doc(newLeadRef.id), {
        leadId:    newLeadRef.id,
        slNo:      nextSlNo,
        createdAt: now,
        reason
      });
    }

    t.set(counterDocRef, { count: nextSlNo }, { merge: true });
  });

  // Audit log
  const action = assignedMember ? "Assigned Immediately" : "Pending Assignment";
  const reason = assignedMember
    ? `Assigned to ${assignedMember.name || assignedMember.email}`
    : "Created outside valid assignment window";

  // Keep the marketing contact cache in sync without re-reading the new lead.
  if (window.MarketingChannels?.syncLeadUpdate) {
    window.MarketingChannels.syncLeadUpdate({
      id: newLeadRef.id,
      fullName: formData.fullName,
      email: formData.email || "",
      phoneNumber: formData.phoneNumber || "",
      companyName: formData.companyName || "",
      status: "Not Open"
    }).catch(err => console.error("Marketing contact sync failed:", err));
  }

  if (!assignedMember) {
    toast("Lead saved with Pending Assignment — will be assigned at next office opening.", "warning");
  }
}

// ── Pending assignment dispatcher (called at office open time) ─
// Recovers every pending lead, including older records that were left behind.
let pendingAssignmentPoller = null;

async function assignPendingLeads() {
  console.log("Checking pending leads...");

  if (!isValidAssignmentTime()) {
    console.log("Office Closed");
    return 0;
  }

  console.log("Office Open");
  const pendingLeads = await getPendingLeadCandidates();
  console.log(`Pending Leads Found: ${pendingLeads.length}`);

  if (pendingLeads.length === 0) {
    console.log("No Pending Leads");
    return 0;
  }

  let assignedCount = 0;
  for (const lead of pendingLeads) {
    if (await assignLead(lead)) {
      assignedCount++;
    }
  }

  console.log("Assignment Completed");
  return assignedCount;
}

function startPendingAssignmentPoller() {
  if (pendingAssignmentPoller) return;

  pendingAssignmentPoller = setInterval(async () => {
    await assignPendingLeads();
  }, 60 * 1000);
}

function startAssignmentWatcher() {
  startPendingAssignmentPoller();
}

// Export functions for use by other modules
window.getNextAvailableUserByRole = getNextAvailableUserByRole;
window.isValidAssignmentTime = isValidAssignmentTime;
window.getTodayLeaves = getTodayLeaves;
window.canManualAssignNow = canManualAssignNow;
window.getManualAssignableMembers = getManualAssignableMembers;
window.assignLead = assignLead;
window.assignLeadToEmployee = assignLeadToEmployee;
window.assignPendingLeads = assignPendingLeads;
window.startPendingAssignmentPoller = startPendingAssignmentPoller;
window.recalculateLeadState = recalculateLeadState;
