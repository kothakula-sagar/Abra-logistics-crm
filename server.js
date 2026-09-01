require('dotenv').config();

const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();

const PORT = Number(process.env.PORT || 3000);

const BOT_TOKEN =
  process.env.BOT_TOKEN ||
  process.env.TELEGRAM_BOT_TOKEN;

const PUBLIC_BASE_URL =
  (
    process.env.PUBLIC_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    ''
  ).replace(/\/$/, '');

const WEBHOOK_PATH = '/telegram/webhook';

const WEBHOOK_SECRET =
  process.env.TELEGRAM_WEBHOOK_SECRET || '';

const FRONTEND_ORIGIN =
  process.env.FRONTEND_ORIGIN || '*';

const REMINDER_SCAN_MS =
  Number(process.env.TELEGRAM_REMINDER_SCAN_MS || 300000);

// ============================================================
// FIRESTORE LOAD PROTECTION
// ============================================================
const USER_CACHE_TTL_MS = Number(process.env.CRM_USER_CACHE_TTL_MS || 60000);
const SETTINGS_CACHE_TTL_MS = Number(process.env.CRM_SETTINGS_CACHE_TTL_MS || 30000);
const REPORT_CACHE_TTL_MS = Number(process.env.TELEGRAM_REPORT_CACHE_TTL_MS || 60000);

const userCache = new Map();
let crmSettingsCache = null;
let crmSettingsCacheAt = 0;
const reportCache = new Map();
const campaignReportCache = new Map();

function isFirestoreQuotaError(error) {
  return Number(error?.code) === 8 ||
    String(error?.message || '').toLowerCase().includes('quota exceeded');
}

function publicFirebaseError(error) {
  if (isFirestoreQuotaError(error)) {
    return 'Firebase Firestore quota is temporarily exhausted. Please wait for the quota to reset or increase the Firestore quota before retrying.';
  }
  return error?.message || 'Unexpected server error.';
}

function clearUserCache(uid) {
  if (uid) userCache.delete(String(uid));
}

function getCachedUser(uid) {
  const item = userCache.get(String(uid || ''));
  if (!item) return null;
  if (Date.now() - item.cachedAt > USER_CACHE_TTL_MS) {
    userCache.delete(String(uid || ''));
    return null;
  }
  return item.user;
}

function setCachedUser(uid, user) {
  if (!uid || !user) return;
  userCache.set(String(uid), { cachedAt: Date.now(), user });
}

function pruneReportCache(cache) {
  const now = Date.now();
  for (const [key, item] of cache.entries()) {
    if (now - item.cachedAt > REPORT_CACHE_TTL_MS) cache.delete(key);
  }
}


// ============================================================
// TELEGRAM RUNTIME MODE
// ============================================================
// Local development uses polling by default.
// Production/Render uses webhook by default.
// You can explicitly override with TELEGRAM_MODE=polling|webhook.
const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  process.env.RENDER === 'true' ||
  !!process.env.RENDER_EXTERNAL_URL;

const REQUESTED_TELEGRAM_MODE = String(
  process.env.TELEGRAM_MODE ||
    (IS_PRODUCTION ? 'webhook' : 'polling')
).trim().toLowerCase();

// Never let a local .env accidentally reconfigure the production Telegram
// webhook. Local webhook testing must be explicitly enabled.
const TELEGRAM_MODE =
  !IS_PRODUCTION &&
  REQUESTED_TELEGRAM_MODE === 'webhook' &&
  process.env.ALLOW_LOCAL_TELEGRAM_WEBHOOK !== 'true'
    ? 'polling'
    : REQUESTED_TELEGRAM_MODE;

const TELEGRAM_POLL_INTERVAL_MS =
  Number(process.env.TELEGRAM_POLL_INTERVAL_MS || 1000);

// Local development should not start the continuous Firestore notification
// scanners. They can consume reads while you are only trying to test the UI
// or Telegram commands, and they are not required for local bot commands.
const DISABLE_BACKGROUND_TELEGRAM_SCANS =
  process.env.TELEGRAM_DISABLE_BACKGROUND_SCANS === 'true' ||
  !IS_PRODUCTION;

let telegramPollingRunning = false;
let telegramPollingOffset = 0;
let telegramPollingStopRequested = false;


// ============================================================
// TELEGRAM BOT TOKEN CHECK
// ============================================================

if (!BOT_TOKEN) {
  console.error(
    'Missing BOT_TOKEN / TELEGRAM_BOT_TOKEN.'
  );

  process.exit(1);
}


// ============================================================
// FIREBASE ADMIN INITIALIZATION
// ============================================================

function initFirebaseAdmin() {
  if (admin.apps.length) {
    return admin.app();
  }

  // ==========================================================
  // OPTION 1: Firebase service account JSON file
  // ==========================================================

  const serviceAccountFile =
    process.env.FIREBASE_SERVICE_ACCOUNT_FILE ||
    './firebase-service-account.json';

  if (serviceAccountFile) {
    const resolvedPath =
      path.isAbsolute(serviceAccountFile)
        ? serviceAccountFile
        : path.resolve(
            __dirname,
            serviceAccountFile
          );

    if (fs.existsSync(resolvedPath)) {
      try {
        const fileContents =
          fs.readFileSync(
            resolvedPath,
            'utf8'
          );

        const serviceAccount =
          JSON.parse(fileContents);

        console.log(
          `🔥 Firebase credentials loaded from ${resolvedPath}`
        );

        return admin.initializeApp({
          credential:
            admin.credential.cert(
              serviceAccount
            )
        });

      } catch (error) {
        throw new Error(
          `Firebase service account file is invalid: ${error.message}`
        );
      }
    }
  }


  // ==========================================================
  // OPTION 2: JSON directly inside environment variable
  // ==========================================================

  if (
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON
  ) {
    let serviceAccount;

    try {
      serviceAccount =
        JSON.parse(
          process.env
            .FIREBASE_SERVICE_ACCOUNT_JSON
        );
    } catch (error) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON: ${error.message}`
      );
    }

    console.log(
      '🔥 Firebase credentials loaded from FIREBASE_SERVICE_ACCOUNT_JSON'
    );

    return admin.initializeApp({
      credential:
        admin.credential.cert(
          serviceAccount
        )
    });
  }


  // ==========================================================
  // OPTION 3: Individual Firebase credentials
  // ==========================================================

  const projectId =
    process.env.FIREBASE_PROJECT_ID;

  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL;

  const privateKey =
    (
      process.env.FIREBASE_PRIVATE_KEY ||
      ''
    ).replace(
      /\\n/g,
      '\n'
    );


  if (
    !projectId ||
    !clientEmail ||
    !privateKey
  ) {
    throw new Error(
      'Firebase Admin credentials are missing. Set FIREBASE_SERVICE_ACCOUNT_FILE, FIREBASE_SERVICE_ACCOUNT_JSON, or FIREBASE_PROJECT_ID/FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.'
    );
  }


  console.log(
    '🔥 Firebase credentials loaded from individual environment variables'
  );


  return admin.initializeApp({
    credential:
      admin.credential.cert({
        projectId,
        clientEmail,
        privateKey
      })
  });
}
try {
  initFirebaseAdmin();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}


const db = admin.firestore();

const FieldValue =
  admin.firestore.FieldValue;


// ============================================================
// CORS
// ============================================================

const allowedOrigins =
  FRONTEND_ORIGIN === '*'
    ? null
    : FRONTEND_ORIGIN
        .split(',')
        .map(v => v.trim())
        .filter(Boolean);


app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        !allowedOrigins ||
        allowedOrigins.includes(origin)
      ) {
        return callback(null, true);
      }

      return callback(
        new Error('CORS origin is not allowed.')
      );
    },

    credentials: true
  })
);


// ============================================================
// BODY PARSING
// ============================================================

app.use(
  express.json({
    limit: '1mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);


// ============================================================
// TELEGRAM API HELPER
// ============================================================

async function telegram(
  method,
  body = {}
) {
  const response = await fetch(
    `https://api.telegram.org/bot${BOT_TOKEN}/${method}`,
    {
      method: 'POST',

      headers: {
        'Content-Type': 'application/json'
      },

      body: JSON.stringify(body)
    }
  );

  const data =
    await response.json();

  if (!data.ok) {
    throw new Error(
      data.description ||
      `Telegram API error: ${method}`
    );
  }

  return data.result;
}


// ============================================================
// HTML ESCAPE
// ============================================================

function escapeHtml(value = '') {
  return String(value)
    .replaceAll(
      '&',
      '&amp;'
    )
    .replaceAll(
      '<',
      '&lt;'
    )
    .replaceAll(
      '>',
      '&gt;'
    )
    .replaceAll(
      '"',
      '&quot;'
    )
    .replaceAll(
      "'",
      '&#039;'
    );
}


// ============================================================
// TIMESTAMP HELPER
// ============================================================

function timestampMs(value) {
  if (!value) {
    return null;
  }

  if (
    typeof value.toMillis === 'function'
  ) {
    return value.toMillis();
  }

  if (
    value._seconds != null
  ) {
    return (
      value._seconds * 1000 +
      Math.floor(
        (value._nanoseconds || 0) / 1e6
      )
    );
  }

  const n = Number(value);

  if (Number.isFinite(n)) {
    return n;
  }

  const parsed =
    new Date(value).getTime();

  return Number.isNaN(parsed)
    ? null
    : parsed;
}


// ============================================================
// FIREBASE AUTHENTICATION MIDDLEWARE
// ============================================================

async function verifyFirebaseUser(
  req,
  res,
  next
) {
  try {
    const authHeader =
      req.headers.authorization || '';

    if (
      !authHeader.startsWith('Bearer ')
    ) {
      return res.status(401).json({
        ok: false,
        error:
          'Firebase ID token is required.'
      });
    }

    const idToken =
      authHeader.slice(7);

    req.firebaseUser =
      await admin
        .auth()
        .verifyIdToken(idToken);

    let crmUser = getCachedUser(req.firebaseUser.uid);

    if (!crmUser) {
      const userSnap = await db
        .collection('users')
        .doc(req.firebaseUser.uid)
        .get();

      if (!userSnap.exists || userSnap.data().active === false) {
        return res.status(403).json({
          ok: false,
          error: 'CRM user is inactive or not provisioned.'
        });
      }

      crmUser = { id: userSnap.id, ...userSnap.data() };
      setCachedUser(req.firebaseUser.uid, crmUser);
    }

    req.crmUser = crmUser;
    next();

  } catch (error) {
    console.error(
      'Auth middleware error:',
      error.message
    );

    const quotaExceeded =
      error.code === 8 ||
      error.code === 'resource-exhausted' ||
      String(error.message || '').toLowerCase().includes('quota exceeded');

    return res.status(quotaExceeded ? 503 : 401).json({
      ok: false,
      error: quotaExceeded
        ? 'Firebase quota is temporarily exhausted. Please try again after the quota resets.'
        : 'Invalid or expired Firebase session.'
    });
  }
}


// ============================================================
// CRM SETTINGS
// ============================================================

async function getCRMSettings() {
  if (crmSettingsCache && Date.now() - crmSettingsCacheAt < SETTINGS_CACHE_TTL_MS) {
    return crmSettingsCache;
  }
  const snap =
    await db
      .collection('crmSettings')
      .doc('general')
      .get();

  const defaults = {
    workingDays: [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday'
    ],

    officeStart: '09:00',

    officeEnd: '18:00',

    breakTimings: [],

    holidays: [],

    reminderAfterMinutes: 30,

    whatsappMarketingMessagesPerBatch: 10,
    whatsappMarketingCooldownMinutes: 5,
    emailMarketingMessagesPerBatch: 10,
    emailMarketingCooldownMinutes: 5,

    maintenanceMode: false,

    telegramAlerts: true,

    telegramOverdueAlerts: true,

    telegramStatusAlerts: true,

    telegramAdminOverdueAlerts: true,

    telegramDailyReportEnabled: true,

    telegramDailyReportTime: '17:30',

    timezone: 'Asia/Kolkata',

    ...(snap.exists
      ? snap.data()
      : {})
  };

  crmSettingsCache = defaults;
  crmSettingsCacheAt = Date.now();
  return crmSettingsCache;
}


