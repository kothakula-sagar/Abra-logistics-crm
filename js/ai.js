// ============================================================
// AI.JS — AI Settings: secure per-user Groq API key storage,
//         test connection, and shared Groq call helper used by
//         ALL AI features in the CRM (pitch, reports, etc.)
//
// API keys are stored in Firestore under users/{uid}.aiSettings
// They are NEVER hardcoded, NEVER in source control.
// ============================================================

const GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions";

const AI_MODELS = [
  { value: "llama-3.3-70b-versatile",      label: "Llama 3.3 70B Versatile (Recommended)" },
  { value: "llama-3.1-8b-instant",          label: "Llama 3.1 8B Instant (Fastest)" },
  { value: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill Llama 70B" }
];

const AI_DEFAULT_MODEL = "llama-3.3-70b-versatile";

// In-memory cache — updated on save/delete, no logout required
let _aiSettings = {
  groqApiKey: "",
  model: AI_DEFAULT_MODEL,
  lastUpdated: null
};

// ── Bootstrap: load AI settings for the logged-in user ──────
async function loadAISettings() {
  try {
    const doc = await usersRef.doc(CURRENT_USER.uid).get();
    const data = doc.data();
    if (data && data.aiSettings) {
      _aiSettings = {
        groqApiKey: data.aiSettings.groqApiKey || "",
        model:      data.aiSettings.model      || AI_DEFAULT_MODEL,
        lastUpdated: data.aiSettings.lastUpdated || null
      };
    }
  } catch (err) {
    console.error("Failed to load AI settings:", err);
  }
}

// ── Public getter used by pitch.js and any future AI feature ─
function getAISettings() {
  return { ..._aiSettings };
}

// ── Core Groq call — used by ALL AI features ─────────────────
// Throws if key is missing or API returns an error.
async function callGroq(messages, { temperature = 0.75, maxTokens = 1200 } = {}) {
  const { groqApiKey, model } = _aiSettings;

  if (!groqApiKey) {
    throw new AIKeyMissingError();
  }

  const resp = await fetch(GROQ_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${groqApiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      max_tokens: maxTokens
    })
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new Error(`Groq API error ${resp.status}: ${body}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

// ── Custom error so callers can show the "configure key" UI ──
class AIKeyMissingError extends Error {
  constructor() {
    super("Groq API key not configured.");
    this.name = "AIKeyMissingError";
  }
}

// ── Check whether to show the first-login welcome modal ──────
async function checkAISetupPrompt() {
  const doc  = await usersRef.doc(CURRENT_USER.uid).get();
  const data = doc.data();
  const hasKey = data?.aiSettings?.groqApiKey?.trim().length > 0;
  if (!hasKey) {
    const modal = bootstrap.Modal.getOrCreateInstance(
      document.getElementById("aiWelcomeModal")
    );
    modal.show();
  }
}

// ─────────────────────────────────────────────────────────────
// AI SETTINGS PAGE LOGIC
// ─────────────────────────────────────────────────────────────

function renderAISettingsView() {
  const wrap = document.getElementById("view-aisettings");
  if (!wrap) return;

  const { groqApiKey, model, lastUpdated } = _aiSettings;
  const hasKey   = !!groqApiKey;
  const maskedKey = hasKey ? groqApiKey.slice(0, 4) + "•".repeat(Math.min(36, groqApiKey.length - 4)) : "";
  const modelOptions = AI_MODELS.map(m =>
    `<option value="${m.value}" ${m.value === model ? "selected" : ""}>${m.label}</option>`
  ).join("");

  const lastUpdatedLabel = lastUpdated
    ? (lastUpdated.toDate ? lastUpdated.toDate() : new Date(lastUpdated))
        .toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  wrap.innerHTML = `
    <div class="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-3">
      <div>
        <h1 class="page-title"><i class="bi bi-robot me-2"></i>AI Settings</h1>
        <p class="page-subtitle">Configure your personal Groq API key. Your key is stored securely and never shared.</p>
      </div>
    </div>

    <div class="row g-3">

      <!-- ── API Key Card ── -->
      <div class="col-12 col-lg-7">
        <div class="ai-settings-card">
          <div class="ai-settings-card-header">
            <i class="bi bi-key-fill me-2"></i>Groq API Key
          </div>
          <div class="ai-settings-card-body">

            <!-- Status banner -->
            <div id="aiKeyStatus" class="ai-status-badge mb-3 ${hasKey ? "ai-status-connected" : "ai-status-unconfigured"}">
              <i class="bi ${hasKey ? "bi-check-circle-fill" : "bi-x-circle-fill"} me-2"></i>
              ${hasKey ? "Connected" : "Not Configured"}
              ${lastUpdatedLabel ? `<span class="ai-status-updated ms-auto">Last updated: ${lastUpdatedLabel}</span>` : ""}
            </div>

            <!-- Key input row -->
            <label class="form-label fw-semibold">API Key</label>
            <div class="input-group mb-1">
              <input type="password"
                     id="aiApiKeyInput"
                     class="form-control font-monospace"
                     placeholder="${hasKey ? maskedKey : "gsk_..."}"
                     value="${hasKey ? groqApiKey : ""}"
                     autocomplete="off"
                     spellcheck="false">
              <button class="btn btn-outline-secondary"
                      type="button"
                      id="aiKeyToggleBtn"
                      onclick="toggleApiKeyVisibility()"
                      title="Show / Hide">
                <i class="bi bi-eye" id="aiKeyToggleIcon"></i>
              </button>
              <button class="btn btn-outline-secondary"
                      type="button"
                      onclick="copyApiKey()"
                      title="Copy API Key"
                      ${!hasKey ? "disabled" : ""}>
                <i class="bi bi-clipboard" id="aiKeyCopyIcon"></i>
              </button>
            </div>
            <div class="form-text mb-3">
              Get your free key at
              <a href="https://console.groq.com/keys" target="_blank" rel="noopener noreferrer">
                console.groq.com/keys
              </a>
            </div>

            <!-- Model selector -->
            <label class="form-label fw-semibold">AI Model</label>
            <select id="aiModelSelect" class="form-select mb-3">
              ${modelOptions}
            </select>

            <!-- Action buttons -->
            <div class="d-flex flex-wrap gap-2">
              <button class="btn btn-brand" onclick="saveAISettings()">
                <i class="bi bi-floppy-fill me-1"></i>
                ${hasKey ? "Update Settings" : "Save Settings"}
              </button>
              <button class="btn btn-outline-primary" onclick="testAIConnection()">
                <i class="bi bi-wifi me-1"></i>Test Connection
              </button>
              ${hasKey ? `
              <button class="btn btn-outline-danger" onclick="deleteApiKey()">
                <i class="bi bi-trash me-1"></i>Delete API Key
              </button>` : ""}
              <button class="btn btn-outline-secondary" onclick="resetAISettingsForm()">
                <i class="bi bi-arrow-counterclockwise me-1"></i>Reset
              </button>
            </div>

            <!-- Test connection result -->
            <div id="aiTestResult" class="mt-3 d-none"></div>

          </div>
        </div>
      </div>

      <!-- ── Info / Help Card ── -->
      <div class="col-12 col-lg-5">
        <div class="ai-settings-card">
          <div class="ai-settings-card-header">
            <i class="bi bi-info-circle-fill me-2"></i>How it works
          </div>
          <div class="ai-settings-card-body ai-help-body">
            <ul class="ai-help-list">
              <li><i class="bi bi-shield-lock-fill text-success me-2"></i>Your key is stored only in <strong>your account</strong> — no one else can read it.</li>
              <li><i class="bi bi-arrow-repeat text-primary me-2"></i>Updates take effect <strong>immediately</strong> — no logout needed.</li>
              <li><i class="bi bi-robot text-purple me-2"></i>All AI features (Sales Pitch, Reports, etc.) automatically use this key.</li>
              <li><i class="bi bi-gift text-warning me-2"></i>Groq offers a <strong>free tier</strong> with generous limits. Perfect for a sales team.</li>
            </ul>
            <hr class="my-3">
            <div class="ai-model-info">
              <div class="fw-semibold small mb-2">Model Guide</div>
              <div class="ai-model-row"><span class="ai-model-name">Llama 3.3 70B</span><span class="ai-model-desc">Best quality · Recommended</span></div>
              <div class="ai-model-row"><span class="ai-model-name">Llama 3.1 8B</span><span class="ai-model-desc">Fastest response · Light tasks</span></div>
              <div class="ai-model-row"><span class="ai-model-name">DeepSeek R1</span><span class="ai-model-desc">Strong reasoning · Complex tasks</span></div>
            </div>
          </div>
        </div>
      </div>

    </div>`;
}

// ── Save / Update ─────────────────────────────────────────────
async function saveAISettings() {
  const key   = document.getElementById("aiApiKeyInput")?.value.trim();
  const model = document.getElementById("aiModelSelect")?.value;

  if (!key) {
    toast("Please enter your Groq API Key.", "warning");
    return;
  }
  if (!key.startsWith("gsk_")) {
    toast("That doesn't look like a valid Groq key (should start with gsk_).", "warning");
    return;
  }

  try {
    const now = firebase.firestore.Timestamp.now();
    await usersRef.doc(CURRENT_USER.uid).update({
      "aiSettings.groqApiKey": key,
      "aiSettings.model":      model,
      "aiSettings.lastUpdated": now
    });

    // Update in-memory cache immediately — no logout needed
    _aiSettings = { groqApiKey: key, model, lastUpdated: now };

    toast("AI Settings saved successfully.", "success");
    renderAISettingsView();
  } catch (err) {
    console.error("Save AI settings failed:", err);
    toast("Failed to save AI settings. Please try again.", "danger");
  }
}

// ── Delete API Key ────────────────────────────────────────────
async function deleteApiKey() {
  if (!confirm("Delete your Groq API Key? AI features will stop working until you add a new one.")) return;
  try {
    await usersRef.doc(CURRENT_USER.uid).update({
      "aiSettings.groqApiKey": firebase.firestore.FieldValue.delete(),
      "aiSettings.lastUpdated": firebase.firestore.Timestamp.now()
    });
    _aiSettings.groqApiKey = "";
    toast("API Key deleted.", "success");
    renderAISettingsView();
  } catch (err) {
    console.error("Delete API key failed:", err);
    toast("Failed to delete API key.", "danger");
  }
}

// ── Test Connection ───────────────────────────────────────────
async function testAIConnection() {
  const keyInput  = document.getElementById("aiApiKeyInput")?.value.trim();
  const modelSel  = document.getElementById("aiModelSelect")?.value;
  const resultEl  = document.getElementById("aiTestResult");
  const testBtn   = document.querySelector('[onclick="testAIConnection()"]');

  if (!keyInput) {
    toast("Enter an API key first.", "warning");
    return;
  }

  resultEl.className = "mt-3 ai-test-running";
  resultEl.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span>Testing connection…`;
  resultEl.classList.remove("d-none");
  if (testBtn) testBtn.disabled = true;

  try {
    const resp = await fetch(GROQ_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${keyInput}`
      },
      body: JSON.stringify({
        model: modelSel || AI_DEFAULT_MODEL,
        messages: [{ role: "user", content: "Reply with only the word: OK" }],
        max_tokens: 5,
        temperature: 0
      })
    });

    if (resp.ok) {
      resultEl.className = "mt-3 ai-test-success";
      resultEl.innerHTML = `<i class="bi bi-check-circle-fill me-2"></i>Connection Successful — key is valid!`;
    } else {
      const body = await resp.text().catch(() => "");
      resultEl.className = "mt-3 ai-test-fail";
      resultEl.innerHTML = `<i class="bi bi-x-circle-fill me-2"></i>Invalid API Key (${resp.status})`;
      console.warn("Groq test failed:", body);
    }
  } catch (err) {
    resultEl.className = "mt-3 ai-test-fail";
    resultEl.innerHTML = `<i class="bi bi-x-circle-fill me-2"></i>Connection failed — check your internet or key.`;
    console.error("Groq test error:", err);
  } finally {
    if (testBtn) testBtn.disabled = false;
  }
}

// ── Reset form to last saved state ────────────────────────────
function resetAISettingsForm() {
  renderAISettingsView();
}

// ── Toggle show/hide API key ──────────────────────────────────
function toggleApiKeyVisibility() {
  const input = document.getElementById("aiApiKeyInput");
  const icon  = document.getElementById("aiKeyToggleIcon");
  if (!input) return;
  if (input.type === "password") {
    input.type = "text";
    icon.className = "bi bi-eye-slash";
  } else {
    input.type = "password";
    icon.className = "bi bi-eye";
  }
}

// ── Copy API key to clipboard ─────────────────────────────────
async function copyApiKey() {
  const key = _aiSettings.groqApiKey;
  if (!key) return;
  try {
    await navigator.clipboard.writeText(key);
    const icon = document.getElementById("aiKeyCopyIcon");
    icon.className = "bi bi-check2";
    setTimeout(() => { icon.className = "bi bi-clipboard"; }, 2000);
    toast("API Key copied.", "success");
  } catch {
    toast("Could not copy — please copy manually.", "warning");
  }
}

// ── "No API Key" guard modal — shown by pitch.js & future AI ─
function showAIKeyMissingModal() {
  bootstrap.Modal.getOrCreateInstance(
    document.getElementById("aiKeyMissingModal")
  ).show();
}

function openAISettingsFromMissingModal() {
  bootstrap.Modal.getInstance(
    document.getElementById("aiKeyMissingModal")
  )?.hide();
  document.querySelectorAll(".nav-item-link").forEach(l => l.classList.remove("active"));
  document.querySelector('[data-view="aisettings"]')?.classList.add("active");
  showView("aisettings");
}
