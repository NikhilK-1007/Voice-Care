/**
 * VoiceCare QR share routes
 *
 * POST /api/share          → creates a 24-hour read-only link (patient device)
 * GET  /api/share/:token   → JSON for the same link
 * GET  /s/:token           → a plain HTML page a doctor opens in any browser,
 *                            with no login, no scripts and no app install
 */

const express = require('express');
const { createShare, getShare, TTL_MS } = require('../services/shareStore');
const { NOT_MENTIONED, MANDATORY_DISCLAIMER } = require('../services/safetyValidator');

const router = express.Router();

const SECTION_ORDER = [
  ['mainHealthConcern', 'Main health concern'],
  ['symptoms', 'Symptoms'],
  ['duration', 'Duration'],
  ['severity', 'Severity'],
  ['relevantMedicalHistory', 'Relevant medical history'],
  ['currentMedications', 'Current medicines'],
  ['additionalObservations', 'Additional observations'],
  ['questionsToAskDoctor', 'Questions to ask the doctor']
];

function str(value, max = 400) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
}

function strArray(value, maxItems = 12, maxLen = 300) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim())
    .map((item) => item.replace(/\s+/g, ' ').trim().slice(0, maxLen))
    .slice(0, maxItems);
}

function sanitizeSections(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {};
  for (const [key] of SECTION_ORDER) {
    if (key === 'symptoms' || key === 'questionsToAskDoctor') {
      out[key] = strArray(raw[key]);
    } else {
      out[key] = str(raw[key], 600);
    }
  }
  return out;
}

/**
 * Builds the stored snapshot. Anything unexpected is dropped rather than
 * rendered, so a malformed request cannot inject markup into the doctor page.
 */
function buildSnapshot(body = {}) {
  const patient = body.patient && typeof body.patient === 'object' ? body.patient : {};
  const summary = sanitizeSections(body.summary);
  const englishSummary = sanitizeSections(body.englishSummary) || summary;

  return {
    patient: {
      name: str(patient.name, 80),
      age: str(patient.age, 4),
      gender: str(patient.gender, 20),
      bloodGroup: str(patient.bloodGroup, 8),
      allergies: str(patient.allergies, 200),
      emergencyContact: str(patient.emergencyContact, 40)
    },
    languageLabel: str(body.languageLabel, 40) || 'English',
    createdAt: str(body.createdAt, 40) || new Date().toISOString(),
    summary,
    englishSummary,
    urgentFlags: strArray(body.urgentFlags, 6, 120),
    missingInfo: strArray(body.missingInfo, 5, 80),
    patientText: str(body.patientText, 5000)
  };
}

function isUsable(snapshot) {
  if (!snapshot.summary) return false;
  const concern = snapshot.summary.mainHealthConcern || '';
  return Boolean(concern && concern !== NOT_MENTIONED) || snapshot.patientText.length >= 3;
}

function baseUrlFor(req) {
  const configured = process.env.PUBLIC_BASE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  return `${req.protocol}://${req.get('host')}`;
}

router.post('/share', (req, res) => {
  const snapshot = buildSnapshot(req.body);

  if (!isUsable(snapshot)) {
    return res.status(400).json({
      success: false,
      error: 'There is no summary to share yet. Please create the summary first.'
    });
  }

  const { token, expiresAt } = createShare(snapshot);
  const baseUrl = baseUrlFor(req);

  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  return res.json({
    success: true,
    data: {
      token,
      url: `${baseUrl}/s/${token}`,
      expiresAt,
      expiresInHours: Math.round(TTL_MS / 3600000)
    }
  });
});

router.get('/share/:token', (req, res) => {
  const result = getShare(req.params.token);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

  if (result.status === 'missing') {
    return res.status(404).json({ success: false, error: 'This link does not exist.' });
  }
  if (result.status === 'expired') {
    return res.status(410).json({ success: false, error: 'This link has expired.' });
  }

  return res.json({
    success: true,
    data: { ...result.data, expiresAt: result.expiresAt }
  });
});

