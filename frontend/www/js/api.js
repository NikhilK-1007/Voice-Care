/**
 * VoiceCare Backend API Client
 *
 * Sends patient text securely to the Node.js + Express backend.
 * Never calls Gemini directly from the browser.
 */

window.VOICECARE_API = {
  async checkHealth() {
    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/health`, {
      method: 'GET',
      headers: { Accept: 'application/json' }
    });
    if (!res.ok) {
      throw new Error(`Backend responded with status ${res.status}`);
    }
    return res.json();
  },

  async generateSummary({ patientText, language, extraNotes = '', endpoint = 'summarize' }) {
    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({
        patientText,
        language,
        extraNotes
      })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not reach VoiceCare AI backend. Please check that the server is running.');
    }

    return json.data;
  },

  /**
   * Sends a recorded voice clip to the backend for speech-to-text.
   * Resolves to { text, model }; `text` is empty when nothing was said.
   */
  async transcribe({ audioBase64, mimeType }) {
    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await fetch(`${baseUrl}/api/transcribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      body: JSON.stringify({ audioBase64, mimeType })
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not reach VoiceCare to write down the recording.');
    }

    return json.data;
  }
};