// ============================================================
// HOLIDAY CHECK
// ============================================================

function isHoliday(
  date,
  settings
) {
  const localDate =
    new Intl.DateTimeFormat(
      'en-CA',
      {
        timeZone:
          settings.timezone ||
          'Asia/Kolkata'
      }
    ).format(date);

  return (
    settings.holidays || []
  ).some(h => {
    if (!h || !h.date) {
      return false;
    }

    if (h.date === localDate) {
      return true;
    }

    if (
      h.recurring &&
      String(h.date).slice(5) ===
        localDate.slice(5)
    ) {
      return true;
    }

    return false;
  });
}


// ============================================================
// TIMEZONE MINUTES
// ============================================================

function minutesInTimeZone(
  date,
  timezone
) {
  const parts =
    new Intl.DateTimeFormat(
      'en-GB',
      {
        timeZone: timezone,

        hour: '2-digit',

        minute: '2-digit',

        hour12: false
      }
    ).formatToParts(date);

  const hour =
    Number(
      parts.find(
        p => p.type === 'hour'
      )?.value || 0
    );

  const minute =
    Number(
      parts.find(
        p => p.type === 'minute'
      )?.value || 0
    );

  return (
    hour * 60 +
    minute
  );
}


// ============================================================
// WEEKDAY
// ============================================================

function weekdayInTimeZone(
  date,
  timezone
) {
  return new Intl.DateTimeFormat(
    'en-US',
    {
      timeZone: timezone,
      weekday: 'long'
    }
  ).format(date);
}


// ============================================================
// OFFICE HOURS
// ============================================================

function isOfficeHoursNow(
  date,
  settings
) {
  const timezone =
    settings.timezone ||
    'Asia/Kolkata';

  if (
    !(settings.workingDays || [])
      .includes(
        weekdayInTimeZone(
          date,
          timezone
        )
      )
  ) {
    return false;
  }

  if (
    isHoliday(
      date,
      settings
    )
  ) {
    return false;
  }

  const [
    sh,
    sm
  ] =
    String(
      settings.officeStart ||
      '09:00'
    )
      .split(':')
      .map(Number);

  const [
    eh,
    em
  ] =
    String(
      settings.officeEnd ||
      '18:00'
    )
      .split(':')
      .map(Number);

  const now =
    minutesInTimeZone(
      date,
      timezone
    );

  if (
    now <
      sh * 60 + sm ||
    now >=
      eh * 60 + em
  ) {
    return false;
  }

  return !(
    settings.breakTimings || []
  ).some(b => {
    if (
      !b?.start ||
      !b?.end
    ) {
      return false;
    }

    const [
      bh,
      bm
    ] =
      b.start
        .split(':')
        .map(Number);

    const [
      eh2,
      em2
    ] =
      b.end
        .split(':')
        .map(Number);

    const start =
      bh * 60 + bm;

    const end =
      eh2 * 60 + em2;

    return (
      now >= start &&
      now < end
    );
  });
}


// ============================================================
// SEND TELEGRAM MESSAGE TO CRM MEMBER
// ============================================================

async function sendToMember(
  memberId,
  text,
  options = {}
) {
  if (!memberId) {
    return {
      sent: false,
      reason: 'missing-member'
    };
  }

  let member = getCachedUser(memberId);

  if (!member) {
    const userSnap = await db
      .collection('users')
      .doc(memberId)
      .get();

    if (!userSnap.exists) {
      return { sent: false, reason: 'member-not-found' };
    }

    member = { id: userSnap.id, ...userSnap.data() };
    setCachedUser(memberId, member);
  }

  if (
    member.active === false
  ) {
    return {
      sent: false,
      reason: 'member-inactive'
    };
  }

  if (
    !member.telegramConnected ||
    !member.telegramChatId
  ) {
    return {
      sent: false,
      reason:
        'telegram-not-connected'
    };
  }

  await telegram(
    'sendMessage',
    {
      chat_id:
        String(
          member.telegramChatId
        ),

      text,

      parse_mode: 'HTML',

      disable_web_page_preview:
        true,

      ...(options.replyMarkup
        ? {
            reply_markup:
              options.replyMarkup
          }
        : {})
    }
  );

  return {
    sent: true,
    member
  };
}


// ============================================================
// LEAD TELEGRAM MESSAGE
// ============================================================

function leadMessage(
  lead,
  kind
) {
  const title =
    kind === 'reminder'
      ? '⚠️ LEAD REMINDER'
      : '🔔 NEW LEAD ASSIGNED';

  const assignedName =
    lead.assignedToName ||
    'You';

  const lines = [
    `<b>${title}</b>`,

    '',

    `<b>Lead #:</b> ${escapeHtml(
      lead.slNo ?? lead.id
    )}`,

    `<b>👤 Customer:</b> ${escapeHtml(
      lead.fullName || '—'
    )}`,

    `<b>📞 Phone:</b> ${escapeHtml(
      lead.phoneNumber || '—'
    )}`,

    `<b>🛠 Service:</b> ${escapeHtml(
      leadService(lead)
    )}`,

    `<b>🏢 Company:</b> ${escapeHtml(
      lead.companyName || '—'
    )}`,

    `<b>📌 Status:</b> ${escapeHtml(
      lead.status ||
      'Not Open'
    )}`,

    `<b>👨‍💼 Assigned To:</b> ${escapeHtml(
      assignedName
    )}`
  ];


  if (
    kind === 'reminder'
  ) {
    lines.push(
      '',

      '<b>⏰ This lead is overdue and still marked Not Open.</b>',

      'Please contact the customer and update the lead status.'
    );
  } else {
    lines.push(
      '',

      'Please contact the customer and update the lead status in the CRM.'
    );
  }


  if (PUBLIC_BASE_URL) {
    lines.push(
      '',

      `<a href="${escapeHtml(
        `${PUBLIC_BASE_URL}/dashboard.html`
      )}">Open CRM</a>`
    );
  }


  return lines.join('\n');
}



// ============================================================
// ADMIN / SUPER ADMIN TELEGRAM RECIPIENTS
// ============================================================

function normalizeRole(role) {
  return String(role || '')
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, '_');
}

function isAdminOrSuperAdmin(user) {
  const role = normalizeRole(user?.role);

  return (
    role === 'admin' ||
    role === 'super_admin' ||
    role === 'superadmin'
  );
}

let managementTelegramUsersCache = null;
let managementTelegramUsersCacheAt = 0;

async function getManagementTelegramUsers() {
  if (managementTelegramUsersCache && Date.now() - managementTelegramUsersCacheAt < USER_CACHE_TTL_MS) {
    return managementTelegramUsersCache;
  }

  const snapshot = await db.collection('users').get();
  managementTelegramUsersCache = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(user =>
      user.active !== false &&
      isAdminOrSuperAdmin(user) &&
      user.telegramConnected === true &&
      !!user.telegramChatId
    );
  managementTelegramUsersCacheAt = Date.now();
  return managementTelegramUsersCache;
}


// ============================================================
// LEAD FIELD HELPERS
// ============================================================

function firstNonEmpty(...values) {
  for (const value of values) {
    if (value === undefined || value === null) {
      continue;
    }

    const text = String(value).trim();

    if (text) {
      return text;
    }
  }

  return '—';
}

// Extract the requested service from both legacy top-level fields and
// newer campaignData fields. Campaign forms can use different field labels,
// so exact known keys are preferred before a safe keyword fallback.
function leadService(lead) {
  const direct = [
    lead?.serviceNeeded,
    lead?.service,
    lead?.requestedService,
    lead?.freightService
  ];

  for (const value of direct) {
    if (value !== undefined && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }

  const data = lead?.campaignData;
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data);
    const exactKeys = new Set([
      'service',
      'serviceneeded',
      'requestedservice',
      'freightservice',
      'what service do you require',
      'which freight service do you require'
    ]);

    for (const [key, value] of entries) {
      if (exactKeys.has(String(key).trim().toLowerCase()) && value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }

    for (const [key, value] of entries) {
      const lower = String(key).toLowerCase();
      if ((lower.includes('service') || lower.includes('requirement')) && value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }
  }

  return '—';
}

function leadNoteOrCallSummary(lead) {
  const direct = firstNonEmpty(
    lead?.lastStatusNote,
    lead?.lastCallSummary,
    lead?.callSummary,
    lead?.call_summary,
    lead?.note,
    lead?.notes,
    lead?.callNotes,
    lead?.call_notes,
    lead?.remarks,
    lead?.remark,
    lead?.lastNote,
    lead?.lastNotes,
    lead?.customerNote,
    lead?.customerNotes,
    lead?.description
  );

  if (direct !== '—') {
    return direct;
  }

  const history = Array.isArray(lead?.history) ? lead.history : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const text = history[i]?.text;
    if (text !== undefined && text !== null && String(text).trim()) {
      return String(text).trim();
    }
  }

  return '—';
}

function leadStatus(lead) {
  return String(lead?.status || '')
    .trim();
}

function normalizedStatus(lead) {
  return leadStatus(lead).toLowerCase();
}

function leadDueTimeMs(lead) {
  const values = [
    lead?.dueTime,
    lead?.followUpAt,
    lead?.followUpDateTime,
    lead?.followUpTime,
    lead?.nextFollowUpAt,
    lead?.callbackAt,
    lead?.callbackTime,
    lead?.dueAt
  ];

  for (const value of values) {
    const ms = timestampMs(value);

    if (ms) {
      return ms;
    }
  }

  return null;
}

