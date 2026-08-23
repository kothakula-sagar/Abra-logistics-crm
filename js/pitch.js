// ============================================================
// PITCH.JS — AI Sales Pitch Generator
// Uses callGroq() from ai.js — no hardcoded keys.
// ============================================================

// Active lead context for the open modal
let _pitchLead = null;

// ── Greeting helper ────────────────────────────────────────
function _timeGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good Morning";
  if (h < 17) return "Good Afternoon";
  return "Good Evening";
}

// ── Build the Groq prompt ───────────────────────────────────
function _buildPitchPrompt(lead) {
  const greeting = _timeGreeting();
  return `
You are an expert sales trainer for Abra Logistics, an Indian logistics company.
Generate a professional outbound sales pitch conversation in English.

Lead Details:
- Sales Executive: ${lead.assignedToName || "Sales Executive"}
- Customer Name: ${lead.fullName || "Sir/Ma'am"}
- Company: ${lead.companyName || "their company"}
- Service Required: ${lead.serviceNeeded || "logistics services"}

Greeting to use: "${greeting}"

Structure the pitch EXACTLY in this order:

1. GREETING
   Start with "${greeting}, am I speaking with ${lead.fullName || "Sir/Ma'am"}?"
   Confirm you have a moment to speak.

2. SELF INTRODUCTION
   Introduce the sales executive by name.
   Mention they are calling from Abra Logistics.

3. COMPANY INTRODUCTION (2–3 sentences)
   Briefly describe Abra Logistics. Mention at least 4 of these services naturally:
   Freight Services, Warehousing, Transportation, Export & Import, Last Mile Delivery, Pan India Logistics.

4. PERSONALIZED PITCH
   Reference ${lead.companyName || "their company"} by name.
   Focus specifically on: ${lead.serviceNeeded || "logistics solutions"}.
   Explain clearly how Abra Logistics solves their specific need.

5. DISCOVERY QUESTIONS (4–6 questions)
   Ask intelligent, consultative questions such as:
   - Type of shipments they handle
   - Domestic or International routes
   - Monthly shipment volume
   - Current logistics partner and challenges
   - Delivery timelines they work with

6. OBJECTION HANDLING
   Write natural responses to these 3 objections:
   a) "We already have a logistics partner."
   b) "Your price might be high."
   c) "I'll think about it / Call me later."

7. CLOSING
   End professionally. Ask for ONE of: a meeting, a quotation, a site visit, or a trial shipment.
   Leave the customer feeling valued and confident.

Rules:
- Write as a real conversation (Sales: ... / Customer: ...)
- Tone: Professional, Friendly, Confident, Consultative — never robotic
- Length: 400–700 words
- Do NOT use bullet lists inside the conversation itself
- Do NOT add any preamble or explanation outside the pitch
`.trim();
}

// ── Generate pitch via shared Groq helper ──────────────────
async function generateSalesPitch(lead) {
  return callGroq(
    [
      {
        role: "system",
        content: "You are an expert sales coach for Abra Logistics, an Indian logistics company. Generate professional, natural-sounding sales pitches in English."
      },
      {
        role: "user",
        content: _buildPitchPrompt(lead)
      }
    ],
    { temperature: 0.75, maxTokens: 1200 }
  );
}

// ── UI helpers ──────────────────────────────────────────────
function _setPitchLoading(isLoading) {
  const spinner  = document.getElementById("pitchSpinner");
  const output   = document.getElementById("pitchOutput");
  const btnCopy  = document.getElementById("pitchCopyBtn");
  const btnRegen = document.getElementById("pitchRegenBtn");
  const btnWA    = document.getElementById("pitchWhatsAppBtn");

  if (isLoading) {
    spinner.classList.remove("d-none");
    output.classList.add("d-none");
    btnCopy.disabled  = true;
    btnRegen.disabled = true;
    btnWA.disabled    = true;
  } else {
    spinner.classList.add("d-none");
    output.classList.remove("d-none");
    btnCopy.disabled  = false;
    btnRegen.disabled = false;
    btnWA.disabled    = false;
  }
}

