const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const summaryRoutes = require('./routes/summary');
const transcribeRoutes = require('./routes/transcribe');
const { getModelChain } = require('./services/geminiService');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Security headers (allow inline styles/scripts needed by local mobile web assets)
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
  })
);

// Configure CORS for web browser + Capacitor Android/iOS origins
const allowedOrigins = process.env.ALLOWED_ORIGINS || '*';
app.use(
  cors({
    origin: allowedOrigins === '*' ? true : allowedOrigins.split(',').map((o) => o.trim()),
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

app.use('/api', apiLimiter);

// Health check endpoint (never exposes secrets)
app.get('/api/health', (_req, res) => {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const geminiConfigured =
    Boolean(apiKey) &&
    apiKey !== 'your_gemini_api_key_here' &&
    !apiKey.startsWith('REPLACE_');

  res.json({
    status: 'ok',
    service: 'VoiceCare Backend',
    geminiConfigured,
    demoFallbackEnabled: process.env.ALLOW_DEMO_FALLBACK !== 'false',
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-3.8-flash',
    modelChain: getModelChain(),
    timestamp: new Date().toISOString()
  });
});

app.use('/api', summaryRoutes);
app.use('/api', transcribeRoutes);

// Serve the mobile web frontend from ../frontend/www for easy local development
const frontendDir = path.join(__dirname, '..', 'frontend', 'www');
app.use(express.static(frontendDir));

// Fallback to index.html for unknown non-API routes
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ success: false, error: 'API endpoint not found.' });
  }
  return res.sendFile(path.join(frontendDir, 'index.html'));
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
