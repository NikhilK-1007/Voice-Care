/**
 * VoiceCare Backend API Client
 *
 * Sends patient text securely to the Node.js + Express backend.
 * Never calls Gemini directly from the browser.
 */

window.VOICECARE_API = {
  async fetchWithTimeout(url, options = {}, timeoutMs = 45000) {
    const externalSignal = options.signal;
    const controller = new AbortController();
    let timedOut = false;

    const onExternalAbort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } catch (err) {
      if (timedOut) {
        throw new Error('The server took too long to respond. Please check your internet connection and try again.');
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
      if (externalSignal) {
        externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }
  },

  async checkHealth() {
    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await this.fetchWithTimeout(
      `${baseUrl}/api/health`,
      {
        method: 'GET',
        headers: { Accept: 'application/json' }
      },
      12000
    );
    if (!res.ok) {
      throw new Error(`Backend responded with status ${res.status}`);
    }
    return res.json();
  },

  async generateSummary({ patientText, language, extraNotes = '', endpoint = 'summarize', signal }) {
    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await this.fetchWithTimeout(
      `${baseUrl}/api/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({
          patientText,
          language,
          extraNotes
        }),
        signal
      },
      55000
    );

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
  async transcribe({ audioBase64, mimeType, signal }) {
    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await this.fetchWithTimeout(
      `${baseUrl}/api/transcribe`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        body: JSON.stringify({ audioBase64, mimeType }),
        signal
      },
      45000
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not reach VoiceCare to write down the recording.');
    }

    return json.data;
  }
};