function _showPitchError(msg) {
  const output = document.getElementById("pitchOutput");
  output.classList.remove("d-none");
  output.innerHTML = `<div class="pitch-error"><i class="bi bi-exclamation-triangle-fill me-2"></i>${escapeHtml(msg)}</div>`;
}

// ── Open modal & trigger generation ────────────────────────
async function openSalesPitchModal(leadId) {
  const lead = ALL_LEADS.find((l) => l.id === leadId);
  if (!lead) return;

  // Guard: require a configured API key before opening the modal
  if (!getAISettings().groqApiKey) {
    showAIKeyMissingModal();
    return;
  }

  _pitchLead = lead;

  document.getElementById("pitchModalLeadName").textContent =
    `${lead.fullName}${lead.companyName ? " — " + lead.companyName : ""}`;

  const output = document.getElementById("pitchOutput");
  output.innerHTML = "";
  _setPitchLoading(true);

  bootstrap.Modal.getOrCreateInstance(document.getElementById("salesPitchModal")).show();

  try {
    const pitch = await generateSalesPitch(lead);
    output.innerHTML = escapeHtml(pitch).replace(/\n/g, "<br>");
    _setPitchLoading(false);
  } catch (err) {
    console.error("Pitch generation failed:", err);
    _setPitchLoading(false);
    if (err instanceof AIKeyMissingError) {
      bootstrap.Modal.getInstance(document.getElementById("salesPitchModal"))?.hide();
      showAIKeyMissingModal();
    } else {
      _showPitchError("Unable to generate AI Sales Pitch. Please try again.");
    }
  }
}

// ── Regenerate (same lead) ──────────────────────────────────
async function regeneratePitch() {
  if (!_pitchLead) return;
  const output = document.getElementById("pitchOutput");
  output.innerHTML = "";
  _setPitchLoading(true);
  try {
    const pitch = await generateSalesPitch(_pitchLead);
    output.innerHTML = escapeHtml(pitch).replace(/\n/g, "<br>");
    _setPitchLoading(false);
  } catch (err) {
    console.error("Pitch regeneration failed:", err);
    _setPitchLoading(false);
    _showPitchError("Unable to generate AI Sales Pitch. Please try again.");
  }
}

// ── Copy to clipboard ───────────────────────────────────────
async function copyPitch() {
  const output = document.getElementById("pitchOutput");
  const text   = output.innerText || output.textContent || "";
  if (!text.trim()) return;

  try {
    await navigator.clipboard.writeText(text);
    const btn      = document.getElementById("pitchCopyBtn");
    const original = btn.innerHTML;
    btn.innerHTML  = `<i class="bi bi-check2"></i> Copied!`;
    btn.classList.replace("btn-outline-secondary", "btn-success");
    setTimeout(() => {
      btn.innerHTML = original;
      btn.classList.replace("btn-success", "btn-outline-secondary");
    }, 2500);
  } catch {
    toast("Unable to copy — please select and copy manually.", "warning");
  }
}

// ── Send to WhatsApp ────────────────────────────────────────
function sendToWhatsApp() {
  if (!_pitchLead) return;
  const output = document.getElementById("pitchOutput");
  const text   = output.innerText || output.textContent || "";
  if (!text.trim()) { toast("No pitch to send yet.", "warning"); return; }

  let phone = (_pitchLead.phoneNumber || "").replace(/[\s\-().+]/g, "");
  if (phone.startsWith("0")) phone = "91" + phone.slice(1);
  if (!/^\d{10,15}$/.test(phone)) {
    toast("Invalid phone number — cannot open WhatsApp.", "danger");
    return;
  }

  window.open(
    `https://wa.me/${phone}?text=${encodeURIComponent(text)}`,
    "_blank", "noopener,noreferrer"
  );
}
