const express = require('express');
const { validatePatientInput } = require('../services/safetyValidator');
const { generateHealthSummary } = require('../services/geminiService');

const router = express.Router();

/**
 * VoiceCare accepts a description in any language (the AI detects the script),
 * so we only normalise the code instead of rejecting unknown languages.
 * @param {unknown} raw
 * @returns {string}
 */
function sanitizeLanguage(raw) {
  if (typeof raw !== 'string') return 'en';
  const trimmed = raw.trim();
  if (!trimmed) return 'en';
  if (trimmed.toLowerCase() === 'auto') return 'auto';
  if (!/^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(trimmed)) return 'en';
  return trimmed.toLowerCase();
}

/**
 * Turns the patient's answers to the follow-up questions into one clarification
 * block for the model. Only answers the patient actually typed or dictated are
 * included; a skipped question contributes nothing.
 * @param {unknown} raw
 * @returns {string}
 */
function buildAnswersNote(raw) {
  if (!Array.isArray(raw)) return '';
  const lines = [];
  for (const item of raw.slice(0, 3)) {
    if (!item || typeof item !== 'object') continue;
    const question = typeof item.question === 'string' ? item.question.trim().slice(0, 160) : '';
    const answer = typeof item.answer === 'string' ? item.answer.trim().slice(0, 300) : '';
    if (!answer) continue;
    lines.push(question ? `Q: ${question}\nA: ${answer}` : answer);
  }
  return lines.join('\n');
}

/**
 * Shared handler for generating or regenerating a structured health summary.
 */
async function handleSummarize(req, res) {
  try {
    const { patientText, language = 'en', extraNotes = '', followUpAnswers } = req.body || {};

    const validation = validatePatientInput(patientText);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }

    const safeLanguage = sanitizeLanguage(language);
    const answersNote = buildAnswersNote(followUpAnswers);
    const safeExtraNotes = [
      typeof extraNotes === 'string' ? extraNotes.trim().slice(0, 1000) : '',
      answersNote
    ]
      .filter(Boolean)
      .join('\n')
      .slice(0, 1400);

    const result = await generateHealthSummary({
      patientText: validation.text,
      language: safeLanguage,
      extraNotes: safeExtraNotes
    });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[VoiceCare API] Error generating summary:', error.message);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error:
        status >= 500
          ? 'Unable to generate your health summary right now. Please try again in a moment.'
          : error.message
    });
  }
}

router.post('/summarize', handleSummarize);
router.post('/regenerate', handleSummarize);

module.exports = router;