function localDateKey(date, timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function localTimeKey(date, timezone = 'Asia/Kolkata') {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function isAtOrAfterTime(date, time, timezone) {
  const [hour, minute] = String(time || '18:00')
    .split(':')
    .map(Number);

  const current = minutesInTimeZone(date, timezone);
  const target = (hour || 0) * 60 + (minute || 0);

  return current >= target;
}

function isWorkingDayForDate(date, settings) {
  const timezone = settings.timezone || 'Asia/Kolkata';

  if (!(settings.workingDays || []).includes(
    weekdayInTimeZone(date, timezone)
  )) {
    return false;
  }

  return !isHoliday(date, settings);
}


// ============================================================
// MANAGEMENT STATUS CHANGE MESSAGE
// ============================================================

function managementStatusMessage(lead, previousStatus) {
  const status = leadStatus(lead);
  const icon =
    status.toLowerCase() === 'interested'
      ? '🟢'
      : '🔴';

  const lines = [
    `${icon} <b>LEAD STATUS UPDATED</b>`,
    '',
    `<b>Lead ID:</b> ${escapeHtml(lead.slNo ?? lead.id)}`,
    `<b>Name:</b> ${escapeHtml(firstNonEmpty(lead.fullName, lead.name, lead.customerName))}`,
    `<b>Number:</b> ${escapeHtml(firstNonEmpty(lead.phoneNumber, lead.phone, lead.mobile))}`,
    `<b>Note / Call summary:</b> ${escapeHtml(leadNoteOrCallSummary(lead))}`,
    `<b>Service:</b> ${escapeHtml(leadService(lead))}`,
    `<b>Status:</b> ${escapeHtml(status)}`,
    `<b>Previous status:</b> ${escapeHtml(previousStatus || '—')}`
  ];

  const changedBy = firstNonEmpty(
    lead.statusChangedByName,
    lead.updatedByName,
    lead.lastUpdatedByName
  );

  if (changedBy !== '—') {
    lines.push(
      `<b>Updated by:</b> ${escapeHtml(changedBy)}`
    );
  }

  if (PUBLIC_BASE_URL) {
    lines.push(
      '',
      `<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`
    );
  }

  return lines.join('\n');
}


// ============================================================
// SEND MANAGEMENT STATUS ALERTS
// ============================================================

async function notifyManagementStatusChange(
  lead,
  previousStatus
) {
  const settings = await getCRMSettings();

  if (settings.telegramStatusAlerts === false) {
    return;
  }

  const current = normalizedStatus(lead);

  if (
    current !== 'interested' &&
    current !== 'not interested'
  ) {
    return;
  }

  const users = await getManagementTelegramUsers();

  if (!users.length) {
    console.log(
      `ℹ️ No connected Admin/Super Admin Telegram accounts for status alert: ${lead.id}`
    );
    return;
  }

  const eventKey = timestampMs(
    lead.statusUpdatedAt ||
    lead.updatedAt
  ) || Date.now();

  const statusKey = current.replace(/\s+/g, '_');

  for (const user of users) {
    const deliveryId =
      `status_${lead.id}_${statusKey}_${eventKey}_${user.id}`
        .replace(/[^a-zA-Z0-9_-]/g, '_');

    const claimed = await claimDelivery(deliveryId, {
      type: 'managementStatusChange',
      leadId: lead.id,
      memberId: user.id,
      status: current,
      previousStatus,
      eventAt: eventKey
    });

    if (!claimed) {
      continue;
    }

    try {
      const result = await sendToMember(
        user.id,
        managementStatusMessage(
          lead,
          previousStatus
        )
      );

      if (!result.sent) {
        await db
          .collection('telegramDeliveries')
          .doc(deliveryId)
          .delete()
          .catch(() => {});
        continue;
      }

      console.log(
        `📨 Telegram status alert sent: ${lead.id} -> ${user.id}`
      );
    } catch (error) {
      await db
        .collection('telegramDeliveries')
        .doc(deliveryId)
        .delete()
        .catch(() => {});

      console.error(
        `Telegram status alert failed for ${lead.id} -> ${user.id}:`,
        error.message
      );
    }
  }
}


// ============================================================
// REAL-TIME STATUS CHANGE DETECTOR
// ============================================================
// Firestore listener for lead status changes.
// This catches Interested / Not Interested transitions from ANY
// previous status (Not Open, Contacted, Busy, Not Picking Call,
// Call Back Later, etc.) without waiting for the polling cycle.
// The existing polling detector remains as a safety fallback.

const liveLeadStatusCache = new Map();
let leadStatusListenerStarted = false;
let leadStatusListenerHealthy = false;
let realtimeInitialSnapshotComplete = false;
let lastStatusFallbackScanAt = 0;
const STATUS_FALLBACK_MIN_INTERVAL_MS = 5 * 60 * 1000;

function statusEventKey(lead, status) {
  const eventAt = timestampMs(
    lead?.statusUpdatedAt ||
    lead?.updatedAt ||
    lead?.modifiedAt
  ) || Date.now();

  return `${lead?.id || 'unknown'}_${String(status || '').trim().toLowerCase()}_${eventAt}`
    .replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function handleRealtimeLeadStatusChange(lead, previousStatus) {
  const current = normalizedStatus(lead);

  if (
    current !== 'interested' &&
    current !== 'not interested'
  ) {
    return;
  }

  // Ignore a status that did not actually change.
  if (
    previousStatus &&
    String(previousStatus).trim().toLowerCase() === current
  ) {
    return;
  }

  console.log(
    `🔔 Realtime status change: ${lead.id} | ${previousStatus || '—'} -> ${leadStatus(lead)}`
  );

  await notifyManagementStatusChange(
    lead,
    previousStatus || '—'
  );
}

function startLeadStatusRealtimeListener() {
  if (leadStatusListenerStarted) return;

  leadStatusListenerStarted = true;
  console.log('👂 Starting realtime Firestore lead status + assignment listener...');

  db.collection('leads').onSnapshot(
    snapshot => {
      leadStatusListenerHealthy = true;
      const tasks = [];
      const isInitialSnapshot = !realtimeInitialSnapshotComplete;

      snapshot.docChanges().forEach(change => {
        const lead = { id: change.doc.id, ...change.doc.data() };
        const currentStatus = leadStatus(lead);
        const currentAssignment = lead.assignedTo || null;
        const cached = liveLeadStatusCache.get(lead.id);

        if (change.type === 'removed') {
          liveLeadStatusCache.delete(lead.id);
          return;
        }

        if (isInitialSnapshot && change.type === 'added' && !cached) {
          liveLeadStatusCache.set(lead.id, {
            status: currentStatus,
            assignedTo: currentAssignment
          });
          return;
        }

        const previousStatus = cached?.status;
        const previousAssignment = cached?.assignedTo || null;

        liveLeadStatusCache.set(lead.id, {
          status: currentStatus,
          assignedTo: currentAssignment
        });

        if (
          previousStatus !== undefined &&
          String(previousStatus).trim().toLowerCase() !== String(currentStatus).trim().toLowerCase()
        ) {
          tasks.push(
            handleRealtimeLeadStatusChange(lead, previousStatus).catch(error => {
              console.error(`Realtime status notification failed for ${lead.id}:`, error.message);
            })
          );
        }

        const assignmentChanged =
          previousAssignment !== currentAssignment &&
          !!currentAssignment &&
          lead.assignmentStatus === 'assigned';

        if (!isInitialSnapshot && assignmentChanged) {
          tasks.push(
            notifyAssignment(lead).catch(error => {
              console.error(`Realtime assignment notification failed for ${lead.id}:`, error.message);
            })
          );
        }
      });

      realtimeInitialSnapshotComplete = true;
      if (tasks.length) Promise.allSettled(tasks).catch(() => {});
    },
    error => {
      leadStatusListenerHealthy = false;
      console.error('❌ Firestore realtime lead status listener error:', error.message);
    }
  );
}

// ============================================================
// STATUS CHANGE DETECTOR - POLLING FALLBACK
// ============================================================

async function processStatusChanges() {
  // Realtime Firestore listener handles status changes immediately.
  // Do not download the entire leads collection as a one-minute fallback.
  return;
}

// ============================================================
// MANAGEMENT OVERDUE MESSAGE
// ============================================================

function managementOverdueMessage(lead, category) {
  const categoryLabels = {
    not_open: 'Leads Not Opened Yet',
    follow_up: 'Follow-up Overdue',
    not_picking: 'Not Picking Call Overdue'
  };

  const label = categoryLabels[category] || 'Lead Overdue';

  const lines = [
    '⚠️ <b>LEAD OVERDUE ALERT</b>',
    '',
    `<b>Type:</b> ${escapeHtml(label)}`,
    `<b>Lead ID:</b> ${escapeHtml(lead.slNo ?? lead.id)}`,
    `<b>Name:</b> ${escapeHtml(firstNonEmpty(lead.fullName, lead.name, lead.customerName))}`,
    `<b>Number:</b> ${escapeHtml(firstNonEmpty(lead.phoneNumber, lead.phone, lead.mobile))}`,
    `<b>Service:</b> ${escapeHtml(leadService(lead))}`,
    `<b>Status:</b> ${escapeHtml(firstNonEmpty(lead.status, '—'))}`,
    `<b>Assigned To:</b> ${escapeHtml(firstNonEmpty(lead.assignedToName, lead.assignedToEmail, lead.assignedTo))}`,
    `<b>Note / Call summary:</b> ${escapeHtml(leadNoteOrCallSummary(lead))}`
  ];

  const due = leadDueTimeMs(lead);

  if (due) {
    lines.push(
      `<b>Due:</b> ${escapeHtml(new Date(due).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }))}`
    );
  }

  if (PUBLIC_BASE_URL) {
    lines.push(
      '',
      `<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`
    );
  }

  return lines.join('\n');
}


// ============================================================
// MANAGEMENT OVERDUE SCAN
// ============================================================

async function scanManagementOverdues() {
  const settings = await getCRMSettings();

  if (settings.telegramAdminOverdueAlerts === false) {
    return;
  }

  const now = Date.now();

  if (!isOfficeHoursNow(new Date(now), settings)) {
    return;
  }

  const users = await getManagementTelegramUsers();

  if (!users.length) {
    return;
  }

  const overdueStatuses = [
    'Not Open', 'Not Opened', 'New',
    'Call Back Later', 'Callback Later',
    'Follow Up', 'Follow-Up', 'Followup',
    'Not Picking Call', 'Not Picking'
  ];

  const snapshot = await db
    .collection('leads')
    .where('status', 'in', overdueStatuses)
    .get();

  for (const doc of snapshot.docs) {
    const lead = {
      id: doc.id,
      ...doc.data()
    };

    const status = normalizedStatus(lead);
    let due = leadDueTimeMs(lead);

    // If a Not Open lead does not have a dueTime field, use the CRM
    // reminder-after-minutes setting from its assignment time.
    if (!due && (status === 'not open' || status === 'not opened')) {
      const assignedAt = timestampMs(lead.assignedAt);

      if (assignedAt) {
        due = assignedAt +
          (Number(settings.reminderAfterMinutes || 30) * 60 * 1000);
      }
    }

    if (!due || now < due) {
      continue;
    }

    let category = null;

    if (
      status === 'not open' ||
      status === 'not opened' ||
      status === 'new'
    ) {
      category = 'not_open';
    } else if (
      status === 'call back later' ||
      status === 'callback later' ||
      status === 'follow up' ||
      status === 'follow-up' ||
      status === 'followup'
    ) {
      category = 'follow_up';
    } else if (
      status === 'not picking call' ||
      status === 'not picking'
    ) {
      category = 'not_picking';
    }

    if (!category) {
      continue;
    }

    for (const user of users) {
      const deliveryId =
        `management_overdue_${lead.id}_${category}_${due}_${user.id}`
          .replace(/[^a-zA-Z0-9_-]/g, '_');

      const claimed = await claimDelivery(deliveryId, {
        type: 'managementOverdue',
        leadId: lead.id,
        memberId: user.id,
        category,
        dueAt: due
      });

      if (!claimed) {
        continue;
      }

      try {
        const result = await sendToMember(
          user.id,
          managementOverdueMessage(lead, category)
        );

        if (!result.sent) {
          await db
            .collection('telegramDeliveries')
            .doc(deliveryId)
            .delete()
            .catch(() => {});
        } else {
          console.log(
            `⏰ Management overdue alert sent: ${lead.id} (${category}) -> ${user.id}`
          );
        }
      } catch (error) {
        await db
          .collection('telegramDeliveries')
          .doc(deliveryId)
          .delete()
          .catch(() => {});

        console.error(
          `Management overdue alert failed for ${lead.id}:`,
          error.message
        );
      }
    }
  }
}


// ============================================================
// DAILY MANAGEMENT REPORT
// ============================================================

function formatDailyReportDate(dateKey, timezone = 'Asia/Kolkata') {
  const date = new Date(`${dateKey}T00:00:00+05:30`);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: timezone,
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function dailyReportMessage(report, dateKey) {
  const dateLabel = formatDailyReportDate(dateKey);
  const lines = [
    'Hi Sri, here is today\'s lead summary for Abra Logistics (' + dateLabel + '):',
    '',
    `Total leads received: ${report.total}`,
    '',
    `Interested: ${report.interested}`,
    `Not Interested: ${report.notInterested}`,
    `Drivers: ${report.drivers}`,
    `Transporters: ${report.transporters}`,
    `Job Seekers: ${report.jobSeekers}`,
    `Busy (call again): ${report.callBackLater}`,
    `Not Picking Call: ${report.notPickingCall}`,
    `Pending / Not Contacted: ${report.notOpen}`,
    '',
    'Marketing activity:',
    `Email messages initiated: ${report.marketing?.email?.messages || 0}`,
    `WhatsApp messages initiated: ${report.marketing?.whatsapp?.messages || 0}`
  ];

  for (const [channel, label] of [['email', 'Email'], ['whatsapp', 'WhatsApp']]) {
    const campaigns = report.marketing?.[channel]?.campaigns || [];
    if (campaigns.length) {
      lines.push(`${label} campaigns:`);
      campaigns.slice(0, 10).forEach((campaign, index) => {
        lines.push(`${index + 1}. ${campaign.name} — ${campaign.messages}`);
      });
    }
  }
  lines.push('');

  if (report.notOpen > 0) {
    lines.push(`Note: ${report.notOpen} lead(s) are still pending first contact — following up shortly.`);
  } else {
    lines.push('All leads received have been contacted at least once.');
  }

  lines.push('', 'Regards,', 'Sagar');
  return lines.join('\n');
}

async function buildDailyReport(dateKey, timezone) {
  pruneReportCache(reportCache);
  const cacheKey = `${timezone}:${dateKey}`;
  const cached = reportCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REPORT_CACHE_TTL_MS) return cached.report;

  const start = new Date(`${dateKey}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  let snapshot;
  try {
    snapshot = await db
      .collection('leads')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(end))
      .get();
  } catch (error) {
    if (error.code === 8 || error.code === 'resource-exhausted') throw error;
    console.warn('Daily report date query failed; using fallback scan:', error.message);
    snapshot = await db.collection('leads').get();
  }

  const report = {
    total: 0,
    newLeads: 0,
    notOpen: 0,
    contacted: 0,
    interested: 0,
    notInterested: 0,
    drivers: 0,
    transporters: 0,
    jobSeekers: 0,
    callBackLater: 0,
    notPickingCall: 0,
    topMembers: [],
    marketing: {
      email: { messages: 0, campaigns: [] },
      whatsapp: { messages: 0, campaigns: [] }
    }
  };

  const memberCounts = new Map();

  for (const doc of snapshot.docs) {
    const lead = doc.data();
    const created = timestampMs(lead.createdAt);
    const createdDate = created
      ? localDateKey(new Date(created), timezone)
      : null;

    // Count only leads received on this date, matching the CRM Daily Report UI.
    if (createdDate !== dateKey) {
      continue;
    }

    report.total += 1;
    report.newLeads += 1;

    const status = normalizedStatus(lead);

    if (status === 'not open' || status === 'not opened') {
      report.notOpen += 1;
    } else if (status === 'interested') {
      report.interested += 1;
    } else if (status === 'not interested') {
      report.notInterested += 1;
    } else if (status === 'driver') {
      report.drivers += 1;
    } else if (status === 'transporter') {
      report.transporters += 1;
    } else if (status === 'job seeker' || status === 'jobseeker') {
      report.jobSeekers += 1;
    } else if (
      status === 'busy' ||
      status === 'call back later' ||
      status === 'callback later' ||
      status === 'follow up' ||
      status === 'follow-up' ||
      status === 'followup'
    ) {
      report.callBackLater += 1;
    } else if (
      status === 'not picking call' ||
      status === 'not picking'
    ) {
      report.notPickingCall += 1;
    } else if (status) {
      report.contacted += 1;
    }

    const memberName = firstNonEmpty(
      lead.assignedToName,
      lead.assignedToEmail,
      lead.assignedTo
    );

    if (memberName !== '—') {
      memberCounts.set(
        memberName,
        (memberCounts.get(memberName) || 0) + 1
      );
    }
  }

  // Marketing activity is counted from the actual campaign recipient-open records
  // for the same local date. This keeps the Telegram daily report aligned with
  // the CRM's current Email + WhatsApp marketing report.
  for (const [channel, collectionName] of [['email', 'emailMarketingCampaigns'], ['whatsapp', 'whatsappMarketingCampaigns']]) {
    try {
      const campaignSnap = await db.collection(collectionName).get();
      const campaignRows = [];
      for (const campaignDoc of campaignSnap.docs) {
        const campaign = campaignDoc.data() || {};
        let messages = 0;
        for (const entry of Object.values(campaign.sentRecipients || {})) {
          const opened = timestampMs(entry?.openedAt);
          if (opened && localDateKey(new Date(opened), timezone) === dateKey) messages += 1;
        }
        if (messages > 0) {
          campaignRows.push({ name: campaign.name || `${channel === 'email' ? 'Email' : 'WhatsApp'} Campaign`, messages });
          report.marketing[channel].messages += messages;
        }
      }
      report.marketing[channel].campaigns = campaignRows.sort((a, b) => b.messages - a.messages || a.name.localeCompare(b.name));
    } catch (error) {
      console.warn(`Daily ${channel} marketing report query failed:`, error.message);
    }
  }

  report.topMembers = Array.from(memberCounts.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  reportCache.set(cacheKey, { cachedAt: Date.now(), report });
  return report;
}

async function sendDailyManagementReport() {
  const settings = await getCRMSettings();

  if (settings.telegramDailyReportEnabled === false) {
    return;
  }

  const timezone = settings.timezone || 'Asia/Kolkata';
  const now = new Date();

  if (!isWorkingDayForDate(now, settings)) {
    return;
  }

  if (!isAtOrAfterTime(
    now,
    settings.telegramDailyReportTime || settings.officeEnd || '18:00',
    timezone
  )) {
    return;
  }

  const dateKey = localDateKey(now, timezone);
  const reportRef = db
    .collection('telegramSystem')
    .doc(`daily-report-${dateKey}`);

  const reportSnap = await reportRef.get();

  const users = await getManagementTelegramUsers();

  if (!users.length) {
    return;
  }

  const report = await buildDailyReport(dateKey, timezone);
  const text = dailyReportMessage(report, dateKey);

  for (const user of users) {
    const deliveryId =
      `daily_report_${dateKey}_${user.id}`
        .replace(/[^a-zA-Z0-9_-]/g, '_');

    const claimed = await claimDelivery(deliveryId, {
      type: 'dailyManagementReport',
      memberId: user.id,
      dateKey
    });

    if (!claimed) {
      continue;
    }

    try {
      const result = await sendToMember(user.id, text);

      if (!result.sent) {
        await db
          .collection('telegramDeliveries')
          .doc(deliveryId)
          .delete()
          .catch(() => {});
      }
    } catch (error) {
      await db
        .collection('telegramDeliveries')
        .doc(deliveryId)
        .delete()
        .catch(() => {});

      console.error(
        `Daily Telegram report failed for ${user.id}:`,
        error.message
      );
    }
  }

  await reportRef.set({
    dateKey,
    sentAt: FieldValue.serverTimestamp(),
    recipientCount: users.length,
    report
  }, { merge: true });

  if (!reportSnap.exists) {
    console.log(
      `📊 Daily Telegram management report sent for ${dateKey}`
    );
  }
}


// ============================================================
// REAL-TIME MANAGEMENT TELEGRAM NOTIFICATIONS
// ============================================================
// The marketing UI writes management-audience events to the
// `notifications` collection. This server listener forwards only the
// marketing events to every connected Admin / Super Admin Telegram account.
// This keeps Telegram delivery server-side and independent of which CRM
// page the management user currently has open.

let managementNotificationListenerStarted = false;
let managementNotificationInitialSnapshotComplete = false;

function managementTelegramNotificationMessage(data, recipient) {
  const metadata = data?.metadata || {};
  const type = String(data?.type || '').trim();
  const adminName = firstNonEmpty(
    recipient?.name,
    recipient?.email,
    'Admin'
  );

  if (type === 'marketing-campaign-created') {
    const marketingType =
      metadata.marketingType === 'email' ? 'Email Marketing' : 'WhatsApp Marketing';
    const lines = [
      '📣 <b>NEW MARKETING CAMPAIGN CREATED</b>',
      '',
      `<b>Hi ${escapeHtml(adminName)} Sir,</b>`,
      '',
      `<b>Marketing Name:</b> ${escapeHtml(metadata.marketingName || data.createdByName || '—')}`,
      `<b>Marketing Type:</b> ${escapeHtml(marketingType)}`,
      `<b>Campaign Name:</b> ${escapeHtml(metadata.campaignName || '—')}`
    ];

    if (metadata.marketingType === 'email') {
      lines.push(
        `<b>Subject:</b> ${escapeHtml(metadata.subject || '—')}`,
        `<b>Open Email With:</b> ${escapeHtml(metadata.openEmailWith || '—')}`
      );
    }

    lines.push(
      `<b>Body:</b> ${escapeHtml(metadata.body || data.message || '—')}`
    );

    if (PUBLIC_BASE_URL) {
      lines.push(
        '',
        `<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`
      );
    }

    return lines.join('\n');
  }

  if (type === 'marketing-status-change') {
    const marketingType =
      metadata.marketingType === 'email' ? 'Email' : 'WhatsApp';
    const changedBy = firstNonEmpty(
      metadata.changedBy,
      data.createdByName,
      'Team member'
    );
    const customerName = firstNonEmpty(
      metadata.customerName,
      'the customer'
    );
    const newStatus = firstNonEmpty(
      metadata.newStatus,
      'updated'
    );

    const lines = [
      '🔔 <b>MARKETING SUBSCRIPTION STATUS UPDATED</b>',
      '',
      `Hi ${escapeHtml(adminName)} Sir,`,
      `Your team member <b>${escapeHtml(changedBy)}</b> has changed <b>${escapeHtml(customerName)}</b> to <b>${escapeHtml(newStatus)}</b> for <b>${escapeHtml(marketingType)}</b>.`
    ];

    if (PUBLIC_BASE_URL) {
      lines.push(
        '',
        `<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`
      );
    }

    return lines.join('\n');
  }

  return null;
}

async function forwardManagementNotificationToTelegram(
  notificationId,
  data
) {
  const type = String(data?.type || '').trim();

  if (
    type !== 'marketing-campaign-created' &&
    type !== 'marketing-status-change'
  ) {
    return;
  }

  const users = await getManagementTelegramUsers();

  if (!users.length) {
    console.log(
      `ℹ️ No connected Admin/Super Admin Telegram accounts for management notification: ${notificationId}`
    );
    return;
  }

  for (const user of users) {
    const deliveryId =
      `management_notification_${notificationId}_${user.id}`
        .replace(/[^a-zA-Z0-9_-]/g, '_');

    const claimed = await claimDelivery(deliveryId, {
      type: 'managementNotification',
      notificationId,
      memberId: user.id,
      notificationType: type
    });

    if (!claimed) continue;

    try {
      const text = managementTelegramNotificationMessage(data, user);

      if (!text) continue;

      const result = await sendToMember(user.id, text);

      if (!result.sent) {
        await db.collection('telegramDeliveries').doc(deliveryId).delete().catch(() => {});
        continue;
      }

      console.log(
        `📨 Telegram management notification sent: ${notificationId} -> ${user.id}`
      );
    } catch (error) {
      await db.collection('telegramDeliveries').doc(deliveryId).delete().catch(() => {});
      console.error(
        `Telegram management notification failed for ${notificationId} -> ${user.id}:`,
        error.message
      );
    }
  }
}

function startManagementNotificationRealtimeListener() {
  if (managementNotificationListenerStarted) return;

  managementNotificationListenerStarted = true;
  managementNotificationInitialSnapshotComplete = false;

  console.log('👂 Starting realtime marketing management Telegram notification listener...');

  db.collection('notifications')
    .where('audience', '==', 'management')
    .onSnapshot(
      snapshot => {
        const tasks = [];

        snapshot.docChanges().forEach(change => {
          if (change.type !== 'added') return;

          // Do not resend notifications that were already present when the
          // server started. New documents after the initial snapshot are sent.
          if (!managementNotificationInitialSnapshotComplete) return;

          tasks.push(
            forwardManagementNotificationToTelegram(
              change.doc.id,
              { id: change.doc.id, ...change.doc.data() }
            )
          );
        });

        managementNotificationInitialSnapshotComplete = true;

        if (tasks.length) {
          Promise.allSettled(tasks).catch(error => {
            console.error(
              'Management Telegram notification batch error:',
              error.message
            );
          });
        }
      },
      error => {
        console.error(
          'Management Telegram notification listener error:',
          error.message
        );
      }
    );
}


// ============================================================
// TELEGRAM DELIVERY CLAIM
// ============================================================

async function claimDelivery(
  deliveryId,
  data
) {
  const ref =
    db
      .collection(
        'telegramDeliveries'
      )
      .doc(deliveryId);

  try {
    await ref.create({
      ...data,

      createdAt:
        FieldValue.serverTimestamp()
    });

    return true;

  } catch (error) {

    if (
      error.code === 6 ||
      error.code ===
        'already-exists'
    ) {
      return false;
    }

    throw error;
  }
}


// ============================================================
// NEW LEAD TELEGRAM NOTIFICATION
// ============================================================

async function notifyAssignment(
  lead
) {
  const settings =
    await getCRMSettings();

  if (
    settings.telegramAlerts ===
    false
  ) {
    return;
  }

  if (
    !lead.assignedTo ||
    lead.assignmentStatus !==
      'assigned'
  ) {
    return;
  }

  const assignedAt =
    timestampMs(
      lead.assignedAt
    ) ||
    timestampMs(
      lead.createdAt
    ) ||
    Date.now();

  const deliveryId =
    `new_${lead.id}_${assignedAt}`
      .replace(
        /[^a-zA-Z0-9_-]/g,
        '_'
      );

  const userSnap =
    await db
      .collection('users')
      .doc(lead.assignedTo)
      .get();

  if (!userSnap.exists) {
    return;
  }

  const member =
    userSnap.data();

  if (
    !member.telegramConnected ||
    !member.telegramChatId
  ) {
    return;
  }

  const claimed =
    await claimDelivery(
      deliveryId,
      {
        type: 'newLead',

        leadId:
          lead.id,

        memberId:
          lead.assignedTo,

        assignmentAt:
          assignedAt
      }
    );

  if (!claimed) {
    return;
  }

  try {

    const result =
      await sendToMember(
        lead.assignedTo,

        leadMessage(
          lead,
          'new'
        )
      );

    if (!result.sent) {

      await db
        .collection(
          'telegramDeliveries'
        )
        .doc(deliveryId)
        .delete()
        .catch(() => {});

      return;
    }

    console.log(
      `📨 Telegram new-lead notification sent: ${lead.id} -> ${lead.assignedTo}`
    );

  } catch (error) {

    await db
      .collection(
        'telegramDeliveries'
      )
      .doc(deliveryId)
      .delete()
      .catch(() => {});

    console.error(
      `Telegram new-lead notification failed for ${lead.id}:`,
      error.message
    );
  }
}


// ============================================================
// OVERDUE LEAD TELEGRAM NOTIFICATION
// ============================================================

async function scanOverdueLeads() {

  const settings =
    await getCRMSettings();

  if (
    settings.telegramOverdueAlerts ===
    false
  ) {
    return;
  }

  const now =
    Date.now();

  if (
    !isOfficeHoursNow(
      new Date(now),
      settings
    )
  ) {
    return;
  }

  const snapshot = await db
    .collection('leads')
    .where('status', 'in', ['Not Open', 'Not Opened', 'New'])
    .get();


  for (
    const doc of snapshot.docs
  ) {

    const lead = {
      id: doc.id,
      ...doc.data()
    };

    if (
      !lead.assignedTo ||
      lead.assignmentStatus !==
        'assigned'
    ) {
      continue;
    }

    if (
      lead.telegramOverdueReminderSent ===
      true
    ) {
      continue;
    }

    const dueTime =
      timestampMs(
        lead.dueTime
      );

    if (
      !dueTime ||
      now < dueTime
    ) {
      continue;
    }

    const deliveryId =
      `overdue_${lead.id}_${timestampMs(
        lead.assignedAt
      ) || dueTime}`
        .replace(
          /[^a-zA-Z0-9_-]/g,
          '_'
        );

    const userSnap =
      await db
        .collection('users')
        .doc(lead.assignedTo)
        .get();

    if (!userSnap.exists) {
      continue;
    }

    const member =
      userSnap.data();

    if (
      !member.telegramConnected ||
      !member.telegramChatId
    ) {
      continue;
    }

    const claimed =
      await claimDelivery(
        deliveryId,
        {
          type:
            'overdueReminder',

          leadId:
            lead.id,

          memberId:
            lead.assignedTo,

          dueAt:
            dueTime
        }
      );

    if (!claimed) {
      continue;
    }

    try {

      const result =
        await sendToMember(
          lead.assignedTo,

          leadMessage(
            lead,
            'reminder'
          )
        );

      if (!result.sent) {

        await db
          .collection(
            'telegramDeliveries'
          )
          .doc(deliveryId)
          .delete()
          .catch(() => {});

        continue;
      }

      await doc.ref.update({
        telegramOverdueReminderSent:
          true,

        telegramOverdueReminderSentAt:
          FieldValue.serverTimestamp()
      });

      console.log(
        `⏰ Telegram overdue reminder sent: ${lead.id} -> ${lead.assignedTo}`
      );

    } catch (error) {

      await db
        .collection(
          'telegramDeliveries'
        )
        .doc(deliveryId)
        .delete()
        .catch(() => {});

      console.error(
        `Telegram overdue reminder failed for ${lead.id}:`,
        error.message
      );
    }
  }
}


// ============================================================
// INITIALIZE DELIVERY BASELINE
// ============================================================

async function initializeAssignmentDeliveryBaseline() {

  const markerRef =
    db
      .collection(
        'telegramSystem'
      )
      .doc(
        'assignment-baseline'
      );

  const markerSnap =
    await markerRef.get();

  if (markerSnap.exists) {
    return;
  }

  const snapshot =
    await db
      .collection('leads')
      .where(
        'assignmentStatus',
        '==',
        'assigned'
      )
      .get();

  const batch =
    db.batch();

  let count = 0;


  snapshot.docs.forEach(
    doc => {

      const lead =
        doc.data();

      const assignedAt =
        timestampMs(
          lead.assignedAt
        ) ||
        timestampMs(
          lead.createdAt
        );

      if (!assignedAt) {
        return;
      }

      const deliveryId =
        `new_${doc.id}_${assignedAt}`
          .replace(
            /[^a-zA-Z0-9_-]/g,
            '_'
          );

      batch.set(
        db
          .collection(
            'telegramDeliveries'
          )
          .doc(deliveryId),

        {
          type:
            'newLeadBaseline',

          leadId:
            doc.id,

          memberId:
            lead.assignedTo ||
            null,

          assignmentAt:
            assignedAt,

          baseline:
            true,

          createdAt:
            FieldValue.serverTimestamp()
        },

        {
          merge: true
        }
      );

      count += 1;
    }
  );


  if (count) {
    await batch.commit();
  }


  await markerRef.set(
    {
      initializedAt:
        FieldValue.serverTimestamp(),

      seeded:
        count
    },

    {
      merge: true
    }
  );


  console.log(
    `🧱 Telegram assignment baseline initialized for ${count} existing assignments.`
  );
}


// ============================================================
// PROCESS NEW ASSIGNMENTS
// ============================================================

async function processNewAssignments() {
  // Assignment notifications are handled by the realtime lead listener.
  // Avoid a full assigned-leads query every minute.
  return;
}

// ============================================================
// TELEGRAM NOTIFICATION CYCLE
// ============================================================

let cycleRunning = false;


async function runNotificationCycle() {

  if (cycleRunning) {
    return;
  }

  cycleRunning = true;

  try {

    await processNewAssignments();

    await processStatusChanges();

    await scanOverdueLeads();

    await scanManagementOverdues();

    await sendDailyManagementReport();

  } catch (error) {

    console.error(
      'Telegram notification cycle error:',
      error.message
    );

  } finally {

    cycleRunning = false;
  }
}


// ============================================================
// TELEGRAM REPORT / TEAM NOTIFICATION HELPERS
// ============================================================

const telegramChatUserCache = new Map();

async function getTelegramCRMUserByChatId(chatId) {
  const key = String(chatId);
  const cached = telegramChatUserCache.get(key);
  if (cached && Date.now() - cached.cachedAt < USER_CACHE_TTL_MS) return cached.user;

  const snapshot = await db
    .collection('users')
    .where('telegramChatId', '==', key)
    .limit(1)
    .get();

  const user = snapshot.empty
    ? null
    : { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };

  telegramChatUserCache.set(key, { cachedAt: Date.now(), user });
  if (user) setCachedUser(user.id, user);
  return user;
}

function reportStatusCount(report) {
  return [
    ['Interested', report.interested],
    ['Not Interested', report.notInterested],
    ['Drivers', report.drivers],
    ['Transporters', report.transporters],
    ['Job Seekers', report.jobSeekers],
    ['Busy / Call Back Later', report.callBackLater],
    ['Not Picking Call', report.notPickingCall],
    ['Pending / Not Contacted', report.notOpen]
  ];
}

function telegramReportMessage(report, dateKey, title = 'LEAD REPORT') {
  const dateLabel = formatDailyReportDate(dateKey);
  const lines = [
    `📊 <b>${escapeHtml(title)}</b>`,
    `<b>Date:</b> ${escapeHtml(dateLabel)}`,
    '',
    `<b>Total leads received:</b> ${report.total}`,
    ''
  ];

  const marketing = report.marketing || {};
  lines.push(
    '<b>📣 Marketing activity</b>',
    `Email messages initiated: ${marketing.email?.messages || 0}`,
    `WhatsApp messages initiated: ${marketing.whatsapp?.messages || 0}`
  );
  for (const [channel, label] of [['email', 'Email'], ['whatsapp', 'WhatsApp']]) {
    const campaigns = marketing[channel]?.campaigns || [];
    if (campaigns.length) {
      lines.push(`<b>${label} campaigns</b>`);
      campaigns.slice(0, 10).forEach((campaign, index) => {
        lines.push(`${index + 1}. ${escapeHtml(campaign.name)} — ${campaign.messages}`);
      });
    }
  }
  lines.push('');

  for (const [label, count] of reportStatusCount(report)) {
    lines.push(`<b>${escapeHtml(label)}:</b> ${count}`);
  }

  if (report.topMembers?.length) {
    lines.push('', '<b>👥 Top assigned members</b>');
    report.topMembers.forEach((member, index) => {
      lines.push(`${index + 1}. ${escapeHtml(member.name)} — ${member.count}`);
    });
  }

  if (report.total === 0) {
    lines.push('', 'No leads were received on this date.');
  }

  if (PUBLIC_BASE_URL) {
    lines.push(
      '',
      `<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`
    );
  }

  return lines.join('\n');
}

function parseTelegramReportDate(value, timezone = 'Asia/Kolkata') {
  const normalized = String(value || '').trim().toLowerCase();
  const now = new Date();

  if (!normalized || normalized === 'today' || normalized === 'report') {
    return localDateKey(now, timezone);
  }

  if (normalized === 'yesterday') {
    return localDateKey(new Date(now.getTime() - 24 * 60 * 60 * 1000), timezone);
  }

  let match = normalized.match(/^(\\d{4})-(\\d{1,2})-(\\d{1,2})$/);
  if (match) {
    const date = new Date(Date.UTC(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      12
    ));
    return localDateKey(date, timezone);
  }

  match = normalized.match(/^(\\d{1,2})[\\/.-](\\d{1,2})[\\/.-](\\d{4})$/);
  if (match) {
    const date = new Date(Date.UTC(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      12
    ));
    return localDateKey(date, timezone);
  }

  return null;
}

async function buildTelegramCampaignReport(dateKey, timezone = 'Asia/Kolkata') {
  pruneReportCache(campaignReportCache);
  const cacheKey = `${timezone}:${dateKey}`;
  const cached = campaignReportCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < REPORT_CACHE_TTL_MS) return cached.campaigns;

  const start = new Date(`${dateKey}T00:00:00+05:30`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  let snapshot;
  try {
    snapshot = await db
      .collection('leads')
      .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(start))
      .where('createdAt', '<', admin.firestore.Timestamp.fromDate(end))
      .get();
  } catch (error) {
    if (error.code === 8 || error.code === 'resource-exhausted') throw error;
    console.warn('Campaign report date query failed; using fallback scan:', error.message);
    snapshot = await db.collection('leads').get();
  }
  const campaigns = new Map();

  const campaignValue = lead => {
    const direct = [
      lead?.campaignName,
      lead?.campaignTitle,
      lead?.campaign,
      lead?.campaignId
    ];

    for (const value of direct) {
      if (value !== undefined && value !== null && String(value).trim()) {
        return String(value).trim();
      }
    }

    const data = lead?.campaignData;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const keys = [
        'campaignName',
        'campaignTitle',
        'campaign',
        'campaignId'
      ];
      for (const key of keys) {
        if (data[key] !== undefined && data[key] !== null && String(data[key]).trim()) {
          return String(data[key]).trim();
        }
      }
    }

    return 'Unspecified campaign';
  };

  for (const doc of snapshot.docs) {
    const lead = { id: doc.id, ...doc.data() };
    const created = timestampMs(lead.createdAt);
    if (!created || localDateKey(new Date(created), timezone) !== dateKey) {
      continue;
    }

    const name = campaignValue(lead);
    const current = campaigns.get(name) || {
      name,
      leads: 0,
      interested: 0,
      notInterested: 0,
      pending: 0
    };

    current.leads += 1;
    const status = normalizedStatus(lead);
    if (status === 'interested') current.interested += 1;
    else if (status === 'not interested') current.notInterested += 1;
    else if (status === 'not open' || status === 'not opened') current.pending += 1;

    campaigns.set(name, current);
  }

  const result = Array.from(campaigns.values())
    .sort((a, b) => b.leads - a.leads || a.name.localeCompare(b.name));
  campaignReportCache.set(cacheKey, { cachedAt: Date.now(), campaigns: result });
  return result;
}

function telegramCampaignReportMessage(campaigns, dateKey) {
  const dateLabel = formatDailyReportDate(dateKey);
  const lines = [
    '📣 <b>CAMPAIGN REPORT</b>',
    `<b>Date:</b> ${escapeHtml(dateLabel)}`,
    ''
  ];

  if (!campaigns.length) {
    lines.push('No campaign information was found in the leads received on this date.');
  } else {
    campaigns.forEach((campaign, index) => {
      lines.push(
        `<b>${index + 1}. ${escapeHtml(campaign.name)}</b>`,
        `Leads: ${campaign.leads} | Interested: ${campaign.interested} | Not Interested: ${campaign.notInterested} | Pending: ${campaign.pending}`,
        ''
      );
    });
  }

  if (PUBLIC_BASE_URL) {
    lines.push(`<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`);
  }

  return lines.join('\n');
}

const TEAM_OVERDUE_CACHE_TTL_MS = Number(
  process.env.TELEGRAM_TEAM_OVERDUE_CACHE_TTL_MS || 30000
);
let teamOverdueCache = null;
let teamOverdueCacheAt = 0;
let teamOverdueLoadPromise = null;

function clearTeamOverdueCache() {
  teamOverdueCache = null;
  teamOverdueCacheAt = 0;
}

async function getTeamOverdueLeads({ forceRefresh = false } = {}) {
  const cacheFresh =
    teamOverdueCache &&
    Date.now() - teamOverdueCacheAt < TEAM_OVERDUE_CACHE_TTL_MS;

  if (!forceRefresh && cacheFresh) {
    return teamOverdueCache;
  }

  if (!forceRefresh && teamOverdueLoadPromise) {
    return teamOverdueLoadPromise;
  }

  teamOverdueLoadPromise = (async () => {
  const settings = await getCRMSettings();
  const now = Date.now();
  const overdueStatuses = [
    'Not Open', 'Not Opened', 'New',
    'Call Back Later', 'Callback Later',
    'Follow Up', 'Follow-Up', 'Followup',
    'Not Picking Call', 'Not Picking'
  ];
  const snapshot = await db
    .collection('leads')
    .where('status', 'in', overdueStatuses)
    .get();
  const groups = new Map();
  const memberCache = new Map();
  let unassigned = 0;

  for (const doc of snapshot.docs) {
    const lead = { id: doc.id, ...doc.data() };
    const status = normalizedStatus(lead);
    let due = leadDueTimeMs(lead);

    if (!due && (status === 'not open' || status === 'not opened' || status === 'new')) {
      const assignedAt = timestampMs(lead.assignedAt);
      if (assignedAt) {
        due = assignedAt + (Number(settings.reminderAfterMinutes || 30) * 60 * 1000);
      }
    }

    if (!due || now < due) continue;

    const category =
      status === 'not open' || status === 'not opened' || status === 'new'
        ? 'not_open'
        : status === 'call back later' || status === 'callback later' || status === 'follow up' || status === 'follow-up' || status === 'followup'
          ? 'follow_up'
          : status === 'not picking call' || status === 'not picking'
            ? 'not_picking'
            : null;

    if (!category) continue;

    if (!lead.assignedTo) {
      unassigned += 1;
      continue;
    }

    let member = memberCache.get(lead.assignedTo);

    if (member === undefined) {
      const memberSnap = await db.collection('users').doc(lead.assignedTo).get();
      member = memberSnap.exists
        ? { id: memberSnap.id, ...memberSnap.data() }
        : null;
      memberCache.set(lead.assignedTo, member);
    }

    if (!member) {
      unassigned += 1;
      continue;
    }
    const group = groups.get(member.id) || {
      member,
      leads: []
    };

    group.leads.push({ ...lead, overdueCategory: category, overdueAt: due });
    groups.set(member.id, group);
  }

  const groupsArray = Array.from(groups.values())
    .map(group => ({
      memberId: group.member.id,
      memberName: firstNonEmpty(group.member.name, group.member.email, group.member.id),
      connected: group.member.active !== false && !!group.member.telegramConnected && !!group.member.telegramChatId,
      leads: group.leads
    }))
    .sort((a, b) => b.leads.length - a.leads.length || a.memberName.localeCompare(b.memberName));

  const result = {
    groups: groupsArray,
    total: groupsArray.reduce((sum, group) => sum + group.leads.length, 0),
    connectedGroups: groupsArray.filter(group => group.connected).length,
    unassigned,
    generatedAt: Date.now(),
    settings
  };

  teamOverdueCache = result;
  teamOverdueCacheAt = Date.now();
  return result;
  })();

  try {
    return await teamOverdueLoadPromise;
  } finally {
    teamOverdueLoadPromise = null;
  }
}

function splitTelegramMessage(text, maxLength = 3800) {
  if (String(text).length <= maxLength) {
    return [String(text)];
  }

  const lines = String(text).split('\n');
  const chunks = [];
  let current = '';

  for (const line of lines) {
    const candidate = current ? `${current}\n${line}` : line;

    if (candidate.length <= maxLength) {
      current = candidate;
      continue;
    }

    if (current) {
      chunks.push(current);
    }

    if (line.length <= maxLength) {
      current = line;
    } else {
      for (let index = 0; index < line.length; index += maxLength) {
        chunks.push(line.slice(index, index + maxLength));
      }
      current = '';
    }
  }

  if (current) {
    chunks.push(current);
  }

  return chunks.length ? chunks : [String(text)];
}

function teamOverdueMessage(memberName, leads) {
  const categoryLabels = {
    not_open: 'Not Open',
    follow_up: 'Follow-up',
    not_picking: 'Not Picking Call'
  };

  const lines = [
    '⚠️ <b>OVERDUE LEADS - TEAM NOTIFICATION</b>',
    '',
    `<b>Assigned To:</b> ${escapeHtml(memberName)}`,
    `<b>Total overdue:</b> ${leads.length}`,
    ''
  ];

  leads.forEach((lead, index) => {
    lines.push(
      `<b>${index + 1}. Lead #${escapeHtml(lead.slNo ?? lead.id)}</b>`,
      `👤 ${escapeHtml(firstNonEmpty(lead.fullName, lead.name, lead.customerName))}`,
      `📞 ${escapeHtml(firstNonEmpty(lead.phoneNumber, lead.phone, lead.mobile))}`,
      `🛠 ${escapeHtml(leadService(lead))}`,
      `📌 ${escapeHtml(categoryLabels[lead.overdueCategory] || lead.status || 'Overdue')}`,
      `📝 ${escapeHtml(leadNoteOrCallSummary(lead))}`,
      ''
    );
  });

  lines.push('Please update the lead status in the CRM after contacting the customer.');

  if (PUBLIC_BASE_URL) {
    lines.push('', `<a href="${escapeHtml(`${PUBLIC_BASE_URL}/dashboard.html`)}">Open CRM</a>`);
  }

  return lines.join('\n');
}

// ============================================================
// TELEGRAM MESSAGE HANDLER
// ============================================================

async function handleTelegramMessage(message) {
  if (!message?.text || !message.chat?.id) {
    return;
  }

  const chatId = String(message.chat.id);
  const text = message.text.trim();
  const lowerText = text.toLowerCase();
  const parts = text.split(/\s+/);
  const command = parts[0].split('@')[0].toLowerCase();
  const argument = parts.slice(1).join(' ').trim();

  if (command === '/start') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text:
        '👋 <b>Welcome to Abra Logistics CRM Bot</b>\n\n' +
        'Your Telegram Chat ID is:\n\n' +
        `<code>${escapeHtml(chatId)}</code>\n\n` +
        'Use /id anytime to see this Chat ID.\n\n' +
        'Use /help to see CRM assistant commands.',
      parse_mode: 'HTML'
    });
    return;
  }

  if (command === '/id') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text:
        '🆔 <b>Your Telegram Chat ID</b>\n\n' +
        `<code>${escapeHtml(chatId)}</code>\n\n` +
        'Copy this number and paste it into:\n' +
        '<b>CRM → Telegram → Telegram Chat ID</b>',
      parse_mode: 'HTML'
    });
    return;
  }

  if (command === '/disconnect') {
    const userSnap = await db.collection('users')
      .where('telegramChatId', '==', chatId)
      .limit(1)
      .get();

    if (userSnap.empty) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: 'This Telegram account is not connected to a CRM user.'
      });
      return;
    }

    await userSnap.docs[0].ref.update({
      telegramChatId: null,
      telegramConnected: false,
      telegramUsername: null,
      telegramFirstName: null,
      telegramLastName: null,
      telegramConnectedAt: null,
      telegramUpdatedAt: FieldValue.serverTimestamp()
    });

    clearUserCache(userSnap.docs[0].id);
    managementTelegramUsersCache = null;
    managementTelegramUsersCacheAt = 0;

    await telegram('sendMessage', {
      chat_id: chatId,
      text: '🔌 Telegram notifications have been disconnected from the CRM.'
    });
    return;
  }

  const user = await getTelegramCRMUserByChatId(chatId);

  if (command === '/status') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text: user
        ? '🟢 <b>Telegram is connected to your CRM account.</b>'
        : '🔴 This Telegram account is not connected to the CRM.',
      parse_mode: 'HTML'
    });
    return;
  }

  if (command === '/help' || lowerText === 'help' || lowerText === 'menu') {
    await telegram('sendMessage', {
      chat_id: chatId,
      text:
        '🤖 <b>Abra Logistics CRM Assistant</b>\n\n' +
        '<b>Connection</b>\n' +
        '/id - Show your Telegram Chat ID\n' +
        '/status - Check CRM connection\n' +
        '/disconnect - Disconnect Telegram\n\n' +
        '<b>Management reports</b>\n' +
        "/today - Today's lead report\n" +
        "/yesterday - Yesterday's lead report\n" +
        '/report YYYY-MM-DD - Report for a date\n' +
        "/classifications - Today's classifications\n" +
        "/campaigns - Today's campaign summary\n\n" +
        'You can also type: <i>today report</i>, <i>yesterday report</i>, <i>how many leads</i>, or <i>show classifications</i>.',
      parse_mode: 'HTML'
    });
    return;
  }

  const wantsToday = command === '/today' || lowerText === 'today report' || lowerText === 'today';
  const wantsYesterday = command === '/yesterday' || lowerText === 'yesterday report' || lowerText === 'yesterday';
  const wantsReport = command === '/report' || lowerText === 'report' || lowerText.startsWith('report ');
  const wantsClassifications = command === '/classifications' || lowerText.includes('classification') || lowerText.includes('how many leads') || lowerText.includes('how many lead');
  const wantsCampaigns = command === '/campaigns' || lowerText.includes('active campaigns') || lowerText.includes('campaign report') || lowerText === 'campaigns';

  if (wantsToday || wantsYesterday || wantsReport || wantsClassifications || wantsCampaigns) {
    if (!user) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: '🔐 Connect this Telegram account to a CRM user before using CRM reports. Use the CRM → Telegram page to connect your Chat ID.'
      });
      return;
    }

    if (!isAdminOrSuperAdmin(user)) {
      await telegram('sendMessage', {
        chat_id: chatId,
        text: '🔐 Management reports are available only to Admin and Super Admin Telegram accounts.'
      });
      return;
    }

    const settings = await getCRMSettings();
    const timezone = settings.timezone || 'Asia/Kolkata';
    let dateKey = localDateKey(new Date(), timezone);

    if (wantsYesterday) {
      dateKey = localDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000), timezone);
    } else if (wantsReport && command === '/report') {
      dateKey = parseTelegramReportDate(argument, timezone);
      if (!dateKey) {
        await telegram('sendMessage', {
          chat_id: chatId,
          text: 'Use /report YYYY-MM-DD, for example: /report 2026-08-25'
        });
        return;
      }
    } else if (wantsReport && lowerText.startsWith('report ')) {
      dateKey = parseTelegramReportDate(lowerText.slice(7), timezone);
      if (!dateKey) {
        await telegram('sendMessage', {
          chat_id: chatId,
          text: 'Use report YYYY-MM-DD, for example: report 2026-08-25'
        });
        return;
      }
    }

    if (wantsCampaigns) {
      const campaigns = await buildTelegramCampaignReport(dateKey, timezone);
      await telegram('sendMessage', {
        chat_id: chatId,
        text: telegramCampaignReportMessage(campaigns, dateKey),
        parse_mode: 'HTML',
        disable_web_page_preview: true
      });
      return;
    }

    const report = await buildDailyReport(dateKey, timezone);
    const title = wantsYesterday ? 'YESTERDAY LEAD REPORT' : 'LEAD REPORT';

    await telegram('sendMessage', {
      chat_id: chatId,
      text: telegramReportMessage(report, dateKey, title),
      parse_mode: 'HTML',
      disable_web_page_preview: true
    });
    return;
  }

  await telegram('sendMessage', {
    chat_id: chatId,
    text:
      '🤖 I can help with CRM reports.\n\n' +
      'Try <b>/help</b>, <b>today report</b>, <b>yesterday report</b>, <b>how many leads</b>, or <b>campaign report</b>.',
    parse_mode: 'HTML'
  });
}

