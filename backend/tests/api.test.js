const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  validatePatientInput,
  detectEmergencyWarning,
  enforceSummarySchema,
  NOT_MENTIONED
} = require('../services/safetyValidator');
const app = require('../server');

test('validatePatientInput accepts English, Hindi, and Kannada text', () => {
  assert.equal(validatePatientInput('I have fever since 2 days').valid, true);
  assert.equal(validatePatientInput('मुझे दो दिन से बुखार है').valid, true);
  assert.equal(validatePatientInput('ನನಗೆ ಎರಡು ದಿನಗಳಿಂದ ಜ್ವರ ಇದೆ').valid, true);
});

test('validatePatientInput rejects empty or overly short input', () => {
  assert.equal(validatePatientInput('').valid, false);
  assert.equal(validatePatientInput('  ').valid, false);
  assert.equal(validatePatientInput('hi').valid, false);
  assert.equal(validatePatientInput(null).valid, false);
});

test('detectEmergencyWarning flags red-flag phrases across languages', () => {
  assert.equal(detectEmergencyWarning('I have severe chest pain and cannot breathe').detected, true);
  assert.equal(detectEmergencyWarning('मुझे सीने में दर्द हो रहा है').detected, true);
  assert.equal(detectEmergencyWarning('ನನಗೆ ಎದೆ ನೋವು ಇದೆ').detected, true);
  assert.equal(detectEmergencyWarning('Mild headache since morning').detected, false);
});

test('enforceSummarySchema populates all 8 sections without inventing missing info', () => {
  const result = enforceSummarySchema(
    { mainHealthConcern: 'Fever and body ache' },
    'I have fever and body ache',
    'en',
    'demo-fallback'
  );

  assert.equal(result.summary.mainHealthConcern, 'Fever and body ache');
  assert.deepEqual(result.summary.symptoms, [NOT_MENTIONED]);
  assert.equal(result.summary.duration, NOT_MENTIONED);
  assert.equal(result.summary.severity, NOT_MENTIONED);
  assert.equal(result.summary.relevantMedicalHistory, NOT_MENTIONED);
  assert.equal(result.summary.currentMedications, NOT_MENTIONED);
  assert.equal(result.summary.additionalObservations, NOT_MENTIONED);
  assert.ok(Array.isArray(result.summary.questionsToAskDoctor));
  assert.ok(result.summary.questionsToAskDoctor.length >= 1);
  assert.ok(result.metadata.disclaimer.includes('NOT a medical diagnosis'));
});

test('HTTP API /api/health and /api/summarize work end-to-end in demo fallback mode', async () => {
  const originalKey = process.env.GEMINI_API_KEY;
  const originalFallback = process.env.ALLOW_DEMO_FALLBACK;
  delete process.env.GEMINI_API_KEY;
  process.env.ALLOW_DEMO_FALLBACK = 'true';

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const healthRes = await fetch(`${baseUrl}/api/health`);
    assert.equal(healthRes.status, 200);
    const healthData = await healthRes.json();
    assert.equal(healthData.status, 'ok');

    const homeRes = await fetch(`${baseUrl}/`);
    assert.equal(homeRes.status, 200);
    const homeHtml = await homeRes.text();
    assert.ok(homeHtml.includes('id="btn-voice"'), 'in-app microphone button is served');
    assert.ok(homeHtml.includes('js/voice.js'), 'voice recorder script is served');
    assert.ok(!/wispr/i.test(homeHtml), 'no third-party keyboard instructions remain');

    const voiceScriptRes = await fetch(`${baseUrl}/js/voice.js`);
    assert.equal(voiceScriptRes.status, 200);

    const pdfVendorRes = await fetch(`${baseUrl}/vendor/jspdf.umd.min.js`);
    assert.equal(pdfVendorRes.status, 200);

    // Speech-to-text endpoint rejects junk before ever calling Gemini.
    const shortAudioRes = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: 'abc', mimeType: 'audio/webm' })
    });
    assert.equal(shortAudioRes.status, 400);

    const badMimeRes = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: 'A'.repeat(2000), mimeType: 'text/plain' })
    });
    assert.equal(badMimeRes.status, 415);

    const badRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientText: '', language: 'en' })
    });
    assert.equal(badRes.status, 400);

    const sumRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientText: 'I have mild knee pain for 3 days. I have diabetes and take metformin.',
        language: 'en'
      })
    });
    assert.equal(sumRes.status, 200);
    const sumJson = await sumRes.json();
    assert.equal(sumJson.success, true);
    assert.equal(sumJson.data.metadata.source, 'demo-fallback');
    assert.ok(sumJson.data.summary.duration.toLowerCase().includes('3 days'));
    assert.ok(sumJson.data.summary.relevantMedicalHistory.toLowerCase().includes('diabetes'));
    assert.ok(sumJson.data.summary.currentMedications.toLowerCase().includes('metformin'));

    // Unknown POST /api/* endpoint returns JSON 404 (not Express HTML)
    const missingApiRes = await fetch(`${baseUrl}/api/does-not-exist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(missingApiRes.status, 404);
    const missingApiJson = await missingApiRes.json();
    assert.equal(missingApiJson.success, false);

    // Malformed JSON body returns JSON 400
    const badJsonRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"patientText": '
    });
    assert.equal(badJsonRes.status, 400);
    const badJsonBody = await badJsonRes.json();
    assert.equal(badJsonBody.success, false);

    // Native language demo fallback always outputs English labels (no native script leaked)
    const hiRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientText: 'मुझे तीन दिन से बुखार है।',
        language: 'hi'
      })
    });
    assert.equal(hiRes.status, 200);
    const hiJson = await hiRes.json();
    assert.equal(/[\u0900-\u097F]/.test(hiJson.data.summary.duration), false);
    assert.equal(/[\u0900-\u097F]/.test(hiJson.data.summary.mainHealthConcern), false);
  } finally {
    server.close();
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    if (originalFallback !== undefined) process.env.ALLOW_DEMO_FALLBACK = originalFallback;
  }
});
