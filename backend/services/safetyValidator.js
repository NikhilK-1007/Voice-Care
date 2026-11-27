/**
 * VoiceCare Safety & Schema Validator
 *
 * Enforces healthcare communication safety rules:
 * - Never diagnose diseases or prescribe medicines/dosages
 * - Never invent missing symptoms or medical history
 * - Always return a predictable 8-section structured JSON format
 * - Flag potential emergency warning signs with India helpline guidance (108 / 112)
 */

const NOT_MENTIONED = 'Not mentioned by patient';

const MANDATORY_DISCLAIMER =
  'This summary was created with AI to help you explain your health concerns to a doctor. It is NOT a medical diagnosis, prescription, or verified medical record. Please confirm all details with your doctor.';

const EMERGENCY_PATTERNS = [
  // English red-flag patterns
  /\b(chest pain|chest tightness|heart attack|can'?t breathe|cannot breathe|difficulty breathing|shortness of breath|unconscious|fainted|fainting|seizure|convulsion|stroke|slurred speech|one side weak|paralysis|severe bleeding|heavy bleeding|coughing blood|vomiting blood|suicidal|self harm)\b/i,
  // Hinglish / transliterated Hindi
  /\b(seene mein dard|chhati mein dard|saans nahi|saans lene mein|behosh|khoon ki ulti)\b/i,
  // Hindi Devanagari
  /(सीने में दर्द|छाती में दर्द|सांस लेने में तकलीफ|सांस नहीं|बेहोश|खून की उल्टी|बहुत ज्यादा खून)/,
  // Kannada script
  /(ಎದೆ ನೋವು|ಉಸಿರಾಡಲು ಕಷ್ಟ|ಉಸಿರಾಟದ ತೊಂದರೆ|ಪ್ರಜ್ಞೆ ತಪ್ಪಿ|ರಕ್ತ ವಾಂತಿ)/,
  // Kanglish
  /\b(ede novu|usiradalu kashta|prajne tappi)\b/i
];

/**
 * Validates and cleans raw patient input text.
 * @param {unknown} rawText
 * @returns {{ valid: boolean, text?: string, error?: string }}
 */
function validatePatientInput(rawText) {
  if (typeof rawText !== 'string') {
    return { valid: false, error: 'Patient description must be text.' };
  }

  // Remove null bytes and excessive whitespace while preserving multilingual Unicode scripts
  const cleaned = rawText.replace(/\u0000/g, '').trim();

  if (cleaned.length < 3) {
    return {
      valid: false,
      error: 'Please enter or dictate at least a few words describing your health concern.'
    };
  }

  if (cleaned.length > 5000) {
    return {
      valid: false,
      error: 'Description is too long. Please keep it under 5,000 characters.'
    };
  }

  return { valid: true, text: cleaned };
}

/**
 * Checks whether the patient's description mentions potential emergency warning symptoms.
 * This does NOT diagnose; it only displays an urgent care reminder.
 * @param {string} text
 * @returns {{ detected: boolean, guidance: string }}
 */
function detectEmergencyWarning(text) {
  const matched = EMERGENCY_PATTERNS.some((pattern) => pattern.test(text));
  if (!matched) {
    return {
      detected: false,
      guidance: ''
    };
  }

  return {
    detected: true,
    guidance:
      'Your description mentions symptoms that may need urgent medical attention. If you or the patient are having severe chest pain, trouble breathing, sudden weakness, heavy bleeding, or loss of consciousness, please call 108 or 112 immediately or visit the nearest emergency hospital.'
  };
}

/**
 * Normalizes a string field so missing values never get invented.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeTextField(value) {
  if (typeof value !== 'string') return NOT_MENTIONED;
  const trimmed = value.trim();
  if (!trimmed || /^(none|n\/a|na|unknown|not specified)$/i.test(trimmed)) {
    return NOT_MENTIONED;
  }
  return trimmed;
}

/**
 * Normalizes an array field (such as symptoms or questionsToAskDoctor).
 * @param {unknown} value
 * @param {string[]} fallbackArray
 * @returns {string[]}
 */
function normalizeArrayField(value, fallbackArray) {
  if (Array.isArray(value)) {
    const cleaned = value
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    return cleaned.length > 0 ? cleaned : fallbackArray;
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/\n|;|•|-/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return fallbackArray;
}

/**
 * Enforces the exact 8-section summary contract and attaches safety metadata.
 * @param {Record<string, unknown>} rawSummary
 * @param {string} originalText
 * @param {string} language
 * @param {'gemini' | 'demo-fallback'} source
 * @param {{ model?: string, demoReason?: string }} [extra]
 */
function enforceSummarySchema(rawSummary, originalText, language, source, extra = {}) {
  const emergency = detectEmergencyWarning(originalText);

  const summary = {
    mainHealthConcern: normalizeTextField(rawSummary?.mainHealthConcern),
    symptoms: normalizeArrayField(rawSummary?.symptoms, [NOT_MENTIONED]),
    duration: normalizeTextField(rawSummary?.duration),
    severity: normalizeTextField(rawSummary?.severity),
    relevantMedicalHistory: normalizeTextField(rawSummary?.relevantMedicalHistory),
    currentMedications: normalizeTextField(rawSummary?.currentMedications),
    additionalObservations: normalizeTextField(rawSummary?.additionalObservations),
    questionsToAskDoctor: normalizeArrayField(rawSummary?.questionsToAskDoctor, [
      'What could be causing these symptoms?',
      'Which tests or checks do you recommend?',
      'What warning signs should I watch out for at home?'
    ])
  };

  // Merge AI-flagged emergency note if AI also flagged something responsibly, without diagnosing
  const emergencyDetected = Boolean(emergency.detected || rawSummary?.emergencyWarningDetected);
  const emergencyGuidance = emergency.detected
    ? emergency.guidance
    : emergencyDetected
      ? 'If symptoms feel severe or suddenly worsen, seek immediate medical care or call 108 / 112 in India.'
      : '';

  return {
    summary,
    metadata: {
      source,
      model: extra.model || null,
      demoReason: source === 'demo-fallback' ? extra.demoReason || null : null,
      language,
      generatedAt: new Date().toISOString(),
      disclaimer: MANDATORY_DISCLAIMER,
      emergencyWarning: {
        detected: emergencyDetected,
        guidance: emergencyGuidance
      }
    }
  };
}

module.exports = {
  NOT_MENTIONED,
  MANDATORY_DISCLAIMER,
  validatePatientInput,
  detectEmergencyWarning,
  enforceSummarySchema
};