// ============================================================
// TELEGRAM WEBHOOK
// ============================================================

app.post(
  '/telegram/webhook',
  async (req, res) => {

    if (
      WEBHOOK_SECRET &&
      req.get(
        'X-Telegram-Bot-Api-Secret-Token'
      ) !== WEBHOOK_SECRET
    ) {
      return res
        .status(401)
        .send('Unauthorized');
    }


    // Telegram expects a quick response.
    res.sendStatus(200);


    try {

      await handleTelegramMessage(
        req.body.message
      );

    } catch (error) {

      console.error(
        'Telegram webhook error:',
        error.message
      );
    }
  }
);


// ============================================================
// PROVISION AN EXISTING FIREBASE AUTH ACCOUNT
// ============================================================
// A team member may already exist in Firebase Authentication.
// The browser cannot resolve another user's Auth UID by email, so the
// Super Admin's authenticated request is handled here with Firebase Admin.
app.post(
  '/api/admin/provision-existing-user',
  verifyFirebaseUser,
  async (req, res) => {
    try {
      if (req.crmUser?.role !== 'superadmin') {
        return res.status(403).json({
          ok: false,
          error: 'Only the Super Admin can provision an existing account.'
        });
      }

      const name = String(req.body?.name || '').trim();
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = String(req.body?.role || 'member').trim().toLowerCase();

      const allowedRoles = new Set(['admin', 'member', 'hr', 'marketing']);

      if (!name || !email || !allowedRoles.has(role)) {
        return res.status(400).json({
          ok: false,
          error: 'Name, valid email, and role are required.'
        });
      }

      let authUser;
      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (error) {
        if (error?.code === 'auth/user-not-found') {
          return res.status(404).json({
            ok: false,
            error: 'No Firebase Authentication account was found for this email.'
          });
        }
        throw error;
      }

      const userRef = db.collection('users').doc(authUser.uid);
      const existing = await userRef.get();
      const now = FieldValue.serverTimestamp();

      const profile = {
        name,
        email: authUser.email || email,
        role,
        active: true,
        updatedAt: now
      };

      if (!existing.exists) {
        profile.createdBy = req.firebaseUser.uid;
        profile.createdAt = now;
      }

      await userRef.set(profile, { merge: true });
      clearUserCache(authUser.uid);

      return res.json({
        ok: true,
        uid: authUser.uid,
        existed: existing.exists,
        message: existing.exists
          ? 'Existing CRM profile updated.'
          : 'Existing Firebase account provisioned into the CRM.'
      });
    } catch (error) {
      console.error('Provision existing user error:', error);
      return res.status(500).json({
        ok: false,
        error: publicFirebaseError(error)
      });
    }
  }
);


