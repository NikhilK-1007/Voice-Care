/**
 * VoiceCare Frontend Configuration
 *
 * Notice: NEVER put GEMINI_API_KEY in this file!
 * Gemini API calls happen only on the Node.js backend.
 */

window.VOICECARE_CONFIG = {
  /**
   * Backend base URL baked into the app build.
   * Leave empty for emulator/local testing (falls back to the automatic rules
   * below). For an APK on a real phone, set this to a reachable address, e.g.
   * 'http://192.168.1.9:3000' on the same Wi-Fi, or your deployed HTTPS URL.
   */
  API_BASE_URL: 'https://voice-care-t4gz.onrender.com',

  /**
   * Resolves the backend API base URL automatically:
   * 1. Same origin if served by the VoiceCare Express backend (e.g. http://localhost:3000)
   * 2. http://10.0.2.2:3000 inside the Capacitor Android emulator
   * 3. http://localhost:3000 otherwise
   */
  getApiBaseUrl() {
    const configured = String(window.VOICECARE_CONFIG.API_BASE_URL || '')
      .trim()
      .replace(/\/+$/, '');
    if (configured) return configured;

    const { protocol, hostname, port } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && hostname !== 'localhost') {
      return window.location.origin;
    }
    if (protocol === 'http:' && hostname === 'localhost' && port === '3000') {
      return 'http://localhost:3000';
    }

    // Inside Capacitor native Android WebView
    if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
      return 'http://10.0.2.2:3000';
    }

    return 'http://localhost:3000';
  },

  /**
   * Supabase configuration for Authentication & Cloud Sync.
   */
  SUPABASE_CONFIG: {
    url: 'https://jrszguszetsejyxpcncw.supabase.co',
    anonKey: 'sb_publishable_LeAHHwN5ED5dVQVPI307ZQ_G1dP-9AT'
  }
};
