const express = require('express');
const { transcribeAudio } = require('../services/geminiService');

const router = express.Router();

// ~6.7 MB of audio once decoded. A 60 s voice note is ~400 KB, so this is generous.
const MAX_BASE64_CHARS = 9 * 1024 * 1024;
const MIN_BASE64_CHARS = 800;

const ALLOWED_MIME = new Set([
  'audio/webm',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
  'audio/wav',
  'audio/x-wav',
  'audio/aac',
  'audio/amr',
  'audio/3gpp'
]);

/** Browsers send `audio/webm;codecs=opus`; Gemini wants the container only. */
function normaliseMime(raw) {
  if (typeof raw !== 'string') return '';
  return raw.split(';')[0].trim().toLowerCase();
}

router.post('/transcribe', async (req, res) => {
  try {
    const { audioBase64, mimeType } = req.body || {};

    if (typeof audioBase64 !== 'string' || audioBase64.length < MIN_BASE64_CHARS) {
      return res.status(400).json({
        success: false,
        error: 'The recording was too short. Please tap the mic and speak for a few seconds.'
      });
    }

    if (audioBase64.length > MAX_BASE64_CHARS) {
      return res.status(413).json({
        success: false,
        error: 'That recording is too long. Please speak for less than a minute.'
      });
    }

    if (!/^[A-Za-z0-9+/=\r\n]+$/.test(audioBase64)) {
      return res.status(400).json({
        success: false,
        error: 'The recording could not be read. Please try again.'
      });
    }

    const safeMime = normaliseMime(mimeType);
    if (!ALLOWED_MIME.has(safeMime)) {
      return res.status(415).json({
        success: false,
        error: 'This audio format is not supported. Please use the in-app microphone.'
      });
    }

    const result = await transcribeAudio({
      audioBase64: audioBase64.replace(/\s+/g, ''),
      mimeType: safeMime
    });

    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.set('Pragma', 'no-cache');
    return res.json({ success: true, data: result });
  } catch (error) {
    console.error('[VoiceCare API] Transcription error:', error.message);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error:
        status >= 500
          ? 'Could not turn the recording into text right now. Please try again, or type it instead.'
          : error.message
    });
  }
});

module.exports = router;