// ============================================================
// HEALTH CHECK
// ============================================================

app.get(
  '/api/health',
  async (_req, res) => {

    try {

      const bot =
        await telegram('getMe');

      res.json({
        ok: true,

        server:
          'running',

        telegram: {
          username:
            bot.username,

          name:
            bot.first_name
        },

        webhook:
          `${PUBLIC_BASE_URL}${WEBHOOK_PATH}`,

        firebase:
          'connected'
      });

    } catch (error) {

      res.status(500).json({
        ok: false,
        error:
          error.message
      });
    }
  }
);


// ============================================================
// TELEGRAM STATUS
// ============================================================

app.get(
  '/api/telegram/status',
  verifyFirebaseUser,
  async (req, res) => {

    try {

      const user =
        req.crmUser;

      const bot =
        await telegram('getMe');


      const connected =
        user.telegramConnected ===
          true &&
        !!user.telegramChatId;


      res.json({
        ok: true,

        connected,

        chatId:
          user.telegramChatId ||
          null,

        username:
          user.telegramUsername ||
          null,

        role:
          user.role ||
          null,

        name:
          user.name ||
          user.email ||
          null,

        botUsername:
          bot.username,

        botName:
          bot.first_name ||
          'Telegram Bot'
      });

    } catch (error) {

      console.error(
        'Telegram status error:',
        error.message
      );

      res.status(500).json({
        ok: false,

        error:
          error.message
      });
    }
  }
);


