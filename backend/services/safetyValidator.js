/**
 * VoiceCare Safety & Schema Validator
 *
 * Enforces healthcare communication safety rules:
 * - Never diagnose diseases or prescribe medicines/dosages
 * - Never invent missing symptoms, medical history or urgency flags
 * - Always return a predictable 8-section structured JSON format, in the
 *   patient's language plus an English translation
 * - Highlight only red-flag phrases the patient actually said, with India
 *   helpline guidance (108 / 112)
 */

const NOT_MENTIONED = 'Not mentioned by patient';

const MANDATORY_DISCLAIMER =
  'This summary was created with AI to help you explain your health concerns to a doctor. It is NOT a medical diagnosis, prescription, or verified medical record. Please confirm all details with your doctor.';

const EMERGENCY_GUIDANCE =
  'If this is an emergency, call 108. Your description mentions words that may need urgent medical attention. VoiceCare only repeats what you said — it does not judge how serious it is.';

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

/** Native-language names, used for the badge the doctor reads. */
const SCRIPT_LABELS = {
  hi: 'हिन्दी',
  kn: 'ಕನ್ನಡ',
  ta: 'தமிழ்',
  te: 'తెలుగు',
  bn: 'বাংলা',
  gu: 'ગુજરાતી',
  pa: 'ਪੰਜਾਬੀ',
  ml: 'മലയാളം',
  or: 'ଓଡ଼ିଆ',
  ur: 'اردو',
  en: 'English'
};

/**
 * Detects the language of the patient's words from the script they typed or
 * dictated. The app's menu language is only a preference: a patient can type
 * Hindi while the app is in English, and labelling that summary "English" made
 * the screen look broken.
 *
 * @param {unknown} text
 * @returns {'hi'|'kn'|'ta'|'te'|'bn'|'gu'|'pa'|'ml'|'or'|'ur'|'en'}
 */
function detectScriptLanguage(text) {
  const value = String(text ?? '');
  if (/[\u0900-\u097F]/.test(value)) return 'hi';
  if (/[\u0C80-\u0CFF]/.test(value)) return 'kn';
  if (/[\u0C00-\u0C7F]/.test(value)) return 'te';
  if (/[\u0B80-\u0BFF]/.test(value)) return 'ta';
  if (/[\u0980-\u09FF]/.test(value)) return 'bn';
  if (/[\u0A80-\u0AFF]/.test(value)) return 'gu';
  if (/[\u0A00-\u0A7F]/.test(value)) return 'pa';
  if (/[\u0D00-\u0D7F]/.test(value)) return 'ml';
  if (/[\u0B00-\u0B7F]/.test(value)) return 'or';
  if (/[\u0600-\u06FF]/.test(value)) return 'ur';
  return 'en';
}

