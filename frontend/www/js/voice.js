/**
 * VoiceCare built-in voice input.
 *
 * Records with the WebView's MediaRecorder, sends the clip to the VoiceCare
 * backend, and inserts the transcript the AI returns. This replaces the old
 * "install a dictation keyboard" instructions: no third-party app is needed,
 * and any Indian language works because transcription happens on our server.
 */
window.VOICECARE_VOICE = (() => {
  const MAX_RECORD_MS = 60000;
  const MIN_RECORD_MS = 700;
  const MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];

  let recorder = null;
  let stream = null;
  let chunks = [];
  let startedAt = 0;
  let tickId = null;
  let guardId = null;
  let busy = false;
  let bound = false;

  function $(id) {
    return document.getElementById(id);
  }

  function strings() {
    const language = window.VOICECARE_STORAGE?.getLanguage?.() || 'en';
    const active = window.VOICECARE_I18N?.[language] || {};
    const english = window.VOICECARE_I18N?.en || {};
    const pick = (key, fallback) => active[key] || english[key] || fallback;
    return {
      start: pick('voiceStart', 'Tap to speak'),
      stop: pick('voiceStop', 'Tap to stop'),
      listening: pick('voiceListening', 'Listening…'),
      writing: pick('voiceWriting', 'Writing down what you said…'),
      done: pick('voiceDone', 'Added to your description. Check the words, then create the summary.'),
      empty: pick('voiceEmpty', 'We could not hear any words. Please try again.'),
      tooShort: pick('voiceTooShort', 'That was too short. Please speak for a few seconds.'),
      denied: pick(
        'voiceDenied',
        'Microphone permission is off. Allow the microphone for VoiceCare in your phone settings.'
      ),
      unsupported: pick('voiceUnsupported', 'This device cannot record audio here. Please type instead.'),
      failed: pick('voiceUploadFailed', 'Could not write down the recording. Please try again.')
    };
  }

  function setStatus(text, isError = false) {
    const status = $('voice-status');
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function setBusy(value) {
    busy = value;
    const button = $('btn-voice');
    if (button) button.disabled = value;
  }

  function setRecording(value) {
    const button = $('btn-voice');
    const timer = $('voice-timer');
    if (!button) return;
    button.classList.toggle('is-recording', value);
    button.setAttribute('aria-pressed', value ? 'true' : 'false');
    const title = $('voice-title');
    if (title) title.textContent = value ? strings().listening : strings().start;
    if (timer) timer.hidden = !value;
  }

  function updateTimer() {
    const timer = $('voice-timer');
    if (!timer) return;
    const totalSeconds = Math.floor((Date.now() - startedAt) / 1000);
    const mins = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const secs = String(totalSeconds % 60).padStart(2, '0');
    timer.textContent = `${mins}:${secs}`;
  }

  function releaseStream() {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (tickId) {
      clearInterval(tickId);
      tickId = null;
    }
    if (guardId) {
      clearTimeout(guardId);
      guardId = null;
    }
  }

  function pickMimeType() {
    if (typeof MediaRecorder === 'undefined') return '';
    return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result || '');
        resolve(result.slice(result.indexOf(',') + 1));
      };
      reader.onerror = () => reject(new Error('The recording could not be read.'));
      reader.readAsDataURL(blob);
    });
  }

  function appendTranscript(text) {
    const box = $('patient-input-box');
    if (!box) return;
    const existing = box.value.trim();
    box.value = existing ? `${existing} ${text}` : text;
    box.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function upload(blob) {
    setBusy(true);
    setStatus(strings().writing);
    let audioBase64 = '';
    try {
      const baseUrl = window.VOICECARE_CONFIG?.getApiBaseUrl?.() || '';
      if (
        /^http:\/\//i.test(baseUrl) &&
        !/^http:\/\/(localhost|127\.0\.0\.1|10\.0\.2\.2|192\.168\.)/i.test(baseUrl)
      ) {
        throw new Error('Insecure connection blocked. Voice data requires HTTPS.');
      }

      audioBase64 = await blobToBase64(blob);
      const data = await window.VOICECARE_API.transcribe({
        audioBase64,
        mimeType: blob.type || 'audio/webm'
      });
      const text = String(data?.text || '').trim();
      if (!text) {
        setStatus(strings().empty, true);
        return;
      }
      appendTranscript(text);
      setStatus(strings().done);
    } catch (error) {
      setStatus(error.message || strings().failed, true);
    } finally {
      // Immediately clear raw audio data from memory after transcription
      audioBase64 = '';
      chunks = [];
      setBusy(false);
    }
  }

  async function start() {
    if (busy || recorder) return;
    const copy = strings();

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setStatus(copy.unsupported, true);
      return;
    }

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
      });
    } catch (error) {
      const denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
      setStatus(denied ? copy.denied : copy.unsupported, true);
      releaseStream();
      return;
    }

    const mimeType = pickMimeType();
    chunks = [];

    // 32 kbps mono opus is plenty for speech, and a smaller clip uploads a lot
    // faster on a phone's mobile data than the browser's default bitrate.
    const options = { audioBitsPerSecond: 32000 };
    if (mimeType) options.mimeType = mimeType;

    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      setStatus(copy.unsupported, true);
      releaseStream();
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chunks.push(event.data);
    };

    recorder.onstop = () => {
      const durationMs = Date.now() - startedAt;
      const type = recorder?.mimeType || mimeType || 'audio/webm';
      recorder = null;
      releaseStream();
      setRecording(false);

      const blob = new Blob(chunks, { type });
      chunks = [];

      if (durationMs < MIN_RECORD_MS || blob.size === 0) {
        setStatus(strings().tooShort, true);
        return;
      }

      upload(blob);
    };

    startedAt = Date.now();
    recorder.start();
    setRecording(true);
    setStatus('');
    updateTimer();
    tickId = setInterval(updateTimer, 500);
    guardId = setTimeout(stop, MAX_RECORD_MS);
  }

  function stop() {
    if (!recorder) return;
    try {
      recorder.stop();
    } catch {
      /* already stopped */
    }
  }

  /** Drops the current recording without transcribing (used when leaving the screen). */
  function abort() {
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    try {
      recorder.stop();
    } catch {
      /* already stopped */
    }
    recorder = null;
    chunks = [];
    releaseStream();
    setRecording(false);
    setStatus('');
  }

  function toggle() {
    if (recorder) stop();
    else start();
  }

  function refreshLabels() {
    if (recorder) return;
    const title = $('voice-title');
    if (title) title.textContent = strings().start;
  }

  function bind() {
    if (bound) return;
    const button = $('btn-voice');
    if (!button) return;
    bound = true;
    button.addEventListener('click', toggle);
    refreshLabels();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  return { toggle, start, stop, abort, refreshLabels };
})();