// ============================================================
// TELEGRAM MANUAL CONNECT
// ============================================================

app.post(
  '/api/telegram/connect',
  verifyFirebaseUser,
  async (req, res) => {

    try {

      const rawChatId =
        req.body?.chatId;


      // ------------------------------------------------------
      // Validate existence
      // ------------------------------------------------------

      if (
        rawChatId === undefined ||
        rawChatId === null
      ) {

        return res.status(400).json({
          ok: false,

          error:
            'Telegram Chat ID is required.'
        });
      }


      const chatId =
        String(
          rawChatId
        ).trim();


      // ------------------------------------------------------
      // Validate numeric Chat ID
      // ------------------------------------------------------

      if (
        !/^-?\d+$/.test(chatId)
      ) {

        return res.status(400).json({
          ok: false,

          error:
            'Invalid Telegram Chat ID. Enter the numeric Chat ID from /id.'
        });
      }


      if (
        chatId.length < 5 ||
        chatId.length > 20
      ) {

        return res.status(400).json({
          ok: false,

          error:
            'Invalid Telegram Chat ID.'
        });
      }


      // ------------------------------------------------------
      // Prevent same Telegram account from being connected
      // to multiple CRM users.
      // ------------------------------------------------------

      const existingSnapshot =
        await db
          .collection('users')
          .where(
            'telegramChatId',
            '==',
            chatId
          )
          .limit(1)
          .get();


      if (
        !existingSnapshot.empty
      ) {

        const existingUser =
          existingSnapshot.docs[0];


        if (
          existingUser.id !==
          req.firebaseUser.uid
        ) {

          return res.status(409).json({
            ok: false,

            error:
              'This Telegram Chat ID is already connected to another CRM account.'
          });
        }
      }


      // ------------------------------------------------------
      // Verify Chat ID by sending a Telegram message
      // ------------------------------------------------------

      try {

        await telegram(
          'sendMessage',
          {
            chat_id:
              chatId,

            text:
              '🧪 <b>Telegram connection test</b>\n\n' +
              'Your Telegram account is being connected to the Abra Logistics CRM.\n\n' +
              'You will receive new lead assignments and overdue lead reminders here.',

            parse_mode:
              'HTML'
          }
        );

      } catch (telegramError) {

        console.error(
          'Telegram Chat ID verification failed:',
          telegramError.message
        );


        return res.status(400).json({
          ok: false,

          error:
            'Telegram could not send a message to this Chat ID. ' +
            'Make sure you opened the bot and pressed /start, then verify the Chat ID.'
        });
      }


      // ------------------------------------------------------
      // Save Telegram connection
      // ------------------------------------------------------

      await db
        .collection('users')
        .doc(req.firebaseUser.uid)
        .update({

          telegramChatId:
            chatId,

          telegramConnected:
            true,

          telegramConnectedAt:
            FieldValue.serverTimestamp(),

          telegramUpdatedAt:
            FieldValue.serverTimestamp()
        });

      clearUserCache(req.firebaseUser.uid);
      managementTelegramUsersCache = null;
      managementTelegramUsersCacheAt = 0;


      console.log(
        `🔗 Telegram connected manually: ${
          req.crmUser.name ||
          req.crmUser.email
        } -> ${chatId}`
      );


      res.json({

        ok: true,

        connected:
          true,

        chatId,

        message:
          'Telegram connected successfully.'
      });


    } catch (error) {

      console.error(
        'Telegram manual connect error:',
        error.message
      );


      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);


// ============================================================
// TELEGRAM TEST MESSAGE
// ============================================================

app.post(
  '/api/telegram/test',
  verifyFirebaseUser,
  async (req, res) => {

    try {

      const user =
        req.crmUser;


      if (
        !user.telegramChatId
      ) {

        return res.status(400).json({

          ok: false,

          error:
            'Telegram Chat ID is not connected.'
        });
      }


      await telegram(
        'sendMessage',
        {
          chat_id:
            String(
              user.telegramChatId
            ),

          text:
            '🧪 <b>Telegram Test Successful</b>\n\n' +

            `👤 CRM User: ${escapeHtml(
              user.name ||
              user.email ||
              'User'
            )}\n\n` +

            'You will receive:\n' +

            '🔔 New lead assignments\n' +

            '⚠️ Overdue lead reminders',

          parse_mode:
            'HTML'
        }
      );


      res.json({

        ok: true,

        message:
          'Test message sent successfully.'
      });


    } catch (error) {

      console.error(
        'Telegram test error:',
        error.message
      );


      res.status(400).json({

        ok: false,

        error:
          'Could not send the test message. ' +
          error.message
      });
    }
  }
);


// ============================================================
// TELEGRAM DISCONNECT
// ============================================================

app.post(
  '/api/telegram/disconnect',
  verifyFirebaseUser,
  async (req, res) => {

    try {

      await db
        .collection('users')
        .doc(req.firebaseUser.uid)
        .update({

          telegramChatId:
            null,

          telegramConnected:
            false,

          telegramUsername:
            null,

          telegramFirstName:
            null,

          telegramLastName:
            null,

          telegramConnectedAt:
            null,

          telegramUpdatedAt:
            FieldValue.serverTimestamp()
        });


      console.log(
        `🔌 Telegram disconnected: ${
          req.crmUser.name ||
          req.crmUser.email
        }`
      );


      res.json({

        ok: true,

        connected:
          false,

        message:
          'Telegram disconnected successfully.'
      });


    } catch (error) {

      console.error(
        'Telegram disconnect error:',
        error.message
      );


      res.status(500).json({

        ok: false,

        error:
          error.message
      });
    }
  }
);


// ============================================================
// TELEGRAM TEAM OVERDUE API
// ============================================================

app.get(
  '/api/telegram/team-overdue',
  verifyFirebaseUser,
  async (req, res) => {
    try {
      if (!isAdminOrSuperAdmin(req.crmUser)) {
        return res.status(403).json({
          ok: false,
          error: 'Only Admin and Super Admin users can view team overdue leads.'
        });
      }

      const data = await getTeamOverdueLeads({
        forceRefresh: String(req.query.refresh || '') === '1'
      });

      res.json({
        ok: true,
        total: data.total,
        connectedGroups: data.connectedGroups,
        unassigned: data.unassigned,
        generatedAt: data.generatedAt,
        groups: data.groups.map(group => ({
          memberId: group.memberId,
          memberName: group.memberName,
          connected: group.connected,
          count: group.leads.length,
          leads: group.leads.map(lead => ({
            id: lead.id,
            slNo: lead.slNo ?? lead.id,
            fullName: firstNonEmpty(lead.fullName, lead.name, lead.customerName),
            phone: firstNonEmpty(lead.phoneNumber, lead.phone, lead.mobile),
            service: leadService(lead),
            status: firstNonEmpty(lead.status, '—'),
            category: lead.overdueCategory,
            dueAt: lead.overdueAt,
            note: leadNoteOrCallSummary(lead)
          }))
        }))
      });
    } catch (error) {
      console.error('Telegram team overdue preview error:', error.message);
      res.status(isFirestoreQuotaError(error) ? 503 : 500).json({ ok: false, error: publicFirebaseError(error) });
    }
  }
);

app.post(
  '/api/telegram/notify-team-overdue',
  verifyFirebaseUser,
  async (req, res) => {
    try {
      if (!isAdminOrSuperAdmin(req.crmUser)) {
        return res.status(403).json({
          ok: false,
          error: 'Only Admin and Super Admin users can notify the team.'
        });
      }

      const data = await getTeamOverdueLeads({ forceRefresh: true });
      const recipients = data.groups.filter(group => group.connected && group.leads.length);

      if (!recipients.length) {
        return res.json({
          ok: true,
          sent: false,
          sentCount: 0,
          totalOverdue: data.total,
          message: data.total
            ? 'No overdue leads have a connected Telegram recipient.'
            : 'There are no overdue leads to notify.'
        });
      }

      const notificationRef = db.collection('telegramTeamNotifications').doc();
      const notificationId = notificationRef.id;
      const sentRecipients = [];
      const failedRecipients = [];

      for (const group of recipients) {
        try {
          const messageChunks = splitTelegramMessage(
            teamOverdueMessage(group.memberName, group.leads)
          );
          let sentAll = true;
          let lastReason = 'send-failed';

          for (const chunk of messageChunks) {
            const result = await sendToMember(
              group.memberId,
              chunk
            );

            if (!result.sent) {
              sentAll = false;
              lastReason = result.reason || lastReason;
              break;
            }
          }

          if (sentAll) {
            sentRecipients.push({
              memberId: group.memberId,
              memberName: group.memberName,
              leadCount: group.leads.length
            });
          } else {
            failedRecipients.push({
              memberId: group.memberId,
              memberName: group.memberName,
              leadCount: group.leads.length,
              reason: lastReason
            });
          }
        } catch (error) {
          failedRecipients.push({
            memberId: group.memberId,
            memberName: group.memberName,
            leadCount: group.leads.length,
            reason: error.message
          });
        }
      }

      await notificationRef.set({
        createdAt: FieldValue.serverTimestamp(),
        sentBy: req.firebaseUser.uid,
        sentByName: firstNonEmpty(req.crmUser.name, req.crmUser.email, req.firebaseUser.uid),
        totalOverdue: data.total,
        sentCount: sentRecipients.length,
        sentLeadCount: sentRecipients.reduce((sum, item) => sum + item.leadCount, 0),
        failedCount: failedRecipients.length,
        recipients: sentRecipients,
        failedRecipients,
        unassigned: data.unassigned
      });

      clearTeamOverdueCache();

      res.json({
        ok: true,
        sent: sentRecipients.length > 0,
        notificationId,
        sentCount: sentRecipients.length,
        sentLeadCount: sentRecipients.reduce((sum, item) => sum + item.leadCount, 0),
        failedCount: failedRecipients.length,
        totalOverdue: data.total,
        unassigned: data.unassigned,
        recipients: sentRecipients,
        failedRecipients
      });
    } catch (error) {
      console.error('Telegram team overdue notification error:', error.message);
      res.status(isFirestoreQuotaError(error) ? 503 : 500).json({ ok: false, error: publicFirebaseError(error) });
    }
  }
);

app.get(
  '/api/telegram/team-notification-history',
  verifyFirebaseUser,
  async (req, res) => {
    try {
      if (!isAdminOrSuperAdmin(req.crmUser)) {
        return res.status(403).json({
          ok: false,
          error: 'Only Admin and Super Admin users can view Telegram team notification history.'
        });
      }

      const limit = Math.min(Math.max(Number(req.query.limit || 10), 1), 50);
      const snapshot = await db
        .collection('telegramTeamNotifications')
        .orderBy('createdAt', 'desc')
        .limit(limit)
        .get();

      res.json({
        ok: true,
        history: snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: timestampMs(doc.data().createdAt)
        }))
      });
    } catch (error) {
      console.error('Telegram team notification history error:', error.message);
      res.status(500).json({ ok: false, error: error.message });
    }
  }
);