/** The 8 summary sections, in order. */
const SUMMARY_KEYS = [
  'mainHealthConcern',
  'symptoms',
  'duration',
  'severity',
  'relevantMedicalHistory',
  'currentMedications',
  'additionalObservations',
  'questionsToAskDoctor'
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
 * Lowercases and strips punctuation so words can be compared across formats.
 * @param {unknown} value
 * @returns {string}
 */
function normalizeForMatch(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Finds the red-flag phrases that literally appear in the patient's text.
 * Used only to repeat the patient's own words back to them.
 * @param {string} text
 * @returns {string[]}
 */
function detectRedFlagPhrases(text) {
  const source = String(text || '');
  const found = [];
  for (const pattern of EMERGENCY_PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    let match;
    while ((match = global.exec(source)) !== null) {
      const phrase = String(match[0] || '').trim();
      if (phrase && !found.some((f) => normalizeForMatch(f) === normalizeForMatch(phrase))) {
        found.push(phrase);
      }
      if (match.index === global.lastIndex) global.lastIndex += 1;
      if (found.length >= 6) return found;
    }
  }
  return found;
}

/**
 * Keeps only urgency flags that the patient actually said.
 *
 * The AI is asked to quote the patient's own words, but a model can still
 * paraphrase or invent a red flag. A flag is trusted only when the exact phrase
 * appears in the description, or when every meaningful word of the flag appears
 * in it (so "chest pain" matches "pain in my chest").
 *
 * @param {unknown} rawFlags
 * @param {string} patientText
 * @returns {string[]}
 */
function filterUrgentFlags(rawFlags, patientText) {
  const haystack = normalizeForMatch(patientText);
  const source = String(patientText || '');
  const accepted = [];

  for (const rawFlag of Array.isArray(rawFlags) ? rawFlags : []) {
    if (typeof rawFlag !== 'string') continue;
    const flag = rawFlag.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (flag.length < 3) continue;

    const normalizedFlag = normalizeForMatch(flag);
    if (!normalizedFlag) continue;

    const tokens = normalizedFlag.split(' ').filter((token) => token.length >= 2);
    if (tokens.length === 0) continue;

    const exact = haystack.includes(normalizedFlag);
    const substring = source.toLowerCase().includes(flag.toLowerCase());
    const everyTokenPresent = tokens.every((token) => haystack.includes(token));
    // Guard against a flag that is only a stop-word match ("of the").
    const hasSubstantialToken = tokens.some((token) => token.length >= 4);

    if ((exact || substring || (everyTokenPresent && hasSubstantialToken)) &&
        !accepted.some((f) => normalizeForMatch(f) === normalizedFlag)) {
      accepted.push(flag);
    }

    if (accepted.length >= 6) break;
  }

  return accepted;
}

/**
 * Checks whether the patient's description mentions potential emergency warning symptoms.
 * This does NOT diagnose; it only displays an urgent care reminder.
 * @param {string} text
 * @returns {{ detected: boolean, guidance: string, phrases: string[] }}
 */
function detectEmergencyWarning(text) {
  const phrases = detectRedFlagPhrases(text);
  if (!phrases.length) {
    return { detected: false, guidance: '', phrases: [] };
  }

  return {
    detected: true,
    guidance: EMERGENCY_GUIDANCE,
    phrases
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
 * Normalizes the 8-section summary object.
 * @param {Record<string, unknown> | undefined} raw
 * @returns {Record<string, string | string[]>}
 */
function normalizeSections(raw) {
  const fallbackQuestions = [
    'What could be causing these symptoms?',
    'Which tests or checks do you recommend?',
    'What warning signs should I watch out for at home?'
  ];

  return {
    mainHealthConcern: normalizeTextField(raw?.mainHealthConcern),
    symptoms: normalizeArrayField(raw?.symptoms, [NOT_MENTIONED]),
    duration: normalizeTextField(raw?.duration),
    severity: normalizeTextField(raw?.severity),
    relevantMedicalHistory: normalizeTextField(raw?.relevantMedicalHistory),
    currentMedications: normalizeTextField(raw?.currentMedications),
    additionalObservations: normalizeTextField(raw?.additionalObservations),
    questionsToAskDoctor: normalizeArrayField(raw?.questionsToAskDoctor, fallbackQuestions)
  };
}

/**
 * Cleans the AI's "possible symptoms" suggestions: short English phrases the
 * patient may also want to mention. They are never presented as the patient's
 * own words, so they are kept apart from the eight summary sections.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizePossibleSymptoms(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  const nonLatin = /[\u0600-\u06FF\u0900-\u0DFF]/;
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (text.length < 3) continue;
    if (nonLatin.test(text)) continue; // the doctor-facing list must be English
    if (text.toLowerCase() === NOT_MENTIONED.toLowerCase()) continue;
    if (!cleaned.some((s) => s.toLowerCase() === text.toLowerCase())) cleaned.push(text);
    if (cleaned.length >= 6) break;
  }
  return cleaned;
}

/**
 * Cleans the "what is still missing" list. It may only describe gaps, never
 * suggest a diagnosis or a treatment.
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeMissingInfo(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  for (const item of list) {
    if (typeof item !== 'string') continue;
    const text = item.replace(/\s+/g, ' ').trim().slice(0, 80);
    if (text.length < 2) continue;
    if (!cleaned.includes(text)) cleaned.push(text);
    if (cleaned.length >= 5) break;
  }
  return cleaned;
}

/**
 * Cleans up to 3 follow-up questions (strings or {question} objects).
 * @param {unknown} raw
 * @returns {string[]}
 */
function normalizeFollowUpQuestions(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const cleaned = [];
  for (const item of list) {
    const text =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && typeof item.question === 'string'
          ? item.question
          : '';
    const question = text.replace(/\s+/g, ' ').trim().slice(0, 160);
    if (question.length < 5) continue;
    if (!cleaned.some((q) => q.toLowerCase() === question.toLowerCase())) cleaned.push(question);
    if (cleaned.length >= 3) break;
  }
  return cleaned;
}

/**
 * Enforces the exact 8-section summary contract and attaches safety metadata.
 *
 * @param {Record<string, unknown>} rawSummary
 * @param {string} originalText
 * @param {string} language
 * @param {'gemini' | 'demo-fallback'} source
 * @param {{ model?: string, demoReason?: string }} [extra]
 */
function enforceSummarySchema(rawSummary, originalText, language, source, extra = {}) {
  const summary = normalizeSections(rawSummary);

  // The English version is what a doctor who does not read the patient's
  // language sees. When the model did not produce one (or produced something
  // that is not English at all), fall back to the summary itself rather than
  // inventing a translation.
  const rawEnglish = rawSummary?.englishSummary || rawSummary?.english_summary;
  const englishSections = normalizeSections(rawEnglish);
  const englishIsUsable =
    Boolean(rawEnglish) && !containsNonLatinScript(englishSections);

  const englishSummary = englishIsUsable
    ? englishSections
    : { ...summary, questionsToAskDoctor: [...summary.questionsToAskDoctor] };

  // Urgency flags are verified against the patient's own words, so nothing the
  // model invents can ever be highlighted as an emergency.
  let urgentFlags = filterUrgentFlags(
    rawSummary?.urgentFlags ?? rawSummary?.urgent_flags,
    originalText
  );
  if (urgentFlags.length === 0) {
    // Fallback: the deterministic detector still only quotes the patient.
    urgentFlags = detectRedFlagPhrases(originalText);
  }

  const detectedLanguage = detectScriptLanguage(originalText);
  const missingInfo = normalizeMissingInfo(rawSummary?.missingInfo ?? rawSummary?.missing_info);
  const followUpQuestions = normalizeFollowUpQuestions(
    rawSummary?.followUpQuestions ?? rawSummary?.follow_up_questions
  );

  return {
    summary,
    englishSummary,
    urgentFlags,
    missingInfo,
    followUpQuestions,
    possibleSymptoms: normalizePossibleSymptoms(
      rawSummary?.possibleSymptoms ?? rawSummary?.possible_symptoms
    ),
    metadata: {
      source,
      model: extra.model || null,
      demoReason: source === 'demo-fallback' ? extra.demoReason || null : null,
      language,
      detectedLanguage,
      detectedLanguageLabel: SCRIPT_LABELS[detectedLanguage] || 'English',
      englishIsGenerated: englishIsUsable,
      generatedAt: new Date().toISOString(),
      disclaimer: MANDATORY_DISCLAIMER,
      emergencyWarning: {
        detected: urgentFlags.length > 0,
        guidance: urgentFlags.length > 0 ? EMERGENCY_GUIDANCE : '',
        phrases: urgentFlags
      }
    }
  };
}

/**
 * Enforces the follow-up contract: at most 3 questions and a short list of
 * missing details. Never returns answers — the patient supplies those.
 * @param {Record<string, unknown>} raw
 */
function enforceFollowUpSchema(raw) {
  return {
    missingInfo: normalizeMissingInfo(raw?.missingInfo ?? raw?.missing_info),
    followUpQuestions: normalizeFollowUpQuestions(
      raw?.followUpQuestions ?? raw?.follow_up_questions
    )
  };
}

/** True when a summary object still contains non-Latin script. */
function containsNonLatinScript(sections) {
  if (!sections) return false;
  const nonLatin = /[\u0600-\u06FF\u0900-\u0DFF]/;
  const values = [
    sections.mainHealthConcern,
    sections.duration,
    sections.severity,
    sections.relevantMedicalHistory,
    sections.currentMedications,
    sections.additionalObservations,
    ...(sections.symptoms || []),
    ...(sections.questionsToAskDoctor || [])
  ];
  return values.some((v) => typeof v === 'string' && nonLatin.test(v));
}

module.exports = {
  NOT_MENTIONED,
  MANDATORY_DISCLAIMER,
  EMERGENCY_GUIDANCE,
  SUMMARY_KEYS,
  SCRIPT_LABELS,
  detectScriptLanguage,
  validatePatientInput,
  detectEmergencyWarning,
  detectRedFlagPhrases,
  filterUrgentFlags,
  normalizeMissingInfo,
  normalizeFollowUpQuestions,
  normalizePossibleSymptoms,
  normalizeSections,
  containsNonLatinScript,
  enforceSummarySchema,
  enforceFollowUpSchema
};
