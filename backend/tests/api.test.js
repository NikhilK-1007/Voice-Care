const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  validatePatientInput,
  detectEmergencyWarning,
  enforceSummarySchema,
  filterUrgentFlags,
  enforceFollowUpSchema,
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

test('filterUrgentFlags only keeps phrases the patient actually said', () => {
  const text = 'I have pain in my chest since morning and I take metformin.';

  // Quoted exactly → kept.
  assert.deepEqual(filterUrgentFlags(['chest pain'], text), ['chest pain']);
  // Every meaningful word appears in the description → kept.
  assert.equal(filterUrgentFlags(['pain in my chest'], text).length, 1);
  // Invented red flags are dropped.
  assert.deepEqual(filterUrgentFlags(['heavy bleeding', 'cannot breathe'], text), []);
  // Non-string junk is ignored instead of crashing.
  assert.deepEqual(filterUrgentFlags([null, 42, {}], text), []);
  // Native-script quote is kept only when it is in the patient's words.
  assert.deepEqual(filterUrgentFlags(['सीने में दर्द'], 'मुझे सीने में दर्द है'), ['सीने में दर्द']);
  assert.deepEqual(filterUrgentFlags(['सीने में दर्द'], 'मुझे बुखार है'), []);
  // At most 6 flags are returned.
  const long = 'chest pain, cannot breathe, fainting, seizure, heavy bleeding, stroke, unconscious';
  assert.ok(filterUrgentFlags(long.split(',').map((s) => s.trim()), long).length <= 6);
});

test('enforceFollowUpSchema caps questions at 3 and strips junk', () => {
  const result = enforceFollowUpSchema({
    missing_info: ['duration', 'severity', 'duration', 42, 'current medicines'],
    follow_up_questions: [
      { question: 'For how many days?' },
      'Is it mild or severe?',
      '  ',
      'Which medicines do you take?',
      'A fourth question that must be dropped?'
    ]
  });

  assert.ok(result.followUpQuestions.length <= 3);
  assert.equal(result.followUpQuestions[0], 'For how many days?');
  assert.ok(result.missingInfo.includes('duration'));
  assert.ok(!result.missingInfo.includes(42));
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

    // New Phase 1 contract: every summary carries an English version, a
    // verified urgency list and the missing-detail metadata.
    assert.ok(sumJson.data.englishSummary, 'englishSummary is returned');
    assert.ok(Array.isArray(sumJson.data.urgentFlags), 'urgentFlags is an array');
    assert.ok(Array.isArray(sumJson.data.missingInfo), 'missingInfo is an array');
    assert.equal(sumJson.data.urgentFlags.length, 0, 'no invented urgency flags');

    // A real red flag the patient said is repeated back, and only that one.
    const urgentRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientText: 'I have severe chest pain since this morning and I feel dizzy.',
        language: 'en'
      })
    });
    assert.equal(urgentRes.status, 200);
    const urgentJson = await urgentRes.json();
    assert.ok(urgentJson.data.urgentFlags.length >= 1, 'chest pain is flagged');
    assert.equal(urgentJson.data.metadata.emergencyWarning.detected, true);
    assert.match(urgentJson.data.metadata.emergencyWarning.guidance, /108/);

    // Follow-up questions never need Gemini to work.
    const followRes = await fetch(`${baseUrl}/api/follow-up`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientText: 'I have fever.', language: 'en' })
    });
    assert.equal(followRes.status, 200);
    const followJson = await followRes.json();
    assert.equal(followJson.success, true);
    assert.ok(followJson.data.followUpQuestions.length <= 3, 'at most 3 questions');
    assert.ok(followJson.data.followUpQuestions.length >= 1);
    assert.equal(followJson.data.source, 'local-rules');

    // Follow-up answers are optional input for the summary request.
    const answeredRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patientText: 'I have fever.',
        language: 'en',
        followUpAnswers: [{ question: 'How long?', answer: 'For 3 days' }]
      })
    });
    assert.equal(answeredRes.status, 200);

    // Possible symptoms: English suggestions, never mixed into the summary.
    const feverRes = await fetch(`${baseUrl}/api/summarize`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ patientText: 'I have fever since yesterday.', language: 'en' })
    });
    assert.equal(feverRes.status, 200);
    const feverJson = await feverRes.json();
    assert.ok(Array.isArray(feverJson.data.possibleSymptoms), 'possibleSymptoms is an array');
    assert.ok(feverJson.data.possibleSymptoms.length >= 2, 'fever suggests companion symptoms');
    assert.ok(feverJson.data.possibleSymptoms.length <= 6, 'at most 6 suggestions');
    for (const item of feverJson.data.possibleSymptoms) {
      assert.equal(typeof item, 'string');
      assert.ok(!/[\u0900-\u0DFF]/.test(item), 'suggestions are English only');
      assert.ok(
        !feverJson.data.summary.symptoms.includes(item),
        'suggestions are not passed off as the patient\'s own symptoms'
      );
    }

    // The removed QR share feature must stay gone.
    const shareGoneRes = await fetch(`${baseUrl}/api/share`, { method: 'POST' });
    assert.equal(shareGoneRes.status, 404);
    const shareApiGoneRes = await fetch(`${baseUrl}/api/share/anything`);
    assert.equal(shareApiGoneRes.status, 404);
    // The old doctor share page is gone; the SPA fallback serves the app.
    const legacySharePage = await fetch(`${baseUrl}/s/doesnotexist`);
    const legacyHtml = await legacySharePage.text();
    assert.ok(!/read-only summary/i.test(legacyHtml), 'no read-only share page is served');
  } finally {
    server.close();
    if (originalKey !== undefined) process.env.GEMINI_API_KEY = originalKey;
    if (originalFallback !== undefined) process.env.ALLOW_DEMO_FALLBACK = originalFallback;
  }
});

