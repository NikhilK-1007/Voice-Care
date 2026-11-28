const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const summaryRoutes = require('./routes/summary');
const transcribeRoutes = require('./routes/transcribe');
const followUpRoutes = require('./routes/followup');
const { getModelChain } = require('./services/geminiService');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
// Trust Render's reverse proxy so rate-limiting applies per client IP
app.set('trust proxy', 1);

// Security headers with strict CSP compatible with Capacitor & Supabase
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: [
          "'self'",
          'https://voice-care-t4gz.onrender.com',
          'https://jrszguszetsejyxpcncw.supabase.co',
          'wss://jrszguszetsejyxpcncw.supabase.co'
        ],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"]
      }
    },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    crossOriginEmbedderPolicy: false
  })
);

// Configure CORS for web browser, Render, and Capacitor Android/iOS origins
const rawAllowed = process.env.ALLOWED_ORIGINS?.trim();
const DEFAULT_SAFE_ORIGINS = [
  'https://localhost',
  'capacitor://localhost',
  'https://voice-care-t4gz.onrender.com'
];

app.use(
  cors({
    origin(origin, callback) {
      // Allow native mobile / curl / same-origin requests with no Origin header
      if (!origin) return callback(null, true);
      if (rawAllowed && rawAllowed !== '*') {
        const list = rawAllowed.split(',').map((o) => o.trim());
        return callback(null, list.includes(origin));
      }
      if (
        DEFAULT_SAFE_ORIGINS.includes(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)
      ) {
        return callback(null, true);
      }
      return callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
  })
);

// Voice notes are far larger than text requests, so that one endpoint gets its
// own body limit before the general JSON parser runs.
app.use('/api/transcribe', express.json({ limit: '12mb' }));
app.use(express.json({ limit: '100kb' }));

// Rate limit API endpoints to protect backend and Gemini quota
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests. Please wait a minute and try again.'
  }
});

const transcribeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many voice recordings. Please wait a minute and try again.'
  }
});

app.use('/api', apiLimiter);
app.use('/api/transcribe', transcribeLimiter);

// Health check endpoint (never exposes secrets)
app.get('/api/health', (_req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiConfigured =
    Boolean(apiKey) &&
    apiKey !== 'your_gemini_api_key_here' &&
    !apiKey.startsWith('REPLACE_');

  const chain = getModelChain();
  res.json({
    status: 'ok',
    service: 'VoiceCare Backend',
    geminiConfigured,
    demoFallbackEnabled: process.env.ALLOW_DEMO_FALLBACK !== 'false',
    model: chain[0] || process.env.GEMINI_MODEL?.trim() || 'gemini-3.1-flash-lite',
    modelChain: chain,
    timestamp: new Date().toISOString()
  });
});

app.use('/api', summaryRoutes);
app.use('/api', transcribeRoutes);
app.use('/api', followUpRoutes);

// Serve only the public mobile web frontend (deny dotfiles like .env)
const frontendDir = path.join(__dirname, '..', 'frontend', 'www');
app.use(express.static(frontendDir, { dotfiles: 'deny' }));

// Return JSON 404 for all unknown /api/* endpoints regardless of HTTP verb
app.all('/api/*', (_req, res) => {
  return res.status(404).json({ success: false, error: 'API endpoint not found.' });
});

// Fallback to index.html for unknown non-API routes
app.get('*', (_req, res) => {
  return res.sendFile(path.join(frontendDir, 'index.html'));
});

// Production error handler (never leak stack traces or internal details)
app.use((err, _req, res, _next) => {
  if (err && err.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Origin not allowed.' });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Invalid JSON request body.' });
  }
  console.error('[VoiceCare Server Error]:', err?.message || 'Unknown error');
  return res.status(500).json({ success: false, error: 'Internal server error.' });
});

if (require.main === module) {
  // Bind to all interfaces so a phone on the same Wi-Fi can reach the API.
  const HOST = process.env.HOST?.trim() || '0.0.0.0';

  const server = app.listen(PORT, HOST, () => {
    console.log(`VoiceCare backend running at http://localhost:${PORT}`);
    if (HOST === '0.0.0.0') {
      console.log(
        `Phone testing: use this computer's Wi-Fi IP, e.g. http://192.168.1.9:${PORT} (run ipconfig to confirm)`
      );
    }
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `Port ${PORT} is already in use. Either VoiceCare is already running, or another app is using port ${PORT}.`
      );
      console.error(
        'Stop the other Node process (or change PORT in backend/.env) and try again.'
      );
      process.exit(1);
    }
    throw err;
  });
}

module.exports = app;
