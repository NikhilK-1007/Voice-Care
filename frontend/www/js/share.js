/**
 * VoiceCare QR share
 *
 * Creates a 24-hour read-only link on the backend, draws it as a QR code the
 * doctor can scan, and offers copy / native share. The doctor never logs in and
 * never installs anything.
 */
window.VOICECARE_SHARE = (() => {
  const CACHE_PREFIX = 'voicecare_share_';

  function $(id) {
    return document.getElementById(id);
  }

  function profileSnapshot() {
    const profile = window.VOICECARE_STORAGE?.getProfile?.() || {};
    return {
      name: profile.name || '',
      age: profile.age || '',
      gender: profile.gender || '',
      bloodGroup: profile.bloodGroup || '',
      allergies: profile.allergies || '',
      emergencyContact: profile.emergencyContact || ''
    };
  }

  /** Reuses a link created in the last hour so the QR does not change on every tap. */
  function readCache(entryId) {
    try {
      const raw = localStorage.getItem(`${CACHE_PREFIX}${entryId}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed?.url || !parsed?.expiresAt) return null;
      if (new Date(parsed.expiresAt).getTime() - Date.now() < 60 * 60 * 1000) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function writeCache(entryId, value) {
    try {
      localStorage.setItem(`${CACHE_PREFIX}${entryId}`, JSON.stringify(value));
    } catch {
      /* storage full: the link still works for this session */
    }
  }

  /**
   * Creates (or reuses) a share link for a saved summary.
   * @param {object} entry
   * @returns {Promise<{ url: string, expiresAt: string }>}
   */
  async function ensureLink(entry) {
    if (!entry) throw new Error('There is no summary to share yet.');

    const cached = readCache(entry.id);
    if (cached) return cached;

    const baseUrl = window.VOICECARE_CONFIG.getApiBaseUrl();
    const res = await window.VOICECARE_API.fetchWithTimeout(
      `${baseUrl}/api/share`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          patientText: entry.patientText || '',
          languageLabel: entry.languageLabel || 'English',
          createdAt: entry.createdAt || new Date().toISOString(),
          summary: entry.summary,
          englishSummary: entry.englishSummary,
          urgentFlags: entry.urgentFlags || [],
          missingInfo: entry.missingInfo || [],
          patient: entry.quickInfo || profileSnapshot()
        })
      },
      20000
    );

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json.error || 'Could not create a share link. Check your connection.');
    }

    const value = { url: json.data.url, expiresAt: json.data.expiresAt };
    writeCache(entry.id, value);
    return value;
  }

  /**
   * Draws the QR code onto a canvas element.
   * @param {HTMLCanvasElement} canvas
   * @param {string} text
   */
  function drawQr(canvas, text) {
    if (!canvas) return;
    const factory = window.qrcode;
    if (typeof factory !== 'function') return;

    // Type 0 lets the library pick the smallest version; 'M' is the usual
    // error-correction level for a URL on a phone screen.
    const qr = factory(0, 'M');
    qr.addData(text);
    qr.make();

    const modules = qr.getModuleCount();
    const scale = Math.max(3, Math.floor(240 / modules));
    const size = modules * scale;

    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = '#0f172a';
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (qr.isDark(row, col)) {
          ctx.fillRect(col * scale, row * scale, scale, scale);
        }
      }
    }
  }

  function formatExpiry(iso) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  }

  function setStatus(text, isError = false) {
    const status = $('share-status');
    if (!status) return;
    status.textContent = text || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  /**
   * Shows the QR block for the current entry inside the report screen.
   * @param {object} entry
   */
  async function showForEntry(entry) {
    const wrap = $('share-qr-wrap');
    if (!wrap || !entry) return;

    wrap.classList.remove('hidden');
    setStatus('Creating your 24-hour link…');

    try {
      const link = await ensureLink(entry);
      drawQr($('share-qr-canvas'), link.url);
      $('share-link-text').textContent = link.url;
      $('share-expiry-text').textContent = `This link stops working on ${formatExpiry(link.expiresAt)} (24 hours).`;
      entry.shareUrl = link.url;
      entry.shareExpiresAt = link.expiresAt;
      setStatus('Show this QR code to your doctor. No login needed.');
    } catch (error) {
      setStatus(error.message || 'Could not create the QR code.', true);
    }
  }

  async function copyLink() {
    const url = $('share-link-text')?.textContent || '';
    if (!url) return;
    try {
      await window.VOICECARE_PDF.copyTextSafe(url);
      setStatus('Link copied. Send it to your doctor on WhatsApp or SMS.');
    } catch {
      setStatus('Could not copy. Long-press the link to copy it.', true);
    }
  }

  async function nativeShare(entry) {
    const link = await ensureLink(entry);
    const text = `VoiceCare health summary for your consultation (valid 24 hours): ${link.url}`;
    if (navigator.share) {
      try {
        await navigator.share({ title: 'VoiceCare health summary', text, url: link.url });
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    await window.VOICECARE_PDF.copyTextSafe(text);
    setStatus('Link copied. Send it to your doctor on WhatsApp or SMS.');
  }

  return {
    ensureLink,
    showForEntry,
    drawQr,
    copyLink,
    nativeShare
  };
})();