test('a non-English "English" summary is flagged instead of shown to the doctor', () => {
  const hindiSections = {
    mainHealthConcern: 'सीने में दर्द',
    symptoms: ['सीने में दर्द'],
    duration: '2 दिन से',
    severity: 'तेज',
    relevantMedicalHistory: NOT_MENTIONED,
    currentMedications: NOT_MENTIONED,
    additionalObservations: NOT_MENTIONED,
    questionsToAskDoctor: ['क्या जाँच करानी चाहिए?']
  };

  const result = enforceSummarySchema(
    { ...hindiSections, englishSummary: { ...hindiSections } },
    'सीने में दर्द 2 दिन से तेज है',
    'hi',
    'gemini',
    { model: 'test' }
  );

  // The model repeated the Hindi text in the English field. That must never be
  // presented to a doctor as an English translation.
  assert.equal(result.metadata.englishIsGenerated, false);
});

test('a real Latin-script englishSummary is kept and marked as generated', () => {
  const result = enforceSummarySchema(
    {
      mainHealthConcern: 'सीने में दर्द',
      symptoms: ['सीने में दर्द'],
      duration: '2 दिन से',
      severity: 'तेज',
      relevantMedicalHistory: NOT_MENTIONED,
      currentMedications: NOT_MENTIONED,
      additionalObservations: NOT_MENTIONED,
      questionsToAskDoctor: ['क्या जाँच करानी चाहिए?'],
      englishSummary: {
        mainHealthConcern: 'Chest pain',
        symptoms: ['Chest pain'],
        duration: 'For 2 days',
        severity: 'Severe',
        relevantMedicalHistory: NOT_MENTIONED,
        currentMedications: NOT_MENTIONED,
        additionalObservations: NOT_MENTIONED,
        questionsToAskDoctor: ['Which tests should I get?']
      },
      urgent_flags: ['सीने में दर्द']
    },
    'सीने में दर्द 2 दिन से तेज है',
    'hi',
    'gemini',
    { model: 'test' }
  );

  assert.equal(result.metadata.englishIsGenerated, true);
  assert.equal(result.englishSummary.mainHealthConcern, 'Chest pain');
  assert.deepEqual(result.urgentFlags, ['सीने में दर्द']);
});