// ============================================================
// SERVE CRM FRONTEND
// ============================================================

app.use(
  express.static(
    __dirname,
    {
      extensions: ['html']
    }
  )
);


// ============================================================
// SPA FALLBACK
// ============================================================

app.get(
  /.*/,
  (req, res, next) => {

    if (
      req.path.startsWith('/api/') ||
      req.path.startsWith('/telegram/')
    ) {
      return next();
    }

    res.sendFile(
      path.join(
        __dirname,
        'index.html'
      )
    );
  }
);


// ============================================================
// TELEGRAM WEBHOOK / LOCAL POLLING
// ============================================================

async function configureTelegramWebhook() {
  if (TELEGRAM_MODE === 'polling') {
    try {
      // A bot cannot receive getUpdates while a webhook is active.
      // This also removes an old Cloudflare/Render webhook when testing locally.
      await telegram('deleteWebhook', {
        drop_pending_updates: false
      });

      console.log(
        '🧹 Telegram webhook cleared. Local polling will be used.'
      );

      startTelegramPolling();
    } catch (error) {
      console.error(
        '❌ Could not clear Telegram webhook:',
        error.message
      );
    }

    return;
  }

  if (TELEGRAM_MODE !== 'webhook') {
    console.warn(
      `⚠️ Unknown TELEGRAM_MODE="${TELEGRAM_MODE}". Use "polling" or "webhook". Falling back to polling.`
    );

    try {
      await telegram('deleteWebhook', {
        drop_pending_updates: false
      });
      startTelegramPolling();
    } catch (error) {
      console.error(
        '❌ Could not start fallback Telegram polling:',
        error.message
      );
    }

    return;
  }

  if (!PUBLIC_BASE_URL) {
    console.warn(
      '⚠️ PUBLIC_BASE_URL/RENDER_EXTERNAL_URL is missing. Telegram webhook was not configured.'
    );

    return;
  }

  try {
    const result =
      await telegram(
        'setWebhook',
        {
          url:
            `${PUBLIC_BASE_URL}${WEBHOOK_PATH}`,

          allowed_updates:
            ['message'],

          ...(WEBHOOK_SECRET
            ? {
                secret_token:
                  WEBHOOK_SECRET
              }
            : {})
        }
      );

    console.log(
      `🔗 Telegram webhook configured: ${PUBLIC_BASE_URL}${WEBHOOK_PATH}`
    );

    console.log(
      `Telegram webhook result: ${JSON.stringify(result)}`
    );
  } catch (error) {
    console.error(
      'Telegram webhook setup failed:',
      error.message
    );
  }
}


