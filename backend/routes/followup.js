/**
 * VoiceCare follow-up questions route
 *
 * Called before the summary so the app can ask up to three short questions
 * about details the patient forgot (duration, severity, medicines).
 * It never produces answers — the patient fills those in.
 */

const express = require('express');
const { validatePatientInput } = require('../services/safetyValidator');
const { generateFollowUpQuestions } = require('../services/geminiService');

const router = express.Router();

router.post('/follow-up', async (req, res) => {
  try {
    const { patientText, language = 'en' } = req.body || {};

    const validation = validatePatientInput(patientText);
    if (!validation.valid) {
      return res.status(400).json({ success: false, error: validation.error });
    }

    const safeLanguage =
      typeof language === 'string' && language.trim() ? language.trim().toLowerCase() : 'en';

    const result = await generateFollowUpQuestions({
      patientText: validation.text,
      language: safeLanguage
    });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[VoiceCare API] Follow-up error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Could not prepare follow-up questions right now.'
    });
  }
});

module.exports = router;