/* ------------------------------ doctor page ------------------------------ */

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatDate(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function renderSections(sections) {
  if (!sections) return '<p class="muted">No summary content.</p>';
  return SECTION_ORDER.map(([key, title]) => {
    const value = sections[key];
    const isEmptyArray = Array.isArray(value) && value.length === 0;
    let body;
    if (Array.isArray(value)) {
      body = isEmptyArray
        ? `<p class="muted">${escapeHtml(NOT_MENTIONED)}</p>`
        : `<ul>${value.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    } else {
      body = `<p>${escapeHtml(value || NOT_MENTIONED)}</p>`;
    }
    return `<section class="block"><h3>${escapeHtml(title)}</h3>${body}</section>`;
  }).join('');
}

function renderPatientRow(label, value) {
  if (!value) return '';
  return `<div class="kv"><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(value)}</span></div>`;
}

function renderSharePage(result) {
  const data = result.data;
  const patient = data.patient || {};
  const flags = Array.isArray(data.urgentFlags) ? data.urgentFlags : [];
  const missing = Array.isArray(data.missingInfo) ? data.missingInfo : [];

  const urgency = flags.length
    ? `<div class="urgent">
         <p class="urgent-title">Urgent words from the patient</p>
         <p class="urgent-lead">The patient said these words. VoiceCare only repeats them and does not judge how serious they are.</p>
         <ul class="flag-list">${flags.map((flag) => `<li>${escapeHtml(flag)}</li>`).join('')}</ul>
         <p class="urgent-call"><strong>If this is an emergency, call 108.</strong></p>
       </div>`
    : '';

  const missingBlock = missing.length
    ? `<section class="card missing"><h2>Details the patient did not give</h2><ul>${missing
        .map((item) => `<li>${escapeHtml(item)}</li>`)
        .join('')}</ul></section>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>VoiceCare shared summary</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #f1f5f9; color: #1e293b; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 18px; }
  header.top { background: #0f766e; color: #fff; border-radius: 14px; padding: 18px 20px; }
  header.top h1 { margin: 0 0 4px; font-size: 1.35rem; }
  header.top p { margin: 0; opacity: 0.92; font-size: 0.9rem; }
  .meta { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 10px; font-size: 0.82rem; opacity: 0.95; }
  .urgent { margin-top: 16px; border: 2px solid #dc2626; background: #fef2f2; border-radius: 14px; padding: 16px 18px; }
  .urgent-title { margin: 0 0 4px; font-weight: 700; color: #b91c1c; text-transform: uppercase; letter-spacing: 0.06em; font-size: 0.8rem; }
  .urgent-lead { margin: 0 0 10px; color: #7f1d1d; font-size: 0.9rem; }
  .flag-list { margin: 0 0 10px; padding-left: 20px; color: #7f1d1d; font-weight: 600; }
  .urgent-call { margin: 0; color: #b91c1c; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 16px 18px; margin-top: 14px; }
  .card h2 { margin: 0 0 10px; font-size: 1.05rem; color: #0f766e; }
  .kv { display: flex; gap: 10px; font-size: 0.92rem; padding: 3px 0; }
  .kv .k { min-width: 150px; color: #64748b; }
  .kv .v { font-weight: 600; }
  .cols { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
  @media (max-width: 760px) { .cols { grid-template-columns: 1fr; } }
  .col { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 14px 16px; }
  .col > .col-title { margin: 0 0 8px; font-size: 0.78rem; letter-spacing: 0.08em; text-transform: uppercase; color: #64748b; }
  .block { padding: 8px 0; border-top: 1px solid #eef2f7; }
  .block:first-of-type { border-top: none; }
  .block h3 { margin: 0 0 3px; font-size: 0.86rem; color: #0f766e; }
  .block p { margin: 0; font-size: 0.95rem; }
  .block ul { margin: 0; padding-left: 18px; font-size: 0.95rem; }
  .muted { color: #94a3b8; font-style: italic; }
  details.card summary { cursor: pointer; font-weight: 700; color: #0f766e; }
  details.card p { white-space: pre-wrap; margin: 10px 0 0; }
  footer { margin: 18px 0 30px; font-size: 0.78rem; color: #64748b; }
  .expiry { background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 10px 12px; font-size: 0.82rem; color: #475569; margin-top: 14px; }
</style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <h1>VoiceCare · Shared health summary</h1>
      <p>Read-only page. No login needed. Shared by the patient for one consultation.</p>
      <div class="meta">
        <span>Prepared: ${escapeHtml(formatDate(data.createdAt))}</span>
        <span>Patient language: ${escapeHtml(data.languageLabel)}</span>
        <span>Link expires: ${escapeHtml(formatDate(result.expiresAt))}</span>
      </div>
    </header>

    ${urgency}

    <section class="card">
      <h2>Patient information</h2>
      ${renderPatientRow('Name', patient.name)}
      ${renderPatientRow('Age', patient.age)}
      ${renderPatientRow('Gender', patient.gender)}
      ${renderPatientRow('Blood group', patient.bloodGroup)}
      ${renderPatientRow('Allergies', patient.allergies)}
      ${renderPatientRow('Emergency contact', patient.emergencyContact)}
      ${!patient.name && !patient.age && !patient.bloodGroup && !patient.allergies
        ? '<p class="muted">The patient has not filled the quick-info card.</p>'
        : ''}
    </section>

    <div class="cols">
      <div class="col">
        <p class="col-title">Patient's language · ${escapeHtml(data.languageLabel)}</p>
        ${renderSections(data.summary)}
      </div>
      <div class="col">
        <p class="col-title">English version</p>
        ${renderSections(data.englishSummary || data.summary)}
      </div>
    </div>

    ${missingBlock}

    <details class="card">
      <summary>Patient's own words (unedited)</summary>
      <p>${escapeHtml(data.patientText || 'Not recorded')}</p>
    </details>

    <div class="expiry">
      This link works for 24 hours and then stops opening. Ask the patient to share a new link if you need it again.
    </div>

    <footer>
      ${escapeHtml(MANDATORY_DISCLAIMER)}
      <br />VoiceCare only organises what the patient said. It does not diagnose and does not prescribe.
    </footer>
  </div>
</body>
</html>`;
}

/**
 * GET /s/:token — the page a doctor opens from the QR code.
 */
function sharePageHandler(req, res) {
  const result = getShare(req.params.token);
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.set('X-Robots-Tag', 'noindex, nofollow');

  const shell = (title, message) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(title)}</title>
<style>body{margin:0;background:#f1f5f9;color:#1e293b;font:16px/1.6 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.wrap{max-width:620px;margin:12vh auto;padding:24px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;text-align:center}
h1{font-size:1.2rem;margin:0 0 8px;color:#0f766e}p{margin:0;color:#475569}</style></head>
<body><div class="wrap"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`;

  if (result.status === 'missing') {
    return res.status(404).type('html').send(
      shell('Link not found', 'This summary link does not exist. Please ask the patient to share it again.')
    );
  }

  if (result.status === 'expired') {
    return res.status(410).type('html').send(
      shell('Link expired', 'This summary link was valid for 24 hours and has now expired. Please ask the patient for a new link.')
    );
  }

  return res.type('html').send(renderSharePage(result));
}

module.exports = {
  router,
  sharePageHandler
};