// ============================================================
// TELEGRAM LOCAL POLLING
// ============================================================

async function startTelegramPolling() {
  if (telegramPollingRunning) {
    console.log(
      'ℹ️ Telegram local polling is already running.'
    );
    return;
  }

  telegramPollingRunning = true;
  telegramPollingStopRequested = false;

  console.log(
    '📡 Starting Telegram local polling...'
  );

  // Get the current update offset so old messages are not replayed
  // every time the local server restarts.
  try {
    const pending =
      await telegram(
        'getUpdates',
        {
          offset: -1,
          limit: 1,
          timeout: 0,
          allowed_updates: ['message']
        }
      );

    if (Array.isArray(pending) && pending.length) {
      telegramPollingOffset =
        Number(pending[pending.length - 1].update_id) + 1;

      console.log(
        `↪️ Telegram polling starting from update ${telegramPollingOffset}`
      );
    }
  } catch (error) {
    console.warn(
      '⚠️ Could not initialize Telegram polling offset:',
      error.message
    );
  }

  while (!telegramPollingStopRequested) {
    try {
      const updates =
        await telegram(
          'getUpdates',
          {
            offset:
              telegramPollingOffset || undefined,

            timeout: 25,

            allowed_updates:
              ['message']
          }
        );

      if (!Array.isArray(updates)) {
        continue;
      }

      for (const update of updates) {
        if (
          update?.update_id != null
        ) {
          telegramPollingOffset =
            Number(update.update_id) + 1;
        }

        if (!update?.message) {
          continue;
        }

        console.log(
          `📩 Telegram message from ${update.message.chat?.id}: ${update.message.text || '[non-text message]'}`
        );

        try {
          await handleTelegramMessage(
            update.message
          );
        } catch (error) {
          console.error(
            '❌ Telegram message handler error:',
            error.message
          );
        }
      }
    } catch (error) {
      const message =
        error?.message || String(error);

      console.error(
        '❌ Telegram polling error:',
        message
      );

      // A Telegram 409 usually means another webhook/poller is still
      // consuming updates. Retry after a short delay instead of crashing.
      if (
        message.includes('Conflict') ||
        message.includes('getUpdates')
      ) {
        console.warn(
          '⚠️ Telegram update conflict detected. Make sure this bot is not being used by another polling process or webhook.'
        );
      }

      await new Promise(resolve =>
        setTimeout(
          resolve,
          Math.max(
            TELEGRAM_POLL_INTERVAL_MS,
            3000
          )
        )
      );
    }
  }

  telegramPollingRunning = false;

  console.log(
    '🛑 Telegram local polling stopped.'
  );
}


// ============================================================
// TELEGRAM RUNTIME STATUS
// ============================================================

app.get(
  '/api/telegram/runtime',
  async (_req, res) => {
    try {
      const webhookInfo =
        await telegram('getWebhookInfo');

      res.json({
        ok: true,
        mode: TELEGRAM_MODE,
        polling:
          telegramPollingRunning,
        webhook: {
          url:
            webhookInfo?.url || '',
          pendingUpdateCount:
            webhookInfo?.pending_update_count || 0,
          lastErrorDate:
            webhookInfo?.last_error_date || null,
          lastErrorMessage:
            webhookInfo?.last_error_message || null
        }
      });
    } catch (error) {
      res.status(500).json({
        ok: false,
        error: error.message
      });
    }
  }
);


// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================

async function shutdown(signal) {
  console.log(
    `🛑 Received ${signal}. Shutting down...`
  );

  telegramPollingStopRequested = true;

  // Do not delete a production webhook during shutdown.
  // The webhook should remain configured on Render.
  console.log(
    '✅ Telegram shutdown state updated.'
  );

  process.exit(0);
}

process.on(
  'SIGINT',
  () => shutdown('SIGINT')
);

process.on(
  'SIGTERM',
  () => shutdown('SIGTERM')
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  async () => {

    console.log(
      `🚀 CRM + Telegram server running on port ${PORT}`
    );

    console.log(
      `🤖 Telegram mode: ${TELEGRAM_MODE}`
    );

    console.log(
      `🔎 Health: ${
        PUBLIC_BASE_URL ||
        `http://localhost:${PORT}`
      }/api/health`
    );

    console.log(
      `🔎 Telegram runtime: http://localhost:${PORT}/api/telegram/runtime`
    );

    await configureTelegramWebhook();


    if (DISABLE_BACKGROUND_TELEGRAM_SCANS) {
      console.log(
        '🧪 Local Telegram mode: background Firestore notification scans are disabled.'
      );
    } else {
      await initializeAssignmentDeliveryBaseline();

      // Start realtime status notifications before the first polling cycle.
      // This makes Interested / Not Interested alerts independent of the
      // reminder scan interval.
      startLeadStatusRealtimeListener();

      // Forward management-audience marketing events created by the CRM UI
      // to every connected Admin / Super Admin Telegram account.
      startManagementNotificationRealtimeListener();

      await runNotificationCycle();

      setInterval(
        runNotificationCycle,
        REMINDER_SCAN_MS
      );
    }
  }
);