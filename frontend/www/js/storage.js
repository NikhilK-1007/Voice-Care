/**
 * VoiceCare Local Storage Manager
 *
 * Persists user session, language preference, accessibility settings, the
 * quick-info card, and past health summaries cleanly on device.
 */

const KEYS = {
  USER: 'voicecare_user',
  LANGUAGE: 'voicecare_language',
  ACCESSIBILITY: 'voicecare_accessibility',
  HISTORY: 'voicecare_history',
  PROFILE: 'voicecare_quick_info',
  DELETED: 'voicecare_deleted_ids',
  PHOTOS: 'voicecare_photos',
  PATIENTS: 'voicecare_patients',
  ACTIVE_PATIENT: 'voicecare_active_patient',
  PRESCRIPTIONS: 'voicecare_prescriptions',
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
      Boolean(safeRead(KEYS.USER, null)) || safeRead(KEYS.HISTORY, []).length > 0;
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
    // Remember the deletion so the next cloud sync does not bring the visit back.
    const deleted = safeRead(KEYS.DELETED, []).filter((x) => x !== id);
    deleted.push(id);
    safeWrite(KEYS.DELETED, deleted.slice(-100));
    window.VOICECARE_STORAGE.deletePhotos(id);
    return list;
  },

  /** Ids the patient deleted while offline; the next sync removes them from the cloud. */
  getDeletedIds() {
    return safeRead(KEYS.DELETED, []).filter((x) => typeof x === 'string');
  },
  clearDeletedIds() {
    safeWrite(KEYS.DELETED, []);
  },

  /**
   * Report photos (lab slips, prescriptions, rash photos) live beside the
   * entry, not inside it, so saving/editing a summary never rewrites images.
   * @param {string} entryId
   * @returns {Array<{ id: string, dataUrl: string, addedAt: string }>}
   */
  getPhotos(entryId) {
    const map = safeRead(KEYS.PHOTOS, {}) || {};
    const list = map[entryId];
    return Array.isArray(list) ? list.filter((p) => p && p.dataUrl) : [];
  },
  savePhotos(entryId, photos) {
    if (!entryId) return [];
    const map = safeRead(KEYS.PHOTOS, {}) || {};
    const list = (Array.isArray(photos) ? photos : [])
      .filter((p) => p && typeof p.dataUrl === 'string')
      .slice(0, 4);
    if (list.length) map[entryId] = list;
    else delete map[entryId];
    safeWrite(KEYS.PHOTOS, map);
    return list;
  },
  deletePhotos(entryId) {
    const map = safeRead(KEYS.PHOTOS, {}) || {};
    if (map[entryId]) {
      delete map[entryId];
      safeWrite(KEYS.PHOTOS, map);
    }
  },
  countPhotos(entryId) {
    return window.VOICECARE_STORAGE.getPhotos(entryId).length;
  },

  /**
   * Patient records, added one by one by the doctor. The first patient is
   * migrated from the old single quick-info card so no data is lost.
   * @returns {Array<{id: string, name: string, age: string, gender: string, bloodGroup: string, allergies: string, emergencyContact: string}>}
   */
  getPatients() {
    const list = safeRead(scopedKey(KEYS.PATIENTS), []);
    if (Array.isArray(list) && list.length) {
      return list.filter((item) => item && item.id);
    }

    const legacy = safeRead(scopedKey(KEYS.PROFILE), null);
    if (
      legacy &&
      (legacy.name || legacy.age || legacy.bloodGroup || legacy.allergies || legacy.emergencyContact)
    ) {
      const now = new Date().toISOString();
      const migrated = {
        id: `pat_${Date.now()}`,
        name: String(legacy.name || '').trim().slice(0, 80),
        age: String(legacy.age || '').trim().slice(0, 3),
        gender: String(legacy.gender || '').trim().slice(0, 20),
        bloodGroup: String(legacy.bloodGroup || '').trim().slice(0, 8),
        allergies: String(legacy.allergies || '').trim().slice(0, 200),
        emergencyContact: String(legacy.emergencyContact || '').trim().slice(0, 20),
        createdAt: legacy.createdAt || now,
        updatedAt: legacy.updatedAt || now
      };
      safeWrite(scopedKey(KEYS.PATIENTS), [migrated]);
      localStorage.setItem(scopedKey(KEYS.ACTIVE_PATIENT), migrated.id);
      return [migrated];
    }
    return [];
  },

  getActivePatient() {
    const list = window.VOICECARE_STORAGE.getPatients();
    const id = localStorage.getItem(scopedKey(KEYS.ACTIVE_PATIENT));
    return list.find((item) => item.id === id) || list[0] || null;
  },

  getActivePatientId() {
    return window.VOICECARE_STORAGE.getActivePatient()?.id || null;
  },

  setActivePatient(id) {
    if (!id) return;
    localStorage.setItem(scopedKey(KEYS.ACTIVE_PATIENT), id);
  },

  /**
   * Creates or updates one patient record. Passing no id creates a new record.
   * The active patient doubles as the legacy profile so PDFs and cloud sync keep
   * working without changes.
   */
  savePatient(patient = {}) {
    const list = window.VOICECARE_STORAGE.getPatients();
    const existing = patient.id ? list.find((item) => item.id === patient.id) : null;
    const now = new Date().toISOString();
    const clean = {
      id: existing?.id || `pat_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: String(patient.name || '').trim().slice(0, 80),
      age: String(patient.age || '').trim().slice(0, 3),
      gender: String(patient.gender || '').trim().slice(0, 20),
      bloodGroup: String(patient.bloodGroup || '').trim().slice(0, 8),
      allergies: String(patient.allergies || '').trim().slice(0, 200),
      emergencyContact: String(patient.emergencyContact || '').trim().slice(0, 20),
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    const next = existing
      ? list.map((item) => (item.id === clean.id ? clean : item))
      : [...list, clean];
    safeWrite(scopedKey(KEYS.PATIENTS), next);

    if (!window.VOICECARE_STORAGE.getActivePatientId()) {
      localStorage.setItem(scopedKey(KEYS.ACTIVE_PATIENT), clean.id);
    }
    // Keep the plain profile key in step for older code and cloud metadata.
    const activeId = localStorage.getItem(scopedKey(KEYS.ACTIVE_PATIENT));
    if (!activeId || activeId === clean.id) {
      safeWrite(scopedKey(KEYS.PROFILE), clean);
    }
    return clean;
  },

  deletePatient(id) {
    const list = window.VOICECARE_STORAGE.getPatients().filter((item) => item.id !== id);
    safeWrite(scopedKey(KEYS.PATIENTS), list);

    const rxMap = safeRead(scopedKey(KEYS.PRESCRIPTIONS), {}) || {};
    if (rxMap[id]) {
      delete rxMap[id];
      safeWrite(scopedKey(KEYS.PRESCRIPTIONS), rxMap);
    }

    if (localStorage.getItem(scopedKey(KEYS.ACTIVE_PATIENT)) === id) {
      if (list[0]) {
        localStorage.setItem(scopedKey(KEYS.ACTIVE_PATIENT), list[0].id);
        safeWrite(scopedKey(KEYS.PROFILE), list[0]);
      } else {
        localStorage.removeItem(scopedKey(KEYS.ACTIVE_PATIENT));
        localStorage.removeItem(scopedKey(KEYS.PROFILE));
      }
    }
    return list;
  },

  /**
   * Prescription files (photos or a PDF) attached to one patient.
   * @returns {Array<{id: string, kind: 'image'|'document', name: string, dataUrl: string, addedAt: string}>}
   */
  getPrescriptions(patientId) {
    if (!patientId) return [];
    const map = safeRead(scopedKey(KEYS.PRESCRIPTIONS), {}) || {};
    const list = map[patientId];
    return Array.isArray(list) ? list.filter((item) => item && item.dataUrl) : [];
  },

  savePrescriptions(patientId, files) {
    if (!patientId) return [];
    const map = safeRead(scopedKey(KEYS.PRESCRIPTIONS), {}) || {};
    const list = (Array.isArray(files) ? files : [])
      .filter((item) => item && typeof item.dataUrl === 'string')
      .slice(0, 6);
    if (list.length) map[patientId] = list;
    else delete map[patientId];
    safeWrite(scopedKey(KEYS.PRESCRIPTIONS), map);
    return list;
  },

  /**
   * The active patient's details, in the shape PDFs, summaries and cloud sync
   * already expect.
   * @returns {{ name: string, age: string, gender: string, bloodGroup: string, allergies: string, emergencyContact: string }}
   */
  getProfile() {
    const raw = window.VOICECARE_STORAGE.getActivePatient() || safeRead(scopedKey(KEYS.PROFILE), null) || {};
    return {
      name: typeof raw.name === 'string' ? raw.name : '',
      age: typeof raw.age === 'string' ? raw.age : '',
      gender: typeof raw.gender === 'string' ? raw.gender : '',
      bloodGroup: typeof raw.bloodGroup === 'string' ? raw.bloodGroup : '',
      allergies: typeof raw.allergies === 'string' ? raw.allergies : '',
      emergencyContact:
        typeof raw.emergencyContact === 'string' ? raw.emergencyContact : ''
    };
  },
  hasProfile() {
    const profile = window.VOICECARE_STORAGE.getProfile();
    return Boolean(profile.name || profile.age || profile.bloodGroup || profile.allergies);
  },
  saveProfile(profile) {
    const active = window.VOICECARE_STORAGE.getActivePatient();
    return window.VOICECARE_STORAGE.savePatient({ ...profile, id: active?.id });
  },

  /**
   * Moves local guest/pre-login history into a signed-in user's storage bucket
   * so nothing recorded before signing in is lost on upgrade.
   */
  adoptGuestDataForUser(uid) {
    if (!uid || uid === 'guest-demo') return { adoptedHistory: 0 };

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

    // The quick-info card follows the account too, but never overwrites details
    // the signed-in patient already saved.
    const guestProfile = safeRead(KEYS.PROFILE, null);
    if (guestProfile && !safeRead(scopedKey(KEYS.PROFILE, uid), null)) {
      safeWrite(scopedKey(KEYS.PROFILE, uid), guestProfile);
    }

    return { adoptedHistory };
  }
};
