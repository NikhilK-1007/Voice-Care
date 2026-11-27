/**
 * VoiceCare Local Storage Manager
 *
 * Persists user session, language preference, accessibility settings,
 * past health summaries, and medicine reminders cleanly on device.
 */

const KEYS = {
  USER: 'voicecare_user',
  LANGUAGE: 'voicecare_language',
  ACCESSIBILITY: 'voicecare_accessibility',
  HISTORY: 'voicecare_history',
  REMINDERS: 'voicecare_reminders',
  DRAFT_TEXT: 'voicecare_draft_text'
};

function safeRead(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function safeWrite(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[VoiceCare Storage] Write failed:', err);
  }
}

window.VOICECARE_STORAGE = {
  getUser() {
    return safeRead(KEYS.USER, null);
  },
  setUser(user) {
    safeWrite(KEYS.USER, user);
  },
  clearUser() {
    localStorage.removeItem(KEYS.USER);
  },

  getLanguage() {
    return localStorage.getItem(KEYS.LANGUAGE) || 'en';
  },
  setLanguage(lang) {
    localStorage.setItem(KEYS.LANGUAGE, lang);
  },

  getAccessibility() {
    return safeRead(KEYS.ACCESSIBILITY, {
      textSize: 'large', // Elderly-friendly default: large readable text
      highContrast: false,
      reducedMotion: false
    });
  },
  setAccessibility(settings) {
    safeWrite(KEYS.ACCESSIBILITY, settings);
  },

  getDraftText() {
    return localStorage.getItem(KEYS.DRAFT_TEXT) || '';
  },
  setDraftText(text) {
    localStorage.setItem(KEYS.DRAFT_TEXT, text);
  },

  getHistory() {
    return safeRead(KEYS.HISTORY, []);
  },
  saveHistoryEntry(entry) {
    const list = safeRead(KEYS.HISTORY, []);
    const index = list.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      list[index] = entry;
    } else {
      list.unshift(entry);
    }
    safeWrite(KEYS.HISTORY, list.slice(0, 50));
    return list;
  },
  deleteHistoryEntry(id) {
    const list = safeRead(KEYS.HISTORY, []).filter((item) => item.id !== id);
    safeWrite(KEYS.HISTORY, list);
    return list;
  },

  getReminders() {
    return safeRead(KEYS.REMINDERS, []);
  },
  saveReminders(reminders) {
    safeWrite(KEYS.REMINDERS, reminders);
  }
};
