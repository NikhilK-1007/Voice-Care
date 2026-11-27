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
  REMINDERS_META: 'voicecare_reminders_meta',
  DRAFT_TEXT: 'voicecare_draft_text',
  ONBOARDED: 'voicecare_onboarded'
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

function getActiveUid() {
  const user = safeRead(KEYS.USER, null);
  if (!user || !user.uid) return 'guest-demo';
  if (user.expiresAt && Date.now() > user.expiresAt) return 'guest-demo';
  return String(user.uid);
}

function scopedKey(baseKey, uid = getActiveUid()) {
  if (!uid || uid === 'guest-demo') return baseKey;
  return `${baseKey}_${uid}`;
}

window.VOICECARE_STORAGE = {
  hasOnboarded() {
    if (localStorage.getItem(KEYS.ONBOARDED) === '1') return true;
    // Existing installs upgrading to this version shouldn't re-see first-install prompt
    const hasExistingData =
      Boolean(safeRead(KEYS.USER, null)) ||
      safeRead(KEYS.HISTORY, []).length > 0 ||
      safeRead(KEYS.REMINDERS, []).length > 0;
    if (hasExistingData) {
      localStorage.setItem(KEYS.ONBOARDED, '1');
      return true;
    }
    return false;
  },
  setOnboarded(value = true) {
    if (value) localStorage.setItem(KEYS.ONBOARDED, '1');
    else localStorage.removeItem(KEYS.ONBOARDED);
  },

  getUser() {
    const data = safeRead(KEYS.USER, null);
    if (!data) return null;
    if (data.expiresAt && Date.now() > data.expiresAt) {
      localStorage.removeItem(KEYS.USER);
      return null;
    }
    return data;
  },
  setUser(user, { rememberDays = 30 } = {}) {
    if (!user) return;
    localStorage.setItem(KEYS.ONBOARDED, '1');
    const expiresAt = Date.now() + rememberDays * 24 * 60 * 60 * 1000;
    safeWrite(KEYS.USER, { ...user, expiresAt });
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
    return localStorage.getItem(scopedKey(KEYS.DRAFT_TEXT)) || '';
  },
  setDraftText(text) {
    localStorage.setItem(scopedKey(KEYS.DRAFT_TEXT), text);
  },

  getHistory(uid) {
    return safeRead(scopedKey(KEYS.HISTORY, uid), []);
  },
  replaceHistory(list, uid) {
    safeWrite(scopedKey(KEYS.HISTORY, uid), (Array.isArray(list) ? list : []).slice(0, 50));
  },
  saveHistoryEntry(entry, uid) {
    const key = scopedKey(KEYS.HISTORY, uid);
    const list = safeRead(key, []);
    const index = list.findIndex((item) => item.id === entry.id);
    if (index >= 0) {
      list[index] = entry;
    } else {
      list.unshift(entry);
    }
    const trimmed = list.slice(0, 50);
    safeWrite(key, trimmed);
    return trimmed;
  },
  deleteHistoryEntry(id, uid) {
    const key = scopedKey(KEYS.HISTORY, uid);
    const list = safeRead(key, []).filter((item) => item.id !== id);
    safeWrite(key, list);
    return list;
  },

  getReminders(uid) {
    return safeRead(scopedKey(KEYS.REMINDERS, uid), []);
  },
  saveReminders(reminders, uid) {
    safeWrite(scopedKey(KEYS.REMINDERS, uid), Array.isArray(reminders) ? reminders : []);
  },
  getDeletedReminderIds(uid) {
    return safeRead(scopedKey(KEYS.REMINDERS_META, uid), []);
  },
  saveDeletedReminderIds(ids, uid) {
    safeWrite(scopedKey(KEYS.REMINDERS_META, uid), (Array.isArray(ids) ? ids : []).slice(0, 30));
  },
  recordDeletedReminderId(id, uid) {
    if (!id) return [];
    const current = safeRead(scopedKey(KEYS.REMINDERS_META, uid), []);
    const next = [id, ...current.filter((x) => x !== id)].slice(0, 30);
    safeWrite(scopedKey(KEYS.REMINDERS_META, uid), next);
    return next;
  },

  /**
   * Moves local guest/pre-login history and reminders into a signed-in user's
   * storage bucket so nothing recorded before signing in is lost on upgrade.
   */
  adoptGuestDataForUser(uid) {
    if (!uid || uid === 'guest-demo') return { adoptedHistory: 0, adoptedReminders: 0 };

    const guestHistory = safeRead(KEYS.HISTORY, []);
    let adoptedHistory = 0;
    if (guestHistory.length > 0) {
      const userHistory = safeRead(scopedKey(KEYS.HISTORY, uid), []);
      const seen = new Set(userHistory.map((item) => item.id));
      const merged = [...userHistory];
      for (const item of guestHistory) {
        if (item?.id && !seen.has(item.id)) {
          merged.push({ ...item, synced: false });
          seen.add(item.id);
          adoptedHistory += 1;
        }
      }
      merged.sort((a, b) =>
        String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || ''))
      );
      safeWrite(scopedKey(KEYS.HISTORY, uid), merged.slice(0, 50));
      safeWrite(KEYS.HISTORY, []);
    }

    const guestReminders = safeRead(KEYS.REMINDERS, []);
    let adoptedReminders = 0;
    if (guestReminders.length > 0) {
      const userReminders = safeRead(scopedKey(KEYS.REMINDERS, uid), []);
      const seenRem = new Set(userReminders.map((r) => r.id));
      const mergedRem = [...userReminders];
      for (const rem of guestReminders) {
        if (rem?.id && !seenRem.has(rem.id)) {
          mergedRem.push({ ...rem, updatedAt: rem.updatedAt || new Date().toISOString() });
          seenRem.add(rem.id);
          adoptedReminders += 1;
        }
      }
      safeWrite(scopedKey(KEYS.REMINDERS, uid), mergedRem);
      safeWrite(KEYS.REMINDERS, []);
    }

    return { adoptedHistory, adoptedReminders };
  }
};
